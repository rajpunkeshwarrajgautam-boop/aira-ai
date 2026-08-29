FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --uid 10006 --shell /usr/sbin/nologin scheduler
WORKDIR /app
COPY worker.py .
RUN chown -R scheduler:scheduler /app
USER scheduler
CMD ["python", "worker.py"]
