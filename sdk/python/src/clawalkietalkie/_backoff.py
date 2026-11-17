"""Waits between retries: doubling from a floor to a cap, each spread ±20% so many clients do not retry in step."""

from typing import Callable, Tuple

Backoff = Tuple[float, float]
DEFAULT_BACKOFF: Backoff = (1.0, 30.0)


def next_backoff(previous: float, limits: Backoff) -> float:
    return min(limits[1], max(limits[0], previous * 2))


def jitter(seconds: float, random: Callable[[], float]) -> float:
    """random() of 0.5 gives the wait exactly."""
    return round(seconds * (0.8 + 0.4 * random()), 6)
