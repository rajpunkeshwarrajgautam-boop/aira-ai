# AIRA AI — External Blockers Register

This document tracks capabilities blocked strictly by genuine external third-party boundaries (OAuth provider client credentials, signing certificates, or external paid service authorization).

All underlying code contracts, security invariants, error handling, and test harnesses for these gates are fully built and verified in the repository.

| Gate | Capability | External Dependency | Status | Mitigation / Verification Implemented |
| :--- | :--- | :--- | :--- | :--- |
| **42** | Cashfree Subscriptions | User authorization for payment mutation | **DEFERRED** | Preserved existing stub/routes without live billing mutation |
| **69** | Image Generation / Editing | Midjourney / DALL-E / Flux API Key | **EXTERNAL_BLOCKED** | Tested artifact engine SVG/raster format validation & fallback |
| **70** | Video Workflow | Runway Gen-3 / Sora API Key | **EXTERNAL_BLOCKED** | Multimodal router contract & deliverable metadata validator verified |
| **72** | Real-time Multimodal | Live WebRTC Streaming Key | **EXTERNAL_BLOCKED** | Multimodal capability schema & routing fallbacks verified |
| **76** | Gmail Agent | Google OAuth Client ID & Secret | **EXTERNAL_BLOCKED** | Tool gateway contract & adversarial security test suite passing |
| **77** | Calendar Agent | Google Calendar OAuth scopes | **EXTERNAL_BLOCKED** | Scoped adapter tests with fixture events & approval gates verified |
| **78** | Slack / Teams Agent | Slack App Bot/User Tokens & Signing Secret | **EXTERNAL_BLOCKED** | HMAC-SHA256 signature verification & replay resistance passing |
| **80** | Business File Connectors | Microsoft Graph / Dropbox Client ID & Secret | **EXTERNAL_BLOCKED** | Unified connector directory & boundary test suite passing |
| **81** | Notion / Jira | Jira OAuth / Notion Integration Token | **EXTERNAL_BLOCKED** | Connector directory manifest & fail-closed security contract passing |
| **82** | CRM (HubSpot/Salesforce) | HubSpot / Salesforce OAuth App Credentials | **EXTERNAL_BLOCKED** | B2B sales pack & CRM ingestion contracts passing |
| **85** | Ad Platform Connectors | Meta Ads / Google Ads Developer Token | **EXTERNAL_BLOCKED** | Marketing OS pack & spend limit guardrails passing |
| **88** | Social Publishing | X / LinkedIn Developer API Keys | **EXTERNAL_BLOCKED** | Content studio pack & editorial review approval fences passing |
| **89** | Ecommerce (Shopify/Stripe)| Shopify Admin Token / Stripe Secret Key | **EXTERNAL_BLOCKED** | Financial modeler & payment analytics pack passing |
| **100** | Desktop Windows Signing | Authenticode Windows Code Signing Certificate | **EXTERNAL_BLOCKED** | Desktop agent package, IPC security, and policy tests passing |
| **113** | Enterprise Identity (SAML)| Enterprise Identity Provider (Okta / Azure AD) | **EXTERNAL_BLOCKED** | Standard OIDC/SAML mock IdP & multi-tenant org hierarchy passing |
