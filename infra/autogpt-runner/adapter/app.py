from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import re
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

LOGGER = logging.getLogger("aira.autogpt_runner")
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

DATABASE_PATH = Path(os.getenv("RUNNER_DATABASE_PATH", "/data/runner.db"))
AUTOGPT_INTERNAL_URL = os.getenv(
    "AUTOGPT_INTERNAL_URL", "http://autogpt:8000/ap/v1"
).rstrip("/")
NVIDIA_API_URL = os.getenv(
    "NVIDIA_API_URL", "https://integrate.api.nvidia.com/v1"
).rstrip("/")
RUNNER_API_KEY = os.getenv("RUNNER_API_KEY", "")
AUTOGPT_INTERNAL_TOKEN = os.getenv("AUTOGPT_INTERNAL_TOKEN", "")
EXPECTED_GRAPH_ID = os.getenv("AIRA_GRAPH_ID", "aira-objective-runner")
EXPECTED_GRAPH_VERSION = int(os.getenv("AIRA_GRAPH_VERSION", "1"))
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
NVIDIA_SMART_MODEL = os.getenv(
    "NVIDIA_SMART_MODEL", "nvidia/nemotron-3-nano-30b-a3b"
)
NVIDIA_FAST_MODEL = os.getenv("NVIDIA_FAST_MODEL", NVIDIA_SMART_MODEL)
NVIDIA_EMBEDDING_MODEL = os.getenv(
    "NVIDIA_EMBEDDING_MODEL", "nvidia/nv-embedqa-e5-v5"
)
MAX_OBJECTIVE_CHARS = int(os.getenv("RUNNER_MAX_OBJECTIVE_CHARS", "16000"))
MAX_STEPS = int(os.getenv("AUTOGPT_MAX_STEPS", "12"))
MAX_CONCURRENT_RUNS = int(os.getenv("AUTOGPT_MAX_CONCURRENT_RUNS", "1"))
UPSTREAM_TIMEOUT_SECONDS = float(os.getenv("AUTOGPT_UPSTREAM_TIMEOUT_SECONDS", "180"))
MAX_PROVIDER_BODY_BYTES = int(os.getenv("MAX_PROVIDER_BODY_BYTES", "1000000"))
MAX_STORED_OUTPUT_BYTES = int(os.getenv("MAX_STORED_OUTPUT_BYTES", "128000"))
HOST_ROLE = os.getenv("RUNNER_HOST_ROLE", "unknown")
SWALLOWED_STEP_ERROR_PREFIXES = (
    "an error occurred while proposing the next action:",
    "an error occurred while executing the command:",
)

QUEUE: asyncio.Queue[str] = asyncio.Queue()
WORKERS: list[asyncio.Task[None]] = []


def _require_non_default_secrets() -> None:
    values = {
        "RUNNER_API_KEY": RUNNER_API_KEY,
        "AUTOGPT_INTERNAL_TOKEN": AUTOGPT_INTERNAL_TOKEN,
        "NVIDIA_API_KEY": NVIDIA_API_KEY,
    }
    missing = [name for name, value in values.items() if len(value) < 24]
    if missing:
        raise RuntimeError(f"Missing or weak required secrets: {', '.join(missing)}")
    if not AUTOGPT_INTERNAL_TOKEN.startswith("sk-"):
        raise RuntimeError("AUTOGPT_INTERNAL_TOKEN must start with 'sk-'.")


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS executions (
                id TEXT PRIMARY KEY,
                client_request_id TEXT NOT NULL UNIQUE,
                objective TEXT NOT NULL,
                status TEXT NOT NULL,
                autogpt_task_id TEXT,
                output TEXT,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        connection.execute(
            "UPDATE executions SET status = 'QUEUED', updated_at = ? "
            "WHERE status = 'RUNNING'",
            (time.time(),),
        )


def _recoverable_execution_ids() -> list[str]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT id FROM executions WHERE status = 'QUEUED' ORDER BY created_at"
        ).fetchall()
    return [str(row["id"]) for row in rows]


def _execution(execution_id: str) -> sqlite3.Row | None:
    with _connect() as connection:
        return connection.execute(
            "SELECT * FROM executions WHERE id = ?", (execution_id,)
        ).fetchone()


def _create_execution(client_request_id: str, objective: str) -> tuple[str, bool]:
    now = time.time()
    execution_id = str(uuid.uuid4())
    with _connect() as connection:
        existing = connection.execute(
            "SELECT id, objective FROM executions WHERE client_request_id = ?",
            (client_request_id,),
        ).fetchone()
        if existing:
            if not hmac.compare_digest(str(existing["objective"]), objective):
                raise HTTPException(
                    status_code=409,
                    detail="The request ID was already used for another objective.",
                )
            return str(existing["id"]), False
        connection.execute(
            """
            INSERT INTO executions (
                id, client_request_id, objective, status, created_at, updated_at
            ) VALUES (?, ?, ?, 'QUEUED', ?, ?)
            """,
            (execution_id, client_request_id, objective, now, now),
        )
    return execution_id, True


