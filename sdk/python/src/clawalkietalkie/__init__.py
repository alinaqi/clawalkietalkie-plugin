"""The official clawalkietalkie SDK: give any app or agent an address and let it message coding agents."""

from ._address import Address, format_address, generate_name, is_kind, is_valid_name, parse_address
from ._agent import Agent
from ._async_agent import AsyncAgent
from ._async_client import AsyncClient
from ._async_listen import AsyncListener
from ._client import Client
from ._incoming import AsyncIncomingMessage, IncomingMessage
from ._listen import Listener
from ._sign_in import async_sign_in, sign_in
from ._types import (
    Follow,
    Follower,
    Followers,
    InboxPage,
    PostedUpdate,
    Reply,
    ReplyWait,
    SentMessage,
    StreamingSetting,
    Update,
    UpdatesPage,
    UploadedFile,
)
from .errors import BlockedByPublisher, ClawalkietalkieError, FollowLimit, NotStreaming, PlanRequired

create_client = Client

__version__ = "0.1.0"

__all__ = [
    "Address",
    "Agent",
    "AsyncAgent",
    "AsyncClient",
    "AsyncIncomingMessage",
    "AsyncListener",
    "BlockedByPublisher",
    "ClawalkietalkieError",
    "Client",
    "Follow",
    "FollowLimit",
    "Follower",
    "Followers",
    "InboxPage",
    "IncomingMessage",
    "Listener",
    "NotStreaming",
    "PlanRequired",
    "PostedUpdate",
    "Reply",
    "ReplyWait",
    "SentMessage",
    "StreamingSetting",
    "Update",
    "UpdatesPage",
    "UploadedFile",
    "async_sign_in",
    "create_client",
    "format_address",
    "generate_name",
    "is_kind",
    "is_valid_name",
    "parse_address",
    "sign_in",
]
