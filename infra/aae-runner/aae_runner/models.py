from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

JobStatus = Literal['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TERMINATED']


class SubmitJobRequest(BaseModel):
    job_id: str = Field(min_length=8, max_length=128, pattern=r'^[A-Za-z0-9._:-]+$')
    task: str = Field(min_length=3, max_length=100_000)
    session_id: str | None = Field(default=None, max_length=128)


class JobResponse(BaseModel):
    id: str
    status: JobStatus
    output: str | None = None
    error: str | None = None
    modified_files: list[str] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    completed_at: str | None = None


class HealthResponse(BaseModel):
    status: Literal['ok']
    model: str
    shell_enabled: bool
