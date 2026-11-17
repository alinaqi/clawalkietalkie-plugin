"""What the sync and async clients share: where the relay is, the token, and how answers become values or errors."""

import json
import os
from pathlib import Path
from typing import Any, Optional

import httpx

from .errors import ClawalkietalkieError, error_for

DEFAULT_SERVER = "https://api.clawalkietalkie.com"
DEFAULT_TIMEOUT = 30.0


def resolve_server(server: Optional[str]) -> str:
    return (server or os.environ.get("CLAWALKIETALKIE_SERVER") or DEFAULT_SERVER).rstrip("/")


def _from_file(path: str) -> str:
    """A token file holds the token alone, or JSON with a `token` field (like the MCP server's auth.json)."""
    text = Path(path).read_text(encoding="utf-8").strip()
    if not text.startswith("{"):
        return text
    token = json.loads(text).get("token")
    return token if isinstance(token, str) else ""


def resolve_token(token: Optional[str], token_file: Optional[str]) -> str:
    """Given, read from a token file (never written), or CLAWALKIETALKIE_TOKEN."""
    found = token or (_from_file(token_file) if token_file else os.environ.get("CLAWALKIETALKIE_TOKEN"))
    if not found:
        raise ClawalkietalkieError(0, "no_token")
    return found


def headers_for(token: Optional[str]) -> dict:
    headers = {"accept": "application/json", "user-agent": "clawalkietalkie-python/0.1.0"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


def failure(error: httpx.HTTPError) -> ClawalkietalkieError:
    return ClawalkietalkieError(0, "timeout" if isinstance(error, httpx.TimeoutException) else "unreachable")


def refusal(response: httpx.Response) -> ClawalkietalkieError:
    try:
        body = response.json()
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    code = body.pop("error", None)
    return error_for(response.status_code, code if isinstance(code, str) else f"http_{response.status_code}", body)


def parse(response: httpx.Response, raw: bool = False) -> Any:
    if response.is_error:
        raise refusal(response)
    if raw:
        return response.content
    return response.json() if response.content else None


def compact(**fields: Any) -> dict:
    return {key: value for key, value in fields.items() if value is not None}
