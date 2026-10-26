---
name: Payer responsibility notifications
description: Authorization and routing rules for resident payer-responsibility notices.
---

Payer-responsibility notices are finance-category events, but a valid recipient may be a renter or family member without `billing.own`. Resolve access from the live role, exact unit, and active payer delegation; do not require invoice-reading permission or include bill details in the notice. Route authorized recipients to ImTun preferences, where the Payer surface is mounted.

**Why:** Payer consent changes responsibility for future charges, not access to invoices or control of payment accounts. Requiring broad finance permission blocks eligible residents; exposing charge data would exceed the consent flow.

**How to apply:** For recipient notices, require current renter/family membership and delegation eligibility in the exact unit. For owner notices, require the current owner assignment recorded on the delegation. Continue using canonical notification emission, preferences, quiet hours, and dedupe.
