---
name: Browser QA origin
description: Local authenticated browser tests must align the UI origin with the API test origin for CSRF validation.
---

When an authenticated browser test uses the local Vite proxy, configure the API test process `APP_ORIGIN` to the exact browser-visible origin. Otherwise POST requests with an `Origin` header fail CSRF checks even when the UI and API share the same test server.

**Why:** API clients in existing tests do not send browser `Origin` headers, so this mismatch only appears in real browser flows.

**How to apply:** Keep the API test origin and Vite port in sync, and scope the override to the QA runner rather than development or production processes.
