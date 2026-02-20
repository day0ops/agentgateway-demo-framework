"""Random number tools for the MCP server."""

import random
import secrets
from typing import Any

from .utils import (
    validate_list_not_empty,
    validate_positive_int,
    validate_range,
    validate_weights_match_population,
)


def random_int(low: int, high: int) -> int:
    if not isinstance(low, int) or not isinstance(high, int):
        raise TypeError("Both low and high must be integers")
    validate_range(low, high)
    return random.randint(low, high)


def random_float(low: float = 0.0, high: float = 1.0) -> float:
    if not isinstance(low, int | float) or not isinstance(high, int | float):
        raise TypeError("Both low and high must be numeric")
    validate_range(low, high)
    return random.uniform(low, high)


def random_choices(
    population: list[Any], k: int = 1, weights: list[int | float] | None = None
) -> list[Any]:
    validate_list_not_empty(population, "population")
    validate_positive_int(k, "k")
    if weights is not None:
        validate_weights_match_population(population, weights)
    return random.choices(population, weights=weights, k=k)


def random_shuffle(items: list[Any]) -> list[Any]:
    validate_list_not_empty(items, "items")
    return random.sample(items, len(items))


def random_sample(population: list[Any], k: int) -> list[Any]:
    validate_list_not_empty(population, "population")
    validate_positive_int(k, "k")
    if k > len(population):
        raise ValueError("Sample size k cannot be greater than population size")
    return random.sample(population, k)


def secure_token_hex(nbytes: int = 32) -> str:
    validate_positive_int(nbytes, "nbytes")
    return secrets.token_hex(nbytes)


def secure_random_int(upper_bound: int) -> int:
    if not isinstance(upper_bound, int):
        raise TypeError("upper_bound must be an integer")
    if upper_bound <= 0:
        raise ValueError("upper_bound must be positive")
    return secrets.randbelow(upper_bound)
