FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=0 \
    OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1 \
    OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1

WORKDIR /app
RUN pip install --no-cache-dir \
    "aiosqlite>=0.20,<1" \
    "fastapi>=0.116,<1" \
    "httpx>=0.28,<1" \
    "openai-agents==0.19.4" \
    "pydantic-settings>=2.10,<3" \
    "uvicorn[standard]>=0.35,<1"
COPY aae_runner ./aae_runner
RUN useradd --create-home --uid 10001 aae \
    && mkdir -p /workspace /data \
    && chown -R aae:aae /workspace /data /app
USER 10001
EXPOSE 8000
CMD ["uvicorn", "aae_runner.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
