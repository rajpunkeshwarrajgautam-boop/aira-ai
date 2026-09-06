# AIRA AI — Reusable Connector Matrix

All connectors conform to the unified `AiraConnectorDefinition`:

| Connector | Category | Read Operations | Write Operations (Require Approval) | Risk Level |
| :--- | :--- | :--- | :--- | :--- |
| **GitHub** | Developer | Search code, list issues, get PR | Create issue, create PR, dispatch workflow | HIGH |
| **Vercel** | DevOps | List deployments, get build logs | Redeploy, trigger rollback, promote | HIGH |
| **Supabase**| Database | Read schema, query tables (read-only)| Execute migration, mutate data | HIGH |
| **MCP v2** | Extensible | List tools, call read-only tool | Execute high-impact tool | DYNAMIC |
| **Gmail** | Communication | Search threads, get email, read draft | Send email, update labels | HIGH |
| **Calendar**| Productivity | List availability, view events | Create event, update event, delete event | MEDIUM |
| **Drive** | Storage | Search files, download content | Upload file, share file, delete file | MEDIUM |
| **Slack** | Communication | Search messages, read channel | Post message, reply in thread | MEDIUM |
