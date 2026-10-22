---
name: Search dialog keyboard behavior
description: Native search-input defaults can consume Escape before a modal closes.
---

Verify keyboard dismissal with a populated search field, not only an empty dialog or its close button.

**Why:** In browser acceptance, Escape cleared a native search input but left the Console/IAM dialog open. A working close button did not establish accessible keyboard dismissal.

**How to apply:** Compound search dialogs need an explicit Escape/close/focus-return contract that is checked in a real browser with non-empty input. Do not rely exclusively on the native dialog cancel event.
