---
name: Private file policy
description: Why persistent storage must preserve the original Vernatun authorization and upload contract.
---

Changing a storage provider is not permission to migrate or delete existing bytes.
Retain restored App Storage until an explicit switch is requested; do not run an
App Storage-specific cleanup or recovery tool against Local/S3 configuration.

**Why:** SQL references and object-store versions form a paired recovery contract.
Provider-specific conditional deletion guarantees are not interchangeable, and
silently switching after an error could hide or lose the user's existing files.

**How to apply:** Require explicit provider selection and separate transfer approval.
Refuse unsupported reviewed deletion instead of falling back to an unconditional
delete. Verify matched SQL/bytes and the owning namespace before maintenance.

Every new table that references private bytes must be registered across every
file-lifecycle catalog: cleanup references and locks, migration enumeration,
backup manifests, restore validation, and tests. These lists are independent, so
adding an authorized upload route alone can leave live bytes classified as orphaned
or omitted from a recovery set.

**Why:** Platform-task attachments use their own metadata table rather than the
existing document catalog; the first integrated check exposed a missing reference
and mismatched key type in separate lifecycle queries.

**How to apply:** Search all private-file reference queries whenever adding a
metadata table, include it in inventory and backup/restore, and preserve the
canonical key type when combining references.

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

Support-case document sharing is a separate, narrow business purpose, not a
blanket documents permission for platform staff. Sharing requires the author's
existing document access and explicit selection; a download requires the visible
case reference, current case authorization, and assignment for ordinary support.

**Why:** The master prompt requests case attachments, but the support role must
not thereby gain access to the customer's entire document catalog.

**How to apply:** Keep direct document downloads unchanged. When document
versioning is introduced, pin the exact shared version before allowing a parent
document to change: consent to one attachment is not consent to future replacement
content. Include case-shared versions in the live-reference cleanup inventory.

App Storage can emit a transient `MaxListenersExceededWarning` for a single
Google Storage HTTP response because nested SDK pipelines attach their own
error/close listeners. Do not suppress it by raising listener limits or changing
the storage provider. Verify the response reaches `destroyed`/`readableEnded` and
that repeated PDF generation does not create additional open streams.

**Why:** Isolated phase-six tracing showed the warning on a node-fetch response
passing through three SDK pipelines; the response closed shortly after the API
operation completed. The phase-six test worker had no open PassThrough streams
at exit. Separate instrumentation also saw other node-fetch streams in the
`tsx --test` parent process; their origin was not attributed to protocol generation.

**How to apply:** Attribute warnings by tracing stream origin and lifecycle.
`protocolPdf` returns a Buffer and does not own the App Storage transport stream;
check the test worker and parent runner separately before claiming all processes
are leak-free. Change or upgrade the transport dependency only after a repeatable
leak is attributed to that dependency.
