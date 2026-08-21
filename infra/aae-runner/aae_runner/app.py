from __future__ import annotations

import hmac

import httpx
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request, status

from .config import get_settings
from .manager import JobManager
from .models import HealthResponse, JobResponse, SubmitJobRequest

settings = get_settings()
manager = JobManager(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await manager.start()
    try:
        yield
    finally:
        await manager.close()


app = FastAPI(
    title='AIRA Autonomous Agent Engine',
    version='0.2.0',
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


def require_auth(
    authorization: str | None = Header(default=None),
    owner_id: str | None = Header(default=None, alias='X-Aira-Owner-User-Id'),
) -> str:
    expected = f'Bearer {settings.api_token}'
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Unauthorized')
    if not owner_id or len(owner_id) > 256:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Missing owner identity')
    if not hmac.compare_digest(owner_id, settings.allowed_owner_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Owner is not allowed on this runner')
    return owner_id


@app.get('/health', response_model=HealthResponse)
async def health() -> HealthResponse:
    if settings.allow_shell:
        try:
            async with httpx.AsyncClient(timeout=settings.health_timeout_seconds) as client:
                response = await client.get(f"{settings.sandbox_url.rstrip('/')}/health")
            if not response.is_success:
                raise RuntimeError('sandbox unhealthy')
        except Exception as exc:
            raise HTTPException(status_code=503, detail='Execution sandbox is unavailable') from exc
    return HealthResponse(status='ok', model=settings.model, shell_enabled=settings.allow_shell)


@app.post('/v1/jobs', response_model=JobResponse, status_code=202)
async def submit_job(payload: SubmitJobRequest, request: Request) -> JobResponse:
    owner_id = require_auth(
        request.headers.get('authorization'),
        request.headers.get('x-aira-owner-user-id'),
    )
    try:
        return await manager.submit(
            job_id=payload.job_id,
            owner_id=owner_id,
            task=payload.task,
            session_id=payload.session_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail='Job id conflict') from exc


@app.get('/v1/jobs/{job_id}', response_model=JobResponse)
async def get_job(job_id: str, request: Request) -> JobResponse:
    owner_id = require_auth(
        request.headers.get('authorization'),
        request.headers.get('x-aira-owner-user-id'),
    )
    job = await manager.get(job_id, owner_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Job not found')
    return job


@app.post('/v1/jobs/{job_id}/cancel', response_model=JobResponse, status_code=202)
async def cancel_job(job_id: str, request: Request) -> JobResponse:
    owner_id = require_auth(
        request.headers.get('authorization'),
        request.headers.get('x-aira-owner-user-id'),
    )
    job = await manager.cancel(job_id, owner_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Job not found')
    return job
