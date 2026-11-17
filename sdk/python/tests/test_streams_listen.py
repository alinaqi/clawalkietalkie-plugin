import pytest
from conftest import until, until_async
from fake_streams import publish

FAST = {"wait_seconds": 25, "backoff": (0.001, 0.008), "random": lambda: 0.5}


def setup(relay, client):
    pub = client.agent(name="pub", client="example", kind="cc", instance_id="ip")
    fan = client.agent(name="fan", client="example", kind="cc", instance_id="if")
    pub.claim()
    fan.claim()
    pub.set_streaming(True)
    fan.follow("pub")
    return pub, fan


def feed_polls(relay):
    return relay.calls_to("^/v1/updates$", "GET")


def test_listen_runs_the_updates_feed_with_its_own_cursor(relay, client):
    _, fan = setup(relay, client)
    updates, messages = [], []
    stop = fan.listen(lambda m: messages.append(m.text), on_update=lambda u: updates.append(u["text"]), **FAST)
    publish(relay, "pub", ["one"])
    until(lambda: updates == ["one"])
    publish(relay, "pub", ["two"])
    until(lambda: updates == ["one", "two"])
    relay.deliver("fan", id="m1", **{"from": "cc:pub"}, text="hi")
    until(lambda: messages == ["hi"])
    stop()
    polls = feed_polls(relay)
    assert "after" not in polls[0].query and polls[0].query["wait"] == "25"
    assert polls[-1].query["after"] == "u2"


def test_listen_without_on_update_never_reads_the_feed(relay, client):
    _, fan = setup(relay, client)
    stop = fan.listen(lambda m: None, **FAST)
    until(lambda: len(relay.calls_to("^/v1/inbox/fan$")) >= 1)
    stop()
    assert feed_polls(relay) == []


def test_feed_errors_back_off_and_a_raising_handler_is_reported(relay, client):
    _, fan = setup(relay, client)
    for _ in range(3):
        relay.fail("^/v1/updates$", 503, body={"error": "busy"}, method="GET")
    infos, seen = [], []

    def on_update(update):
        seen.append(update["text"])
        if update["text"] == "bad":
            raise RuntimeError("handler")

    stop = fan.listen(lambda m: None, on_update=on_update, on_error=lambda e, i: infos.append((e, i)), **FAST)
    publish(relay, "pub", ["bad", "good"])
    until(lambda: seen == ["bad", "good"])
    stop()
    assert [i["delay"] for _, i in infos[:3]] == [0.001, 0.002, 0.004]
    assert str(infos[3][0]) == "handler" and infos[3][1]["update"]["text"] == "bad"


def test_stop_ends_both_loops(relay, client):
    _, fan = setup(relay, client)
    relay.wait_scale = 0.04
    listener = fan.listen(lambda m: None, on_update=lambda u: None, **FAST)
    until(lambda: feed_polls(relay) and relay.calls_to("^/v1/inbox/fan$"))
    assert listener.running
    listener.stop()
    assert not listener.running
    listener.join(3)
    publish(relay, "pub", ["late"])
    assert len(feed_polls(relay)) == 1


@pytest.mark.parametrize("code", ["invalid_cursor", "invalid_request"])
def test_a_refused_feed_cursor_reads_from_the_start_and_401_is_fatal(relay, client, code):
    _, fan = setup(relay, client)
    seen, infos = [], []
    stop = fan.listen(lambda m: None, on_update=lambda u: seen.append(u["id"]), **FAST)
    publish(relay, "pub", ["a"])
    until(lambda: seen == ["u1"])
    relay.fail("^/v1/updates$", 400, body={"error": code}, method="GET")
    publish(relay, "pub", ["b"])
    until(lambda: "u2" in seen)
    stop()
    relay.fail("^/v1/updates$", 401, body={"error": "unauthorized"}, method="GET")
    listener = fan.listen(lambda m: None, on_update=lambda u: None, on_error=lambda e, i: infos.append(i), **FAST)
    until(lambda: infos)
    listener.stop()
    assert infos[0]["fatal"] is True


async def test_async_listen_runs_the_feed_and_stop_ends_both(relay, async_client):
    pub = async_client.agent(name="pub", client="example", kind="cc", instance_id="ip")
    fan = async_client.agent(name="fan", client="example", kind="cc", instance_id="if")
    await fan.claim()
    await pub.set_streaming(True)
    await fan.follow("pub")
    updates, infos = [], []

    async def on_update(update):
        updates.append(update["text"])
        if update["text"] == "bad":
            raise RuntimeError("handler")

    relay.fail("^/v1/updates$", 503, body={"error": "busy"}, method="GET")
    stop = fan.listen(lambda m: None, on_update=on_update, on_error=lambda e, i: infos.append(i), **FAST)
    await pub.post_update("bad")
    await pub.post_update("good")
    await until_async(lambda: updates == ["bad", "good"])
    relay.wait_scale = 0.04
    await stop()
    assert not stop.running
    assert infos[0]["delay"] == 0.001 and infos[1]["update"]["text"] == "bad"


async def test_async_listen_without_on_update_never_reads_the_feed(relay, async_client):
    fan = async_client.agent(name="fan", client="example", kind="cc", instance_id="if")
    stop = fan.listen(lambda m: None, **FAST)
    await until_async(lambda: relay.calls_to("^/v1/inbox/fan$"))
    await stop()
    assert relay.calls_to("^/v1/updates$") == []
