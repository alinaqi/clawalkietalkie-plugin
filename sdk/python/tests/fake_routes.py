"""The routes of the fake relay."""

import re
from typing import Any, Dict, Optional

import httpx
from fake_messages import message_route


def ok(body: Any = None, status: int = 200) -> httpx.Response:
    return httpx.Response(status) if body is None else httpx.Response(status, json=body)


def err(status: int, error: str, **extra: Any) -> httpx.Response:
    return httpx.Response(status, json={"error": error, **extra})


def auth(call) -> Optional[httpx.Response]:
    if call.path == "/v1/auth/otp":
        return ok({}, 202)
    if call.path != "/v1/auth/verify":
        return None
    if call.body["code"] == "123456":
        return ok({"token": "tok_new", "email": call.body["email"]})
    return err(401, "invalid_code")


def device_tokens(call) -> Optional[httpx.Response]:
    if not call.path.startswith("/v1/auth/device-tokens"):
        return None
    if call.method == "POST":
        return ok({"id": "0123456789abcdef", "token": "tok_minted", "device": call.body["device"]}, 201)
    if call.method == "GET":
        token = {
            "id": "0123456789abcdef",
            "device": "d",
            "createdAt": 1,
            "expiresAt": 2,
            "minted": True,
            "current": False,
        }
        return ok({"tokens": [token]})
    return ok(None, 204) if call.path.endswith("/0123456789abcdef") else err(404, "unknown_token")


def claim(relay, call, name: str) -> httpx.Response:
    body: Dict[str, Any] = call.body
    held = relay.sessions.get(name)
    if held and held["live"] and held["instance_id"] != body["instanceId"]:
        return err(409, "name_taken")
    kind = body.get("kind") or (re.sub("[^a-z]", "", body["client"])[:2] if body.get("client") else "cc")
    relay.sessions[name] = {"kind": kind, "instance_id": body["instanceId"], "live": True, "closed": False}
    return ok({"address": f"{kind}:{name}"})


def sessions(relay, call) -> Optional[httpx.Response]:
    match = re.match(r"^/v1/sessions/([^/]+)(/close|/status)?$", call.path)
    if not match:
        return None
    name, tail = match.group(1), match.group(2)
    if not tail and call.method == "PUT":
        return claim(relay, call, name)
    if relay.sessions.get(name, {}).get("instance_id") != call.body["instanceId"]:
        return err(403, "not_holder")
    if tail == "/close":
        relay.sessions[name]["closed"] = True
    if tail == "/status":
        relay.keys[f"status:{name}"] = call.body
    return ok(None, 204)


def listing(relay, call) -> Optional[httpx.Response]:
    if call.method != "GET":
        return None
    if call.path == "/v1/me":
        return ok({"kind": "person", "email": "me@example.com"})
    if call.path == "/v1/kinds":
        return ok(
            {
                "kinds": [
                    {"kind": "cc", "product": "claude-code", "label": "Claude Code", "builtIn": True, "verified": True}
                ]
            }
        )
    if call.path == "/v1/activity":
        return ok({"events": [], "cursor": call.query.get("after", "0")})
    if call.path == "/v1/sessions":
        rows = [
            {"address": f"{s['kind']}:{n}", "online": s["live"], "closed": s["closed"]}
            for n, s in relay.sessions.items()
        ]
        return ok({"sessions": rows})
    return None


def files(relay, call) -> Optional[httpx.Response]:
    if call.path == "/v1/files" and call.method == "POST":
        relay.ids += 1
        file_id = f"f{relay.ids}"
        relay.files[file_id] = {"name": call.query["name"], "bytes": call.body}
        size = len(call.body)
        view = {
            "id": file_id,
            "name": call.query["name"],
            "size": size,
            "mime": "text/plain",
            "sha256": "x",
            "status": "clean",
        }
        return ok({**view, "createdAt": 1}, 201)
    match = re.match(r"^/v1/files/([^/]+)/content$", call.path)
    if not match:
        return None
    found = relay.files.get(match.group(1))
    return httpx.Response(200, content=found["bytes"]) if found else err(404, "unknown_file")


def route(relay, call):
    for handler in (auth, device_tokens):
        found = handler(call)
        if found is not None:
            return found
    for handler in (listing, sessions, files, message_route):
        found = handler(relay, call)
        if found is not None:
            return found
    return err(404, "not_found")
