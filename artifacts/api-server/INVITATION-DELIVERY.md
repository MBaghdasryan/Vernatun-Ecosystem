# Invitation delivery evidence

`sent` remains the legacy transport status. The scoped invitation API exposes
`delivery_outcome`: `accepted`, `unknown`, `local`, `failed`, `delivered`, `bounced`
or `complained`. Delivered means accepted by the recipient's mail server, not
read or guaranteed placement in the inbox. SMTP without a DSN adapter and the
development outbox cannot provide delivery evidence.

## Storage and ordering

Migration 014 is additive; migrations 001–013 are unchanged. Attempts, transport
receipts and normalized inbound evidence are append-only (including protection
against TRUNCATE). They contain neither plaintext invitation tokens nor URLs,
raw recipients, subjects or bounce diagnostic text. Existing invitation emails
remain in the permission-scoped invitation record.

Correlation uses provider, provider-account scope and message identifier, then
the invitation's current attempt and token hash. Early events are retained until
a receipt exists; late events from earlier attempts cannot change the current
outcome. Within an attempt, complained takes precedence over bounced, which
takes precedence over delivered, independently of arrival order. Webhooks never
change invitation validity, roles, expiry, acceptance or revocation.

If a process stops before persisting a transport receipt, the attempt remains
unknown instead of claiming delivery. Resend rotates the token, so a previously
sent link is invalidated. Correcting the email uses the same scoped resend action
and also rotates the token; accepted and revoked invitations cannot be revived.

## Live setup (requires separate approval)

No webhook is created by application startup, migrations or tests. No live mail
is sent by the test suite.

1. Read the integrations skill and verify the **existing** Resend connection,
   plus the verified sender used by `EMAIL_FROM`. Do not install another connector.
2. Read the deployment skill to retrieve the published URL. Obtain explicit
   approval for that URL's `/api/email-webhooks/resend` callback and live setup
   before creating a provider webhook or sending a real test message.
3. Select only `email.delivered`, `email.bounced`, `email.complained` on that
   callback. Do not enable open/click tracking.
4. Store `RESEND_WEBHOOK_SECRET` using the environment-secrets skill, never in
   chat, code, logs or a normal form. Without the secret the endpoint returns 503.
5. Set the non-secret `RESEND_WEBHOOK_SCOPE` to a stable account label (default:
   `primary`). It must identify the account/connection that sends the messages.
   When switching accounts, change this label AND the signing secret together.
   Do not reuse an old account label for a new account. Secret rotation within
   the same account keeps the scope unchanged.
6. Apply the additive migration through the approved deployment schema process;
   do not run the development migration command against production.

The endpoint verifies raw JSON bytes using Svix, including the five-minute
signature timestamp tolerance. Stored event IDs deduplicate signed retries.
Only this endpoint bypasses session CSRF; operator actions still require the
session, permission checks and CSRF token. Unknown/open/click/sent events are
ignored, without storing their payloads. Authenticated events from other mail
in the same provider account may be stored as normalized, uncorrelated evidence;
they are never exposed in the invitation list.

## Verification

`pnpm --filter @workspace/api-server run test:delivery` creates a random schema
in `vernatun_test`, migrates and seeds only that isolated schema, uses synthetic
Svix secrets and injected transports, and cleans up its own test resources.
It covers signatures, replay, out-of-order/early/old events, account and tenant
isolation, transport failures, SMTP without evidence, token rotation, correction,
revocation and immutable history.
