# Agent Architecture Proposal (Inspired by Agentic CLIs)

This document outlines a high-level architectural proposal to enhance our Perplexity clone with an agentic system. The design patterns are inspired by state-of-the-art agent frameworks (like the public concepts from Claude Code and MCP) but are **100% original, safe, and tailor-made** for our web-first search and research pipeline.

---

## 1. What We Can Build (Original Implementations)

We will construct a modular, scalable agent engine inside our Next.js backend, consisting of the following core subsystems:

### 1.1 `/tools` Architecture (Tool Registry)
Instead of hardcoding tool definitions in the API routes, we will implement a centralized `ToolRegistry`.
*   **Design**: Every tool (e.g., `WebSearchTool`, `FetchPageTool`, `AnalyzeDataTool`) will be an isolated module implementing a standard `AgentTool` interface.
*   **Schema Validation**: We will use libraries like `Zod` to strictly type inputs and outputs.
*   **Benefits**: Easy to add new capabilities (like Python execution or internal database querying) without touching the core LLM loop.

### 1.2 `/commands` Architecture (Command Dispatcher)
To support deterministic actions and admin overrides without confusing the LLM, we will introduce a Slash Command System.
*   **Design**: A parser intercepts inputs starting with `/`. Commands like `/research [topic]`, `/memory clear`, or `/stats` will route directly to specific handlers.
*   **Benefits**: Faster execution for known workflows, zero token cost for basic commands, and a clear separation between conversational queries and system instructions.

### 1.3 User-Safe Permission Model
Safety is paramount when agents execute tools automatically.
*   **Design**: A middleware layer `ToolPermissionGuard`. Before any tool executes, its configuration is checked.
*   **Modes**:
    *   `auto`: Safe tools (like `WebSearchTool`) execute automatically.
    *   `plan_only`: The agent outputs a plan of what it *wants* to run, but waits for the user to click "Approve" (e.g., for destructive actions or expensive long-running tasks).
    *   `ask`: Prompts the user inline for every invocation.

### 1.4 Research Task Queue & Agent Orchestration
For Deep Research, a single LLM call is insufficient. We need multi-agent orchestration.
*   **Design**: A `CoordinatorAgent` that breaks down a complex query into sub-tasks and dispatches them to a `TaskQueue`.
*   **Sub-agents**: Smaller, specialized agents (e.g., a `SummarizationAgent` or `FactCheckAgent`) pick up tasks from the queue and run them in parallel.
*   **Benefits**: Massive speed improvements for Deep Research by parallelizing Exa searches and summarization tasks.

### 1.5 Memory Improvement Layer
To make the agent feel personalized and context-aware over time.
*   **Design**: Implement a dual-memory system.
    *   **Short-term context**: Standard conversation history.
    *   **Persistent Memory Directory (`memdir`)**: A lightweight vector database (or Postgres PGVector) where the agent can `extractMemories()` (e.g., "User prefers TypeScript over JavaScript") and retrieve them contextually on future queries.

### 1.6 Admin/Dev Commands
System observability is critical.
*   **Design**: Introduce tools specifically for developers or admins to monitor agent health, such as a `/doctor` command to verify API keys (OpenAI, NVIDIA, Exa), or a `CostTracker` module that logs token usage and stops execution if usage exceeds a budget.

---

## 2. What We Must Avoid

To maintain a pristine, legal, and original codebase, we must strictly enforce the following:
*   **No Code Copying**: Do not paste or transcribe any proprietary logic or leaked implementation files.
*   **No Proprietary Algorithms**: We will rely on open-source community standards (like MCP, LangChain patterns, or Vercel AI SDK) for orchestration, not internal proprietary state machines.
*   **No Bypassing Safety**: Never allow the agent to execute modifying commands or database writes without explicitly going through the `ToolPermissionGuard` and user consent.
*   **No Hardcoded Contexts**: Do not replicate proprietary system prompts; our prompts must be uniquely tailored to the Perplexity use-case.

---

## 3. Implementation Roadmap

### Phase 1: Foundation (Registries)
1.  Define the `Tool` interface and create the central `ToolRegistry`.
2.  Refactor existing `exaSearch` and `fetch` logic into standalone Tools.
3.  Implement the `/command` parser for deterministic routing.

### Phase 2: Safety & Execution Engine
1.  Build the `ToolPermissionGuard` middleware.
2.  Integrate the permission state into the Next.js frontend (e.g., UI popups for "Approve Agent Action").
3.  Implement the LLM routing loop (ReAct pattern) using the Vercel AI SDK.

### Phase 3: Orchestration & Tasks
1.  Create the `TaskQueue` and `Coordinator` logic for Deep Research.
2.  Allow the backend to spawn parallel sub-tasks and stream partial progress updates (e.g., "Agent 1 is reading source A", "Agent 2 is reading source B").

### Phase 4: Long-Term Memory
1.  Integrate a `extractMemories` prompt that runs asynchronously after a successful chat.
2.  Store extracted facts into the database and retrieve them dynamically for future queries.

---

## 4. Priority Order

1.  **High**: Tool Registry & Refactoring existing search logic (Foundational).
2.  **High**: Command Dispatcher (Quick wins for user experience).
3.  **Medium**: Safe Permission Model (Critical before adding advanced tools).
4.  **Medium**: Research Task Queue & Sub-agents (Major enhancement to Deep Research).
5.  **Low**: Persistent Memory Layer (Great for retention, but complex).
6.  **Low**: Admin/Dev tools (Can be built iteratively).
