"""One async agent: the same as Agent, awaited."""

import asyncio
import time
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from . import _messages as m
from ._agent import GENERATED_TRIES, AgentBase, claim_body
from ._async_listen import AsyncListener
from ._http import AsyncHttp
from ._types import InboxPage, ReplyWait, SentMessage, UploadedFile
from .errors import CUT_AFTER, ClawalkietalkieError, is_cut


class AsyncAgent(AgentBase):
    def __init__(self, http: AsyncHttp, options: Dict[str, Any]) -> None:
        super().__init__(options)
        self._http = http
        self._listeners: List[AsyncListener] = []

    async def claim(self) -> str:
        for attempt in range(1, GENERATED_TRIES + 1):
            try:
                answer = await self._http.call("PUT", self._path(), json=claim_body(self._options, self.instance_id))
                self.address = answer["address"]
                return answer["address"]
            except ClawalkietalkieError as error:
                if error.code != "name_taken":
                    raise
                self._taken(error, attempt)
        raise AssertionError("unreachable")  # pragma: no cover

    async def _ready(self) -> None:
        if self.address is None:
            await self.claim()

    async def send(self, to: str, text: str, **options: Any) -> SentMessage:
        await self._ready()
        body = m.send_body((self.name, self.instance_id), to, {**options, "text": text})
        headers = {"idempotency-key": str(uuid.uuid4())}
        for attempt in range(1, m.ATTEMPTS + 1):
            try:
                return await self._http.call("POST", "/v1/messages", json=body, headers=headers)
            except ClawalkietalkieError as error:
                if not error.retryable or attempt == m.ATTEMPTS:
                    raise
                await asyncio.sleep(m.RETRY_SECONDS * 2 ** (attempt - 1))
        raise AssertionError("unreachable")  # pragma: no cover

    async def status(self, message_id: str) -> Dict[str, Any]:
        return await self._http.call("GET", f"/v1/messages/{quote(message_id, safe='')}")

    async def wait_for_reply(self, message_id: str, timeout: float = 60.0, cut_after: float = CUT_AFTER) -> ReplyWait:
        """Long-polls until a reply exists, none can come (refused, discarded, expired), or `timeout` seconds pass.
        A poll the network cuts after `cut_after` seconds is polled again."""
        deadline, last = time.monotonic() + timeout, None
        while True:
            last = await self._poll_replies(message_id, m.wait_seconds(deadline), cut_after) or last
            if last is not None and m.settled(last):
                return {**last, "timedOut": False}
            if time.monotonic() >= deadline:
                last = last or await self.status(message_id)
                return {"replies": last["replies"], "status": last["status"], "timedOut": True}

    async def _poll_replies(self, message_id: str, wait: int, cut_after: float) -> Optional[Dict[str, Any]]:
        started = time.monotonic()
        try:
            params = {"to": message_id, "wait": wait}
            return await self._http.call("GET", "/v1/replies", params=params, timeout=wait + 15)
        except ClawalkietalkieError as error:
            if is_cut(error, time.monotonic() - started, cut_after):
                return None
            raise

    async def inbox(self, after: Optional[str] = None, wait: int = 0) -> InboxPage:
        await self._ready()
        params = {"instanceId": self.instance_id, "wait": min(50, max(0, wait)), **({"after": after} if after else {})}
        return await self._http.call("GET", f"/v1/inbox/{quote(self.name, safe='')}", params=params, timeout=wait + 15)

    async def ack(self, ids: List[str]) -> None:
        await self._ready()
        await self._http.call(
            "POST", f"/v1/inbox/{quote(self.name, safe='')}/ack", json=m.ids_body(self.instance_id, ids)
        )

    async def discard(self, ids: List[str]) -> None:
        await self._ready()
        await self._http.call(
            "POST", f"/v1/inbox/{quote(self.name, safe='')}/discard", json=m.ids_body(self.instance_id, ids)
        )

    def listen(self, handler: Any, **options: Any) -> AsyncListener:
        """Runs handler(message) (sync or async) for each message in a task; `await stop()` ends it."""
        listener = AsyncListener(self, handler, options)
        self._listeners.append(listener)
        return listener.start()

    async def set_status(self, state: str, task: str, **extra: Optional[str]) -> None:
        await self._ready()
        await self._http.call(
            "PUT", self._path("/status"), json={"instanceId": self.instance_id, **m.status_body(state, task, extra)}
        )

    async def upload_file(self, source: m.FileSource, name: Optional[str] = None) -> UploadedFile:
        name, data = m.file_of(source, name)
        await self._ready()
        query = m.files_query((self.name, self.instance_id), name)
        headers = {"content-type": "application/octet-stream"}
        return await self._http.call("POST", "/v1/files", params=query, content=data, headers=headers, timeout=120)

    async def download_file(self, file_id: str) -> bytes:
        await self._ready()
        query = m.files_query((self.name, self.instance_id))
        return await self._http.call("GET", f"/v1/files/{quote(file_id, safe='')}/content", params=query, raw=True)

    async def close(self) -> None:
        for listener in self._listeners:
            await listener.stop()
        self._listeners.clear()
        if self.address is not None:
            await self._http.call("POST", self._path("/close"), json={"instanceId": self.instance_id})
