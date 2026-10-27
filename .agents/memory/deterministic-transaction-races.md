---
name: Deterministic transaction races
description: Force a known transaction order in concurrency tests instead of relying on simultaneous request timing.
---

When a race test needs to prove that one transaction commits before a competing operation proceeds, hold the shared row lock in a test transaction, queue the intended winner first, confirm both transactions are waiting, then release the lock and verify persisted state and side effects. `Promise.all` alone tests an unspecified winner and cannot establish which operation observed the other one's committed state.

**Why:** A concurrency test should prove the transaction boundary, not pass or fail based on incidental scheduling.

**How to apply:** Use this for parent/child lifecycle races where the allowed outcome depends on whether the parent mutation or child creation acquires the lock first.
