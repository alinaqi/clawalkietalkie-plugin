"""The address grammar, [<kind>:]<name>[@<team>], as the relay speaks it."""

import re
from typing import Callable, NamedTuple, Optional

_NAME = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")
_KIND = re.compile(r"^[a-z][a-z0-9]{1,7}$")

_ADJECTIVES = (
    "happy",
    "brave",
    "calm",
    "eager",
    "fuzzy",
    "gentle",
    "jolly",
    "lucky",
    "mellow",
    "nimble",
    "quiet",
    "rapid",
    "sunny",
    "swift",
    "witty",
    "zesty",
)
_ANIMALS = (
    "cat",
    "dog",
    "fox",
    "owl",
    "otter",
    "panda",
    "koala",
    "lynx",
    "moose",
    "heron",
    "gecko",
    "bison",
    "crane",
    "llama",
    "mole",
    "yak",
)


class Address(NamedTuple):
    """kind and team are None when the address does not give them."""

    kind: Optional[str]
    name: str
    team: Optional[str]


def is_kind(value: str) -> bool:
    return bool(_KIND.match(value))


def is_valid_name(name: str) -> bool:
    return bool(_NAME.fullmatch(name))


def parse_address(text: str) -> Optional[Address]:
    """Accepts "cx:Review-Bot", " review-bot " or "cc:api@acme"; None for anything the relay would refuse."""
    parts = text.strip().lower().split("@")
    if len(parts) > 2 or (len(parts) == 2 and not is_valid_name(parts[1])):
        return None
    local, team = parts[0], (parts[1] if len(parts) == 2 else None)
    kind, sep, name = local.partition(":") if ":" in local else (None, "", local)
    if sep and not is_kind(kind or ""):
        return None
    return Address(kind, name, team) if is_valid_name(name) else None


def format_address(address: Address) -> str:
    """An address as it goes to the relay: a missing kind stays missing, so the relay resolves it."""
    local = f"{address.kind}:{address.name}" if address.kind else address.name
    return f"{local}@{address.team}" if address.team else local


def generate_name(random: Callable[[], float]) -> str:
    """An adjective-animal name; `random` returns a float in [0, 1), like random.random."""
    return f"{_ADJECTIVES[int(random() * len(_ADJECTIVES))]}-{_ANIMALS[int(random() * len(_ANIMALS))]}"
