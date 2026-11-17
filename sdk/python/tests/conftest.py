import time
from typing import Callable

import pytest
from fake_relay import TOKEN, FakeRelay

from clawalkietalkie import AsyncClient, Client

SERVER = "http://relay.test"


@pytest.fixture
def relay() -> FakeRelay:
    return FakeRelay()


@pytest.fixture
def client(relay: FakeRelay) -> Client:
    return Client(token=TOKEN, server=SERVER, transport=relay.transport())


@pytest.fixture
def async_client(relay: FakeRelay) -> AsyncClient:
    return AsyncClient(token=TOKEN, server=SERVER, transport=relay.async_transport())


def until(check: Callable[[], bool], seconds: float = 2.0) -> None:
    end = time.monotonic() + seconds
    while not check():
        assert time.monotonic() < end, "timed out waiting"
        time.sleep(0.002)


async def until_async(check: Callable[[], bool], seconds: float = 2.0) -> None:
    import asyncio

    end = time.monotonic() + seconds
    while not check():
        assert time.monotonic() < end, "timed out waiting"
        await asyncio.sleep(0.002)
