---
name: Private file policy
description: Why persistent storage must preserve the original Vernatun authorization and upload contract.
---

Keep private file upload and download operations behind Vernatun's existing
server authorization; moving bytes to App Storage is not an authentication
migration or permission redesign.

**Why:** The user requested durable storage without changing the cabinets or the
original organization, apartment and assigned-worker access rules. Uploads also
require server-side image sanitization; a generic direct-upload endpoint would
allow that validation to be bypassed.

**How to apply:** Treat the database's business scope as authoritative on each
download, rather than granting permanent access based on the uploader's identity.
Preserve existing metadata during byte transfer and require separate permission
before publishing.
