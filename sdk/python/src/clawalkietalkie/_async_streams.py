"""The async agent's update-stream methods: the same as the sync ones, awaited."""

from typing import Any, Optional

from . import _streams as s


class AsyncStreams:
    async def _stream(self, request: s.Request) -> Any:
        await self._ready()  # type: ignore[attr-defined]
        method, path, kwargs = request
        return await self._http.call(method, path, **kwargs)  # type: ignore[attr-defined]

    def _holder(self) -> s.Holder:
        return self.name, self.instance_id  # type: ignore[attr-defined]

    async def set_streaming(self, on: bool, include_status: Optional[bool] = None) -> Any:
        return await self._stream(s.streaming(self._holder(), on, include_status))

    async def post_update(self, text: str) -> Any:
        return await self._stream(s.post(self._holder(), text))

    async def follow(self, to: str) -> str:
        return (await self._stream(s.follow(self._holder(), to, True)))["to"]

    async def unfollow(self, to: str) -> None:
        await self._stream(s.follow(self._holder(), to, False))

    async def following(self) -> Any:
        return (await self._stream(s.listing(self._holder(), "follows")))["follows"]

    async def followers(self) -> Any:
        return await self._stream(s.listing(self._holder(), "followers"))

    async def remove_follower(self, address: str) -> None:
        await self._stream(s.follower(self._holder(), address, False))

    async def unblock_follower(self, address: str) -> None:
        await self._stream(s.follower(self._holder(), address, True))

    async def updates(self, after: Optional[str] = None, wait: int = 0) -> Any:
        return await self._stream(s.feed(self._holder(), after, wait))
