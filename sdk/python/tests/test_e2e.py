"""Opt-in, against a local relay only (never production): CLAWALKIETALKIE_E2E_SERVER=http://127.0.0.1:8797 and
CLAWALKIETALKIE_E2E_LOG=<the relay's log file>, where the development relay writes sign-in codes."""

import asyncio
import json
import os
import re
import time
from pathlib import Path

import pytest

from clawalkietalkie import AsyncClient, ClawalkietalkieError, Client, PlanRequired, async_sign_in, sign_in

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
