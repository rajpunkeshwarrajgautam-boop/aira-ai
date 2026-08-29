import asyncio
import hmac
import ipaddress
import os
import socket
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

TOKEN = os.environ.get("AIRA_BROWSER_RUNTIME_TOKEN", "")
DEFAULT_TTL_SECONDS = max(60, min(4 * 60 * 60, int(os.environ.get("AIRA_BROWSER_SESSION_TTL_SECONDS", "3600"))))
MAX_SESSIONS = max(1, min(20, int(os.environ.get("AIRA_BROWSER_MAX_SESSIONS", "6"))))
MAX_LOG_ITEMS = 200


@dataclass
class SessionState:
    session_id: str
    context: BrowserContext
    page: Page
    allowed_domains: tuple[str, ...]
    created_at: float
    expires_at: float
    console: list[dict[str, Any]] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)
    network_failures: list[dict[str, str]] = field(default_factory=list)


playwright: Playwright | None = None
browser: Browser | None = None
sessions: dict[str, SessionState] = {}
session_lock = asyncio.Lock()


def _hostname(value: str) -> str:
    return value.strip().lower().rstrip(".")


def _domain_allowed(host: str, allowed: tuple[str, ...]) -> bool:
    host = _hostname(host)
    return any(host == domain or host.endswith(f".{domain}") for domain in allowed)


def _literal_address_is_public(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


async def _assert_public_host(host: str) -> None:
    host = _hostname(host)
    if not host or host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise HTTPException(status_code=400, detail="Local/private browser targets are blocked.")
    if not _literal_address_is_public(host):
        raise HTTPException(status_code=400, detail="Private browser targets are blocked.")
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="Browser target could not be resolved.") from exc
    addresses = {info[4][0] for info in infos if info[4]}
    if not addresses:
        raise HTTPException(status_code=400, detail="Browser target could not be resolved.")
    for value in addresses:
        if not _literal_address_is_public(value):
            raise HTTPException(status_code=400, detail="Browser target resolved to a private address.")


async def _validate_url(url: str, allowed: tuple[str, ...], *, require_allowed: bool) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Only HTTP(S) browser targets are allowed.")
    host = _hostname(parsed.hostname)
    await _assert_public_host(host)
    if require_allowed and not _domain_allowed(host, allowed):
        raise HTTPException(status_code=403, detail="Target domain is outside this browser session scope.")
    return url


async def require_token(
    authorization: str | None = Header(default=None),
    x_aira_browser_token: str | None = Header(default=None),
) -> None:
    supplied = x_aira_browser_token or ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not TOKEN or not supplied or not hmac.compare_digest(TOKEN, supplied):
        raise HTTPException(status_code=401, detail="unauthorized")


