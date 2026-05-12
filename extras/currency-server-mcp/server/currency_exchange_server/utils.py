"""Utility functions for the currency exchange MCP server."""

import httpx

API_BASE = "https://api.frankfurter.app"


def api_get(path: str, params: dict | None = None) -> dict:
    with httpx.Client(timeout=10) as client:
        resp = client.get(f"{API_BASE}{path}", params=params)
        resp.raise_for_status()
        return resp.json()


def normalize_code(code: str) -> str:
    return code.strip().upper()
