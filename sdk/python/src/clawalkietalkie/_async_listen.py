"""The async listen loop, in a task: the same as the sync one. stop() cancels a poll in flight (never a handler)
and resolves once the loop has ended."""

import asyncio
import inspect
import random
import time
from typing import Any, Callable, Dict, Optional, Tuple

from ._async_updates_loop import AsyncUpdatesLoop
from ._incoming import AsyncIncomingMessage
from ._loop import LoopState

Failure = Tuple[BaseException, Optional[AsyncIncomingMessage]]


class AsyncListener:
    def __init__(self, agent: Any, handler: Callable[[AsyncIncomingMessage], Any], options: Dict[str, Any]) -> None:
        self._agent = agent
        self._handler = handler
        self._wait = int(options.get("wait_seconds", 25))
        self._on_error = options.get("on_error")
        self._state = LoopState(options, options.get("random") or random.random)
        self._stopping = asyncio.Event()
        self._task: Optional[asyncio.Task] = None
        on_update = options.get("on_update")
        updates_options = {**options, "random": options.get("random") or random.random}
        self._updates = AsyncUpdatesLoop(agent, on_update, updates_options) if on_update else None

    def start(self) -> "AsyncListener":
        self._task = asyncio.ensure_future(self._run())
        if self._updates is not None:
            self._updates.start(self._stopping, self._until_stopped)
        return self

    def _tasks(self) -> list:
        return [t for t in (self._task, self._updates and self._updates.task) if t is not None]

    @property
    def running(self) -> bool:
        return any(not t.done() for t in self._tasks())

    async def __call__(self) -> None:
        await self.stop()

    async def stop(self) -> None:
        """Ends the inbox loop and the updates loop, and resolves once both have ended."""
        self._stopping.set()
        for task in self._tasks():
            await task

    async def _until_stopped(self, awaitable: Any) -> Any:
        """Awaits it unless stop() comes first; None when stopped."""
        work = asyncio.ensure_future(awaitable)
        stopped = asyncio.ensure_future(self._stopping.wait())
        await asyncio.wait({work, stopped}, return_when=asyncio.FIRST_COMPLETED)
        stopped.cancel()
        if work.done():
            return work.result()
        work.cancel()
        return None

    async def _handle(self, raw: Dict[str, Any]) -> Optional[Failure]:
        if not self._state.is_new(raw["id"]):
            return None
        discarded = []
        message = AsyncIncomingMessage(raw, self._agent, lambda: discarded.append(True))
        try:
            result = self._handler(message)
            if inspect.isawaitable(result):
                await result
        except Exception as error:
            return error, message
        self._state.handled(raw["id"], bool(discarded))
        return None

    async def _flush(self) -> Optional[Failure]:
        ids = self._state.to_ack()
        if not ids:
            return None
        try:
            await self._agent.ack(ids)
        except Exception as error:
            return error, None
        self._state.acked(ids)
        return None

    async def _handle_page(self, page: Dict[str, Any]) -> Optional[Failure]:
        for raw in page["messages"]:
            failed = await self._handle(raw)
            if failed:
                return failed
        return None

    async def _round(self) -> Optional[Failure]:
        started = time.monotonic()
        try:
            page = await self._until_stopped(self._agent.inbox(self._state.cursor, self._wait))
        except Exception as error:
            return None if self._state.poll_failed(error, time.monotonic() - started) else (error, None)
        if page is None:
            return None
        failed = await self._handle_page(page)
        self._state.page_done(page.get("cursor"), failed is not None)
        return failed or await self._flush()

    async def _pause(self, failure: Failure) -> bool:
        if self._stopping.is_set():
            return False
        info = self._state.failed(*failure)
        if self._on_error:
            self._on_error(failure[0], info)
        if info["fatal"]:
            return False
        await self._until_stopped(asyncio.sleep(info["delay"]))
        return not self._stopping.is_set()

    async def _begin(self) -> bool:
        while not self._stopping.is_set():
            try:
                await self._agent._ready()
                return True
            except Exception as error:
                if not await self._pause((error, None)):
                    return False
        return False

    async def _run(self) -> None:
        if not await self._begin():
            return
        while not self._stopping.is_set():
            failure = await self._round()
            if failure is None:
                self._state.backoff = 0.0
            elif not await self._pause(failure):
                return
