import random

import pytest

from clawalkietalkie import Address, format_address, generate_name, is_valid_name, parse_address


def test_parses_kind_name_and_team_trimmed_and_lowercased():
    assert parse_address(" CX:Review-Bot ") == Address("cx", "review-bot", None)
    assert parse_address("cc:api@acme") == Address("cc", "api", "acme")
    assert parse_address("happy-dog") == Address(None, "happy-dog", None)


@pytest.mark.parametrize("bad", ["", "-a", "a-", "a@b@c", "x:name", "toolongkind:a", "a_b", "a" * 33, "a@-t"])
def test_refuses_what_the_relay_would_refuse(bad):
    assert parse_address(bad) is None


def test_names_and_formatting():
    assert is_valid_name("a" * 32)
    assert not is_valid_name("-a")
    assert format_address(Address("cu", "web", "acme")) == "cu:web@acme"
    assert format_address(Address(None, "web", None)) == "web"
    assert generate_name(lambda: 0) == "happy-cat"
    assert is_valid_name(generate_name(random.random))
