---
name: Unit plan version policy
description: Why defect coordinates cannot follow replacement images automatically.
---

Replacement unit-plan images start without markers. Preserve the previous image
and its coordinates rather than copying them to the replacement or deleting bytes.

**Why:** Coordinates are meaningful only for the exact image they were placed on;
a new crop, rotation or drawing can silently move a defect to the wrong room.

**How to apply:** Bind coordinates to an immutable plan version; require an
explicit new placement after replacement. Plans use narrowly scoped handover
authorization, not a blanket grant to the document catalog. Keep preserved
document versions visible to storage inventory and backup.
