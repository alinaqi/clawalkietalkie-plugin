"""The async agent's update-stream methods: the same as the sync ones, awaited."""

from typing import Any, Optional

from . import _streams as s


class AsyncStreams:
    async def _stream(self, build: s.Build) -> Any:
        s.checked(self._holder(), build)
        await self._ready()  # type: ignore[attr-defined]
        method, path, kwargs = build(self._holder())
        return await self._http.call(method, path, **kwargs)  # type: ignore[attr-defined]

    def _holder(self) -> s.Holder:
        return self.name, self.instance_id  # type: ignore[attr-defined]

    async def set_streaming(self, on: bool, include_status: Optional[bool] = None) -> Any:
        return await self._stream(lambda h: s.streaming(h, on, include_status))

    async def post_update(self, text: str) -> Any:
        return await self._stream(lambda h: s.post(h, text))

    async def follow(self, to: str) -> str:
        return (await self._stream(lambda h: s.follow(h, to, True)))["to"]

    async def unfollow(self, to: str) -> None:
        await self._stream(lambda h: s.follow(h, to, False))

    async def following(self) -> Any:
        return (await self._stream(lambda h: s.listing(h, "follows")))["follows"]

    async def followers(self) -> Any:
        return await self._stream(lambda h: s.listing(h, "followers"))

    async def remove_follower(self, address: str) -> None:
        await self._stream(lambda h: s.follower(h, address, False))

    async def unblock_follower(self, address: str) -> None:
        await self._stream(lambda h: s.follower(h, address, True))

    async def updates(self, after: Optional[str] = None, wait: int = 0) -> Any:
        return await self._stream(lambda h: s.feed(h, after, wait))
