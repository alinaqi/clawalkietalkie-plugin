import pytest
from conftest import SERVER

from clawalkietalkie import ClawalkietalkieError, async_sign_in, sign_in


def test_sign_in_trades_a_code_for_a_token(relay):
    sign_in.start("Me@Example.com", server=SERVER, transport=relay.transport())
    done = sign_in.verify("me@example.com", "123456", device="my-app@host", server=SERVER, transport=relay.transport())
    assert done == {"token": "tok_new", "email": "me@example.com"}
    assert relay.calls[1].body == {"email": "me@example.com", "code": "123456", "device": "my-app@host"}
    with pytest.raises(ClawalkietalkieError) as caught:
        sign_in.verify("me@example.com", "000000", device="d", server=SERVER, transport=relay.transport())
    assert caught.value.code == "invalid_code"


async def test_async_sign_in(relay):
    await async_sign_in.start("me@example.com", server=SERVER, transport=relay.async_transport())
    done = await async_sign_in.verify(
        "me@example.com", "123456", device="d", server=SERVER, transport=relay.async_transport()
    )
    assert done["token"] == "tok_new"


def test_account_reads(client):
    assert client.me() == {"kind": "person", "email": "me@example.com"}
    assert client.agents() == []
    assert client.kinds()[0]["product"] == "claude-code"
    assert client.activity(after="7") == {"events": [], "cursor": "7"}


def test_device_tokens(relay, client):
    assert client.mint_device_token("laptop app")["token"] == "tok_minted"
    assert client.device_tokens()[0]["minted"] is True
    client.revoke_device_token("0123456789abcdef")
    with pytest.raises(ClawalkietalkieError, match="unknown_token"):
        client.revoke_device_token("ffffffffffffffff")


async def test_async_account_reads(async_client):
    assert (await async_client.me())["kind"] == "person"
    assert await async_client.agents() == []
    assert (await async_client.kinds())[0]["kind"] == "cc"
    assert (await async_client.activity())["cursor"] == "0"
    assert (await async_client.mint_device_token("x"))["device"] == "x"
    assert len(await async_client.device_tokens()) == 1
    await async_client.revoke_device_token("0123456789abcdef")
    await async_client.aclose()
