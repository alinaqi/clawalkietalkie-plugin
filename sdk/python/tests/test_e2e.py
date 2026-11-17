"""Opt-in, against a local relay only (never production): CLAWALKIETALKIE_E2E_SERVER=http://127.0.0.1:8797 and
CLAWALKIETALKIE_E2E_LOG=<the relay's log file>, where the development relay writes sign-in codes."""

import asyncio
import json
import os
import re
import time
from pathlib import Path

import pytest

from clawalkietalkie import (
    AsyncClient,
    BlockedByPublisher,
    ClawalkietalkieError,
    Client,
    NotStreaming,
    PlanRequired,
    async_sign_in,
    sign_in,
)

SERVER = os.environ.get("CLAWALKIETALKIE_E2E_SERVER", "")
LOG = os.environ.get("CLAWALKIETALKIE_E2E_LOG", "")
LOCAL = re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?/?$", SERVER) is not None

pytestmark = pytest.mark.skipif(not (LOCAL and LOG), reason="set CLAWALKIETALKIE_E2E_SERVER (localhost) and _LOG")


@pytest.fixture(autouse=True)
def local_only(monkeypatch):
    """Anything that forgets server= goes to the local relay too, never to production."""
    monkeypatch.setenv("CLAWALKIETALKIE_SERVER", SERVER)


def code_for(email: str) -> str:
    for _ in range(50):
        lines = [line for line in Path(LOG).read_text().splitlines() if email in line and '"code"' in line]
        if lines:
            return json.loads(lines[-1])["code"]
        time.sleep(0.1)
    raise AssertionError(f"no code for {email}")


def claim_or_skip(agent) -> str:
    try:
        return agent.claim()
    except PlanRequired as error:
        pytest.skip(f"relay needs a paid plan: {error.hint}")


def test_sync_end_to_end():
    email = f"sdk-py-{time.time_ns()}@example.com"
    sign_in.start(email, server=SERVER)
    token = sign_in.verify(email, code_for(email), device="sdk-e2e@test", server=SERVER)["token"]
    client = Client(token, server=SERVER)
    echo = client.agent(name="echo", client="example-echo", cwd="sdk")
    claim_or_skip(echo)
    sender = client.agent(client="example-echo")

    def handler(message):
        if message.text == "quiet":
            return
        extra = f" + {echo.download_file(message.files[0]['id']).decode()}" if message.files else ""
        message.reply(f"echo: {message.text}{extra}")

    errors = []
    stop = echo.listen(handler, on_error=lambda error, info: errors.append(error))
    sent = sender.send(echo.address, "ping", type="request")
    assert sender.wait_for_reply(sent["id"], timeout=20)["replies"][0]["text"] == "echo: ping"
    file = sender.upload_file(b"hello file", "notes.txt")
    sent = sender.send(echo.address, "see file", type="request", files=[file["id"]])
    assert sender.wait_for_reply(sent["id"], timeout=20)["replies"][0]["text"] == "echo: see file + hello file"
    # Past the relay's 10 s socket timeout: a cut long-poll is waited through, and the listener keeps answering.
    quiet = sender.send(echo.address, "quiet", type="request")
    assert sender.wait_for_reply(quiet["id"], timeout=12)["timedOut"] is True
    again = sender.send(echo.address, "again", type="request")
    assert sender.wait_for_reply(again["id"], timeout=20)["replies"][0]["text"] == "echo: again"
    assert errors == []
    with pytest.raises(ClawalkietalkieError, match="unknown_address"):
        sender.send("nobody-here", "hi")
    echo.set_status("working", "echoing")
    assert next(a for a in client.agents() if a["address"] == echo.address)["status"]["state"] == "working"
    time.sleep(0.3)
    started = time.monotonic()
    stop()
    assert time.monotonic() - started < 2, "stop() should end a long-poll at once"
    echo.close()
    sender.close()
    client.close()


