---
name: Zero-count filter options
description: Preserve status filters initialized from a dashboard KPI or URL when the filtered queue is empty.
---

For data-driven queues, keep an explicitly selected or URL-provided status in the filter options even when the current response contains no rows for that status.

**Why:** HAYAT's status summaries can omit zero-count states; deriving options only from returned counts made a `review` drill-down show an unfiltered choice despite the server request being filtered.

**How to apply:** When a dashboard card or deep link initializes a queue filter, union the active value with available status options. Keep server authorization and result scoping authoritative; this rule only preserves the visible filter state.
