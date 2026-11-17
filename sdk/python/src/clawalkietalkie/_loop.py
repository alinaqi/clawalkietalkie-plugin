"""The listen loop's bookkeeping, shared by the sync and async loops: the cursor, what was handled, what waits to be
acked, and the backoff. A handler that raised leaves its message unacked and drops the cursor, so the relay hands
it over again; one already handled (whose ack failed) is acked again, never handled twice."""

from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional

from ._backoff import DEFAULT_BACKOFF, Backoff, jitter, next_backoff
from .errors import CUT_AFTER, ClawalkietalkieError, is_cut

# invalid_cursor, or invalid_request from a relay before that code.
_BAD_CURSOR = ("invalid_cursor", "invalid_request")

REMEMBER = 1000


def is_fatal(error: BaseException) -> bool:
    """The token is no longer valid, or another instance took the name: listening cannot go on."""
    return isinstance(error, ClawalkietalkieError) and (error.status == 401 or error.code == "not_holder")


class LoopState:
    def __init__(self, options: Dict[str, Any], random: Callable[[], float]) -> None:
        """options: backoff, cut_after (a poll the network cuts after this many seconds is an empty answer)."""
        self.cursor: Optional[str] = None
        self.cut_after: float = options.get("cut_after", CUT_AFTER)
        self.unacked: List[str] = []
        self.backoff = 0.0
        self._handled: OrderedDict[str, None] = OrderedDict()
        self._limits: Backoff = options.get("backoff") or DEFAULT_BACKOFF
        self._random = random

    def is_new(self, message_id: str) -> bool:
        if message_id in self._handled:
            self.unacked.append(message_id)
            return False
        return True

    def handled(self, message_id: str, discarded: bool) -> None:
        self._handled[message_id] = None
        if len(self._handled) > REMEMBER:
            self._handled.popitem(last=False)
        if not discarded:
            self.unacked.append(message_id)

    def to_ack(self) -> List[str]:
        return list(dict.fromkeys(self.unacked))

    def acked(self, ids: List[str]) -> None:
        self.unacked = [i for i in self.unacked if i not in ids]

    def page_done(self, cursor: Optional[str], failed: bool) -> None:
        self.cursor = None if failed else cursor

    def poll_failed(self, error: BaseException, open_seconds: float) -> bool:
        """True when the failure is no failure: a cut long-poll (an empty answer), or a refused cursor."""
        return is_cut(error, open_seconds, self.cut_after) or self.cursor_refused(error)

    def cursor_refused(self, error: BaseException) -> bool:
        """A cursor the relay no longer takes: read the whole inbox again."""
        refused = self.cursor is not None and isinstance(error, ClawalkietalkieError) and error.code in _BAD_CURSOR
        if refused:
            self.cursor = None
        return refused

    def failed(self, error: BaseException, message: Any = None) -> Dict[str, Any]:
        """The next wait, as reported to on_error: delay (seconds), message, fatal."""
        fatal = is_fatal(error)
        self.backoff = next_backoff(self.backoff, self._limits)
        return {"delay": 0.0 if fatal else jitter(self.backoff, self._random), "message": message, "fatal": fatal}
