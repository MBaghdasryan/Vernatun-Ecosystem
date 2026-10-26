---
name: Recovery password policy
description: Security expectations for temporary passwords issued by account recovery.
---

A CLI-issued recovery password creates a restricted first-login session. Keep the account's existing MFA configuration intact and require the user to authenticate with MFA when it is enabled. Do not allow ordinary API access until the temporary password has been replaced. Revoke prior sessions with tombstones before deleting them so late session saves cannot restore access. Never write temporary or replacement passwords to logs or audit records.

**Why:** Recovery credentials are intentionally short-lived access for account restoration, not a substitute for MFA or a normal authenticated session.

**How to apply:** Preserve these guarantees when changing recovery scripts, password-change routes, session invalidation, or first-login UI.

CLI-provisioned temporary global-account passwords must set `must_change_password=true` at creation and remain blocked from ordinary API access until replaced. The read-only verifier should require a post-provision password-change audit event, not infer rotation from a missing flag.

**Why:** The users table defaults `must_change_password` to false, so a provisioning CLI that inserts only a password hash otherwise grants the generated temporary password normal access before rotation.

**How to apply:** Preserve this rule in one-time provisioning and access-verification scripts. Existing accounts created before the rule need explicit password rotation; never recreate them or expose their private credential file to verify them.
