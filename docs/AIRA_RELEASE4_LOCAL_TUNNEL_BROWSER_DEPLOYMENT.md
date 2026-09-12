# AIRA Release 4 — Phase 5 Local Docker + Cloudflare Tunnel Deployment

## 1. Deployment Overview & Certification Target

- **Target / Mode**: `LOCAL_DOCKER_VIA_CLOUDFLARE_TUNNEL`
- **Tunnel Mode**: `QUICK` (Zero-cost Cloudflare Quick Tunnel)
- **Public Tunnel Hostname**: `https://cross-vessel-uniform-wind.trycloudflare.com`
- **Local Origin Binding**: `http://127.0.0.1:8092` (Loopback only; strictly no 0.0.0.0 exposure)
- **Official Cloudflared Version**: `2026.9.1`
- **Container Host Platform**: Docker Desktop 29.7.2 (WSL2 Linux Kernel)
- **Container Name**: `aira-browser-worker-browser-worker-1`
- **Container Short ID**: `f8d37f21d7f3`
- **Container Image**: `aira-browser-worker-browser-worker:latest`
- **Worker Source SHA**: `9bfbd13cfbf8c687403573f38ead7eb630d3eac6`
- **Replica Count**: `1`
- **Inbound Router / NAT Port Forwarding**: `NONE`
- **Credit Card Required**: `NO`
- **Hosting Cost**: `$0`

---

## 2. Workstation Availability & Operational Constraints

- **Workstation Required**: `YES` (Workstation must remain powered on and connected to internet during active Preview testing)
- **Docker Required**: `YES`
- **cloudflared Required**: `YES`
- **Always-on 24/7 Hosting**: `NO` (Preview certification infrastructure only; NOT permanent Production hosting)
- **Feature Reduction**: `NONE` during active workstation session
- **Production Status**: `OFF_LIMITS` (Production is completely isolated at `https://aira-ai-live.vercel.app`)

---

## 3. Security Baseline & Network Protection

- **Local Host Binding**: `127.0.0.1:8092` only. No binding to LAN IP or public interfaces.
- **Docker Hardening**:
  - `security_opt: [no-new-privileges:true]`
  - `cap_drop: [ALL]`
  - `pids_limit: 384`
  - `shm_size: 1gb`
  - `tmpfs: /tmp:rw,noexec,nosuid,size=1g`
  - Non-root user: `pwuser` (UID 1000)
- **Bearer Token Auth**: Cryptographically secure 256-bit token (`AIRA_BROWSER_RUNTIME_TOKEN`) required for all non-healthz endpoints.
- **SSRF Enforcement**:
  - Layer 1 (Application): Next.js `publicWebUrl` blocks loopback, private RFC1918, link-local, cloud metadata, and non-http schemes.
  - Layer 2 (Worker): FastAPI/Playwright route handler resolves DNS on every request and blocks private IP destinations and redirects.
  - Network Claim Discipline: `APPLICATION_SSRF_ENFORCED`, `WORKER_SSRF_ENFORCED`, `NETWORK_LAYER_PRIVATE_EGRESS_NOT_FULLY_PROVEN`.

---

## 4. End-to-End Verification Trace

```
EXACT VERCEL PREVIEW (dpl_FWiZuJP95WuEfoYpWqg273guBFoE)
         ↓ HTTPS (Bearer Token Auth)
CLOUDFLARE QUICK TUNNEL (cross-vessel-uniform-wind.trycloudflare.com)
         ↓ HTTP
127.0.0.1:8092 (Local Loopback)
         ↓
DOCKER (aira-browser-worker-1)
         ↓
FastAPI Server (server.py)
         ↓
Playwright Chromium (pwuser)
         ↓
REAL PUBLIC WEBSITES (example.com, nextjs.org/docs)
```
