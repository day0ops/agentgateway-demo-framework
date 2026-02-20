"""Currency exchange tools for the MCP server."""

from datetime import datetime, timedelta

from .utils import api_get, normalize_code


def list_currencies() -> dict[str, str]:
    """Return a mapping of all supported currency codes to their full names."""
    return api_get("/currencies")


def get_exchange_rate(base: str, target: str) -> str:
    """Get the latest exchange rate between two currencies."""
    try:
        base, target = normalize_code(base), normalize_code(target)
        data = api_get("/latest", {"from": base, "to": target})
        rate = data["rates"][target]
        return f"1 {base} = {rate} {target} (as of {data['date']})"
    except Exception as e:
        return f"Error fetching rate for {base}/{target}: {e}"


def convert_currency(amount: float, base: str, target: str) -> str:
    """Convert an amount from one currency to another at the latest rate."""
    try:
        base, target = normalize_code(base), normalize_code(target)
        data = api_get("/latest", {"amount": amount, "from": base, "to": target})
        converted = data["rates"][target]
        return f"{amount:.2f} {base} = {converted:.2f} {target} (as of {data['date']})"
    except Exception as e:
        return f"Error converting {amount} {base} to {target}: {e}"


def get_exchange_history(base: str, target: str, days: int = 30) -> str:
    """Retrieve historical daily exchange rates as CSV."""
    days = min(max(days, 1), 365)
    end = datetime.now().date()
    start = end - timedelta(days=days)
    try:
        base, target = normalize_code(base), normalize_code(target)
        data = api_get(f"/{start}..{end}", {"from": base, "to": target})
        rates = data.get("rates", {})
        if not rates:
            return f"No historical data found for {base}/{target}."
        lines = ["date,rate"]
        for date_str in sorted(rates):
            rate = rates[date_str][target]
            lines.append(f"{date_str},{rate}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error fetching history: {e}"
