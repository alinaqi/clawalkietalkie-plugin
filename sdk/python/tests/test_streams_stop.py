"""Stopping a listener from inside its handlers, and the handlers that may still run once stop() was called."""

import asyncio
import threading

from conftest import until, until_async
from fake_streams import publish
from test_streams_listen import FAST, setup


def test_a_handler_that_stops_the_listener_starts_no_further_update(relay, client):
    _, fan = setup(relay, client)
    publish(relay, "pub", ["one", "two"])
    seen, held, started = [], [], threading.Event()

    def on_update(update):
        seen.append(update["text"])
        started.wait(2)
        held[0].stop()

    held.append(fan.listen(lambda m: None, on_update=on_update, **FAST))
    started.set()
    held[0].join(2)
    assert seen == ["one"]


def test_both_handlers_stopping_at_once_do_not_deadlock(relay, client):
    _, fan = setup(relay, client)
    in_message, in_update = threading.Event(), threading.Event()
    done, held, started = [], [], threading.Event()

    def meet(mine, theirs, name):
        started.wait(2)
        mine.set()
        theirs.wait(2)
        held[0].stop()
        done.append(name)

    held.append(
        fan.listen(
            lambda m: meet(in_message, in_update, "message"),
            on_update=lambda u: meet(in_update, in_message, "update"),
            **FAST,
        )
    )
    started.set()
    relay.deliver("fan", id="m1", **{"from": "cc:pub"}, text="hi")
    publish(relay, "pub", ["one"])
    until(lambda: len(done) == 2)


async def test_async_no_further_update_is_handed_once_stop_was_called(relay, async_client):
    pub = async_client.agent(name="pub", client="example", kind="cc", instance_id="ip")
    fan = async_client.agent(name="fan", client="example", kind="cc", instance_id="if")
    await fan.claim()
    await pub.set_streaming(True)
    await fan.follow("pub")
    await pub.post_update("one")
    await pub.post_update("two")
    seen, release = [], asyncio.Event()

    async def on_update(update):
        seen.append(update["text"])
        await release.wait()

    stop = fan.listen(lambda m: None, on_update=on_update, **FAST)
    await until_async(lambda: seen == ["one"])
    stopping = asyncio.ensure_future(stop())
    await asyncio.sleep(0.01)
    release.set()
    await stopping
    assert seen == ["one"]
