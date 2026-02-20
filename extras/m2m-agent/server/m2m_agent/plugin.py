"""M2M STS plugin for Google ADK.

Exchanges the incoming user JWT with the AGW STS (impersonation mode) and
injects the resulting STS token as the Authorization header for every MCP
tool call via MCPToolset.header_provider.

The agentsts-adk ADKTokenPropagationPlugin does not include the Authorization
header that the AGW STS /oauth2/token endpoint requires. This plugin fills
that gap while following the same session-state contract.
"""

import logging
from typing import Dict, Optional

import httpx
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.plugins.base_plugin import BasePlugin

logger = logging.getLogger(__name__)

_HEADERS_KEY = "headers"
_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
_JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt"


class M2MPlugin(BasePlugin):
    """ADK plugin that exchanges the caller's JWT with the AGW STS and injects
    the resulting delegated token into every outbound MCP tool call."""

    def __init__(self, sts_token_url: str, verify_ssl: bool = False) -> None:
        super().__init__("M2MPlugin")
        self._sts_url = sts_token_url
        self._verify_ssl = verify_ssl
        self._cache: Dict[str, str] = {}

    def header_provider(self, readonly_context: Optional[ReadonlyContext]) -> Dict[str, str]:
        """Passed to MCPToolset; called before each MCP request to supply auth headers."""
        if readonly_context is None:
            return {}
        try:
            session_id = readonly_context._invocation_context.session.id
            token = self._cache.get(session_id, "")
            return {"Authorization": f"Bearer {token}"} if token else {}
        except Exception:
            return {}

    async def before_run_callback(self, *, invocation_context: InvocationContext):
        headers: Dict[str, str] = invocation_context.session.state.get(_HEADERS_KEY, {})
        auth = headers.get("authorization") or headers.get("Authorization") or ""
        if not auth.lower().startswith("bearer "):
            logger.warning("M2MPlugin: no Bearer token in session headers; MCP calls will be unauthenticated")
            return None

        user_jwt = auth[7:].strip()
        try:
            async with httpx.AsyncClient(verify=self._verify_ssl, timeout=15.0) as client:
                resp = await client.post(
                    self._sts_url,
                    headers={"Authorization": f"Bearer {user_jwt}"},
                    data={
                        "grant_type": _TOKEN_EXCHANGE_GRANT,
                        "subject_token": user_jwt,
                        "subject_token_type": _JWT_TOKEN_TYPE,
                    },
                )
                resp.raise_for_status()
                sts_token = resp.json()["access_token"]
                self._cache[invocation_context.session.id] = sts_token
                logger.info("M2MPlugin: STS token obtained (session=%s)", invocation_context.session.id)
        except Exception as exc:
            logger.error("M2MPlugin: STS exchange failed: %s", exc)
        return None

    async def after_run_callback(self, *, invocation_context: InvocationContext):
        self._cache.pop(invocation_context.session.id, None)
        return None
