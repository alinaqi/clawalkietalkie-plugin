"""A message handed to a listen handler: the inbox fields, plus reply and discard."""

from typing import Any, Callable, Dict, List, Optional


class IncomingMessage:
    """sender: the address it came from. raw: the message as the relay listed it."""

    def __init__(self, raw: Dict[str, Any], agent: Any, on_discard: Callable[[], None]) -> None:
        self.raw = raw
        self.id: str = raw["id"]
        self.sender: str = raw["from"]
        self.text: str = raw["text"]
        self.type: str = raw.get("type", "note")
        self.hop: int = raw.get("hop") or 0
        self.reply_to: Optional[str] = raw.get("replyTo")
        self.thread: Optional[str] = raw.get("thread")
        self.files: List[Dict[str, Any]] = raw.get("files") or []
        self.from_person: Optional[str] = raw.get("fromPerson")
        self.delivery: Optional[str] = raw.get("delivery")
        self.guidance: Optional[str] = raw.get("guidance")
        self._agent = agent
        self._on_discard = on_discard

    def __repr__(self) -> str:
        return f"IncomingMessage(id={self.id!r}, sender={self.sender!r}, type={self.type!r})"

    def reply(self, text: str, **options: Any) -> Any:
        """Answers the sender in this message's thread (a note unless type= says otherwise), one hop deeper."""
        return self._agent.send(self.sender, text, reply_to=self.id, hop=self.hop + 1, **options)

    def discard(self) -> None:
        """Drops it as not about this agent's work: it leaves the inbox and its sender sees `discarded`."""
        self._agent.discard([self.id])
        self._on_discard()


class AsyncIncomingMessage(IncomingMessage):
    async def discard(self) -> None:  # type: ignore[override]
        await self._agent.discard([self.id])
        self._on_discard()
