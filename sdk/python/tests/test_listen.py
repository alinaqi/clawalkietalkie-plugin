import time

from conftest import until

FAST = {"wait_seconds": 25, "backoff": (0.001, 0.008), "random": lambda: 0.5}


def listening(relay, client):
    agent = client.agent(name="bot", client="example", instance_id="ib")
    agent.claim()
    relay.add_session("cat", instance_id="ic")
    return agent


def test_handles_then_acks_with_the_cursor(relay, client):
    agent = listening(relay, client)
    seen, acked_during = [], []

    def handler(message):
        acked_during.append(len(relay.calls_to("ack$")))
        seen.append(message.text)

    stop = agent.listen(handler, **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="one")
    until(lambda: len(relay.calls_to("ack$")) == 1)
    relay.deliver("bot", id="m2", **{"from": "cc:cat"}, text="two")
    until(lambda: len(relay.calls_to("ack$")) == 2)
    stop()
    assert seen == ["one", "two"] and acked_during == [0, 1]
    assert relay.calls_to("ack$")[0].body == {"instanceId": "ib", "ids": ["m1"]}
    polls = relay.calls_to("^/v1/inbox/bot$")
    assert "after" not in polls[0].query and polls[0].query["wait"] == "25"
    assert polls[-1].query["after"].startswith("c")


def test_redelivers_what_the_handler_threw_on(relay, client):
    agent = listening(relay, client)
    attempts, errors = [], []

    def handler(message):
        attempts.append(message.id)
        if len(attempts) < 3:
            raise RuntimeError("not yet")

    stop = agent.listen(handler, on_error=lambda e, info: errors.append(info), **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="flaky")
    until(lambda: len(relay.calls_to("ack$")) == 1)
    stop()
    assert attempts == ["m1", "m1", "m1"]
    assert [e["message"].id for e in errors] == ["m1", "m1"]


def test_backs_off_doubling_to_the_cap(relay, client):
    agent = listening(relay, client)
    for _ in range(5):
        relay.fail("^/v1/inbox/bot$", 503, body={"error": "busy"})
    delays, seen = [], []
    stop = agent.listen(lambda m: seen.append(m.id), on_error=lambda e, info: delays.append(info["delay"]), **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="x")
    until(lambda: seen == ["m1"])
    stop()
    assert delays == [0.001, 0.002, 0.004, 0.008, 0.008]


def test_cursor_refused_ack_failed_and_fatal(relay, client):
    agent = listening(relay, client)
    seen = []
    relay.fail("ack$", 503, body={"error": "busy"})
    stop = agent.listen(lambda m: seen.append(m.id), **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="x")
    until(lambda: relay.inboxes["bot"] == [])
    relay.fail("^/v1/inbox/bot$", 400, body={"error": "invalid_request"})
    relay.deliver("bot", id="m2", **{"from": "cc:cat"}, text="y")
    until(lambda: seen == ["m1", "m2"])
    stop()
    relay.fail("^/v1/inbox/bot$", 401, body={"error": "unauthorized"})
    infos = []
    listener = agent.listen(lambda m: None, on_error=lambda e, info: infos.append(info), **FAST)
    listener.join(1)
    assert infos[0]["fatal"] is True and not listener.running


def test_reply_discard_and_stop(relay, client):
    agent = listening(relay, client)

    def handler(message):
        if message.text == "spam":
            message.discard()
        else:
            message.reply(f"echo: {message.text}")

    relay.wait_scale = 0.02
    stop = agent.listen(handler, **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="hi", hop=2)
    relay.deliver("bot", id="m2", **{"from": "cc:cat"}, text="spam")
    until(lambda: relay.calls_to("discard$") and relay.calls_to("ack$"))
    started = time.monotonic()
    stop()
    assert time.monotonic() - started < 1
    reply = relay.calls_to("^/v1/messages$")[0].body
    assert reply == {
        "from": "bot",
        "instanceId": "ib",
        "to": "cc:cat",
        "text": "echo: hi",
        "type": "note",
        "replyTo": "m1",
        "hop": 3,
    }
    assert relay.calls_to("ack$")[0].body["ids"] == ["m1"]
    assert relay.calls_to("discard$")[0].body["ids"] == ["m2"]


def test_stop_returns_at_once_mid_poll_and_drops_what_the_poll_brings(relay, client):
    agent = listening(relay, client)
    relay.wait_scale = 0.04
    seen = []
    listener = agent.listen(lambda m: seen.append(m.id), **FAST)
    until(lambda: len(relay.calls_to("^/v1/inbox/bot$")) == 1)
    started = time.monotonic()
    listener.stop()
    assert time.monotonic() - started < 0.2
    assert not listener.running
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="late")
    listener.join(2)
    assert seen == [] and relay.calls_to("ack$") == []
    assert len(relay.inboxes["bot"]) == 1


def test_a_long_poll_cut_by_the_network_is_an_empty_answer(relay, client):
    agent = listening(relay, client)
    relay.fail("^/v1/inbox/bot$", network=True, after=0.03)
    errors, seen = [], []
    stop = agent.listen(lambda m: seen.append(m.id), cut_after=0.02, on_error=lambda e, i: errors.append(e), **FAST)
    until(lambda: len(relay.calls_to("^/v1/inbox/bot$")) >= 2)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="x")
    until(lambda: seen == ["m1"])
    stop()
    assert errors == []


def test_wait_for_reply_polls_again_after_a_cut(relay, client):
    agent = listening(relay, client)
    sent = agent.send("cat", "ping")
    relay.fail("^/v1/replies$", network=True, after=0.03)
    assert agent.wait_for_reply(sent["id"], timeout=1.5, cut_after=0.02)["timedOut"] is True
    assert len(relay.calls_to("^/v1/replies$")) > 1
