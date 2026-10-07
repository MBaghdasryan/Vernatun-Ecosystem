---
name: Operations safety boundaries
description: Durable constraints for session revocation, log retention and future encrypted backups.
---

Session revocation must remain effective even if an in-flight request saves its
old session after the administrative action. Do not assume deleting the session
row is sufficient or discard revocation evidence just because that row is absent.

**Why:** The session store can insert a previously loaded session again during
response completion; a regression test reproduces this resurrection.

**How to apply:** Preserve the revocation check when changing authentication,
store adapters or cleanup. Any cleanup policy needs a proven maximum lifetime of
late requests and restored session cookies.

Operations encryption must use a key with a lifecycle independent of session
signing, and ciphertext must be bound to its domain and record identity.

**Why:** Rotating a session-signing key must not make backups unrecoverable.
Authenticated ciphertext must not be transferable to another tenant or record.

**How to apply:** Future backup/vault consumers require an independently managed
key and recovery plan; never embed it in backups or substitute SESSION_SECRET.
