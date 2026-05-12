"""Minimal FastAPI agent that routes LLM requests through a sidecar agentgateway.

The agent expects agentgateway to be running in the same pod, reachable on
localhost:8080 (or LLM_BASE_URL). It does not hold any provider credentials —
those are managed by agentgateway via the providers feature.

Endpoints:
  POST /run    {"prompt": "..."}  → calls agentgateway → returns LLM response
  POST /chat   {"message": "...", "thread_id": "..."}  → same as /run (call-agent compat)
  GET  /health                    → {"status": "ok"}
  GET  /status                    → agent metadata and uptime
"""

import logging
import os
import time

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

LLM_BASE_URL = os.environ.get('LLM_BASE_URL', 'http://localhost:8080/openai')
MODEL = os.environ.get('MODEL', 'gpt-4o-mini')
AGENT_NAME = os.environ.get('AGENT_NAME', 'sidecar-agent')
PORT = int(os.environ.get('PORT', '8081'))

_start_time = time.time()

app = FastAPI(title='Sidecar Agent', version='1.0.0')


class RunRequest(BaseModel):
    prompt: str


class ChatRequest(BaseModel):
    message: str
    thread_id: str = 'default'


async def _call_llm(prompt: str):
    """Shared LLM call logic for /run and /chat endpoints."""
    url = f'{LLM_BASE_URL}/chat/completions'
    payload = {
        'model': MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data['choices'][0]['message']['content']
            return {'response': content}
    except httpx.HTTPStatusError as e:
        logger.exception('LLM request failed with HTTP error')
        return JSONResponse(
            status_code=e.response.status_code,
            content={'detail': str(e), 'type': 'HTTPStatusError'},
        )
    except Exception as e:
        logger.exception('LLM request failed')
        return JSONResponse(
            status_code=500,
            content={'detail': str(e), 'type': type(e).__name__},
        )


@app.post('/run')
async def run(body: RunRequest):
    return await _call_llm(body.prompt)


@app.post('/chat')
async def chat(body: ChatRequest):
    """Compatibility endpoint for call-agent test action."""
    return await _call_llm(body.message)


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.get('/status')
def status():
    return {
        'name': AGENT_NAME,
        'model': MODEL,
        'llm_base_url': LLM_BASE_URL,
        'uptime_seconds': round(time.time() - _start_time, 1),
    }


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=PORT)
