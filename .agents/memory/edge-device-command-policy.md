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

Resident UI may show complete but inactive shells for provider-dependent
features. Payment, push, and AI providers are configured administratively;
BLE, intercom, camera, and device controls are configured through Vernatun Edge.
Show intended controls and empty viewer/call surfaces, but keep them disabled
until the administrator enables the provider and Cloud confirms the relevant
Edge adapter and user scope.

**Why:** The user wants residents to see where these features will live before
the integrations are connected, without implying that unverified hardware or
external providers already work.

**How to apply:** Keep the UI navigation and inactive states available; never
call providers or Edge directly from ImTun, and do not enable physical actions
until server-side policy and adapter verification authorize them.
