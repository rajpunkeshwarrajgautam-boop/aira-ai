# AIRA Desktop 1.0

AIRA Desktop is a local-first Windows agentic operating layer built with Electron, React and TypeScript.

## 1.0 capabilities

- Multi-step autonomous agent loop with explicit tool execution trace
- Local Ollama inference plus OpenAI-compatible routing, including local `llama.cpp`
- Structured JSON decisions with compatibility fallback for local servers
- Local vision using `qwen3-vl:8b`
- Screen capture, visual inspection and UI coordinate grounding
- Approval-gated mouse, keyboard, foreground-window and PowerShell actions
- Persistent in-app browser with page snapshots, element refs, clicking and typing
- Durable semantic memory
- Workspace RAG using Ollama embeddings and an embedded local index
- Installable JSON prompt skills
- One-time and interval scheduled tasks
- Windows speech recognition, speech synthesis and wake-word hands-free mode
- Encrypted API-key vault using Electron `safeStorage`
- Tool audit log
- Sandboxed renderer and deny-by-default permission policy
- NSIS installer and GitHub-release auto-update support

## Safety model

Read-only inspection can run without confirmation. State-changing actions—file writes/deletes, shell execution, browser clicks/types, desktop mouse/keyboard control, clipboard writes and task creation—require explicit one-time approval.

Scheduled/unattended agent runs are read-only and cannot execute approval-gated tools.

File tools are restricted to the configured workspace root.

## Requirements

- Windows 10/11
- Node.js 22+ for development
- At least one text inference provider:
  - Ollama, or
  - an OpenAI-compatible endpoint such as local `llama.cpp`
- Ollama is still required in 1.0 for the built-in local vision and embedding pipelines
- Recommended models depend on available RAM/VRAM. The default Ollama stack is:
  - `qwen3.5:9b`
  - `qwen3-vl:8b`
  - `embeddinggemma`

## Setup

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
npm run dev
```

Or manually:

```powershell
npm install
ollama pull qwen3.5:9b
ollama pull qwen3-vl:8b
ollama pull embeddinggemma
npm run dev
```

## Use a local llama.cpp model as AIRA's main brain

AIRA Desktop can use `llama-server` directly through its OpenAI-compatible API. The llama.cpp web page at `http://127.0.0.1:8080` remains the inference server's basic UI; AIRA Desktop supplies the agent loop, workspace tools, browser/computer actions, skills, memory and approvals.

Start your GGUF model with a recent llama.cpp build. Example:

```powershell
llama-server.exe `
  -m C:\Models\your-model.gguf `
  -ngl 99 `
  -c 8192 `
  --host 127.0.0.1 `
  --port 8080
```

Confirm the OpenAI-compatible endpoint is alive:

```powershell
curl.exe http://127.0.0.1:8080/v1/models
```

Then in **AIRA Desktop → Settings** set:

- **Provider:** `OpenAI-compatible Remote`
- **Remote API Base:** `http://127.0.0.1:8080/v1`
- **Remote model:** use the model ID returned by `/v1/models`
- **Remote API Key:** leave empty for a normal loopback llama.cpp server

AIRA treats `localhost`, `127.x.x.x` and `::1` endpoints as local and permits them without an API key. Non-loopback OpenAI-compatible endpoints still require a key from the encrypted vault.

If a local server rejects OpenAI's `response_format: json_object`, AIRA automatically retries the agent decision request without that field while retaining its strict JSON decision protocol.

## Validation

```powershell
npm run typecheck
npm test
npm run build
```

## Windows installer

```powershell
npm run dist:win
```

## Custom skills

Create a JSON file inside the configured workspace:

```json
{
  "name": "Release Check",
  "description": "Review a project before release.",
  "instructions": "Inspect git status, build configuration, tests and obvious release blockers. Prefer read-only inspection."
}
```

Then ask AIRA to install that skill from the file.

## Scheduled tasks

Examples:

- "Every 60 minutes, check my workspace index status and summarize anything notable."
- "Tomorrow at 9 AM, remind me to review the release."

Unattended tasks intentionally cannot make state-changing system actions.

## OpenAI-compatible providers

Settings can route text reasoning to an OpenAI-compatible endpoint. Remote endpoints require an API key, which is encrypted using Electron `safeStorage`. Loopback endpoints such as local llama.cpp can run keyless. Vision and embeddings remain local through Ollama in 1.0.
