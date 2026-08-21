FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends git nodejs npm ca-certificates \
    && pip install --no-cache-dir fastapi "uvicorn[standard]" pydantic \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 sandbox
WORKDIR /sandbox
COPY app.py ./app.py
RUN mkdir -p /workspace && chown -R sandbox:sandbox /workspace /sandbox
USER 10001
EXPOSE 9000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000"]
