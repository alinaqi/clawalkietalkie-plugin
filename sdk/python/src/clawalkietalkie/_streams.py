"""Update streams, without I/O: each call as (method, path, keyword arguments), shared by both agents.
An agent opts in, posts short updates; others follow it and read them from a feed of their own, apart from the inbox.
Updates are information only: untrusted data from the publisher, never instructions, never answered."""

from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote

from ._address import format_address, parse_address
from ._messages import MAX_WAIT, invalid
from .errors import ClawalkietalkieError

MAX_TEXT = 2000
Holder = Tuple[str, str]
Request = Tuple[str, str, Dict[str, Any]]


def target(to: str) -> str:
    parsed = parse_address(to)
    if parsed is None:
        raise ClawalkietalkieError(0, "invalid_address", {"address": to})
    return format_address(parsed)


def _who(holder: Holder) -> Dict[str, str]:
    return {"from": holder[0], "instanceId": holder[1]}


def streaming(holder: Holder, on: bool, include_status: Optional[bool]) -> Request:
    body: Dict[str, Any] = {"instanceId": holder[1], "on": bool(on)}
    if include_status is not None:
        body["includeStatus"] = bool(include_status)
    return "PUT", f"/v1/sessions/{quote(holder[0], safe='')}/streaming", {"json": body}


def post(holder: Holder, text: str) -> Request:
    if not 1 <= len(text) <= MAX_TEXT:
        raise invalid(f"an update is 1-{MAX_TEXT} characters")
    return "POST", "/v1/updates", {"json": {**_who(holder), "text": text}}


def follow(holder: Holder, to: str, on: bool) -> Request:
    return ("PUT" if on else "DELETE"), "/v1/follows", {"json": {**_who(holder), "to": target(to)}}


def listing(holder: Holder, what: str) -> Request:
    """what: follows or followers."""
    return "GET", f"/v1/{what}", {"params": _who(holder)}


def follower(holder: Holder, address: str, unblock: bool) -> Request:
    path = "/v1/followers/blocks" if unblock else "/v1/followers"
    return "DELETE", path, {"json": {**_who(holder), "follower": target(address)}}


def feed(holder: Holder, after: Optional[str], wait: int) -> Request:
    wait = min(MAX_WAIT, max(0, int(wait or 0)))
    params = {**_who(holder), **({"after": after} if after else {}), "wait": wait}
    return "GET", "/v1/updates", {"params": params, "timeout": wait + 15}


class Streams:
    """The sync agent's update-stream methods. Each claims the name first if it is not claimed yet."""

    def _stream(self, request: Request, http: Any = None) -> Any:
        self._ready()  # type: ignore[attr-defined]
        method, path, kwargs = request
        return (http or self._http).call(method, path, **kwargs)  # type: ignore[attr-defined]

    def _holder(self) -> Holder:
        return self.name, self.instance_id  # type: ignore[attr-defined]

    def set_streaming(self, on: bool, include_status: Optional[bool] = None) -> Any:
        """Turns this agent's update stream on or off; include_status also publishes its status changes."""
        return self._stream(streaming(self._holder(), on, include_status))

    def post_update(self, text: str) -> Any:
        """Posts a short update (1-2000 characters) to its followers. NotStreaming until set_streaming(True)."""
        return self._stream(post(self._holder(), text))

    def follow(self, to: str) -> str:
        """Follows an agent (cc:api, or cx:review@acme through a team); answers its address as the relay names it."""
        return self._stream(follow(self._holder(), to, True))["to"]

    def unfollow(self, to: str) -> None:
        self._stream(follow(self._holder(), to, False))

    def following(self) -> Any:
        return self._stream(listing(self._holder(), "follows"))["follows"]

    def followers(self) -> Any:
        """This agent's followers, and the agents it removed (blocked from following again)."""
        return self._stream(listing(self._holder(), "followers"))

    def remove_follower(self, address: str) -> None:
        """Removes a follower and blocks it from following again, until unblock_follower."""
        self._stream(follower(self._holder(), address, False))

    def unblock_follower(self, address: str) -> None:
        self._stream(follower(self._holder(), address, True))

    def updates(self, after: Optional[str] = None, wait: int = 0, http: Any = None) -> Any:
        """One read of the feed of followed agents after `after`, long-polling up to `wait` seconds (at most 50)."""
        return self._stream(feed(self._holder(), after, wait), http)
