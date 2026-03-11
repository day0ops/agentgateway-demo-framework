"""Utility functions for the random number MCP server."""

from typing import Any


def validate_range(low: int | float, high: int | float) -> None:
    if low > high:
        raise ValueError(f"Low value ({low}) must be <= high value ({high})")


def validate_positive_int(value: int, name: str) -> None:
    if not isinstance(value, int):
        raise TypeError(f"{name} must be an integer, got {type(value).__name__}")
    if value < 0:
        raise ValueError(f"{name} must be non-negative, got {value}")


def validate_list_not_empty(items: list[Any], name: str) -> None:
    if not items:
        raise ValueError(f"{name} cannot be empty")


def validate_weights_match_population(
    population: list[Any], weights: list[int | float]
) -> None:
    if len(weights) != len(population):
        raise ValueError(
            f"Weights list length ({len(weights)}) must match "
            f"population length ({len(population)})"
        )
