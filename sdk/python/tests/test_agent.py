import re
import threading
import time

import pytest

from clawalkietalkie import ClawalkietalkieError


def test_claims_with_product_label_and_place(relay, client):
    agent = client.agent(name="bot", client="acme-bot", label="Acme Bot", cwd="web", instance_id="i1")
    assert agent.claim() == "ac:bot"
    assert agent.address == "ac:bot"
    assert relay.calls[0].body == {"instanceId": "i1", "client": "acme-bot", "label": "Acme Bot", "cwd": "web"}


def test_a_generated_name_is_replaced_when_taken(relay, client):
    relay.fail(r"^/v1/sessions/", 409, body={"error": "name_taken"}, method="PUT")
    agent = client.agent(client="acme-bot")
    assert re.match(r"^ac:[a-z]+-[a-z]+$", agent.claim())
    assert len(relay.calls_to(r"^/v1/sessions/", "PUT")) == 2
    assert re.match(r"^[0-9a-f]{32}$", agent.instance_id)


def test_a_taken_name_it_asked_for_is_explained(relay, client):
    relay.add_session("bot")
    with pytest.raises(ClawalkietalkieError, match=r"bot.*another live agent") as caught:
        client.agent(name="bot", client="acme-bot").claim()
    assert caught.value.code == "name_taken"


def test_a_bad_name_is_refused_before_any_call(relay, client):
    with pytest.raises(ClawalkietalkieError, match="not a valid name"):
        client.agent(name="Not A Name!", client="x1")
    assert relay.calls == []


@pytest.fixture
def pair(client):
    a = client.agent(name="a", client="example", instance_id="ia")
    b = client.agent(name="b", client="example", instance_id="ib")
    a.claim()
    b.claim()
    return a, b


def test_sends_with_an_idempotency_key(relay, pair):
    a, _ = pair
    sent = a.send("ex:b", "hi", type="request", about="web")
    assert (sent["id"], sent["status"], sent["to"]) == ("m1", "queued", "ex:b")
    call = relay.calls_to(r"^/v1/messages$")[0]
    assert call.body == {"from": "a", "instanceId": "ia", "to": "ex:b", "text": "hi", "type": "request", "about": "web"}
    assert re.match(r"^[0-9a-f-]{36}$", call.headers["idempotency-key"])


def test_claims_first_when_needed(relay, client):
    relay.add_session("b", kind="ex")
    client.agent(name="a", client="example").send("b", "hi")
    assert [c.method for c in relay.calls] == ["PUT", "POST"]


def test_retries_5xx_and_network_with_one_key(relay, pair):
    a, _ = pair
    relay.fail(r"^/v1/messages$", 503, body={"error": "busy"})
    relay.fail(r"^/v1/messages$", network=True)
    assert a.send("b", "hi")["id"] == "m1"
    keys = {c.headers["idempotency-key"] for c in relay.calls_to(r"^/v1/messages$")}
    assert len(relay.calls_to(r"^/v1/messages$")) == 3 and len(keys) == 1
    assert len(relay.inboxes["b"]) == 1


def test_refusals_are_typed_and_not_retried(relay, pair):
    a, _ = pair
    relay.fail(r"^/v1/messages$", 409, body={"error": "unrelated_recipient", "project": "api", "suggest": ["cc:api"]})
    with pytest.raises(ClawalkietalkieError) as caught:
        a.send("b", "hi", about="web")
    assert (caught.value.code, caught.value.project, caught.value.suggest) == ("unrelated_recipient", "api", ["cc:api"])
    assert len(relay.calls_to(r"^/v1/messages$")) == 1
    with pytest.raises(ClawalkietalkieError, match="unknown_address"):
        a.send("nobody", "hi")
    with pytest.raises(ClawalkietalkieError, match="invalid_address"):
        a.send("Bad Address", "hi")
    with pytest.raises(ClawalkietalkieError, match="invalid_request"):
        a.send("b", "hi", type="order")


def test_status_and_wait_for_reply(relay, pair):
    a, b = pair
    sent = a.send("b", "ping", type="request")
    assert a.status(sent["id"])["status"] == "queued"
    threading.Timer(0.02, lambda: b.send("a", "pong", reply_to=sent["id"])).start()
    answer = a.wait_for_reply(sent["id"], timeout=2)
    assert (answer["status"], answer["timedOut"], answer["replies"][0]["text"]) == ("replied", False, "pong")
    late = a.send("b", "ping")
    started = time.monotonic()
    assert a.wait_for_reply(late["id"], timeout=0.03)["timedOut"] is True
    assert time.monotonic() - started < 1


def test_status_is_checked_then_set_and_close(relay, client):
    agent = client.agent(name="a", client="example", instance_id="ia")
    with pytest.raises(ClawalkietalkieError, match="invalid_request"):
        agent.set_status("sleeping", "x")
    with pytest.raises(ClawalkietalkieError, match="invalid_request"):
        agent.set_status("idle", " ")
    agent.set_status("working", "tests", waiting_for="cc:api")
    assert relay.keys["status:a"] == {"instanceId": "ia", "state": "working", "task": "tests", "waitingFor": "cc:api"}
    agent.close()
    assert relay.sessions["a"]["closed"] is True


def test_files(tmp_path, relay, client):
    agent = client.agent(name="a", client="example", instance_id="ia")
    assert agent.upload_file(b"hello", "notes.txt")["id"] == "f1"
    path = tmp_path / "report.md"
    path.write_text("# report")
    assert client.upload_file(str(path), None, agent)["name"] == "report.md"
    upload = relay.calls_to(r"^/v1/files$")[0]
    assert upload.headers["content-type"] == "application/octet-stream"
    assert upload.query == {"from": "a", "instanceId": "ia", "name": "notes.txt"}
    assert agent.download_file("f1") == b"hello"
    assert client.download_file("f1", agent) == b"hello"
    with pytest.raises(ClawalkietalkieError, match="unknown_file"):
        agent.download_file("nope")
    with pytest.raises(ValueError, match="name"):
        agent.upload_file(b"x")
