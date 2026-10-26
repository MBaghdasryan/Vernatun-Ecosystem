---
name: Recovery password policy
description: Security expectations for temporary passwords issued by account recovery.
---

A CLI-issued recovery password creates a restricted first-login session. Keep the account's existing MFA configuration intact and require the user to authenticate with MFA when it is enabled. Do not allow ordinary API access until the temporary password has been replaced. Revoke prior sessions with tombstones before deleting them so late session saves cannot restore access. Never write temporary or replacement passwords to logs or audit records.

**Why:** Recovery credentials are intentionally short-lived access for account restoration, not a substitute for MFA or a normal authenticated session.

**How to apply:** Preserve these guarantees when changing recovery scripts, password-change routes, session invalidation, or first-login UI.
