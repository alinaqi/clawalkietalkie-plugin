"""The sync listen loop, in a background thread: long-poll the inbox from the cursor, hand each message to the
handler, ack it once the handler returned. A blocking poll cannot be interrupted from another thread, so stop()
waits only for a handler that is running: what a poll in flight brings afterwards is dropped unacked (the relay
hands it over again later), and the thread ends on its own when that poll answers."""

import random
import threading
import time
from typing import Any, Callable, Dict, Optional, Tuple

from ._incoming import IncomingMessage
from ._loop import LoopState
from ._updates_loop import UpdatesLoop

Failure = Tuple[BaseException, Optional[IncomingMessage]]


class Listener:
    def __init__(self, agent: Any, handler: Callable[[IncomingMessage], Any], options: Dict[str, Any]) -> None:
        self._agent = agent
        self._handler = handler
        self._wait = int(options.get("wait_seconds", 25))
        self._on_error = options.get("on_error")
        self._state = LoopState(options, options.get("random") or random.random)
        self._stopping = threading.Event()
        self._busy = threading.RLock()
        self._thread = threading.Thread(target=self._run, name="clawalkietalkie-listen", daemon=True)
        self._http: Any = None
        on_update = options.get("on_update")
        updates_options = {**options, "random": options.get("random") or random.random}
        self._updates = UpdatesLoop(agent, on_update, updates_options) if on_update else None

    def start(self, http: Any) -> "Listener":
        """http: the inbox loop's own wire; the updates loop forks another."""
        self._http = http
        self._thread.start()
        if self._updates is not None:
            self._updates.start(http.fork(), self._stopping)
        return self

    @property
    def running(self) -> bool:
        """False once stop() was called or the loops ended (a poll in flight may still be finishing)."""
        alive = self._thread.is_alive() or (self._updates is not None and self._updates.is_alive())
        return alive and not self._stopping.is_set()

    def __call__(self) -> None:
        self.stop()

    def stop(self) -> None:
        """Stops listening, and the updates loop: no handler runs after it returns; it waits for one that is running.
        Called from on_update it only stops: the message handler may be in stop() too, waiting for that on_update."""
        self._stopping.set()
        if self._updates is not None and self._updates.is_current():
            return
        with self._busy:
            pass
        if self._updates is not None:
            self._updates.settle()

    def join(self, timeout: Optional[float] = None) -> None:
        """Waits for the threads themselves to end (after the polls in flight, if any, answer)."""
        self._thread.join(timeout)
        if self._updates is not None:
            self._updates.join(timeout)

    def _handle(self, raw: Dict[str, Any]) -> Optional[Failure]:
        if not self._state.is_new(raw["id"]):
            return None
        discarded = []
        message = IncomingMessage(raw, self._agent, lambda: discarded.append(True))
        try:
            self._handler(message)
        except Exception as error:
            return error, message
        self._state.handled(raw["id"], bool(discarded))
        return None

    def _flush(self) -> Optional[Failure]:
        ids = self._state.to_ack()
        if not ids:
            return None
        try:
            self._agent.ack(ids)
        except Exception as error:
            return error, None
        self._state.acked(ids)
        return None

    def _round(self) -> Optional[Failure]:
        started = time.monotonic()
        try:
            page = self._agent.inbox(self._state.cursor, self._wait, http=self._http)
        except Exception as error:
            return None if self._state.poll_failed(error, time.monotonic() - started) else (error, None)
        with self._busy:
            return self._handle_page(page)

    def _handle_page(self, page: Dict[str, Any]) -> Optional[Failure]:
        """Hands over each message; once stop() was called (from on_update, say) it starts no further handler and
        acks only those handled, so the rest come again to the next listener."""
        for raw in page["messages"]:
            if self._stopping.is_set():
                return self._flush()
            failed = self._handle(raw)
            if failed:
                self._state.page_done(None, True)
                return failed
        self._state.page_done(page.get("cursor"), False)
        return self._flush()

    def _pause(self, failure: Failure) -> bool:
        """Reports the failure and waits out the backoff; False when the loop should end."""
        if self._stopping.is_set():
            return False
        info = self._state.failed(*failure)
        if self._on_error:
            self._on_error(failure[0], info)
        return not info["fatal"] and not self._stopping.wait(info["delay"])

    def _begin(self) -> bool:
        while not self._stopping.is_set():
            try:
                self._agent.claim() if self._agent.address is None else None
                return True
            except Exception as error:
                if not self._pause((error, None)):
                    return False
        return False

    def _run(self) -> None:
        try:
            if not self._begin():
                return
            while not self._stopping.is_set():
                failure = self._round()
                if failure is None:
                    self._state.backoff = 0.0
                elif not self._pause(failure):
                    return
        finally:
            self._http.close()
