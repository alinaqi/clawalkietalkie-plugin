"""The updates feed loop beside an async listener, in a task of its own: the same as the sync one."""

import asyncio
import inspect
import time
from typing import Any, Callable, Dict, Optional

from ._loop import LoopState
from ._updates_loop import Failure, report


class AsyncUpdatesLoop:
    def __init__(self, agent: Any, on_update: Callable[[Dict[str, Any]], Any], options: Dict[str, Any]) -> None:
        self._agent = agent
        self._on_update = on_update
        self._wait = int(options.get("wait_seconds", 25))
        self._on_error = options.get("on_error")
        self._state = LoopState(options, options["random"])
        self._until_stopped: Any = None
        self._stopping: Any = None
        self.task: Optional[asyncio.Task] = None

    def start(self, stopping: asyncio.Event, until_stopped: Any) -> "AsyncUpdatesLoop":
        """until_stopped(awaitable): the listener's way to await unless stop() comes first."""
        self._stopping, self._until_stopped = stopping, until_stopped
        self.task = asyncio.ensure_future(self._run())
        return self

    async def _hand(self, update: Dict[str, Any]) -> None:
        try:
            result = self._on_update(update)
            if inspect.isawaitable(result):
                await result
        except Exception as error:
            report(self._state, self._on_error, (error, update))

    async def _round(self) -> Optional[Failure]:
        started = time.monotonic()
        try:
            page = await self._until_stopped(self._agent.updates(self._state.cursor, self._wait))
        except Exception as error:
            return None if self._state.poll_failed(error, time.monotonic() - started) else (error, None)
        if page is None:
            return None
        for update in page["updates"]:
            await self._hand(update)
        self._state.cursor = page.get("cursor") or self._state.cursor
        return None

    async def _run(self) -> None:
        while not self._stopping.is_set():
            failure = await self._round()
            if failure is None:
                self._state.backoff = 0.0
                continue
            info = report(self._state, self._on_error, failure)
            if info["fatal"]:
                return
            await self._until_stopped(asyncio.sleep(info["delay"]))
