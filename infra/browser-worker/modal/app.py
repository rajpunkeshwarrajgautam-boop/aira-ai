"""
AIRA Release 4 — Phase 5 Modal Browser Worker Deployment Target
Encapsulates FastAPI server on Modal Serverless infrastructure.
Maintains zero coupling to application domain model.
"""

import os
import modal

# Define container image from the canonical browser-worker Dockerfile
image = modal.Image.from_dockerfile(
    path="../Dockerfile",
)

app = modal.App(name="aira-browser-worker", image=image)

# Conceptual single always-warm container configuration
# min_containers=1 ensures process-local BrowserSession persistence across requests
# CPU: 1.0 core minimum for Playwright Chromium
# RAM: 1024 MiB minimum (expandable to 1536/2048 MiB if free credit permits)
@app.function(
    min_containers=1,
    max_containers=1,
    cpu=1.0,
    memory=1024,
    timeout=600,
)
@modal.asgi_app()
def fastapi_app():
    from server import app as web_app

    return web_app
