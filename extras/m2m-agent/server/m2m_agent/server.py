"""FastAPI HTTP server wrapping the M2M ADK agent.

Endpoint: POST /run
  Body:    {"query": "<natural language question>"}
  Headers: Authorization: Bearer <user-jwt>  (required for STS exchange)

The Authorization header is stored in the ADK session state under the key
"headers" so the M2MPlugin can extract it in before_run_callback.

Endpoint: GET /health
  Returns: {"status": "ok"}
"""

import logging
import os
import uuid

import uvicorn
from fastapi import FastAPI, Request
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

from .agent import root_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_APP_NAME = "m2m_agent"

session_service = InMemorySessionService()
runner = Runner(
    app_name=_APP_NAME,
    agent=root_agent,
    session_service=session_service,
)

app = FastAPI(title="M2M ADK Agent", version="1.0.0")


class RunRequest(BaseModel):
    query: str


@app.post("/run")
async def run(request: Request, body: RunRequest):
    user_id = "demo"
    session_id = str(uuid.uuid4())

    await session_service.create_session(
        app_name=_APP_NAME,
        user_id=user_id,
        session_id=session_id,
        state={"headers": dict(request.headers)},
    )

    response_parts = []
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=types.Content(
            role="user",
            parts=[types.Part(text=body.query)],
        ),
    ):
        if event.is_final_response() and event.content:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_parts.append(part.text)

    return {"response": "\n".join(response_parts)}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