async def test_async_end_to_end():
    email = f"sdk-pya-{time.time_ns()}@example.com"
    await async_sign_in.start(email, server=SERVER)
    token = (await async_sign_in.verify(email, code_for(email), device="sdk-e2e@test", server=SERVER))["token"]
    async with AsyncClient(token, server=SERVER) as client:
        echo = client.agent(name="echo", client="example-echo")
        try:
            await echo.claim()
        except PlanRequired as error:
            pytest.skip(f"relay needs a paid plan: {error.hint}")
        sender = client.agent(client="example-echo")
        stop = echo.listen(lambda message: message.reply(f"echo: {message.text}"))
        sent = await sender.send(echo.address, "ping", type="request")
        assert (await sender.wait_for_reply(sent["id"], timeout=20))["replies"][0]["text"] == "echo: ping"
        minted = await client.mint_device_token("e2e app")
        assert any(t["id"] == minted["id"] for t in await client.device_tokens())
        await client.revoke_device_token(minted["id"])
        await asyncio.wait_for(stop(), 2)
        await echo.close()
        await sender.close()


# A built-in product, so a Free account may claim it.
BUILT_IN = "codex"


def signed_in_client(prefix: str) -> Client:
    email = f"{prefix}-{time.time_ns()}@example.com"
    sign_in.start(email, server=SERVER)
    return Client(sign_in.verify(email, code_for(email), device="sdk-e2e@test", server=SERVER)["token"], server=SERVER)


def test_sync_update_streams_end_to_end():
    client = signed_in_client("sdk-py-streams")
    pub, fan = client.agent(client=BUILT_IN), client.agent(client=BUILT_IN)
    claim_or_skip(pub)
    fan.claim()
    with pytest.raises(NotStreaming):
        fan.follow(pub.address)
    with pytest.raises(NotStreaming):
        pub.post_update("too early")
    assert pub.set_streaming(True) == {"on": True, "includeStatus": False}
    assert fan.follow(pub.address) == pub.address
    pub.post_update("half way through the migration")
    page = fan.updates(wait=5)
    assert [(u["from"], u["kind"], u["text"]) for u in page["updates"]] == [
        (pub.address, "post", "half way through the migration")
    ]
    assert (fan.following()[0]["to"], pub.followers()["followers"][0]["address"]) == (pub.address, fan.address)
    got, errors = [], []
    stop = fan.listen(lambda m: None, on_update=got.append, on_error=lambda e, i: errors.append(e))
    pub.post_update("done")
    end = time.monotonic() + 10
    while not any(u["text"] == "done" for u in got) and time.monotonic() < end:
        time.sleep(0.05)
    stop()
    assert "done" in [u["text"] for u in got] and errors == []
    fan.unfollow(pub.address)
    assert fan.following() == []
    pub.close()
    fan.close()
    client.close()


def test_sync_remove_and_unblock_a_follower_end_to_end():
    client = signed_in_client("sdk-py-blocks")
    pub, fan = client.agent(client=BUILT_IN), client.agent(client=BUILT_IN)
    claim_or_skip(pub)
    fan.claim()
    pub.set_streaming(True)
    fan.follow(pub.address)
    pub.remove_follower(fan.address)
    assert pub.followers()["followers"] == []
    if "blocked" not in pub.followers():
        pytest.skip("this relay does not block removed followers yet")
    with pytest.raises(BlockedByPublisher):
        fan.follow(pub.address)
    pub.unblock_follower(fan.address)
    assert fan.follow(pub.address) == pub.address
    client.close()


async def test_async_update_streams_end_to_end():
    email = f"sdk-pya-streams-{time.time_ns()}@example.com"
    await async_sign_in.start(email, server=SERVER)
    token = (await async_sign_in.verify(email, code_for(email), device="sdk-e2e@test", server=SERVER))["token"]
    async with AsyncClient(token, server=SERVER) as client:
        pub, fan = client.agent(client=BUILT_IN), client.agent(client=BUILT_IN)
        try:
            await pub.claim()
        except PlanRequired as error:
            pytest.skip(f"relay needs a paid plan: {error.hint}")
        await fan.claim()
        await pub.set_streaming(True, include_status=True)
        await fan.follow(pub.address)
        got = []
        stop = fan.listen(lambda m: None, on_update=got.append)
        await pub.post_update("async hello")
        await pub.set_status("working", "streaming e2e")
        for _ in range(200):
            if len(got) >= 2:
                break
            await asyncio.sleep(0.05)
        await asyncio.wait_for(stop(), 2)
        assert [(u["kind"], u["text"]) for u in got] == [("post", "async hello"), ("status", "working: streaming e2e")]
        await pub.close()
        await fan.close()
