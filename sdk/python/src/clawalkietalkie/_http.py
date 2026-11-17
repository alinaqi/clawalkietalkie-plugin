"""One sync and one async wire to the relay: a call answered as parsed JSON (or bytes), or raised as an error."""

from typing import Any, Optional

import httpx

from ._wire import DEFAULT_TIMEOUT, failure, headers_for, parse


def _client_args(server: str, token: Optional[str], options: dict) -> dict:
    """options: transport, timeout."""
    args = {"base_url": server, "headers": headers_for(token), "timeout": options.get("timeout") or DEFAULT_TIMEOUT}
    return {**args, "transport": options["transport"]} if options.get("transport") is not None else args


class Http:
    def __init__(self, server: str, token: Optional[str], options: dict) -> None:
        self.server = server
        self._token = token
        self._options = options
        self.client = httpx.Client(**_client_args(server, token, options))
        self._owns_transport = True

    def fork(self) -> "Http":
        """A wire of its own for a listener's long-polls. A transport the caller gave is shared, never closed here."""
        forked = Http(self.server, self._token, self._options)
        forked._owns_transport = self._options.get("transport") is None
        return forked

    def call(self, method: str, path: str, **kwargs: Any) -> Any:
        """kwargs: params, json, content, headers, timeout, and raw (answer bytes)."""
        raw = kwargs.pop("raw", False)
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.HTTPError as error:
            raise failure(error) from None
        return parse(response, raw)

    def close(self) -> None:
        if self._owns_transport:
            self.client.close()


class AsyncHttp:
    def __init__(self, server: str, token: Optional[str], options: dict) -> None:
        self.server = server
        self.client = httpx.AsyncClient(**_client_args(server, token, options))

    async def call(self, method: str, path: str, **kwargs: Any) -> Any:
        raw = kwargs.pop("raw", False)
        try:
            response = await self.client.request(method, path, **kwargs)
        except httpx.HTTPError as error:
            raise failure(error) from None
        return parse(response, raw)

    async def close(self) -> None:
        await self.client.aclose()
