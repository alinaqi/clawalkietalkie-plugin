"""What the relay answers, as plain dicts with the relay's own keys."""

from typing import Any, Dict, List, Optional, TypedDict


class SentMessage(TypedDict, total=False):
    """delivery: prompt, context, or held for its person; ownerNotified: the owner of an offline agent was emailed."""

    id: str
    online: bool
    to: str
    delivery: str
    type: str
    status: str
    thread: str
    closed: bool
    ownerNotified: bool
    notice: str


# "from" is a keyword, so this one is spelled the functional way.
Reply = TypedDict(
    "Reply", {"id": str, "from": str, "text": str, "sentAt": int, "files": List[Dict[str, Any]]}, total=False
)


class ReplyWait(TypedDict):
    replies: List[Reply]
    status: str
    timedOut: bool


class InboxPage(TypedDict):
    messages: List[Dict[str, Any]]
    cursor: Optional[str]


class UploadedFile(TypedDict, total=False):
    id: str
    name: str
    size: int
    mime: str
    sha256: str
    status: str
    createdAt: int
