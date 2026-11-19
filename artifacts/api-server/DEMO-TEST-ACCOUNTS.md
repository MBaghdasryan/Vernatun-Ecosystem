# Production demo accounts for ImTun and HAYAT

This is a one-time, explicit Coolify provisioning command. It creates a separate
`is_demo` organization, synthetic building/unit, an ImTun `unit_owner`, and a
HAYAT `contractor`. It does not modify any existing account, organization, or
production resident record.

The demo organization has the normal product modules enabled for testing, but
`smart_building` is explicitly disabled. It creates no Edge connection, camera,
barrier, payment provider, payment, email, invitation, or push registration.
Account email notifications are disabled; in-app notifications remain enabled.
The demo login passwords are entered in a hidden prompt and are never printed.
Choose different passwords of at least 12 characters; do not reuse a personal
password.

## Provision from Coolify

Deploy the API package containing this script first. In the production API
container shell, run:

```sh
cd /app/artifacts/api-server || exit 1
NODE_ENV=production node archive/vernatun/server/scripts/provision-demo-testers.mjs --confirm-production-demo-testers
```

The script refuses to run without the confirmation flag, a production
`DATABASE_URL` whose database name is exactly `vernatun`, and an interactive
terminal for the hidden password prompts. It checks for existing reserved
emails/organization names and stops without modifying anything if they exist.
The transaction either creates all demo rows or none.

Provide the two entered passwords to testers through a private channel. Do not
put them on `/apps`, in source control, or in screenshots. Accounts share a
demo tenant, so actions such as requests and contractor work updates are visible
to testers using that tenant.

## Manual sign-in check

- ImTun: `bnakich@vernatun.io` — select Owner / Собственник; the server-issued
  role is `unit_owner`.
- HAYAT: `partner@vernatun.io` — HAYAT contractor workspace; role is
  `contractor` (the HAYAT partner workflow supported by the current mobile app).

Both apps use the Vernatun API session and server-resolved role/scope. The
synthetic request, invoice, announcement, and assigned defect are labeled
`DEMO`; none is a real appointment, payment, home, or service visit.
