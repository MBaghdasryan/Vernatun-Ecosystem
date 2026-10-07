---
name: Floor readiness evidence
description: Explicit floor placement and conservative readiness labels.
---

Never infer an apartment's floor from its number. Show unassigned units separately
until an authorized user records their floor.

**Why:** Unit numbers do not reliably encode physical location; an inferred
association would make the readiness matrix look authoritative without evidence.

**How to apply:** Preserve explicit building/entrance/floor scope on mappings.
Unit-scoped managers may map their own unit to an existing floor, but may not
create shared floor topology.

Readiness is a derived display, not an automatic handover transition. Open defects
and pending inspections take precedence over an old ready/operational state.
No handover record means unknown; completed inspections without a confirmed
ready state mean awaiting confirmation.

**Why:** Lack of defect records is not evidence of completed inspection or formal
acceptance, and a previously ready unit may acquire new unresolved problems.

**How to apply:** Show both the underlying handover state and current evidence
counts; do not silently alter business workflow status while computing the matrix.
