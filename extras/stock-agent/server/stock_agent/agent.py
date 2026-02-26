"""Stock ADK agent definition.

Wires together:
  - ADKTokenPropagationPlugin: propagates the incoming user JWT into every
    outbound MCP tool call. JWT validation is enforced by the
    EnterpriseAgentgatewayPolicy on the AGW side; no STS exchange is needed.
  - MCPToolset: connects to the protected MCP server via StreamableHTTP.
  - LiteLlm: routes LLM calls through the agentgateway provider endpoint so
    the gateway handles provider auth, rate limiting, and telemetry.

Environment variables:
  MODEL        LLM model name forwarded in the request body (default: gemini-2.0-flash)
  LLM_BASE_URL Agentgateway provider base URL (default: .../openai)
  MCP_URL      URL of the protected MCP server through the AGW proxy
"""

import os

from agentsts.adk import ADKTokenPropagationPlugin
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StreamableHTTPConnectionParams

_MCP_URL = os.environ.get(
    "MCP_URL",
    "http://agentgateway.agentgateway-system.svc.cluster.local:8080/mcp",
)
_LLM_BASE_URL = os.environ.get(
    "LLM_BASE_URL",
    "http://agentgateway.agentgateway-system.svc.cluster.local:8080/openai",
)
_MODEL = os.environ.get("MODEL", "gemini-2.0-flash")

plugin = ADKTokenPropagationPlugin()

toolset = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(url=_MCP_URL),
    header_provider=plugin.header_provider,
)

root_agent = LlmAgent(
    name="stock_agent",
    model=LiteLlm(
        model=f"openai/{_MODEL}",
        api_base=_LLM_BASE_URL,
        api_key="none",
    ),
    tools=[toolset],
    instruction=(
        "You are a financial assistant with access to real-time stock market tools. "
        "Use the get_stock_price tool when asked about stock prices. "
        "Always provide the stock symbol and the retrieved price in your response."
    ),
)
