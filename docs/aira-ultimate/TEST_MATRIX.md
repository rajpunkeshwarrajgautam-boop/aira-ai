# AIRA AI — Master Test & Quality Matrix

| Layer | Harness | Target Coverage | Execution Command |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `tsc --noEmit` | Strict, 0 errors | `pnpm --filter web check-types` |
| **Lint** | ESLint 9 | Strict, 0 warnings | `pnpm --filter web lint` |
| **Unit Tests** | Node Native Test Runner | Services, utilities, contracts | `pnpm --filter web test` |
| **Security Tests** | Security test suites | SSRF, IDOR, path traversal, secrets | `node --test test/omniroute-security.test.ts test/mcp-security-adapter.test.ts` |
| **Real DB Tests** | PostgreSQL 16+ Docker/Neon | Idempotency, migrations, leases | `AIRA_REAL_DB_RECOVERY_TESTS=1 pnpm --filter web test` |
| **Browser E2E** | Reticle Semantic Assertions | UI workflows, mobile/tablet viewports | Reticle browser subagent / session tests |
| **Build** | Turbo + Next.js | 0 build errors | `pnpm run build` |
