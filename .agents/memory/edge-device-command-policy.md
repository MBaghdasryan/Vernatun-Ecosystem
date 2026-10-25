---
name: Edge physical command policy
description: Distinguish global administration, verified adapter support and real state confirmation from physical command authority.
---

Global platform administration is not implicit physical-device execution
authority. Keep execution as an explicit individual assignment grant; ordinary
organization roles still require their real organization/building scope.

**Why:** The user's production Device Actions specification explicitly separates
platform configuration/diagnostics from authority to operate physical devices.

**How to apply:** Preserve the distinction in IAM effective permissions, server
availability, dispatch and UI. Do not reintroduce automatic physical execution
through a broad administrative wildcard or a role-profile default.

For a stateful adapter, an accepted RPC is not confirmed movement.

**Why:** The user requires actual OPEN/CLOSED feedback before calling a Barrier
command successful and requires real Windows acceptance before production READY.

**How to apply:** Keep ACKNOWLEDGED distinct from SUCCESS, preserve command
expiry/no-replay behavior and report local software-Agent evidence separately
from operator-supervised real-site evidence. Preserve the working v1 Agent;
its older inventory can omit a capability list, but compatibility fallback is
limited to the specifically verified Barrier adapter, not arbitrary profiles.
