---
name: Accessible table overflow
description: Diagnosing mobile overflow caused by absolutely positioned accessibility labels.
---

When a responsive table still causes page-level overflow despite correctly sized
grid tracks, inspect absolutely positioned screen-reader-only labels.

**Why:** A hidden one-pixel label used a containing block outside the table
scroller. The visible layout fit, but the document remained more than twice the
mobile viewport width. Grid constraints alone did not fix it.

**How to apply:** Check overflowing element bounds and their offset parent.
Keep the hidden label's positioning context within the overflow container; do
not hide page overflow or remove accessible labels to mask the issue.
