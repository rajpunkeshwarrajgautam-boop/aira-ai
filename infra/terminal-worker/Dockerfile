FROM node:22.18.0-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    COREPACK_HOME=/opt/corepack

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.28.1 --activate \
    && useradd --create-home --uid 10005 --shell /usr/sbin/nologin runner \
    && mkdir -p /app /workspaces \
    && chown -R runner:runner /app /workspaces

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY server.py launcher.py ./
RUN chown -R runner:runner /app

USER runner
EXPOSE 8080
CMD ["python3", "launcher.py"]
