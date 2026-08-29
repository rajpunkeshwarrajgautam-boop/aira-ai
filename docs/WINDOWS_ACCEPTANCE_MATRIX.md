# Windows Production Acceptance Matrix

Evidence baseline: AIRA Desktop Windows workflow run #95, GitHub Actions run ID `33190844236`, commit `a628e95785d482dd522f43c8d7ca69b1dc543dac`.

Status meanings:
- PASS: directly demonstrated by automated evidence or source-level contract named below.
- FAIL: directly demonstrated failure requiring repair.
- BLOCKED: cannot truthfully be validated from CI/source inspection alone; requires a real Windows VM/device or live service/credential.

| Area | Test | Status | Evidence / next validation |
|---|---|---:|---|
| Build | Install dependencies | PASS | Run #95 `Install dependencies` completed successfully. |
| Build | Production dependency audit | PASS | Run #95 `Audit production dependencies` completed successfully. |
| Build | Typecheck + policy tests + application build | PASS | Run #95 `Typecheck, policy tests, and build` completed successfully. |
| Packaging | NSIS Windows installer packaging | PASS | Run #95 `Package Windows installer` completed successfully. |
| Packaging | Installer artifact upload | PASS | Run #95 `Upload Windows installer` completed successfully. |
| Packaging | Configured installer allows custom install directory | PASS | `desktop-agent/package.json` NSIS config has `oneClick:false` and `allowToChangeInstallationDirectory:true`. |
| Packaging | Desktop and Start Menu shortcut configuration | PASS | NSIS configuration explicitly enables both shortcuts. |
| Installation | Clean install on Windows 10 | BLOCKED | Must execute installer in a clean Windows 10 VM/device. |
| Installation | Clean install on Windows 11 | BLOCKED | Must execute installer in a clean Windows 11 VM/device. |
| Installation | Installation path change | BLOCKED | Configuration exists; needs real installer interaction. |
| Installation | Permissions/UAC behavior | BLOCKED | Requires real Windows execution. |
| Launch | First launch | BLOCKED | Packaging does not prove launch. |
| Launch | Startup time | BLOCKED | Must measure on target hardware/VM. |
| Desktop lifecycle | Minimize/restore/close/reopen | BLOCKED | Requires actual app session. |
| Desktop lifecycle | Crash recovery | BLOCKED | Requires controlled process/runtime fault test. |
| Desktop lifecycle | Uninstall | BLOCKED | Requires real NSIS uninstall execution. |
| Desktop lifecycle | Reinstall | BLOCKED | Requires install/uninstall/reinstall sequence. |
| Desktop lifecycle | Expected persistent data survives reinstall | BLOCKED | Must define expected retained data and inspect userData behavior. |
| Update | electron-updater dependency/config is present | PASS | Desktop package includes `electron-updater`; GitHub publishing target is configured. |
| Update | Live update discovery/download/install | BLOCKED | Requires released version + older installed version. |
| Local AI | Local/Ollama implementation exists | PASS | Desktop main process contains local model/config/agent paths and build policy tests pass. |
| Local AI | Live Ollama discovery/inference | BLOCKED | Requires running Ollama and at least one configured model on Windows. |
| Cloud AI | OpenAI-compatible implementation/test path | PASS | `openai-compatible` source and dedicated automated test are part of desktop `npm test`. |
| Cloud AI | Live cloud key/provider inference | BLOCKED | Requires authorized provider credentials/network. |
| AI | Streaming/cancellation | BLOCKED | Requires live model session and UI exercise. |
| AI | Provider failure/timeout/quota UX | BLOCKED | Requires deterministic live/fault injection. |
| Memory/RAG | Source implementation exists and compiles/tests in desktop build | PASS | `memory.ts`, `rag.ts` and agent contextualization are in the compiled desktop application. |
| Memory/RAG | Real indexing/retrieval across restart | BLOCKED | Requires physical app lifecycle test with files/data. |
| Browser | Sandboxed HTTP(S)-only browser controller exists | PASS | `browser.ts`: sandbox/context isolation, denied permissions, HTTP(S)-only navigation. |
| Browser | Semantic snapshot/click/type/back/screenshot implementation exists | PASS | `browser.ts` implements DOM snapshots and these actions. |
| Browser | Multi-step real website navigation | BLOCKED | Requires desktop run against controlled test site. |
| Browser | Form interaction | BLOCKED | Requires controlled page and result verification. |
| Browser | Browser crash/failure recovery | BLOCKED | Requires fault injection. |
| Computer/tools | Approval/policy tests are part of build | PASS | Desktop `npm test` includes `tests/policy.test.ts`. |
| Computer/tools | PowerShell/filesystem actions on target PC | BLOCKED | Requires real authorized run. |
| Computer/tools | Consequential action approval UX | BLOCKED | Source/policy exists; full UI round-trip must be exercised. |
| Agent | Bounded single-agent execution loop exists | PASS | `agent.ts` enforces `maxAgentSteps` and uses real tool results. |
| Agent | Tool failure is surfaced as evidence instead of fabricated success | PASS | `agent.ts` records failed/denied tool result in execution trace. |
| Agent | Manager -> multi-specialist DAG execution in Desktop | BLOCKED | New web runtime foundation is not yet integrated into Desktop's local agent loop. |
| Security | Electron browser nodeIntegration disabled/contextIsolation+sandbox enabled | PASS | Explicit BrowserWindow configuration in `browser.ts`. |
| Security | Browser permission requests denied by default | PASS | Session handlers return deny. |
| Security | Secrets remain safe during real update/provider/local use | BLOCKED | Requires runtime/IPC/storage inspection on installed build. |

## Release gate

The Windows binary is buildable and packageable, but physical acceptance remains open. Do not label the desktop milestone fully production-accepted until the BLOCKED lifecycle, live Ollama/browser/tool, update and recovery cases are executed on a clean Windows 11 environment and at least one supported Windows 10 environment if Windows 10 remains advertised.
