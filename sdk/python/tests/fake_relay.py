"""A small in-memory relay behind an httpx transport: the shapes, status codes and errors of the real one.

`fail` queues a one-off answer (or a network error) for the next matching call.
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

import httpx
from fake_routes import route

TOKEN = "tok_test_secret"


@dataclass
class Call:
    method: str
    path: str
    query: Dict[str, str]
    headers: Dict[str, str]
    body: Any


@dataclass
class Wait:
    """A long-poll: answer `then()` once `ready()` or after `seconds` (scaled)."""

    ready: Callable[[], bool]
    seconds: float
    then: Callable[[], httpx.Response]


@dataclass
class FakeRelay:
    calls: List[Call] = field(default_factory=list)
    failures: List[Dict[str, Any]] = field(default_factory=list)
    sessions: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    inboxes: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    statuses: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    files: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    keys: Dict[str, Any] = field(default_factory=dict)
    seq: int = 0
    ids: int = 0
    wait_scale: float = 0.005

    def fail(self, path: str, status: int = 0, **extra: Any) -> None:
        self.failures.append({"path": re.compile(path), "status": status, **extra})

    def deliver(self, name: str, **message: Any) -> None:
        message = {"hop": 0, "type": "request", **message}
        push_inbox(self, name, message)

    def calls_to(self, path: str, method: Optional[str] = None) -> List[Call]:
        pattern = re.compile(path)
        return [c for c in self.calls if pattern.search(c.path) and (method is None or c.method == method)]

    def add_session(self, name: str, kind: str = "cc", instance_id: str = "other") -> None:
        self.sessions[name] = {"kind": kind, "instance_id": instance_id, "live": True, "closed": False}

    def respond(self, request: httpx.Request) -> Union[httpx.Response, Wait]:
        call = call_of(request)
        self.calls.append(call)
        failure = take_failure(self, call)
        if failure and failure.get("after"):
            time.sleep(failure["after"])
        if failure and failure.get("network"):
            raise httpx.ConnectError("connection refused", request=request)
        if failure:
            return answer(failure["status"], failure.get("body"))
        if call.headers.get("authorization") != f"Bearer {TOKEN}" and not call.path.startswith("/v1/auth/"):
            return answer(401, {"error": "unauthorized"})
        return route(self, call)

    def handler(self, request: httpx.Request) -> httpx.Response:
        result = self.respond(request)
        if not isinstance(result, Wait):
            return result
        end = time.monotonic() + result.seconds * self.wait_scale
        while not result.ready() and time.monotonic() < end:
            time.sleep(0.002)
        return result.then()

    async def async_handler(self, request: httpx.Request) -> httpx.Response:
        result = self.respond(request)
        if not isinstance(result, Wait):
            return result
        end = time.monotonic() + result.seconds * self.wait_scale
        while not result.ready() and time.monotonic() < end:
            await asyncio.sleep(0.002)
        return result.then()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def async_transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.async_handler)


def answer(status: int, body: Any = None) -> httpx.Response:
    if body is None:
        return httpx.Response(status)
    return httpx.Response(status, json=body)


def call_of(request: httpx.Request) -> Call:
    raw = request.read()
    is_json = request.headers.get("content-type") == "application/json"
    body = json.loads(raw) if is_json and raw else (raw or None)
    return Call(request.method, request.url.path, dict(request.url.params), dict(request.headers), body)


def take_failure(relay: FakeRelay, call: Call) -> Optional[Dict[str, Any]]:
    for at, failure in enumerate(relay.failures):
        if failure["path"].search(call.path) and failure.get("method", call.method) == call.method:
            return relay.failures.pop(at)
    return None


def push_inbox(relay: FakeRelay, name: str, message: Dict[str, Any]) -> None:
    relay.seq += 1
    stored = {"sentAt": int(time.time() * 1000), "delivery": "context", "fromPerson": None, **message}
    relay.inboxes.setdefault(name, []).append({"seq": relay.seq, "message": stored})