class CreateSessionRequest(BaseModel):
    sessionId: str = Field(min_length=8, max_length=128)
    allowedDomains: list[str] = Field(min_length=1, max_length=25)
    width: int = Field(default=1440, ge=320, le=2560)
    height: int = Field(default=900, ge=480, le=1600)
    startUrl: str | None = Field(default=None, max_length=4096)
    ttlSeconds: int = Field(default=DEFAULT_TTL_SECONDS, ge=60, le=14400)

    @field_validator("allowedDomains")
    @classmethod
    def normalize_domains(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for raw in values:
            value = _hostname(raw)
            if not value or "/" in value or ":" in value or value.startswith("."):
                raise ValueError("allowedDomains must contain plain DNS hostnames")
            if value not in normalized:
                normalized.append(value)
        return normalized


class ActionRequest(BaseModel):
    action: Literal[
        "navigate",
        "click",
        "double_click",
        "click_at",
        "fill",
        "press",
        "select",
        "scroll",
        "hover",
        "wait",
        "inspect",
    ]
    selector: str | None = Field(default=None, max_length=2048)
    text: str | None = Field(default=None, max_length=20000)
    value: str | None = Field(default=None, max_length=4096)
    key: str | None = Field(default=None, max_length=128)
    url: str | None = Field(default=None, max_length=4096)
    x: float | None = None
    y: float | None = None
    deltaY: float | None = Field(default=None, ge=-10000, le=10000)
    milliseconds: int | None = Field(default=None, ge=0, le=10000)


async def _session(session_id: str) -> SessionState:
    async with session_lock:
        state = sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Browser session not found.")
    if state.expires_at <= time.time():
        await _close_session(session_id)
        raise HTTPException(status_code=410, detail="Browser session expired.")
    return state


async def _close_session(session_id: str) -> None:
    async with session_lock:
        state = sessions.pop(session_id, None)
    if state:
        await state.context.close()


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(30)
        now = time.time()
        async with session_lock:
            expired = [key for key, state in sessions.items() if state.expires_at <= now]
        for key in expired:
            await _close_session(key)


async def _safe_route(state: SessionState, route: Any) -> None:
    request = route.request
    parsed = urlparse(request.url)
    if parsed.scheme not in {"http", "https"}:
        await route.abort("blockedbyclient")
        return
    host = _hostname(parsed.hostname or "")
    try:
        # Resolve every network request at request time. This makes DNS rebinding
        # and redirect-to-private-address attempts fail closed after navigation
        # has begun, not only when the original URL was validated.
        await _assert_public_host(host)
    except HTTPException:
        await route.abort("blockedbyclient")
        return
    if request.is_navigation_request() and request.frame.parent_frame is None:
        # Every top-level redirect must remain inside the explicit domain scope.
        # Popup/new-tab main frames are blocked entirely so a click cannot create
        # a hidden second browsing context outside the session AIRA audits.
        if request.frame != state.page.main_frame or not _domain_allowed(host, state.allowed_domains):
            await route.abort("blockedbyclient")
            return
    await route.continue_()


def _append_bounded(collection: list[Any], value: Any) -> None:
    collection.append(value)
    if len(collection) > MAX_LOG_ITEMS:
        del collection[: len(collection) - MAX_LOG_ITEMS]


def _public_state(state: SessionState) -> dict[str, Any]:
    return {
        "sessionId": state.session_id,
        "status": "active",
        "currentUrl": state.page.url,
        "title": None,
        "allowedDomains": list(state.allowed_domains),
        "expiresAt": state.expires_at,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    global playwright, browser
    if not TOKEN:
        raise RuntimeError("AIRA_BROWSER_RUNTIME_TOKEN is required")
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=True)
    cleanup = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        cleanup.cancel()
        async with session_lock:
            ids = list(sessions)
        for session_id in ids:
            await _close_session(session_id)
        if browser:
            await browser.close()
        if playwright:
            await playwright.stop()


app = FastAPI(title="AIRA Browser Worker", version="1.0.0", lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"ok": browser is not None and browser.is_connected(), "sessions": len(sessions)}


@app.post("/v1/sessions", dependencies=[Depends(require_token)])
async def create_session(body: CreateSessionRequest) -> dict[str, Any]:
    if browser is None:
        raise HTTPException(status_code=503, detail="Browser runtime unavailable.")
    allowed = tuple(body.allowedDomains)
    for domain in allowed:
        await _assert_public_host(domain)
    if body.startUrl:
        await _validate_url(body.startUrl, allowed, require_allowed=True)
    async with session_lock:
        existing = sessions.get(body.sessionId)
        if existing:
            return _public_state(existing)
        if len(sessions) >= MAX_SESSIONS:
            raise HTTPException(status_code=429, detail="Browser worker session capacity reached.")
    context = await browser.new_context(
        viewport={"width": body.width, "height": body.height},
        accept_downloads=False,
        java_script_enabled=True,
    )
    page = await context.new_page()
    state = SessionState(
        session_id=body.sessionId,
        context=context,
        page=page,
        allowed_domains=allowed,
        created_at=time.time(),
        expires_at=time.time() + body.ttlSeconds,
    )
    await context.route("**/*", lambda route: _safe_route(state, route))
    page.on(
        "console",
        lambda message: _append_bounded(
            state.console,
            {"type": message.type, "text": message.text[:4000]},
        ),
    )
    page.on("pageerror", lambda error: _append_bounded(state.page_errors, str(error)[:4000]))
    page.on(
        "requestfailed",
        lambda request: _append_bounded(
            state.network_failures,
            {"url": request.url[:4096], "error": (request.failure or "request failed")[:1000]},
        ),
    )
    async with session_lock:
        if body.sessionId in sessions:
            await context.close()
            return _public_state(sessions[body.sessionId])
        sessions[body.sessionId] = state
    if body.startUrl:
        try:
            await page.goto(body.startUrl, wait_until="domcontentloaded", timeout=30000)
        except Exception as exc:
            await _close_session(body.sessionId)
            raise HTTPException(status_code=502, detail="Initial browser navigation failed.") from exc
    return _public_state(state)


@app.get("/v1/sessions/{session_id}", dependencies=[Depends(require_token)])
async def session_status(session_id: str) -> dict[str, Any]:
    state = await _session(session_id)
    result = _public_state(state)
    result["title"] = await state.page.title()
    return result


@app.post("/v1/sessions/{session_id}/actions", dependencies=[Depends(require_token)])
async def browser_action(session_id: str, body: ActionRequest) -> dict[str, Any]:
    state = await _session(session_id)
    page = state.page
    try:
        if body.action == "navigate":
            if not body.url:
                raise HTTPException(status_code=400, detail="navigate requires url")
            await _validate_url(body.url, state.allowed_domains, require_allowed=True)
            await page.goto(body.url, wait_until="domcontentloaded", timeout=30000)
        elif body.action == "click":
            if not body.selector:
                raise HTTPException(status_code=400, detail="click requires selector")
            await page.locator(body.selector).first.click(timeout=10000)
        elif body.action == "double_click":
            if not body.selector:
                raise HTTPException(status_code=400, detail="double_click requires selector")
            await page.locator(body.selector).first.dblclick(timeout=10000)
        elif body.action == "click_at":
            if body.x is None or body.y is None:
                raise HTTPException(status_code=400, detail="click_at requires x and y")
            await page.mouse.click(body.x, body.y)
        elif body.action == "fill":
            if not body.selector or body.text is None:
                raise HTTPException(status_code=400, detail="fill requires selector and text")
            await page.locator(body.selector).first.fill(body.text, timeout=10000)
        elif body.action == "press":
            if not body.key:
                raise HTTPException(status_code=400, detail="press requires key")
            if body.selector:
                await page.locator(body.selector).first.press(body.key, timeout=10000)
            else:
                await page.keyboard.press(body.key)
        elif body.action == "select":
            if not body.selector or body.value is None:
                raise HTTPException(status_code=400, detail="select requires selector and value")
            await page.locator(body.selector).first.select_option(body.value, timeout=10000)
        elif body.action == "scroll":
            await page.mouse.wheel(0, body.deltaY or 600)
        elif body.action == "hover":
            if not body.selector:
                raise HTTPException(status_code=400, detail="hover requires selector")
            await page.locator(body.selector).first.hover(timeout=10000)
        elif body.action == "wait":
            await page.wait_for_timeout(body.milliseconds or 500)
        elif body.action == "inspect":
            pass
        await page.wait_for_timeout(150)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Browser action failed: {body.action}") from exc

    parsed = urlparse(page.url)
    if parsed.hostname and not _domain_allowed(parsed.hostname, state.allowed_domains):
        raise HTTPException(status_code=403, detail="Browser navigation left the allowed domain scope.")
    text = (await page.locator("body").inner_text(timeout=5000))[:20000] if body.action == "inspect" else None
    return {
        "ok": True,
        "action": body.action,
        "currentUrl": page.url,
        "title": await page.title(),
        "text": text,
        "console": state.console[-50:],
        "pageErrors": state.page_errors[-50:],
        "networkFailures": state.network_failures[-50:],
    }


@app.get("/v1/sessions/{session_id}/screenshot", dependencies=[Depends(require_token)])
async def screenshot(session_id: str) -> Response:
    state = await _session(session_id)
    raw = await state.page.screenshot(type="png", full_page=False)
    return Response(content=raw, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.delete("/v1/sessions/{session_id}", dependencies=[Depends(require_token)])
async def delete_session(session_id: str) -> dict[str, bool]:
    await _close_session(session_id)
    return {"ok": True}
