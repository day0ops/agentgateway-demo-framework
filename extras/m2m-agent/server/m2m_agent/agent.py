"""M2M ADK agent definition.

Wires together:
  - M2MPlugin: exchanges the incoming user JWT with the AGW STS and injects
    the resulting token into every outbound MCP tool call.
  - MCPToolset: connects to the protected MCP server via StreamableHTTP.
  - LlmAgent: reasons using the configured LLM model.

Environment variables:
  MODEL          LLM model string (default: gemini-2.0-flash)
  MCP_URL        URL of the protected MCP server through the AGW proxy
  STS_TOKEN_URL  AGW STS /oauth2/token endpoint
"""

import os

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StreamableHTTPConnectionParams

from .plugin import M2MPlugin

_STS_TOKEN_URL = os.environ.get(
    "STS_TOKEN_URL",
    "http://enterprise-agentgateway.agentgateway-system.svc.cluster.local:7777/oauth2/token",
)
_MCP_URL = os.environ.get(
    "MCP_URL",
    "http://agentgateway.agentgateway-system.svc.cluster.local:8080/mcp",
)
_MODEL = os.environ.get("MODEL", "gemini-2.0-flash")

plugin = M2MPlugin(sts_token_url=_STS_TOKEN_URL)

toolset = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(url=_MCP_URL),
    header_provider=plugin.header_provider,
)

root_agent = LlmAgent(
    name="m2m_agent",
    model=_MODEL,
    tools=[toolset],
    plugins=[plugin],
    instruction=(
        "You are a financial assistant with access to real-time stock market tools. "
        "Use the get_stock_price tool when asked about stock prices. "
        "Always provide the stock symbol and the retrieved price in your response."
    ),
)
