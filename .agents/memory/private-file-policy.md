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

Cleanup must never remove bytes with live references or change application
metadata to make objects eligible for deletion. Use a reviewed inventory and a
conservative waiting period, not automatic deletion on upload errors.

**Why:** The user explicitly required safe cleanup after interrupted uploads.
An object write and a PostgreSQL commit are not atomic; a failed commit response
does not prove the metadata was never committed.

**How to apply:** Future upload, restore and maintenance paths must coordinate
with cleanup, and must not treat an exception as permission to delete bytes.
Run cleanup only against the database that owns the selected storage prefix.
