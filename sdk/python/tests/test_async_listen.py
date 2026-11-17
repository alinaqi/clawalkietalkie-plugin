import time

from conftest import until_async

FAST = {"wait_seconds": 25, "backoff": (0.001, 0.008), "random": lambda: 0.5}


async def listening(relay, client):
    agent = client.agent(name="bot", client="example", instance_id="ib")
    await agent.claim()
    relay.add_session("cat", instance_id="ic")
    return agent


async def test_handles_acks_and_replies(relay, async_client):
    agent = await listening(relay, async_client)

    async def handler(message):
        if message.text == "spam":
            await message.discard()
        else:
            await message.reply(f"echo: {message.text}")

    stop = agent.listen(handler, **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="hi")
    relay.deliver("bot", id="m2", **{"from": "cc:cat"}, text="spam")
    await until_async(lambda: relay.calls_to("ack$") and relay.calls_to("discard$"))
    await stop()
    assert relay.calls_to("^/v1/messages$")[0].body["replyTo"] == "m1"
    assert relay.calls_to("ack$")[0].body["ids"] == ["m1"]


async def test_redelivers_and_backs_off(relay, async_client):
    agent = await listening(relay, async_client)
    relay.fail("^/v1/inbox/bot$", 503, body={"error": "busy"})
    attempts, delays = [], []

    async def handler(message):
        attempts.append(message.id)
        if len(attempts) < 2:
            raise RuntimeError("not yet")

    stop = agent.listen(handler, on_error=lambda e, info: delays.append(info["delay"]), **FAST)
    relay.deliver("bot", id="m1", **{"from": "cc:cat"}, text="x")
    await until_async(lambda: len(relay.calls_to("ack$")) == 1)
    await stop()
    assert attempts == ["m1", "m1"] and delays == [0.001, 0.002]


async def test_stop_ends_a_long_poll_at_once(relay, async_client):
    agent = await listening(relay, async_client)
    relay.wait_scale = 10
    stop = agent.listen(lambda m: None, **FAST)
    await until_async(lambda: len(relay.calls_to("^/v1/inbox/bot$")) == 1)
    started = time.monotonic()
    await stop()
    assert time.monotonic() - started < 0.5


async def test_close_stops_listening_and_fatal_ends(relay, async_client):
    agent = await listening(relay, async_client)
    agent.listen(lambda m: None, **FAST)
    await until_async(lambda: len(relay.calls_to("^/v1/inbox/bot$")) == 1)
    await agent.close()
    assert relay.sessions["bot"]["closed"] is True
    relay.fail("^/v1/inbox/bot$", 403, body={"error": "not_holder"})
    infos = []
    stop = agent.listen(lambda m: None, on_error=lambda e, info: infos.append(info), **FAST)
    await until_async(lambda: bool(infos))
    await stop()
    assert infos[0]["fatal"] is True


async def test_async_cut_polls_are_empty_answers(relay, async_client):
    agent = await listening(relay, async_client)
    relay.fail("^/v1/inbox/bot$", network=True, after=0.03)
    errors = []
    stop = agent.listen(lambda m: None, cut_after=0.02, on_error=lambda e, i: errors.append(e), **FAST)
    await until_async(lambda: len(relay.calls_to("^/v1/inbox/bot$")) >= 2)
    await stop()
    sent = await agent.send("cat", "ping")
    relay.fail("^/v1/replies$", network=True, after=0.03)
    assert (await agent.wait_for_reply(sent["id"], timeout=1.5, cut_after=0.02))["timedOut"] is True
    assert errors == []
