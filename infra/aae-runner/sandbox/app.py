from __future__ import annotations

import asyncio
import hmac
import os
import re
import signal
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

TOKEN = os.environ.get('AAE_SANDBOX_TOKEN', '')
WORKSPACE = Path(os.environ.get('AAE_WORKSPACE', '/workspace')).resolve()
MAX_OUTPUT = int(os.environ.get('AAE_SANDBOX_MAX_OUTPUT_CHARS', '60000'))
PROCESSES: dict[str, asyncio.subprocess.Process] = {}

DENIED = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r'(^|[;&|]\s*)sudo\b',
        r'\b(shutdown|reboot|poweroff|halt|mkfs|fdisk)\b',
        r'\bdd\s+if=',
        r'\brm\s+-[^\n]*r[^\n]*f[^\n]*\s+/(?:\s|$)',
        r'\bgit\s+push\b',
        r'\bgit\s+reset\s+--hard\b',
        r'\bgit\s+clean\s+-[^\n]*f',
        r'\b(npm|pnpm|yarn)\s+publish\b',
        r'\b(curl|wget|ssh|scp|nc|ncat|socat)\b',
    ]
]


class ExecRequest(BaseModel):
    command: str = Field(min_length=1, max_length=8_000)
    timeout_seconds: int = Field(default=120, ge=1, le=900)


class ExecResponse(BaseModel):
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


app = FastAPI(title='AAE Sandbox', docs_url=None, redoc_url=None)


def auth(value: str | None) -> None:
    expected = f'Bearer {TOKEN}'
    if not TOKEN or not value or not hmac.compare_digest(value, expected):
        raise HTTPException(status_code=401, detail='Unauthorized')


def validate_command(command: str) -> None:
    for pattern in DENIED:
        if pattern.search(command):
            raise HTTPException(status_code=403, detail='Command blocked by sandbox policy')


async def kill_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await process.wait()


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.post('/exec', response_model=ExecResponse)
async def execute(
    payload: ExecRequest,
    authorization: str | None = Header(default=None),
    job_id: str | None = Header(default=None, alias='X-AAE-Job-Id'),
) -> ExecResponse:
    auth(authorization)
    if not job_id or len(job_id) > 128:
        raise HTTPException(status_code=400, detail='Missing job id')
    validate_command(payload.command)
    if job_id in PROCESSES:
        raise HTTPException(status_code=409, detail='Job already has an active process')

    process = await asyncio.create_subprocess_shell(
        payload.command,
        cwd=WORKSPACE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'HOME': '/tmp',
            'LANG': 'C.UTF-8',
            'CI': '1',
        },
        start_new_session=True,
    )
    PROCESSES[job_id] = process
    timed_out = False
    try:
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=payload.timeout_seconds)
        except asyncio.TimeoutError:
            timed_out = True
            await kill_process(process)
            stdout, stderr = await process.communicate()
    except asyncio.CancelledError:
        await kill_process(process)
        raise
    finally:
        PROCESSES.pop(job_id, None)

    return ExecResponse(
        exit_code=process.returncode if process.returncode is not None else 1,
        stdout=stdout.decode('utf-8', errors='replace')[-MAX_OUTPUT:],
        stderr=stderr.decode('utf-8', errors='replace')[-MAX_OUTPUT:],
        timed_out=timed_out,
    )


@app.post('/cancel/{job_id}')
async def cancel(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    process = PROCESSES.get(job_id)
    if process:
        await kill_process(process)
    return {'cancelled': bool(process)}
