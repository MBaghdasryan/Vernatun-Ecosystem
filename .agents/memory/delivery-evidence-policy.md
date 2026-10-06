---
name: Delivery evidence policy
description: Evidence semantics and Svix verification compatibility for provider-neutral invitation delivery.
---

Treat provider acceptance and invitation validity as separate from delivery
evidence. Confirmed delivery means recipient-server acceptance, not reading or
inbox placement. Do not add opens/clicks tracking.

**Why:** The user requested confirmed delivered/bounced/complained outcomes
without changing roles or reviving invitations, and explicitly excluded tracking.

**How to apply:** New evidence adapters must preserve these semantics. Keep
provider-account scopes stable within an account and distinct when accounts
change; the signing secret and account scope must change together on account
replacement.

Receipt persistence failure after provider acceptance is not failed transport.
Keep it unconfirmed; observability failure must not invalidate an already mailed
reset or trigger an automatic resend.

**Why:** Delivery and database writes have separate failure boundaries. Treating
an accepted message as failed can invalidate a usable reset or send duplicates.

**How to apply:** Separate pre-acceptance transport errors from post-acceptance
recording errors in the common email layer, independently of the provider.

Do not assume Svix signature verification returns parsed JSON.

**Why:** Svix 2 verifies successfully but returns void, unlike the return value
shown in Resend's published verification examples. Treating that result as a
payload rejects valid signed events.

**How to apply:** Authenticate the original bytes first; parse the same bytes
after verification succeeds. Never parse/re-serialize before checking signatures.