def _update_execution(execution_id: str, **fields: Any) -> None:
    allowed = {"status", "autogpt_task_id", "output", "error"}
    updates = {key: value for key, value in fields.items() if key in allowed}
    updates["updated_at"] = time.time()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with _connect() as connection:
        connection.execute(
            f"UPDATE executions SET {assignments} WHERE id = ?",  # noqa: S608
            (*updates.values(), execution_id),
        )


def _truncate_output(value: str) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= MAX_STORED_OUTPUT_BYTES:
        return value
    suffix = "\n\n[Output truncated by AIRA runner.]"
    budget = max(0, MAX_STORED_OUTPUT_BYTES - len(suffix.encode("utf-8")))
    return encoded[:budget].decode("utf-8", errors="ignore") + suffix


def _check_api_key(candidate: str | None) -> None:
    if not candidate or not hmac.compare_digest(candidate, RUNNER_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key.")


def _check_internal_token(authorization: str | None) -> None:
    expected = f"Bearer {AUTOGPT_INTERNAL_TOKEN}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid internal token.")


async def _bounded_json(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_PROVIDER_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body is too large.")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Request body must be JSON.") from error
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object.")
    return parsed


def _objective_from_node_input(payload: dict[str, Any]) -> str:
    node_input = payload.get("node_input")
    if not isinstance(node_input, dict):
        raise HTTPException(status_code=422, detail="node_input must be an object.")
    for node_value in node_input.values():
        if not isinstance(node_value, dict):
            continue
        for value in node_value.values():
            if isinstance(value, str) and value.strip():
                objective = value.strip()
                if len(objective) > MAX_OBJECTIVE_CHARS:
                    raise HTTPException(status_code=413, detail="Objective is too long.")
                return objective
    raise HTTPException(status_code=422, detail="A text objective is required.")


async def _autogpt_request(
    method: str, path: str, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    timeout = httpx.Timeout(UPSTREAM_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            method,
            f"{AUTOGPT_INTERNAL_URL}{path}",
            json=payload,
            headers={"Accept": "application/json"},
        ) as response:
            content = await _read_limited_response(response)
            response.raise_for_status()
    data = json.loads(content)
    if not isinstance(data, dict):
        raise RuntimeError("AutoGPT returned a non-object response.")
    return data


def _is_swallowed_step_error(output: Any) -> bool:
    """AutoGPT Classic returns provider failures as a normal step output.

    Without this check an upstream outage is stored as a successful run, so the
    caller's agent-run quota is consumed for work that never happened.
    """
    if not isinstance(output, str):
        return False
    return output.strip().lower().startswith(SWALLOWED_STEP_ERROR_PREFIXES)


async def _run_execution(execution_id: str) -> None:
    row = _execution(execution_id)
    if not row:
        return
    _update_execution(execution_id, status="RUNNING", error=None)
    try:
        task_id = str(row["autogpt_task_id"] or "")
        if not task_id:
            task = await _autogpt_request(
                "POST",
                "/agent/tasks",
                {
                    "input": str(row["objective"]),
                    "additional_input": {
                        "source": "aira",
                        "execution_id": execution_id,
                    },
                },
            )
            task_id = str(task.get("task_id") or "").strip()
            if not task_id:
                raise RuntimeError("AutoGPT did not return a task ID.")
            _update_execution(execution_id, autogpt_task_id=task_id)

        final_output = ""
        transcript: list[str] = []
        for _ in range(MAX_STEPS):
            step = await _autogpt_request(
                "POST", f"/agent/tasks/{task_id}/steps", {"input": ""}
            )
            output = step.get("output")
            if isinstance(output, str) and output.strip():
                final_output = output.strip()
                transcript.append(final_output[:8000])
            status = str(step.get("status") or "").lower()
            if status == "failed":
                raise RuntimeError(final_output or "AutoGPT reported a failed step.")
            if _is_swallowed_step_error(output):
                raise RuntimeError(final_output or "AutoGPT could not complete a step.")
            # Agent Protocol reports per-step status. A step that finished is
            # "completed"; only is_last marks the end of the task.
            if bool(step.get("is_last")):
                _update_execution(
                    execution_id,
                    status="COMPLETED",
                    output=_truncate_output(
                        final_output or "AutoGPT completed the task."
                    ),
                )
                return

        diagnostic = "\n\n".join(transcript[-3:])
        raise RuntimeError(
            f"AutoGPT reached the configured {MAX_STEPS}-step safety limit. {diagnostic}".strip()
        )
    except asyncio.CancelledError:
        _update_execution(execution_id, status="QUEUED")
        raise
    except Exception as error:
        LOGGER.exception("Execution %s failed on %s", execution_id, HOST_ROLE)
        _update_execution(
            execution_id,
            status="FAILED",
            error=str(error)[:2000],
        )


async def _worker(worker_id: int) -> None:
    while True:
        execution_id = await QUEUE.get()
        try:
            LOGGER.info("Worker %s running execution %s", worker_id, execution_id)
            await _run_execution(execution_id)
        finally:
            QUEUE.task_done()


async def _internal_healthy() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{AUTOGPT_INTERNAL_URL}/heartbeat")
        return response.status_code == 200
    except httpx.HTTPError:
        return False


async def _read_limited_response(response: httpx.Response) -> bytes:
    content = bytearray()
    async for chunk in response.aiter_bytes():
        content.extend(chunk)
        if len(content) > MAX_PROVIDER_BODY_BYTES:
            raise HTTPException(
                status_code=502,
                detail="The upstream response exceeded the runner safety limit.",
            )
    return bytes(content)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    _require_non_default_secrets()
    _initialize_database()
    for execution_id in _recoverable_execution_ids():
        QUEUE.put_nowait(execution_id)
    for worker_id in range(max(1, MAX_CONCURRENT_RUNS)):
        WORKERS.append(asyncio.create_task(_worker(worker_id)))
    try:
        yield
    finally:
        for worker in WORKERS:
            worker.cancel()
        await asyncio.gather(*WORKERS, return_exceptions=True)
        WORKERS.clear()


app = FastAPI(
    title="AIRA AutoGPT Runner",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.get("/internal-ready", include_in_schema=False)
async def internal_ready():
    return {"status": "ok"}


@app.get("/external-api/v1/health")
async def health(x_api_key: str | None = Header(default=None, alias="X-API-Key")):
    _check_api_key(x_api_key)
    if not await _internal_healthy():
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "role": HOST_ROLE},
        )
    return {"status": "ok", "role": HOST_ROLE}


