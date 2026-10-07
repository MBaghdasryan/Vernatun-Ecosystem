---
name: Transaction connection budget
description: Prevent authorization and polling from exhausting the same PostgreSQL connection pool as business transactions.
---

Do not reserve a transaction connection and then require another connection from
the same pool for authorization or context queries.

**Why:** When concurrent requests fill the pool, every transaction can wait for
a second connection that none can release. This is an application-side wait,
not necessarily a PostgreSQL lock deadlock. Additional polling can expose it
even when single-user functional tests pass.

**How to apply:** Either reuse the transaction's client throughout authorization,
or authorize before acquiring it and recheck mutable parent ownership/scope under
the transaction lock before writing or replaying an idempotency receipt. Preserve
all permission, module, subscription, MFA and tenant checks. Exercise concurrency
above the configured pool size, not just two requests to one resource.
