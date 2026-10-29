---
name: Accessible native dialogs
description: Native dialog naming and how to validate modal flows through accessible browser locators.
---

Every native `<dialog>` should expose its visible heading as its accessible name with `aria-labelledby`; a heading inside the dialog is not associated automatically.

**Why:** Browser acceptance could not locate the organization creation dialog by its visible title, revealing that assistive technology and role/name-based tests lacked a dialog name.

**How to apply:** When using native dialogs, assign a stable heading ID and reference it from `aria-labelledby`. Prefer browser locators by dialog role and accessible name over CSS-only modal selectors.
