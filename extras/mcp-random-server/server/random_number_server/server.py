"""Main MCP server using FastMCP to expose random number utilities."""

import json
import logging
import os
from datetime import datetime
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse
from fastmcp import FastMCP

from . import tools

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app: FastMCP = FastMCP("Random Number Server")


@app.tool()
def random_int(low: int, high: int) -> int:
    """Generate a random integer between low and high (inclusive).

    Parameters:
        low:  Lower bound (inclusive).
        high: Upper bound (inclusive).
    """
    return tools.random_int(low, high)


@app.tool()
def random_float(low: float = 0.0, high: float = 1.0) -> float:
    """Generate a random float between low and high.

    Parameters:
        low:  Lower bound (default 0.0).
        high: Upper bound (default 1.0).
    """
    return tools.random_float(low, high)


@app.tool()
def random_choices(
    population: list[Any],
    k: int = 1,
    weights: list[int | float] | str | None = None,
) -> list[Any]:
    """Choose k items from population with replacement, optionally weighted.

    Parameters:
        population: List of items to choose from.
        k:          Number of items to choose (default 1).
        weights:    Optional weights for each item (JSON string or list).
    """
    numeric_weights: list[int | float] | None = None
    if isinstance(weights, str):
        try:
            numeric_weights = json.loads(weights)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON string for weights: {weights}") from e
    else:
        numeric_weights = weights
    return tools.random_choices(population, k, numeric_weights)


@app.tool()
def random_shuffle(items: list[Any]) -> list[Any]:
    """Return a new list with items in random order.

    Parameters:
        items: List of items to shuffle.
    """
    return tools.random_shuffle(items)


@app.tool()
def random_sample(population: list[Any], k: int) -> list[Any]:
    """Choose k unique items from population without replacement.

    Parameters:
        population: List of items to choose from.
        k:          Number of items to choose.
    """
    return tools.random_sample(population, k)


@app.tool()
def secure_token_hex(nbytes: int = 32) -> str:
    """Generate a secure random hex token.

    Parameters:
        nbytes: Number of random bytes (default 32). Result is 2*nbytes hex chars.
    """
    return tools.secure_token_hex(nbytes)


@app.tool()
def secure_random_int(upper_bound: int) -> int:
    """Generate a cryptographically secure random integer in [0, upper_bound).

    Parameters:
        upper_bound: Upper bound (exclusive, must be positive).
    """
    return tools.secure_random_int(upper_bound)


@app.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    return JSONResponse({
        "status": "healthy",
        "server": "Random Number Server",
        "timestamp": datetime.now().isoformat(),
        "tools": [
            "random_int",
            "random_float",
            "random_choices",
            "random_shuffle",
            "random_sample",
            "secure_token_hex",
            "secure_random_int",
        ],
    })


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "streamable-http")
    port = int(os.environ.get("MCP_PORT", "8000"))
    logger.info("Starting Random Number MCP Server on http://0.0.0.0:%d (transport=%s)", port, transport)
    app.run(transport=transport, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
