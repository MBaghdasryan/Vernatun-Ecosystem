---
name: Edge integration contract
description: User requirements for connecting existing Edge servers to Vernatun Cloud.
---

The supplied already-working Vernatun Edge Agent is authoritative for protocol v1.
Preserve v1 compatibility; add a separate, explicitly versioned v2 contract where
the deployment model needs block scope rather than silently changing the client.

One УК/ТСЖ can serve several buildings through one Edge node per block; an
organization can have multiple blocks, and a block can include multiple buildings.
Each v2 node is assigned to one block and receives its explicit allowed-building
list. Devices need an explicit device-to-building mapping; never infer a building.

**Why:** The user specified a multi-building, block-based topology (for example,
four blocks with six buildings each) and chose versioned Cloud/Agent v2 to support
it without breaking the working v1 agent.

**How to apply:** Keep organization, block, node, building, and device scope
consistent in the database, API, sockets, and local Agent. Reject out-of-block
records and commands; do not claim production readiness until the migration and
real-site validation are completed.

Edge management is mounted under the shared `/api` path before public auth
endpoints. Do not put router-wide authentication middleware on that mount;
authenticate each Edge handler through its own context/permission checks.

**Why:** Router-wide auth intercepted anonymous `/auth/session` and `/auth/login`
requests before they reached the auth router.

**How to apply:** When mounting feature routers on `/api`, check their middleware
scope against unauthenticated session bootstrap and login routes.
