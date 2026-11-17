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

    def start(self, http: Any) -> "Listener":
        self._http = http
        self._thread.start()
        return self

    @property
    def running(self) -> bool:
        """False once stop() was called or the loop ended (a poll in flight may still be finishing)."""
        return self._thread.is_alive() and not self._stopping.is_set()

    def __call__(self) -> None:
        self.stop()

    def stop(self) -> None:
        """Stops listening: no handler runs after it returns; it waits for one that is running."""
        self._stopping.set()
        with self._busy:
            pass

    def join(self, timeout: Optional[float] = None) -> None:
        """Waits for the thread itself to end (after the poll in flight, if any, answers)."""
        self._thread.join(timeout)

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
            if self._stopping.is_set():
                return None
            failed = next((f for f in map(self._handle, page["messages"]) if f), None)
            self._state.page_done(page.get("cursor"), failed is not None)
            return failed or self._flush()

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
