---
name: Edge integration contract
description: User requirements for connecting existing Edge servers to Vernatun Cloud.
---

The supplied already-working Vernatun Edge Agent is the authoritative client-side
implementation. Adapt Vernatun Cloud to its contract, not vice versa, unless a
verified incompatibility requires a versioned contract change.

Each ЖКХ or УК must be able to attach its own Edge server through the API.

**Why:** The user explicitly required this integration direction and organization-specific Edge attachment.

**How to apply:** Preserve the working agent protocol, verify incompatibilities
before proposing changes, and keep each organization's Edge attachment separate.
