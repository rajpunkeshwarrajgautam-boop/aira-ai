# AIRA AI — External Blockers Register

This document tracks capabilities blocked strictly by genuine external third-party boundaries (OAuth provider client credentials, signing certificates, or external paid resources).

A blocker in one workstream does NOT stop independent workstreams.

| Gate | Capability | External Dependency | Status | Mitigation / Fallback |
| :--- | :--- | :--- | :--- | :--- |
| **42** | Cashfree Subscriptions | User authorization for billing | **DEFERRED** | Preserved existing stub/routes without live billing |
| **76** | Gmail Agent | Google OAuth Client ID & Secret with Gmail scopes | **PENDING_CREDENTIALS** | Mock OAuth & contract tests in CI |
| **77** | Calendar Agent | Google Calendar OAuth scopes | **PENDING_CREDENTIALS** | Scoped adapter tests with fixture events |
| **78** | Slack / Teams Agent | Slack App Bot/User Tokens | **PENDING_CREDENTIALS** | Webhook & event contract tests |
| **80** | Business File Connectors | Microsoft Graph / Google Drive app registration | **PENDING_CREDENTIALS** | Local virtual filesystem bridge in test |
| **99/100** | Desktop Windows Signing | Authenticode Windows Code Signing Certificate | **PENDING_CREDENTIALS** | Unsigned test packages buildable in CI |
| **113** | Enterprise Identity (SAML) | Enterprise Identity Provider (Okta/Azure AD) | **PENDING_CREDENTIALS** | Standard OIDC/SAML mock IdP in test |
