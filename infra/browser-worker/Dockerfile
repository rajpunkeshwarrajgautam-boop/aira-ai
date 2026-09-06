FROM mcr.microsoft.com/playwright/python:v1.61.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /data/screenshots \
    && chown -R pwuser:pwuser /data /app
COPY --chown=pwuser:pwuser server.py .

USER pwuser
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--proxy-headers", "--no-server-header"]
