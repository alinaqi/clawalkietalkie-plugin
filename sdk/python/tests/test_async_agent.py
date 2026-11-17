import asyncio

import pytest

from clawalkietalkie import ClawalkietalkieError


async def test_claim_send_status_reply(relay, async_client):
    a = async_client.agent(name="a", client="example", instance_id="ia")
    b = async_client.agent(name="b", client="example", instance_id="ib")
    assert await a.claim() == "ex:a"
    await b.claim()
    relay.fail(r"^/v1/messages$", 502, body={"error": "bad_gateway"})
    sent = await a.send("b", "ping", type="request")
    assert len(relay.calls_to(r"^/v1/messages$")) == 2
    assert (await a.status(sent["id"]))["status"] == "queued"
    asyncio.get_running_loop().call_later(0.02, lambda: asyncio.ensure_future(b.send("a", "pong", reply_to=sent["id"])))
    answer = await a.wait_for_reply(sent["id"], timeout=2)
    assert answer["replies"][0]["text"] == "pong"
    await a.set_status("idle", "done for now")
    await a.close()
    assert relay.sessions["a"]["closed"] is True


async def test_async_files_and_errors(relay, async_client):
    agent = async_client.agent(name="a", client="example", instance_id="ia")
    uploaded = await async_client.upload_file(b"hi", "n.txt", agent)
    assert await async_client.download_file(uploaded["id"], agent) == b"hi"
    relay.add_session("bot")
    with pytest.raises(ClawalkietalkieError, match="name_taken"):
        await async_client.agent(name="bot", client="example").claim()
    async with async_client:
        pass
