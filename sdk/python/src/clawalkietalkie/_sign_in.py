"""Signing in by email: a 6-digit code is mailed, then traded for a device token. Nothing is stored."""

from typing import Any, Dict, Optional

from ._http import AsyncHttp, Http
from ._wire import resolve_server


class _SignIn:
    def start(self, email: str, *, server: Optional[str] = None, transport: Any = None) -> None:
        """Always answers (the relay never says whether an account exists)."""
        http = Http(resolve_server(server), None, {"transport": transport})
        try:
            http.call("POST", "/v1/auth/otp", json={"email": email.strip()})
        finally:
            http.close()

    def verify(
        self, email: str, code: str, *, device: str, server: Optional[str] = None, transport: Any = None
    ) -> Dict[str, str]:
        """device: what this token is for, shown on the board (at most 100 characters), like 'my-app@laptop'."""
        http = Http(resolve_server(server), None, {"transport": transport})
        try:
            return http.call(
                "POST", "/v1/auth/verify", json={"email": email.strip(), "code": code.strip(), "device": device}
            )
        finally:
            http.close()


class _AsyncSignIn:
    async def start(self, email: str, *, server: Optional[str] = None, transport: Any = None) -> None:
        http = AsyncHttp(resolve_server(server), None, {"transport": transport})
        try:
            await http.call("POST", "/v1/auth/otp", json={"email": email.strip()})
        finally:
            await http.close()

    async def verify(
        self, email: str, code: str, *, device: str, server: Optional[str] = None, transport: Any = None
    ) -> Dict[str, str]:
        http = AsyncHttp(resolve_server(server), None, {"transport": transport})
        try:
            return await http.call(
                "POST", "/v1/auth/verify", json={"email": email.strip(), "code": code.strip(), "device": device}
            )
        finally:
            await http.close()


sign_in = _SignIn()
async_sign_in = _AsyncSignIn()
