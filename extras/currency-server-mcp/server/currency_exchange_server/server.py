"""Main MCP server using FastMCP to expose currency exchange utilities."""

import logging
import os
from datetime import datetime

from starlette.requests import Request
from starlette.responses import JSONResponse
from fastmcp import FastMCP

from . import tools

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app: FastMCP = FastMCP("Currency Exchange Server")


@app.tool()
def list_currencies() -> dict[str, str]:
    """Return a mapping of all supported currency codes to their full names."""
    return tools.list_currencies()


@app.tool()
def get_exchange_rate(base: str, target: str) -> str:
    """Get the latest exchange rate between two currencies.

    Parameters:
        base:   Source currency code (e.g. 'USD').
        target: Target currency code (e.g. 'EUR').
    """
    return tools.get_exchange_rate(base, target)


@app.tool()
def convert_currency(amount: float, base: str, target: str) -> str:
    """Convert an amount from one currency to another at the latest rate.

    Parameters:
        amount: The monetary amount to convert.
        base:   Source currency code (e.g. 'USD').
        target: Target currency code (e.g. 'EUR').
    """
    return tools.convert_currency(amount, base, target)


@app.tool()
def get_exchange_history(base: str, target: str, days: int = 30) -> str:
    """Retrieve historical daily exchange rates as CSV.

    Parameters:
        base:   Source currency code.
        target: Target currency code.
        days:   Number of days of history to retrieve (default 30, max 365).
    """
    return tools.get_exchange_history(base, target, days)


@app.resource("currency://{base}/{target}")
def currency_resource(base: str, target: str) -> str:
    """Expose the latest exchange rate as an MCP resource."""
    return tools.get_exchange_rate(base, target)


@app.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    return JSONResponse({
        "status": "healthy",
        "server": "Currency Exchange Server",
        "timestamp": datetime.now().isoformat(),
        "tools": [
            "list_currencies",
            "get_exchange_rate",
            "convert_currency",
            "get_exchange_history",
        ],
    })


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "streamable-http")
    port = int(os.environ.get("MCP_PORT", "8000"))
    logger.info("Starting Currency Exchange MCP Server on http://0.0.0.0:%d (transport=%s)", port, transport)
    app.run(transport=transport, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
