"""The updates feed loop beside a sync listener, in a thread of its own: long-poll the feed of followed agents from
its own cursor and hand each update to on_update. An update is information, never acked or redelivered: one whose
handler raised is reported to on_error (info["update"]) and the loop reads on. Errors back off as the inbox's do.
A cursor the relay refuses reads the feed from the start again; the ids already handed over are skipped, so no update
is handed twice. No further update is handed once stop() was called."""

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Optional, Tuple

from ._loop import REMEMBER, LoopState

Failure = Tuple[BaseException, Optional[Dict[str, Any]]]


class Handed:
    """The ids of the last updates handed over (at most REMEMBER), kept across cursor resets."""

    def __init__(self) -> None:
        self._ids: OrderedDict[Any, None] = OrderedDict()

    def fresh(self, update_id: Any) -> bool:
        """True the first time; it is then remembered."""
        if update_id in self._ids:
            return False
        self._ids[update_id] = None
        if len(self._ids) > REMEMBER:
            self._ids.popitem(last=False)
        return True


def report(state: LoopState, on_error: Any, failure: Failure) -> Dict[str, Any]:
    error, update = failure
    passed = {"delay": 0.0, "message": None, "fatal": False}
    info = {**(passed if update is not None else state.failed(error)), "update": update}
    if on_error:
        on_error(failure[0], info)
    return info


class UpdatesLoop:
    def __init__(self, agent: Any, on_update: Callable[[Dict[str, Any]], Any], options: Dict[str, Any]) -> None:
        self._agent = agent
        self._on_update = on_update
        self._wait = int(options.get("wait_seconds", 25))
        self._on_error = options.get("on_error")
        self._state = LoopState(options, options["random"])
        self._handed = Handed()
        self._busy = threading.RLock()
        self._thread = threading.Thread(target=self._run, name="clawalkietalkie-updates", daemon=True)
        self._stopping: Any = None
        self._http: Any = None

    def start(self, http: Any, stopping: threading.Event) -> "UpdatesLoop":
        self._http, self._stopping = http, stopping
        self._thread.start()
        return self

    def is_alive(self) -> bool:
        return self._thread.is_alive()

    def is_current(self) -> bool:
        """True when called on this loop's thread (from on_update)."""
        return threading.current_thread() is self._thread

    def settle(self) -> None:
        """Waits for an on_update that is running."""
        with self._busy:
            pass

    def join(self, timeout: Optional[float] = None) -> None:
        self._thread.join(timeout)

    def _hand(self, update: Dict[str, Any]) -> None:
        try:
            self._on_update(update)
        except Exception as error:
            report(self._state, self._on_error, (error, update))

    def _round(self) -> Optional[Failure]:
        started = time.monotonic()
        try:
            page = self._agent.updates(self._state.cursor, self._wait, http=self._http)
        except Exception as error:
            return None if self._state.poll_failed(error, time.monotonic() - started) else (error, None)
        with self._busy:
            self._hand_page(page)
        return None

    def _hand_page(self, page: Dict[str, Any]) -> None:
        for update in page["updates"]:
            if self._stopping.is_set():
                return
            if self._handed.fresh(update["id"]):
                self._hand(update)
        self._state.cursor = page.get("cursor") or self._state.cursor

    def _run(self) -> None:
        try:
            while not self._stopping.is_set():
                failure = self._round()
                if failure is None:
                    self._state.backoff = 0.0
                    continue
                info = report(self._state, self._on_error, failure)
                if info["fatal"] or self._stopping.wait(info["delay"]):
                    return
        finally:
            self._http.close()