@app.post("/external-api/v1/graphs/{graph_id}/execute/{graph_version}")
async def execute_graph(
    graph_id: str,
    graph_version: int,
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    x_aira_request_id: str | None = Header(default=None, alias="X-AIRA-Request-ID"),
):
    _check_api_key(x_api_key)
    if graph_id != EXPECTED_GRAPH_ID or graph_version != EXPECTED_GRAPH_VERSION:
        raise HTTPException(status_code=404, detail="Graph not found.")
    if not x_aira_request_id or not re.fullmatch(
        r"[A-Za-z0-9_-]{8,128}", x_aira_request_id
    ):
        raise HTTPException(status_code=400, detail="A valid request ID is required.")
    payload = await _bounded_json(request)
    objective = _objective_from_node_input(payload)
    execution_id, created = _create_execution(x_aira_request_id, objective)
    if created:
        QUEUE.put_nowait(execution_id)
    return {"id": execution_id}


@app.get(
    "/external-api/v1/graphs/{graph_id}/executions/{execution_id}/results"
)
async def execution_result(
    graph_id: str,
    execution_id: str,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
):
    _check_api_key(x_api_key)
    if graph_id != EXPECTED_GRAPH_ID:
        raise HTTPException(status_code=404, detail="Graph not found.")
    row = _execution(execution_id)
    if not row:
        raise HTTPException(status_code=404, detail="Execution not found.")
    return {
        "execution_id": execution_id,
        "status": str(row["status"]),
        "output": row["output"] if row["status"] == "COMPLETED" else None,
    }


async def _forward_to_nvidia(
    request: Request,
    endpoint: str,
    authorization: str | None,
) -> Response:
    _check_internal_token(authorization)
    payload = await _bounded_json(request)
    requested_model = str(payload.get("model") or "")
    if endpoint == "chat/completions":
        payload["model"] = (
            NVIDIA_FAST_MODEL if requested_model == "gpt-4o-mini" else NVIDIA_SMART_MODEL
        )
    else:
        payload["model"] = NVIDIA_EMBEDDING_MODEL

    async with httpx.AsyncClient(timeout=httpx.Timeout(UPSTREAM_TIMEOUT_SECONDS)) as client:
        async with client.stream(
            "POST",
            f"{NVIDIA_API_URL}/{endpoint}",
            json=payload,
            headers={
                "Authorization": f"Bearer {NVIDIA_API_KEY}",
                "Accept": "application/json",
            },
        ) as response:
            content = await _read_limited_response(response)
    return Response(
        content=content,
        status_code=response.status_code,
        headers={
            "content-type": response.headers.get(
                "content-type", "application/json"
            )
        },
    )


@app.get("/internal/v1/models")
async def models(authorization: str | None = Header(default=None)):
    _check_internal_token(authorization)
    return {
        "object": "list",
        "data": [
            {"id": "gpt-4o", "object": "model", "owned_by": "aira"},
            {"id": "gpt-4o-mini", "object": "model", "owned_by": "aira"},
            {
                "id": "text-embedding-3-small",
                "object": "model",
                "owned_by": "aira",
            },
        ],
    }


@app.post("/internal/v1/chat/completions")
async def chat_completions(
    request: Request, authorization: str | None = Header(default=None)
):
    return await _forward_to_nvidia(request, "chat/completions", authorization)


@app.post("/internal/v1/embeddings")
async def embeddings(
    request: Request, authorization: str | None = Header(default=None)
):
    return await _forward_to_nvidia(request, "embeddings", authorization)
