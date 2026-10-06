---
name: HAYAT offline policy
description: Scope and safety decisions for local work and manual synchronization.
---

HAYAT offline work is limited to work already downloaded by the same user and
business context. Reconnecting never authorizes or starts background submission;
the user explicitly initiates synchronization with fresh server authorization.

**Why:** The requested reliability improvement must not sync after logout or
revocation, or change the restored accounts, core schema or business permissions.
Offline authorization cannot detect remote revocation until connectivity returns.

**How to apply:** Preserve locally queued bytes and report payloads on ambiguous
network errors. Retry immutable operations rather than regenerating keys. Do not
replace authorization errors with cached responses. An offline logout must also
block a still-live server cookie from silently restoring the cached identity.
Keep backend tests in an isolated database/storage namespace and browser write
tests in controlled fixtures unless an isolated live test service is configured.
