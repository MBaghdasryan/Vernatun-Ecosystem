# Vernatun Cloud Edge API Contract v1

This document defines the Cloud endpoints expected by `vernatun-cloud-edge-agent`.

## Topology

Every Edge initiates an outbound connection:

```text
Vernatun Edge #001 ----\
Vernatun Edge #002 -----+---- TLS/443 ----> api.vernatun.io
Vernatun Edge #003 ----/
```

Cloud must never need the public IP of the building Edge.

## Identity binding

One Edge identity is permanently bound to:

```text
edgeId + tenantId + buildingId
```

Cloud must reject any command or uplink whose identity does not match the authenticated Edge.

## 1. Register Edge

```http
POST /api/edge/v1/register
Authorization: Bearer <bootstrap-token>
X-Vernatun-Edge-Id: edge-building01
```

Request:

```json
{
  "edgeId": "edge-building01",
  "edgeName": "Vernatun Edge - Building 01",
  "tenantId": "uk_001",
  "buildingId": "building01",
  "siteCode": "building01",
  "agentVersion": "1.0.0",
  "platform": "Vernatun Edge",
  "connectionMode": "OUTBOUND",
  "transports": ["WEBSOCKET", "HTTPS"]
}
```

Recommended response:

```json
{
  "edgeId": "edge-building01",
  "status": "REGISTERED",
  "accessToken": "<issued-edge-token>",
  "expiresAt": "..."
}
```

Production target: replace long-lived bearer token with mTLS certificate enrollment.

## 2. Heartbeat

```http
POST /api/edge/v1/heartbeat
Authorization: Bearer <edge-token>
```

Cloud updates `ONLINE`, `lastSeenAt`, agent version and queue depth.

## 3. Persistent command channel

```text
WSS /api/edge/v1/connect?edgeId=edge-building01
```

Cloud sends:

```json
{
  "type": "COMMAND",
  "command": {
    "commandId": "cmd-123",
    "idempotencyKey": "cmd-123",
    "tenantId": "uk_001",
    "buildingId": "building01",
    "deviceId": "Barrier-01",
    "capability": "BARRIER.OPEN",
    "actor": {
      "userId": "resident-001",
      "role": "RESIDENT",
      "tenantIds": ["uk_001"],
      "buildingIds": ["building01"],
      "deviceIds": ["Barrier-01"]
    },
    "context": {
      "source": "IMTUN",
      "reason": "resident_access"
    }
  }
}
```

Edge validates tenant/building binding before calling the local Command Authorization Layer.

## 4. Command result

```http
POST /api/edge/v1/commands/{commandId}/result
```

## 5. Inventory

```http
POST /api/edge/v1/inventory
```

## 6. Telemetry / events / alarms

```http
POST /api/edge/v1/telemetry/batch
POST /api/edge/v1/events/batch
POST /api/edge/v1/alarms/batch
```

Edge uses an SQLite outbox when Cloud is offline.

## Required Cloud database model

At minimum:

```text
edge_nodes
- id
- edge_id UNIQUE
- tenant_id
- building_id
- site_code
- status
- registered_at
- last_seen_at
- agent_version
- credential_status

edge_bootstrap_tokens
- id
- tenant_id
- building_id
- token_hash
- expires_at
- used_at
- revoked_at

edge_command_dispatch
- command_id UNIQUE
- edge_id
- tenant_id
- building_id
- device_id
- capability
- actor_id
- actor_role
- status
- requested_at
- delivered_at
- completed_at
- result_json
```

## Security rules

1. Bootstrap token: single-use, short expiry.
2. Edge permanent credential: unique per Edge.
3. Edge can only claim its bound `tenantId/buildingId`.
4. Cloud commands must contain `commandId` and `idempotencyKey`.
5. Cloud never connects directly to ThingsBoard.
6. Cloud never receives the local ThingsBoard password.
7. Fire control and elevator safety control remain hard-denied.
8. Edge port 8091 and agent port 8092 are not public Internet APIs.
