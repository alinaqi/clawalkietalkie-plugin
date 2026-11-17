import pytest
from fake_streams import publish

from clawalkietalkie import (
    BlockedByPublisher,
    ClawalkietalkieError,
    FollowerLimit,
    FollowLimit,
    InvalidCursor,
    NotStreaming,
    TextTooLong,
)


def pair(relay, client):
    """pub (streaming on) and fan (following nobody yet), both claimed."""
    pub = client.agent(name="pub", client="example", kind="cc", instance_id="ip")
    fan = client.agent(name="fan", client="example", kind="cc", instance_id="if")
    pub.claim()
    fan.claim()
    return pub, fan


def test_set_streaming_sends_the_switch_and_answers_the_setting(relay, client):
    pub, _ = pair(relay, client)
    assert pub.set_streaming(True, include_status=True) == {"on": True, "includeStatus": True}
    assert relay.calls_to("/streaming$")[0].body == {"instanceId": "ip", "on": True, "includeStatus": True}
    pub.set_streaming(False)
    assert relay.calls_to("/streaming$")[1].body == {"instanceId": "ip", "on": False}


def test_post_update_needs_streaming_on(relay, client):
    pub, _ = pair(relay, client)
    with pytest.raises(NotStreaming) as caught:
        pub.post_update("hi")
    assert caught.value.code == "not_streaming" and caught.value.status == 409
    pub.set_streaming(True)
    assert pub.post_update("half way")["id"] == "u1"
    assert relay.calls_to("^/v1/updates$", "POST")[-1].body == {"from": "pub", "instanceId": "ip", "text": "half way"}


def test_post_update_checks_the_length_before_sending(relay, client):
    pub, _ = pair(relay, client)
    with pytest.raises(ClawalkietalkieError, match="invalid_request"):
        pub.post_update("")
    with pytest.raises(TextTooLong) as too_long:
        pub.post_update("x" * 2001)
    assert too_long.value.max == 2000
    assert relay.calls_to("^/v1/updates$") == []


def test_follow_reads_the_feed_with_a_cursor(relay, client):
    pub, fan = pair(relay, client)
    pub.set_streaming(True)
    assert fan.follow("pub") == "cc:pub"
    assert relay.calls_to("^/v1/follows$", "PUT")[0].body == {"from": "fan", "instanceId": "if", "to": "pub"}
    publish(relay, "pub", ["one", "two"])
    page = fan.updates()
    assert [u["text"] for u in page["updates"]] == ["one", "two"] and page["updates"][0]["from"] == "cc:pub"
    assert fan.updates(after=page["cursor"]) == {"updates": [], "cursor": page["cursor"]}
    query = relay.calls_to("^/v1/updates$", "GET")[-1].query
    assert query == {"from": "fan", "instanceId": "if", "after": page["cursor"], "wait": "0"}


def test_updates_long_polls_until_a_post(relay, client):
    pub, fan = pair(relay, client)
    pub.set_streaming(True)
    fan.follow("cc:pub")
    publish(relay, "pub", ["first"])
    cursor = fan.updates()["cursor"]
    relay.wait_scale = 0.001
    assert fan.updates(after=cursor, wait=30)["updates"] == []
    assert relay.calls_to("^/v1/updates$", "GET")[-1].query["wait"] == "30"
    fan.updates(after=cursor, wait=99)
    assert relay.calls_to("^/v1/updates$", "GET")[-1].query["wait"] == "50"


def test_following_unfollow_followers_remove_and_unblock(relay, client):
    pub, fan = pair(relay, client)
    pub.set_streaming(True)
    fan.follow("pub")
    assert fan.following() == [{"to": "cc:pub", "since": 1000, "active": True}]
    assert pub.followers() == {"followers": [{"address": "cc:fan", "since": 1000}], "blocked": []}
    pub.remove_follower("cc:fan")
    assert relay.calls_to("^/v1/followers$", "DELETE")[0].body == {
        "from": "pub",
        "instanceId": "ip",
        "follower": "cc:fan",
    }
    assert pub.followers() == {"followers": [], "blocked": [{"address": "cc:fan", "since": 2000}]}
    with pytest.raises(BlockedByPublisher) as caught:
        fan.follow("pub")
    assert caught.value.status == 403
    pub.unblock_follower("fan")
    assert relay.calls_to("^/v1/followers/blocks$")[0].body["follower"] == "fan"
    fan.follow("pub")
    fan.unfollow("pub")
    assert relay.calls_to("^/v1/follows$", "DELETE")[0].body == {"from": "fan", "instanceId": "if", "to": "pub"}
    assert fan.following() == []


def test_follow_refusals_are_typed(relay, client):
    pub, fan = pair(relay, client)
    with pytest.raises(NotStreaming) as caught:
        fan.follow("pub")
    assert caught.value.hint == "Ask its owner to turn streaming on." and "turn streaming on" in str(caught.value)
    pub.set_streaming(True)
    relay.keys["streams"]["max"] = 0
    with pytest.raises(FollowLimit) as limit:
        fan.follow("pub")
    assert limit.value.max == 0 and isinstance(limit.value, ClawalkietalkieError)
    relay.keys["streams"]["max"] = 50
    relay.keys["streams"]["max_followers"] = 0
    with pytest.raises(FollowerLimit) as full:
        fan.follow("pub")
    assert full.value.max == 0 and "as many followers as allowed" in str(full.value)
    with pytest.raises(ClawalkietalkieError, match="invalid_address"):
        fan.follow("not an address!")


def test_typed_errors_describe_themselves():
    from clawalkietalkie.errors import error_for

    assert "removed this agent" in str(error_for(403, "blocked_by_publisher"))
    assert "at most 50" in str(error_for(409, "follow_limit", {"max": 50}))
    assert "set_streaming" in str(error_for(409, "not_streaming"))
    assert "This agent follows as many agents as allowed" in str(error_for(409, "follow_limit", {"max": 50}))
    followers = error_for(409, "follower_limit", {"max": 100})
    assert isinstance(followers, FollowerLimit) and followers.max == 100 and "at most 100" in str(followers)
    too_long = error_for(400, "text_too_long", {"max": 2000})
    assert isinstance(too_long, TextTooLong) and too_long.max == 2000 and "at most 2000 characters" in str(too_long)
    assert isinstance(error_for(400, "invalid_cursor"), InvalidCursor)


async def test_the_async_agent_streams_follows_and_reads(relay, async_client):
    pub = async_client.agent(name="pub", client="example", kind="cc", instance_id="ip")
    fan = async_client.agent(name="fan", client="example", kind="cc", instance_id="if")
    await fan.claim()
    with pytest.raises(NotStreaming):
        await pub.post_update("early")
    assert await pub.set_streaming(True) == {"on": True, "includeStatus": False}
    assert await fan.follow("pub") == "cc:pub"
    assert (await pub.post_update("hello"))["id"] == "u1"
    page = await fan.updates(wait=5)
    assert [u["text"] for u in page["updates"]] == ["hello"]
    assert (await fan.following())[0]["to"] == "cc:pub"
    assert (await pub.followers())["followers"][0]["address"] == "cc:fan"
    await pub.remove_follower("fan")
    with pytest.raises(BlockedByPublisher):
        await fan.follow("pub")
    await pub.unblock_follower("fan")
    await fan.follow("pub")
    await fan.unfollow("pub")
    assert await fan.following() == []
