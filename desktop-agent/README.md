# AIRA Desktop 1.0

AIRA Desktop is a local-first Windows agentic operating layer built with Electron, React and TypeScript.

## 1.0 capabilities

- Multi-step autonomous agent loop with explicit tool execution trace
- Local Ollama inference plus optional OpenAI-compatible model routing
- Structured JSON decisions
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
- Ollama for local inference
- Recommended local models:
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

## Remote model provider

Settings can route text reasoning to an OpenAI-compatible `/chat/completions` endpoint. The API key is encrypted using the operating system credential encryption through Electron `safeStorage`. Vision and embeddings remain local through Ollama in 1.0.
