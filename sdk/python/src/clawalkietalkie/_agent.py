"""One sync agent: an address it claims, then sends, listens, and closes."""

import random
import secrets
import time
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from . import _messages as m
from ._address import generate_name, is_valid_name
from ._http import Http
from ._listen import Listener
from ._streams import Streams
from ._types import InboxPage, ReplyWait, SentMessage, UploadedFile
from .errors import CUT_AFTER, ClawalkietalkieError, is_cut

GENERATED_TRIES = 5


def check_options(options: Dict[str, Any]) -> None:
    name = options.get("name")
    if name is not None and not is_valid_name(name):
        message = f'"{name}" is not a valid name: 1-32 lowercase letters, digits and inner dashes'
        raise ClawalkietalkieError(0, "invalid_address", {"message": message})


def claim_body(options: Dict[str, Any], instance_id: str) -> Dict[str, Any]:
    fields = {k: options.get(k) for k in ("client", "label", "kind", "host", "cwd")}
    return {"instanceId": instance_id, **{k: v for k, v in fields.items() if v is not None}}


class AgentBase:
    """What both agents share: the name (generated when omitted), the instance id and the claim's body."""

    def __init__(self, options: Dict[str, Any]) -> None:
        check_options(options)
        self._options = options
        self._generated = options.get("name") is None
        self.name: str = options.get("name") or generate_name(random.random)
        self.instance_id: str = options.get("instance_id") or secrets.token_hex(16)
        self.address: Optional[str] = None

    def _path(self, tail: str = "") -> str:
        return f"/v1/sessions/{quote(self.name, safe='')}{tail}"

    def _taken(self, error: ClawalkietalkieError, attempt: int) -> None:
        """A generated name that is taken is replaced; one asked for is explained."""
        if not self._generated or attempt >= GENERATED_TRIES:
            raise ClawalkietalkieError(409, "name_taken", {**error.details, "name": self.name}) from None
        self.name = generate_name(random.random)


class Agent(AgentBase, Streams):
    def __init__(self, http: Http, options: Dict[str, Any]) -> None:
        super().__init__(options)
        self._http = http
        self._listeners: List[Listener] = []

    def claim(self) -> str:
        """Registers the name and answers the address (like ex:bot)."""
        for attempt in range(1, GENERATED_TRIES + 1):
            try:
                self.address = self._http.call("PUT", self._path(), json=claim_body(self._options, self.instance_id))[
                    "address"
                ]
                return self.address
            except ClawalkietalkieError as error:
                if error.code != "name_taken":
                    raise
                self._taken(error, attempt)
        raise AssertionError("unreachable")  # pragma: no cover

    def _ready(self) -> None:
        if self.address is None:
            self.claim()

    def send(self, to: str, text: str, **options: Any) -> SentMessage:
        """options: type ('note' or 'request'), about, reply_to, files (ids), hop. Retried safely on 5xx and network."""
        self._ready()
        body = m.send_body((self.name, self.instance_id), to, {**options, "text": text})
        headers = {"idempotency-key": str(uuid.uuid4())}
        for attempt in range(1, m.ATTEMPTS + 1):
            try:
                return self._http.call("POST", "/v1/messages", json=body, headers=headers)
            except ClawalkietalkieError as error:
                if not error.retryable or attempt == m.ATTEMPTS:
                    raise
                time.sleep(m.RETRY_SECONDS * 2 ** (attempt - 1))
        raise AssertionError("unreachable")  # pragma: no cover

    def status(self, message_id: str) -> Dict[str, Any]:
        return self._http.call("GET", f"/v1/messages/{quote(message_id, safe='')}")

    def wait_for_reply(self, message_id: str, timeout: float = 60.0, cut_after: float = CUT_AFTER) -> ReplyWait:
        """Long-polls until a reply exists, none can come (refused, discarded, expired), or `timeout` seconds pass.
        A poll the network cuts after `cut_after` seconds is polled again."""
        deadline, last = time.monotonic() + timeout, None
        while True:
            last = self._poll_replies(message_id, m.wait_seconds(deadline), cut_after) or last
            if last is not None and m.settled(last):
                return {**last, "timedOut": False}
            if time.monotonic() >= deadline:
                last = last or self.status(message_id)
                return {"replies": last["replies"], "status": last["status"], "timedOut": True}

    def _poll_replies(self, message_id: str, wait: int, cut_after: float) -> Optional[Dict[str, Any]]:
        started = time.monotonic()
        try:
            params = {"to": message_id, "wait": wait}
            return self._http.call("GET", "/v1/replies", params=params, timeout=wait + 15)
        except ClawalkietalkieError as error:
            if is_cut(error, time.monotonic() - started, cut_after):
                return None
            raise

    def inbox(self, after: Optional[str] = None, wait: int = 0, http: Optional[Http] = None) -> InboxPage:
        """One read: what waits after `after`, long-polling up to `wait` seconds. Messages stay until acked."""
        self._ready()
        params = {"instanceId": self.instance_id, "wait": min(50, max(0, wait)), **({"after": after} if after else {})}
        return (http or self._http).call(
            "GET", f"/v1/inbox/{quote(self.name, safe='')}", params=params, timeout=wait + 15
        )

    def ack(self, ids: List[str]) -> None:
        self._ready()
        self._http.call("POST", f"/v1/inbox/{quote(self.name, safe='')}/ack", json=m.ids_body(self.instance_id, ids))

    def discard(self, ids: List[str]) -> None:
        """Drops messages not about this agent's work: they leave the inbox and their senders see `discarded`."""
        self._ready()
        self._http.call(
            "POST", f"/v1/inbox/{quote(self.name, safe='')}/discard", json=m.ids_body(self.instance_id, ids)
        )

    def listen(self, handler: Any, **options: Any) -> Listener:
        """Calls handler(message) for each message in a background thread; the answer stops it when called.
        options: wait_seconds (25), backoff ((1.0, 30.0) seconds), on_error(error, info), random, and
        on_update(update): also read the feed of followed agents, in a thread of its own; stop() ends both."""
        listener = Listener(self, handler, options)
        self._listeners.append(listener)
        return listener.start(self._http.fork())

    def set_status(self, state: str, task: str, **extra: Optional[str]) -> None:
        """state: working, blocked, idle or done. extra: blocked_on, waiting_for."""
        self._ready()
        self._http.call(
            "PUT", self._path("/status"), json={"instanceId": self.instance_id, **m.status_body(state, task, extra)}
        )

    def upload_file(self, source: m.FileSource, name: Optional[str] = None) -> UploadedFile:
        name, data = m.file_of(source, name)
        self._ready()
        headers = {"content-type": "application/octet-stream"}
        query = m.files_query((self.name, self.instance_id), name)
        return self._http.call("POST", "/v1/files", params=query, content=data, headers=headers, timeout=120)

    def download_file(self, file_id: str) -> bytes:
        self._ready()
        query = m.files_query((self.name, self.instance_id))
        return self._http.call("GET", f"/v1/files/{quote(file_id, safe='')}/content", params=query, raw=True)

    def close(self) -> None:
        """Stops listening and ends the session; the address stays (closed) and messages wait 24 h for a claim."""
        for listener in self._listeners:
            listener.stop()
        self._listeners.clear()
        if self.address is not None:
            self._http.call("POST", self._path("/close"), json={"instanceId": self.instance_id})
