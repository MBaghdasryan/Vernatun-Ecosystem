---
name: Operations error lifecycle
description: Meaning of resolved error groups and constraints for future log retention.
---

An operational error marked resolved is an acknowledgement of the events already
seen, not proof that a code fix was deployed. A fresh occurrence must reopen it.

**Why:** Administrators can resolve a group while another request is still failing;
blind status overwrites would hide the new failure. Concurrent event insertion
can commit in a different order from sequence allocation.

**How to apply:** Preserve stale-update guards and recurrence detection when
changing grouping or retention. In particular, pruning events changes aggregate
counts: review resolution watermarks together with any future retention policy.
Do not equate “resolved” with a repaired business record or a successful deployment.
