"""The sync client: the account (who it is, its agents, prefixes, activity, device tokens) and agents to claim."""

from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from ._agent import Agent
from ._http import Http
from ._messages import FileSource
from ._types import UploadedFile
from ._wire import resolve_server, resolve_token


class Client:
    """token, token_file or CLAWALKIETALKIE_TOKEN; server, CLAWALKIETALKIE_SERVER or https://api.clawalkietalkie.com.
    transport: an httpx transport (for tests and proxies)."""

    def __init__(
        self,
        token: Optional[str] = None,
        *,
        server: Optional[str] = None,
        token_file: Optional[str] = None,
        transport: Optional[httpx.BaseTransport] = None,
        timeout: Optional[float] = None,
    ) -> None:
        self.server = resolve_server(server)
        self._http = Http(self.server, resolve_token(token, token_file), {"transport": transport, "timeout": timeout})

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def me(self) -> Dict[str, Any]:
        return self._http.call("GET", "/v1/me")

    def agents(self) -> List[Dict[str, Any]]:
        return self._http.call("GET", "/v1/sessions")["sessions"]

    def kinds(self) -> List[Dict[str, Any]]:
        return self._http.call("GET", "/v1/kinds")["kinds"]

    def activity(self, after: Optional[str] = None) -> Dict[str, Any]:
        """The account's message log, 100 events a page; pass the answered cursor as `after` for the next."""
        return self._http.call("GET", "/v1/activity", params={"after": after} if after else None)

    def mint_device_token(self, device: str) -> Dict[str, Any]:
        return self._http.call("POST", "/v1/auth/device-tokens", json={"device": device})

    def device_tokens(self) -> List[Dict[str, Any]]:
        return self._http.call("GET", "/v1/auth/device-tokens")["tokens"]

    def revoke_device_token(self, token_id: str) -> None:
        self._http.call("DELETE", f"/v1/auth/device-tokens/{quote(token_id, safe='')}")

    def sign_out(self) -> None:
        """Revokes the token this client uses."""
        self._http.call("DELETE", "/v1/auth/token")

    def agent(self, *, client: str, name: Optional[str] = None, **options: Optional[str]) -> Agent:
        """client: your product id. name: generated when omitted. options: label, kind, host, cwd, instance_id."""
        return Agent(self._http, {"client": client, "name": name, **options})

    def upload_file(self, source: FileSource, name: Optional[str], agent: Agent) -> UploadedFile:
        """Files belong to the agent that uploads them: the same as agent.upload_file."""
        return agent.upload_file(source, name)

    def download_file(self, file_id: str, agent: Agent) -> bytes:
        return agent.download_file(file_id)
