"""The async client: the same as Client, awaited."""

from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from ._async_agent import AsyncAgent
from ._http import AsyncHttp
from ._messages import FileSource
from ._types import UploadedFile
from ._wire import resolve_server, resolve_token


class AsyncClient:
    def __init__(
        self,
        token: Optional[str] = None,
        *,
        server: Optional[str] = None,
        token_file: Optional[str] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
        timeout: Optional[float] = None,
    ) -> None:
        self.server = resolve_server(server)
        self._http = AsyncHttp(
            self.server, resolve_token(token, token_file), {"transport": transport, "timeout": timeout}
        )

    async def __aenter__(self) -> "AsyncClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.close()

    async def me(self) -> Dict[str, Any]:
        return await self._http.call("GET", "/v1/me")

    async def agents(self) -> List[Dict[str, Any]]:
        return (await self._http.call("GET", "/v1/sessions"))["sessions"]

    async def kinds(self) -> List[Dict[str, Any]]:
        return (await self._http.call("GET", "/v1/kinds"))["kinds"]

    async def activity(self, after: Optional[str] = None) -> Dict[str, Any]:
        return await self._http.call("GET", "/v1/activity", params={"after": after} if after else None)

    async def mint_device_token(self, device: str) -> Dict[str, Any]:
        return await self._http.call("POST", "/v1/auth/device-tokens", json={"device": device})

    async def device_tokens(self) -> List[Dict[str, Any]]:
        return (await self._http.call("GET", "/v1/auth/device-tokens"))["tokens"]

    async def revoke_device_token(self, token_id: str) -> None:
        await self._http.call("DELETE", f"/v1/auth/device-tokens/{quote(token_id, safe='')}")

    async def sign_out(self) -> None:
        await self._http.call("DELETE", "/v1/auth/token")

    def agent(self, *, client: str, name: Optional[str] = None, **options: Optional[str]) -> AsyncAgent:
        return AsyncAgent(self._http, {"client": client, "name": name, **options})

    async def upload_file(self, source: FileSource, name: Optional[str], agent: AsyncAgent) -> UploadedFile:
        return await agent.upload_file(source, name)

    async def download_file(self, file_id: str, agent: AsyncAgent) -> bytes:
        return await agent.download_file(file_id)
