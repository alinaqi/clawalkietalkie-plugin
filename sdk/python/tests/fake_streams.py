"""Update streams on the fake relay: the streaming switch, posts, follows, followers and blocks, and the feed."""

import re
import time
from typing import Any, Dict, List, Optional

import fake_relay
import httpx


def err(status: int, error: str, **extra: Any) -> httpx.Response:
    return httpx.Response(status, json={"error": error, **extra})


def state(relay) -> Dict[str, Any]:
    fresh = {"on": {}, "log": [], "follows": {}, "blocked": set(), "seq": 0, "max": 50, "max_followers": 100}
    return relay.keys.setdefault("streams", fresh)


def address(relay, name: str) -> str:
    return f"{relay.sessions[name]['kind']}:{name}"


def name_of(to: str) -> str:
    return re.sub(r"^[a-z][a-z0-9]{1,7}:", "", to.split("@")[0])


def holder(relay, call) -> Optional[str]:
    """The agent the call is from, when it holds its name; else None."""
    source = call.body if call.method in ("PUT", "POST", "DELETE") and isinstance(call.body, dict) else call.query
    name = source.get("from")
    held = relay.sessions.get(name or "")
    return name if held and held["instance_id"] == source.get("instanceId") else None


def streaming(relay, call, name: str) -> httpx.Response:
    if relay.sessions.get(name, {}).get("instance_id") != call.body.get("instanceId"):
        return err(403, "not_holder")
    on = call.body["on"]
    include = bool(call.body.get("includeStatus", state(relay)["on"].get(name, {}).get("includeStatus", False)))
    state(relay)["on"][name] = {"on": on, "includeStatus": include}
    if not on:
        state(relay)["log"] = [u for u in state(relay)["log"] if u["name"] != name]
    return httpx.Response(200, json={"on": on, "includeStatus": include})


def is_on(relay, name: str) -> bool:
    return state(relay)["on"].get(name, {}).get("on", False)


def post(relay, name: str, text: str) -> httpx.Response:
    if not is_on(relay, name):
        return err(409, "not_streaming")
    if len(text) > 2000:
        return err(400, "text_too_long", max=2000)
    if not text:
        return err(400, "invalid_request")
    s = state(relay)
    s["seq"] += 1
    update = {"id": f"u{s['seq']}", "from": address(relay, name), "kind": "post", "text": text, "at": int(time.time())}
    s["log"].append({"seq": s["seq"], "name": name, "update": update})
    return httpx.Response(201, json={"id": update["id"]})


def page(relay, name: str, after: Optional[str]) -> httpx.Response:
    start = int(after[1:]) if after else 0
    followed = state(relay)["follows"].get(name, {})
    rows = [e for e in state(relay)["log"] if e["seq"] > start and e["name"] in followed and is_on(relay, e["name"])]
    cursor = f"u{rows[-1]['seq']}" if rows else (after or "u0")
    return httpx.Response(200, json={"updates": [e["update"] for e in rows], "cursor": cursor})


def feed(relay, call, name: str) -> Any:
    after = call.query.get("after")
    if after is not None and not re.match(r"^u\d+$", after):
        return err(400, "invalid_cursor")
    wait = int(call.query.get("wait") or 0)
    if wait == 0:
        return page(relay, name, after)
    ready = lambda: page(relay, name, after).json()["updates"] != []  # noqa: E731
    return fake_relay.Wait(ready, wait, lambda: page(relay, name, after))


def follow(relay, name: str, to: str) -> httpx.Response:
    target, s = name_of(to), state(relay)
    if target == name:
        return err(400, "invalid_request")
    if target not in relay.sessions:
        return err(404, "unknown_address")
    if (target, name) in s["blocked"]:
        return err(403, "blocked_by_publisher")
    if not is_on(relay, target):
        return err(409, "not_streaming", hint="Ask its owner to turn streaming on.")
    follows = s["follows"].setdefault(name, {})
    if target not in follows and len(follows) >= s["max"]:
        return err(409, "follow_limit", max=s["max"])
    followers = sum(1 for f in s["follows"].values() if target in f)
    if target not in follows and followers >= s["max_followers"]:
        return err(409, "follower_limit", max=s["max_followers"])
    follows.setdefault(target, 1000)
    return httpx.Response(200, json={"to": address(relay, target)})


def following(relay, name: str) -> httpx.Response:
    rows = [
        {"to": address(relay, t), "since": since, "active": is_on(relay, t)}
        for t, since in state(relay)["follows"].get(name, {}).items()
    ]
    return httpx.Response(200, json={"follows": rows})


def followers(relay, name: str) -> httpx.Response:
    s = state(relay)
    rows = [{"address": address(relay, f), "since": t[name]} for f, t in s["follows"].items() if name in t]
    blocked = [{"address": address(relay, f), "since": 2000} for p, f in sorted(s["blocked"]) if p == name]
    return httpx.Response(200, json={"followers": rows, "blocked": blocked})


def remove(relay, name: str, follower: str, block: bool) -> httpx.Response:
    s, who = state(relay), name_of(follower)
    if block:
        s["follows"].get(who, {}).pop(name, None)
        s["blocked"].add((name, who))
    else:
        s["blocked"].discard((name, who))
    return httpx.Response(204)


def stream_route(relay, call) -> Optional[httpx.Response]:
    match = re.match(r"^/v1/sessions/([^/]+)/streaming$", call.path)
    if match and call.method == "PUT":
        return streaming(relay, call, match.group(1))
    if not re.match(r"^/v1/(updates|follows|followers(/blocks)?)$", call.path):
        return None
    name = holder(relay, call)
    if name is None:
        return err(403, "not_holder")
    return dispatch(relay, call, name)


def dispatch(relay, call, name: str) -> Any:
    key, body = f"{call.method} {call.path}", call.body if isinstance(call.body, dict) else {}
    routes: Dict[str, Any] = {
        "POST /v1/updates": lambda: post(relay, name, body.get("text", "")),
        "GET /v1/updates": lambda: feed(relay, call, name),
        "PUT /v1/follows": lambda: follow(relay, name, body["to"]),
        "DELETE /v1/follows": lambda: drop(relay, name, body["to"]),
        "GET /v1/follows": lambda: following(relay, name),
        "GET /v1/followers": lambda: followers(relay, name),
        "DELETE /v1/followers": lambda: remove(relay, name, body["follower"], True),
        "DELETE /v1/followers/blocks": lambda: remove(relay, name, body["follower"], False),
    }
    found = routes.get(key)
    return found() if found else err(404, "not_found")


def drop(relay, name: str, to: str) -> httpx.Response:
    state(relay)["follows"].get(name, {}).pop(name_of(to), None)
    return httpx.Response(204)


def publish(relay, name: str, texts: List[str]) -> None:
    """A publisher posts, as if over the wire."""
    for text in texts:
        post(relay, name, text)
