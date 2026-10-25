# Existing Windows Edge: Cloud connection correction

## Preserve the existing registration

The operator reports successful production registration (`REGISTERED`, HTTP 201)
for `edge-building01`, bound to:

- Organization: `9e8e581c-d8cf-4bb4-9548-d6e1e961e090`
- Building: `a6e398fc-2f1d-4724-9db4-11e7874683c7`
- Site code: `building01`
- API: `https://api.vernatun.io`

This is operator-provided evidence, not a production check performed from this
workspace. Do not provision this organization again, reinstall the Agent, clear
its SQLite state/Docker volume, revoke its machine credential, or generate a new
bootstrap token to apply this correction.

## Confirmed code-level causes and correction

1. The deployed `src/index.ts` entrypoint started an Express HTTP server without
   attaching the Edge upgrade listener. The legacy entrypoint and tests did
   attach it. Production and integration tests now use the same `createApiServer`
   assembly: machine-authenticated upgrades attach to the real listening server.
2. Edge heartbeat/inventory used Zod datetime validation restricted to trailing
   `Z`. The shared Edge validator now accepts RFC3339 offsets and fractional
   seconds, including Python's microseconds, and normalizes to UTC milliseconds.
   Receipt/freshness timestamps remain server-owned.
3. Upgrade authentication resolves the Bearer machine credential in the database
   and verifies Edge/tenant/building (or v2 block) headers against that binding.
   Identity query parameters are optional but must match when supplied.
   Human session cookies are not used for Edge authentication.
4. Batch source timestamps and HTTP/WebSocket command-result timestamps share the
   same validation. Optional numeric `ts` retains its legacy behavior.

Safe log codes contain node IDs, not credentials, headers, or payload bodies:
`edge_authenticated`, `edge_websocket_upgraded`, `edge_connected`,
`edge_websocket_rejected`, `edge_heartbeat_accepted`,
`edge_inventory_accepted`.

## Deployment

Workspace verification:

- Full workspace TypeScript check: PASS.
- API production build: PASS.
- Edge integration suite: 4/4 PASS, using the production server assembly.
- Cases include credential-only machine upgrades, session-only/missing/random
  credential rejection, header/query binding mismatches, RFC3339 formats, batch
  timestamp validation, v1/v2 isolation, one-time bootstrap and hash-only storage.
- Full default API regression was attempted: 90 completed cases passed, no failed
  cases reported, but the command hit its 300-second limit. The aggregate suite
  is therefore **NOT fully confirmed**; do not call it a complete PASS.
- Restarted local API and web workflows. Local unauthenticated WebSocket
  handshake: HTTP 401, as required.
- Public production health: HTTP 200 (`status: ok`, `stage: 1`). This proves only
  health availability, not that this patch has been deployed or Edge connectivity.
- No production database changes, provisioning, registration, credential issuance,
  device commands, or real Windows execution were performed from this workspace.

Push the code and rebuild/redeploy the **API service** in Coolify. No schema
migration, DNS change, frontend rebuild, Agent modification, or credential rotation
is required for this correction. The existing Agent should reconnect automatically
with the credential issued at registration.

If it does not retry after deployment, restart only its existing container:

```powershell
docker restart vernatun-cloud-edge-agent
```

Do not run `install.ps1` again.

## Production verification: still required

Run in PowerShell on the existing Windows host after deploying the API:

```powershell
$h = Invoke-RestMethod 'http://localhost:8092/health'
[pscustomobject]@{
    Registration     = $h.cloud.registrationState
    RegistrationHTTP = $h.cloud.registrationHttp
    WebSocket        = $h.cloud.websocketState
    HeartbeatAt      = $h.sync.lastHeartbeatAt
    HeartbeatStatus  = $h.sync.lastHeartbeatStatus
    InventoryAt      = $h.sync.lastInventoryAt
    InventoryStatus  = $h.sync.lastInventoryStatus
    QueueDepth       = $h.local.queueDepth
} | Format-List
```

Take a second snapshot after at least one configured heartbeat interval. An old
registration HTTP result may remain recorded locally; do not expect a new 201 on
every reconnect. Inventory need not advance on every heartbeat.

Acceptance requires:

- Windows: `REGISTERED`, `CONNECTED`, successful advancing heartbeat and inventory.
- API logs: authenticated upgrade, connected, heartbeat and inventory accepted.
- Cloud UI for the exact node: REGISTERED / CONNECTED, fresh heartbeat, ONLINE
  only when its actual status supports that state.
- Inventory matches the operator-reported three existing devices:
  `Barrier-01`, `Smoke-Sensor-01`, `Smoke-Sensor-02`; verify their tenant/building.
- A previously queued valid telemetry item is accepted and its queue drains;
  do not manufacture telemetry or a device command solely to obtain that result.

This differs from the original simulator-only lab fixture containing one virtual
Barrier-01. Do not erase inventory to match that older fixture or count a
three-device real installation as proof of simulator isolation.

**No BARRIER.OPEN/CLOSE command is part of this connection verification.**
The separate resident-to-simulator dry-run remains blocked until the actual
Agent command destination is verified as the isolated simulator, with no
physical relay/lock/service reachable. A TEST organization name is not proof.

Do not share `.env`, full Agent configuration, bootstrap/access tokens, session
cookies, or unfiltered logs. Share only the selected health fields and sanitized
Cloud log codes above.
