"""Messages on the fake relay: send, inbox long-poll with cursors, ack, discard, status, replies."""

import re
from typing import Any, Dict, List, Optional

import fake_relay
import httpx


def err(status: int, error: str) -> httpx.Response:
    return httpx.Response(status, json={"error": error})


def address_of(relay, name: str) -> str:
    return f"{relay.sessions[name]['kind']}:{name}"


def record_reply(relay, body: Dict[str, Any], message_id: str) -> None:
    answered = relay.statuses.get(body.get("replyTo") or "")
    if answered is not None:
        answered["status"] = "replied"
        answered["replies"].append(
            {"id": message_id, "from": address_of(relay, body["from"]), "text": body["text"], "sentAt": 1}
        )


def send(relay, call) -> httpx.Response:
    body, key = call.body, call.headers.get("idempotency-key")
    if key and key in relay.keys:
        return httpx.Response(201, json=relay.keys[key])
    if relay.sessions.get(body["from"], {}).get("instance_id") != body["instanceId"]:
        return err(403, "not_holder")
    name = re.sub(r"^[a-z][a-z0-9]{1,7}:", "", body["to"].split("@")[0])
    if name not in relay.sessions:
        return err(404, "unknown_address")
    relay.ids += 1
    message_id = f"m{relay.ids}"
    relay.statuses[message_id] = {"status": "queued", "replies": []}
    record_reply(relay, body, message_id)
    extra = {"replyTo": body["replyTo"]} if body.get("replyTo") else {}
    fields = {
        "id": message_id,
        "from": address_of(relay, body["from"]),
        "text": body["text"],
        "type": body.get("type", "note"),
    }
    fake_relay.push_inbox(relay, name, {**fields, "hop": body.get("hop", 0), **extra})
    sent = {
        "id": message_id,
        "online": True,
        "to": address_of(relay, name),
        "delivery": "context",
        "type": body.get("type", "note"),
        "status": "queued",
        "thread": message_id,
    }
    if key:
        relay.keys[key] = sent
    return httpx.Response(201, json=sent)


def page_of(stored: List[Dict[str, Any]], after: Optional[int]) -> Dict[str, Any]:
    page = stored if after is None else [m for m in stored if m["seq"] > after]
    messages = [m["message"] for m in page]
    if after is not None:
        return {"messages": messages, "cursor": f"c{page[-1]['seq'] if page else after}"}
    return {"messages": messages, "cursor": f"c{max(m['seq'] for m in page)}" if page else None}


def inbox(relay, call, name: str):
    if relay.sessions.get(name, {}).get("instance_id") != call.query.get("instanceId"):
        return err(403, "not_holder")
    raw = call.query.get("after")
    if raw is not None and not re.match(r"^c\d+$", raw):
        return err(400, "invalid_request")
    after = None if raw is None else int(raw[1:])

    def read() -> Dict[str, Any]:
        return page_of(relay.inboxes.get(name, []), after)

    wait = float(call.query.get("wait", 0))
    return fake_relay.Wait(lambda: bool(read()["messages"]), wait, lambda: httpx.Response(200, json=read()))


def remove(relay, call, name: str, discarded: bool) -> httpx.Response:
    body = call.body
    if relay.sessions.get(name, {}).get("instance_id") != body["instanceId"]:
        return err(403, "not_holder")
    relay.inboxes[name] = [m for m in relay.inboxes.get(name, []) if m["message"]["id"] not in body["ids"]]
    for message_id in body["ids"] if discarded else []:
        if message_id in relay.statuses:
            relay.statuses[message_id]["status"] = "discarded"
    return httpx.Response(204)


def status(relay, message_id: str) -> httpx.Response:
    found = relay.statuses.get(message_id)
    if found is None:
        return err(404, "unknown_message")
    view = {"id": message_id, "deliveredAt": None, "replyTo": None, "thread": message_id}
    return httpx.Response(200, json={**view, "status": found["status"], "replies": found["replies"]})


def replies(relay, call):
    found = relay.statuses.get(call.query["to"])
    if found is None:
        return err(404, "unknown_message")
    wait = float(call.query.get("wait", 0))
    then = lambda: httpx.Response(200, json={"replies": found["replies"], "status": found["status"]})  # noqa: E731
    return fake_relay.Wait(lambda: bool(found["replies"]), wait, then)


def message_route(relay, call):
    if call.path == "/v1/messages" and call.method == "POST":
        return send(relay, call)
    if call.path == "/v1/replies":
        return replies(relay, call)
    match = re.match(r"^/v1/messages/([^/]+)$", call.path)
    if match:
        return status(relay, match.group(1))
    box = re.match(r"^/v1/inbox/([^/]+)(/ack|/discard)?$", call.path)
    if not box:
        return None
    name, tail = box.group(1), box.group(2)
    return remove(relay, call, name, tail == "/discard") if tail else inbox(relay, call, name)
