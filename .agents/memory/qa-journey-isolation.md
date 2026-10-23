---
name: QA journey isolation
description: Why aggregate regression journeys use separate fresh fixtures.
---

Compose aggregate regressions with fresh fixtures per journey rather than sharing
mutable seeded role assignments across independent suites.

**Why:** IAM regression deliberately revokes seeded assignments. A later request
journey cannot log in as that dispatcher; this is test contamination, not a reason
to weaken application authorization or silently restore a revoked production grant.

**How to apply:** Keep a single orchestrated run and consolidated report, but isolate
independent journeys in runner-owned random schemas in the test database. Within
each journey preserve the intended step order. Distinguish API regression evidence
from browser and production acceptance.
