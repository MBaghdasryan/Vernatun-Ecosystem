# Vernatun Cloud Edge API Contract v2

## Scope and compatibility

V2 gives each Edge node one block scope. A block belongs to one organization and contains one or more buildings. The same organization can have multiple blocks; multiple nodes can be registered for a block. Each v2 node receives an explicit list of permitted building UUIDs at bootstrap.

V1 endpoints remain unchanged for existing building-bound nodes. V2 must not infer or inherit the v1 `buildingId`.

## Authentication and transport

The Agent opens outbound HTTPS/WSS connections only. Machine requests use:

```text
Authorization: Bearer <single-use bootstrap token during register; issued credential afterwards>
X-Vernatun-Edge-Id: <edgeId>
X-Vernatun-Tenant-Id: <organization UUID>
X-Vernatun-Block-Id: <block UUID>
Content-Type: application/json
```

The Cloud stores SHA-256 hashes of bootstrap and machine credentials, never plaintext credentials. A bootstrap token is bound to an exact edge ID, organization, block, node name, site code, and expiry; it can be used once.

## Registration

`POST /api/edge/v2/register`

```json
{
  "protocolVersion": 2,
  "edgeId": "edge-nor-yerevan-a",
  "tenantId": "organization-uuid",
  "blockId": "block-uuid",
  "siteCode": "nor-yerevan-a",
  "edgeName": "Nor Yerevan block A",
  "agentVersion": "2.0.0",
  "platform": "Vernatun Edge",
  "capabilities": {"inventorySync": true}
}
```

Successful response includes the one-time `accessToken` and `buildingIds` copied from the Cloud block membership. The Agent must persist the returned building IDs and must not accept a local building outside this list.

## Authenticated API

All authenticated payloads identify protocol version 2, edge ID, tenant ID, and block ID. Cloud checks both headers and body. Inventory and every telemetry, event, and alarm item identify their own `buildingId`; Cloud checks that the building is explicitly assigned to the node and the block.

```text
POST /api/edge/v2/heartbeat
GET  /api/edge/v2/config?edgeId=<edgeId>
POST /api/edge/v2/inventory
POST /api/edge/v2/telemetry/batch
POST /api/edge/v2/events/batch
POST /api/edge/v2/alarms/batch
POST /api/edge/v2/commands/{commandId}/result
WSS  /api/edge/v2/connect?edgeId=<edgeId>
```

Example inventory:

```json
{
  "protocolVersion": 2,
  "edgeId": "edge-nor-yerevan-a",
  "tenantId": "organization-uuid",
  "blockId": "block-uuid",
  "devices": [{
    "buildingId": "building-uuid",
    "deviceId": "tb-device-name",
    "thingsboardId": "thingsboard-device-uuid",
    "name": "Device label",
    "profile": "Vernatun Meter",
    "active": true
  }]
}
```

For commands, the Cloud message carries `blockId` and the exact `buildingId`. The Agent checks the block, permitted building, and its local explicit device-to-building mapping before passing any command to the local authorization layer. A missing or conflicting mapping fails closed.

## Management API

```text
GET  /api/edge-console/blocks
POST /api/edge-console/blocks
POST /api/edge-console/blocks/{blockId}/bootstrap-tokens
```

Creating a block requires organization-scoped provisioning permission, a unique organization block code, and at least one building from the same organization. A building can belong to at most one Edge block. Bootstrap tokens are returned once and are never included in subsequent list responses.

## Required safety properties

- Block and organization membership is enforced by database foreign keys as well as request validation.
- Inventory, commands, events, and alarms retain an explicit building ID, even when the node serves multiple buildings.
- Nodes can only access buildings explicitly assigned to their block.
- V1 nodes remain single-building scoped.
- Tests use isolated PostgreSQL data and do not invoke real device commands or network calls to ThingsBoard.
