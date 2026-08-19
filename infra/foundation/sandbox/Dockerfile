FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --uid 10003 sandbox \
    && mkdir -p /work \
    && chown sandbox:sandbox /work
WORKDIR /app
COPY server.py .
USER sandbox
EXPOSE 8080
CMD ["python", "server.py"]
