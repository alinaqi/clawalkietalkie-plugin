"""Sending and following up, without I/O: the send body, the status check, and how long each reply poll waits."""

import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from ._address import format_address, parse_address
from ._wire import compact
from .errors import ClawalkietalkieError

ATTEMPTS = 3
RETRY_SECONDS = 0.2
MAX_HOP = 10
MAX_WAIT = 50
SETTLED = frozenset(("replied", "refused", "discarded", "expired"))
STATES = frozenset(("working", "blocked", "idle", "done"))

FileSource = Union[str, Path, bytes, bytearray]


def invalid(message: str) -> ClawalkietalkieError:
    return ClawalkietalkieError(0, "invalid_request", {"message": message})


def send_body(holder: Tuple[str, str], to: str, options: Dict[str, Any]) -> Dict[str, Any]:
    """holder: (name, instance id). options: text, type, about, reply_to, files, hop."""
    target = parse_address(to)
    if target is None:
        raise ClawalkietalkieError(0, "invalid_address", {"address": to})
    kind = options.get("type") or "note"
    if kind not in ("note", "request"):
        raise invalid("type is note or request")
    hop = options.get("hop")
    body = {
        "from": holder[0],
        "instanceId": holder[1],
        "to": format_address(target),
        "text": options["text"],
        "type": kind,
    }
    extra = compact(about=options.get("about"), replyTo=options.get("reply_to"), files=options.get("files") or None)
    return {**body, **extra, **({} if hop is None else {"hop": min(MAX_HOP, max(0, int(hop)))})}


def _line(value: Optional[str], field: str) -> Optional[str]:
    if value is None:
        return None
    if len(value.strip()) > 200:
        raise invalid(f"{field} is at most 200 characters")
    return value.strip() or None


def status_body(state: str, task: str, extra: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """Checked as the relay checks it; extra: blocked_on, waiting_for."""
    if state not in STATES:
        raise invalid("state is working, blocked, idle or done")
    if not _line(task, "task"):
        raise invalid("task is required")
    return compact(
        state=state,
        task=task.strip(),
        blockedOn=_line(extra.get("blocked_on"), "blocked_on"),
        waitingFor=_line(extra.get("waiting_for"), "waiting_for"),
    )


def wait_seconds(deadline: float) -> int:
    return min(MAX_WAIT, max(0, math.ceil(deadline - time.monotonic())))


def settled(answer: Dict[str, Any]) -> bool:
    return bool(answer["replies"]) or answer["status"] in SETTLED


def file_of(source: FileSource, name: Optional[str]) -> Tuple[str, bytes]:
    """A path names itself; bytes need a name."""
    if isinstance(source, (bytes, bytearray)):
        if not name:
            raise ValueError("upload_file: give a name for bytes, like upload_file(data, 'notes.txt')")
        return name, bytes(source)
    path = Path(source)
    return name or path.name, path.read_bytes()


def files_query(holder: Tuple[str, str], name: Optional[str] = None) -> Dict[str, str]:
    if name is None:
        return {"as": holder[0], "instanceId": holder[1]}
    return {"from": holder[0], "instanceId": holder[1], "name": name}


def ids_body(instance_id: str, ids: List[str]) -> Dict[str, Any]:
    return {"instanceId": instance_id, "ids": list(ids)}
