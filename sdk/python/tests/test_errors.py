import os

import httpx
import pytest
from conftest import SERVER

from clawalkietalkie import ClawalkietalkieError, Client, PlanRequired


def test_a_refusal_is_typed_with_its_details(relay, client):
    relay.fail(r"^/v1/sessions$", 402, body={"error": "plan_limit", "limit": "agents", "max": 2})
    with pytest.raises(ClawalkietalkieError) as caught:
        client.agents()
    assert (caught.value.code, caught.value.status, caught.value.details["max"]) == ("plan_limit", 402, 2)
    assert relay.calls[0].headers["authorization"] == "Bearer tok_test_secret"


def test_plan_required_carries_hint_and_upgrade(relay, client):
    body = {
        "error": "plan_required",
        "hint": "Custom products need Pro.",
        "upgrade": "https://clawalkietalkie.com/#pricing",
    }
    relay.fail(r"^/v1/sessions/", 402, body=body, method="PUT")
    with pytest.raises(PlanRequired) as caught:
        client.agent(name="bot", client="my-product").claim()
    assert isinstance(caught.value, ClawalkietalkieError)
    assert caught.value.hint == "Custom products need Pro."
    assert caught.value.upgrade == "https://clawalkietalkie.com/#pricing"
    assert "Custom products need Pro." in str(caught.value)


def test_the_token_never_shows_in_an_error(relay, client):
    relay.fail(".", 500, body={"error": "internal_error"})
    with pytest.raises(ClawalkietalkieError) as caught:
        client.me()
    assert "tok_test_secret" not in repr(caught.value) + str(caught.value) + repr(vars(caught.value))


def test_unreachable_timeout_and_non_json(relay, client):
    relay.fail(".", network=True)
    with pytest.raises(ClawalkietalkieError, match="unreachable") as caught:
        client.me()
    assert caught.value.status == 0 and caught.value.retryable

    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ClawalkietalkieError) as timed:
        Client(token="t", server=SERVER, transport=httpx.MockTransport(slow)).me()
    assert timed.value.code == "timeout"
    page = httpx.MockTransport(lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    with pytest.raises(ClawalkietalkieError) as bad:
        Client(token="t", server=SERVER, transport=page).me()
    assert (bad.value.code, bad.value.retryable) == ("http_502", True)


def test_unrelated_recipient_and_loop_guard_details():
    unrelated = ClawalkietalkieError(409, "unrelated_recipient", {"project": "web", "suggest": ["cc:web"]})
    assert (unrelated.project, unrelated.suggest) == ("web", ["cc:web"])
    assert "web" in str(unrelated)
    loop = ClawalkietalkieError(429, "loop_guard", {"reason": "pair_busy", "hint": "stop"})
    assert (loop.reason, loop.hint, loop.retryable) == ("pair_busy", "stop", False)


def test_token_file_env_and_default_server(tmp_path, monkeypatch, relay):
    (tmp_path / "plain").write_text("tok_test_secret\n")
    (tmp_path / "auth.json").write_text('{"token": "tok_test_secret", "email": "me@example.com"}')
    for name in ("plain", "auth.json"):
        assert (
            Client(token_file=str(tmp_path / name), server=SERVER, transport=relay.transport()).me()["kind"] == "person"
        )
    monkeypatch.setenv("CLAWALKIETALKIE_TOKEN", "tok_test_secret")
    monkeypatch.delenv("CLAWALKIETALKIE_SERVER", raising=False)
    assert Client(transport=relay.transport()).server == "https://api.clawalkietalkie.com"
    monkeypatch.setenv("CLAWALKIETALKIE_TOKEN", "")
    with pytest.raises(ClawalkietalkieError, match="sign_in"):
        Client()
    assert os.environ["CLAWALKIETALKIE_TOKEN"] == ""
