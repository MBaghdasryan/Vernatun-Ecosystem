# Vernatun Device Actions — implementation and acceptance status

## Scope

Production-capable commands were implemented against the existing authenticated
Cloud → Edge WebSocket path. No command was sent to the real Windows Agent during
this work. No production migration, credential rotation, re-registration, DNS or
production configuration change was performed.

## Implemented

- Shared capability registry with verified Barrier OPEN/CLOSE; unverified adapters
  remain disabled and fire/elevator safety controls remain hard denied.
- Server-authoritative availability:
  `GET /api/buildings/{buildingId}/devices/{deviceId}/actions`.
- Cloud capability configuration:
  `PUT /api/edge-console/devices/{deviceId}/capabilities`.
  Configuration cannot enable an unsupported or unverified adapter capability.
- Commands use the existing authenticated building/resident command APIs. Scope,
  actor and permissions come from the server, not the request body.
- Organization/building checks, resident unit-device access, independent command
  execution permission, device fault/state checks and live connectivity checks.
- Global platform administration alone does not permit physical execution.
  A separate administrator must explicitly grant `edge.commands.execute` on the
  platform assignment. Organization roles remain organization/building scoped.
- Stable client idempotency keys, database idempotency receipts and serialized
  per-device conflict checks. Reconnecting does not replay an access command.
- Thirty-second command lifetime; polling materializes expired commands as TIMEOUT.
- A stateful Barrier result without matching actual device-state feedback is
  ACKNOWLEDGED, not SUCCESS. Confirmed results update the displayed device state.
- Request/result audit records and capability-policy audit records.
- Shared Console/OS device controls, CLOSE confirmation, pending/terminal feedback
  and policy editing. Smoke sensors no longer display a Barrier access-grant form.
- Resident web screen recognizes DELIVERED/ACKNOWLEDGED, polls to a terminal
  result and uses server availability to disable unavailable actions.
- Armenian, Russian and English text for the new web controls.
- OpenAPI source and regenerated clients/schemas.
- DEGRADED is not forcibly changed to ONLINE. Existing diagnostics expose the
  specific health reasons; a connected WebSocket alone does not prove fresh
  inventory/telemetry or healthy local authorization.

## Verification performed

- `corepack pnpm run typecheck`: PASS for the workspace.
- `corepack pnpm --filter @workspace/api-server run test:edge`: PASS, four test
  suites/scenarios including an expanded isolated V1 command journey.
- Isolated command checks exercised real Cloud HTTP handlers and WSS transport
  with a software Agent: resident OPEN, staff CLOSE, matching state feedback,
  accepted-only ACKNOWLEDGED, duplicate submission, conflicting commands, family
  denial, global-admin default denial, hard safety denial, device offline,
  disabled capability policy and request/result audit.
- Migration 044 applied successfully in the isolated test schemas, then in the
  development database. Production was not migrated.
- API and Vernatun web production bundles built successfully.
- Root build was attempted. Without workflow environment it stopped on missing
  `PORT`; with `PORT`/`BASE_PATH`, it reached the mobile build, which stopped because
  Metro port 8082 is already occupied. The full workspace build is NOT confirmed.
- Signed-in device UI browser acceptance and native-app acceptance are NOT
  confirmed by these API/WSS tests.

## Production readiness

READY is reserved for accepted execution through the existing real Windows Agent,
not merely passing local tests.

| Deliverable | Acceptance status |
| --- | --- |
| DEVICE ACTION FRAMEWORK | NOT READY — real-site and signed-in UI acceptance pending |
| BARRIER.OPEN | NOT READY — existing Windows Agent has not received a new UI command in this work |
| BARRIER.CLOSE | NOT READY — same external acceptance requirement |
| STATE-AWARE UI | NOT READY — implemented, signed-in browser/state transition acceptance pending |
| CLOUD AUTHORIZATION | NOT READY for production acceptance; isolated role/scope checks pass |
| EDGE DISPATCH | NOT READY for production acceptance; isolated WSS dispatch passes |
| COMMAND RESULT | NOT READY for production acceptance; isolated ACK/state-confirmed SUCCESS pass |
| AUDIT | NOT READY for production acceptance; isolated request/result records pass |
| CONSOLE DEVICE ACTIONS | NOT READY for acceptance; implemented, explicit execution grant required |
| OS DEVICE ACTIONS | NOT READY for acceptance; implemented, organization scope enforced |
| HAYAT DEVICE ACTIONS | NOT READY — separate native-project integration remains |
| IMTUN DEVICE ACTIONS | NOT READY — resident web controls updated; native mobile controls remain |

## Remaining scope

1. Deploy the updated API and web app, review/apply migration 044, then perform
   operator-supervised OPEN/CLOSE through the existing Windows connection.
2. Verify the signed-in UI for platform, organization staff and resident roles,
   including policy editing, confirmation, keyboard interaction and failures.
3. Connect native ImTun controls to authenticated API sessions. HAYAT belongs in
   its separate project; carry the same effective-action API contract there.
4. Complete the optional future profile catalog and adapter-specific parameter
   editors (e.g. HVAC setpoint). These are not physically enabled by this patch.
5. Resolve the full-workspace mobile build's Metro-port conflict separately.

## Deployment and first real acceptance

After shipping the code to the API and frontend, run inside the API container:

```sh
cd /app || exit 1
NODE_ENV=production corepack pnpm --filter @workspace/api-server run db:migrate:coolify:plan
```

Check for zero drift and review the pending list. This patch adds
`044_device_action_policy.sql`; do not blindly apply unexpected migrations.
Use the normal production backup procedure before applying the approved plan:

```sh
VERNATUN_COOLIFY_MIGRATION_CONFIRM=APPLY NODE_ENV=production corepack pnpm --filter @workspace/api-server run db:migrate:coolify:apply
```

Restart the API and deploy the corresponding frontend. Do not issue a new
bootstrap token for the already connected Agent.

The existing real target is the user's TEST Edge deployment. A TEST name is not
evidence that a physical device is disconnected: the operator must confirm the
target and safe operating conditions before using the controls.

Exact UI path:

`https://vernatun.io/os/edge` → select the existing Edge Agent → **Devices** →
**Barrier-01** → **Open**.

For a platform account:

`https://vernatun.io/console/edge` → select the Agent → **Devices**. Controls remain
disabled without the explicit command-execution grant described above.

Acceptance must capture the command ID, Cloud lifecycle, Windows Agent/local
authorization result and actual state OPEN; then CLOSE confirmation and actual
state CLOSED. Verify one command for a duplicate click and no delayed execution
after an offline attempt. Do not post tokens, credentials or raw secrets.

