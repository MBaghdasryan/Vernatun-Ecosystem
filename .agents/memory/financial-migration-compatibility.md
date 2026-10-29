---
name: Legacy finance migration compatibility
description: Keep older finance write paths compatible with additive billing schema changes.
---

When an additive finance migration adds required fields, update every existing write path to supply safe, derived values while preserving its prior API behavior. New configuration routes are not the only callers of tariff and invoice writes.

**Why:** Older finance APIs can remain in use after a migration; leaving their inserts behind the new schema causes runtime failures even when the new flow works.

**How to apply:** Before shipping a billing migration, search for all inserts and updates touching changed tables, then test both legacy and new API flows against the complete migration chain.
