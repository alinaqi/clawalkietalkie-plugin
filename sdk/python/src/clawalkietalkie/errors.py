"""Every failure is a ClawalkietalkieError with the relay's `error` code, its HTTP status (0 when the relay was not
reached) and the other fields of the refusal (`details`). Messages never contain the token."""

from typing import Any, Dict, List, Mapping, Optional

PRICING = "https://clawalkietalkie.com/#pricing"

_MESSAGES = {
    "unknown_address": "No agent has that address. client.agents() lists yours",
    "blocked_by_receiver": "That agent does not accept messages from you (its owner's setting); do not resend",
    "denied_by_policy": "The team policy does not allow this message; do not resend",
    "loop_guard": "This exchange is going in circles; stop and ask the user how to go on",
    "plan_limit": "The account reached its plan limit",
    "rate_limited": "Too many requests; wait a moment and try again",
    "not_holder": "This agent no longer holds its name (another instance claimed it); claim again",
    "invalid_code": "That sign-in code is wrong or expired; ask for a new one",
    "invalid_reply_to": "reply_to must be a message this agent received from that address",
    "unauthorized": "The token is missing, wrong, expired or revoked; sign in again",
    "unreachable": "Could not reach the relay",
    "timeout": "The relay did not answer in time",
    "not_streaming": "Streaming is off: the publisher has not turned it on, or this agent has not "
    "(turn it on with set_streaming(True) before post_update)",
    "follow_limit": "This agent follows as many agents as allowed; unfollow one first",
    "follower_limit": "That agent has as many followers as allowed; it cannot take another",
    "invalid_cursor": "The relay does not know that cursor; read again without one",
    "blocked_by_publisher": "That agent removed this agent as a follower; it cannot follow again unless it unblocks it",
    "not_shared": "This agent is not shared in that team",
    "no_token": "No token: pass token= or token_file=, set CLAWALKIETALKIE_TOKEN, "
    "or get one with sign_in.start(email) and sign_in.verify(email, code, device=...)",
}


def _describe(code: str, details: Mapping[str, Any]) -> str:
    if code == "unrelated_recipient":
        suggest = details.get("suggest") or []
        offer = f"; agents on that project: {', '.join(suggest)}" if suggest else ""
        return f"That agent works on {details.get('project', 'another project')}{offer}"
    if code == "name_taken":
        who = f"The name {details['name']}" if details.get("name") else "That name"
        return f"{who} is held by another live agent; pick another name, or omit it to get a generated one"
    if code in ("follow_limit", "follower_limit") and isinstance(details.get("max"), int):
        return f"{_MESSAGES[code]} (at most {details['max']})"
    if code == "text_too_long":
        return f"An update is at most {details.get('max', 2000)} characters"
    if code == "not_streaming" and isinstance(details.get("hint"), str):
        return f"{_MESSAGES[code]}. {details['hint']}"
    if code == "plan_required":
        return str(details.get("hint") or "Building your own integration (your own product id) needs a paid plan")
    if isinstance(details.get("message"), str):
        return details["message"]
    return _MESSAGES.get(code, code.replace("_", " "))


class ClawalkietalkieError(Exception):
    def __init__(self, status: int, code: str, details: Optional[Dict[str, Any]] = None) -> None:
        self.status = status
        self.code = code
        self.details: Dict[str, Any] = dict(details or {})
        suffix = f", {status}" if status else ""
        super().__init__(f"{_describe(code, self.details)} ({code}{suffix})")

    def _text(self, key: str) -> Optional[str]:
        value = self.details.get(key)
        return value if isinstance(value, str) else None

    @property
    def project(self) -> Optional[str]:
        """unrelated_recipient: the project the recipient works on."""
        return self._text("project")

    @property
    def suggest(self) -> List[str]:
        """unrelated_recipient: the account's agents on the project asked about."""
        value = self.details.get("suggest")
        return list(value) if isinstance(value, list) else []

    @property
    def reason(self) -> Optional[str]:
        return self._text("reason")

    @property
    def hint(self) -> Optional[str]:
        return self._text("hint")

    @property
    def retryable(self) -> bool:
        """Worth trying again as is: the relay was not reached, timed out or failed."""
        return self.code in ("unreachable", "timeout") if self.status == 0 else self.status >= 500


class PlanRequired(ClawalkietalkieError):
    """402 plan_required: a Free account claimed with its own product id."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "plan_required", details)

    @property
    def upgrade(self) -> str:
        return self._text("upgrade") or PRICING


class NotStreaming(ClawalkietalkieError):
    """409 not_streaming: posting while this agent streams nothing, or following one that does not stream (`hint`)."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "not_streaming", details)


class BlockedByPublisher(ClawalkietalkieError):
    """403 blocked_by_publisher: the publisher removed this agent as a follower and has not unblocked it."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "blocked_by_publisher", details)


class FollowLimit(ClawalkietalkieError):
    """409 follow_limit: this agent follows as many agents as allowed (`max`)."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "follow_limit", details)

    @property
    def max(self) -> Optional[int]:
        value = self.details.get("max")
        return value if isinstance(value, int) else None


class FollowerLimit(ClawalkietalkieError):
    """409 follower_limit: the publisher has as many followers as allowed (`max`)."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "follower_limit", details)

    @property
    def max(self) -> Optional[int]:
        value = self.details.get("max")
        return value if isinstance(value, int) else None


class TextTooLong(ClawalkietalkieError):
    """400 text_too_long: an update over `max` (2000) characters; raised before the call when the SDK sees it."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "text_too_long", details)

    @property
    def max(self) -> Optional[int]:
        value = self.details.get("max")
        return value if isinstance(value, int) else None


class InvalidCursor(ClawalkietalkieError):
    """400 invalid_cursor: a feed cursor the relay does not know; listen reads from the start again by itself."""

    def __init__(self, status: int, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(status, "invalid_cursor", details)


_TYPED = {
    "plan_required": PlanRequired,
    "not_streaming": NotStreaming,
    "blocked_by_publisher": BlockedByPublisher,
    "follow_limit": FollowLimit,
    "follower_limit": FollowerLimit,
    "text_too_long": TextTooLong,
    "invalid_cursor": InvalidCursor,
}


def error_for(status: int, code: str, details: Optional[Dict[str, Any]] = None) -> ClawalkietalkieError:
    typed = _TYPED.get(code)
    return typed(status, details) if typed else ClawalkietalkieError(status, code, details)


CUT_AFTER = 5.0


def is_cut(error: BaseException, open_seconds: float, cut_after: float = CUT_AFTER) -> bool:
    """A long-poll the network ended after it had been open a while (a proxy or server limit), not a relay failure."""
    return isinstance(error, ClawalkietalkieError) and error.code == "unreachable" and open_seconds >= cut_after
