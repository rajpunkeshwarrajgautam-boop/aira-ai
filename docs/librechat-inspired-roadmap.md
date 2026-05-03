# LibreChat-Inspired Architecture Roadmap

This document outlines architectural improvements for the Perplexity-style search engine, inspired by the modular and extensible design of [LibreChat](https://github.com/danny-avila/LibreChat).

## Analysis Overview

LibreChat excels in **multi-provider orchestration** and **extensibility** via its Agents framework and MCP integration. Our current application is highly specialized for research but lacks the generalized routing and tool-extensibility that LibreChat provides.

### Comparison Table

| Feature | LibreChat | Our App | Recommendation |
| :--- | :--- | :--- | :--- |
| **Routing** | Unified Endpoint, YAML config | Basic Fallback (OpenAI/NVIDIA) | **Adopt** modular router |
| **Tools** | Built-in + MCP (Universal) | Static Tool Registry | **Adopt** MCP support |
| **Presets** | Reusable model/params | Hardcoded in services | **Adopt** Research Presets |
| **Search** | Pluggable (Serper, SearXNG) | Exa-specific | **Adopt** Search Abstraction |
| **UI/UX** | Agent Builder / General Chat | Search-First / Specialized | **Keep** Search-First UX |

---

## Roadmap Recommendations

### 1. Provider Router (High Priority)
**Goal:** Decouple LLM logic from specific services (`openai.ts`).
- **Adopt:** A unified "LLM Hub" that handles multiple providers (OpenAI, Anthropic, Gemini, Ollama) via a single internal API.
- **Why:** Reduces vendor lock-in and allows for smarter fallbacks (e.g., switching to a cheaper model for planning and a stronger one for answering).
- **Avoid:** Complex YAML-based configuration for simple deployments; keep it environment-variable driven for now.

### 2. Research Modes & Presets (Medium Priority)
**Goal:** Expand beyond "Standard" and "Deep" research.
- **Adopt:** Preset system for research "intent". Examples:
    - `Academic`: Focus on ArXiv and peer-reviewed journals.
    - `Shopping`: Focus on reviews and price comparisons.
    - `Coding`: Focus on GitHub, StackOverflow, and documentation.
- **Why:** Enhances user relevance and aligns with Perplexity's "Pro" features.
- **Avoid:** Exposing raw LLM parameters (temperature, top_p) to users; keep it simple "modes".

### 3. MCP (Model Context Protocol) Integration (Medium Priority)
**Goal:** Enable "Tools" to be added without modifying core code.
- **Adopt:** Native support for MCP servers.
- **Why:** Allows the agent to use external tools (calculators, database connectors, local file search) via a standardized protocol.
- **Avoid:** Heavy-weight plugin systems that require custom boilerplate for every new tool.

---

## Strategic Fit

### What Fits Our Product
- **Search Abstraction:** Abstracting the search provider (Exa vs. Serper vs. Brave) to ensure reliability.
- **Reranking Layers:** Using specialized rerankers (like Jina or Cohere) after the initial search to improve citation quality.

### What Does NOT Fit
- **General-Purpose Agent Builder:** Our users want answers, not to build their own agents. Keep complexity hidden.
- **Heavy Social/Collaboration Features:** Maintain focus on the individual research experience.

---

## Risks
1.  **Complexity Overhead:** Introducing a provider router might make debugging more difficult if not implemented cleanly.
2.  **Latency:** Adding reranking or MCP layers could increase the time-to-first-token.
3.  **Cost:** Using multiple LLMs or specialized rerankers increases API usage costs.

---

## Top 3 Recommended Implementations

| Implementation | Description | Impact |
| :--- | :--- | :--- |
| **A. Provider Router** | Refactor `openai.ts` into a `ProviderRegistry` supporting OpenAI, Anthropic, and Local models. | High (Scalability) |
| **B. Research Presets** | Move system prompts and search settings into a `presets` configuration. | High (User Value) |
| **C. MCP Integration** | Add an MCP client to `lib/agents/orchestrator` for dynamic tool loading. | Medium (Extensibility) |
