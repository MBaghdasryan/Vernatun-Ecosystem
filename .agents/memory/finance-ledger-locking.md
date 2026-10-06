---
name: Append-only financial ledger concurrency
description: Why money balances must be read after obtaining parent-row locks, and how account credit is scoped.
---

Acquire the payment/invoice row lock first, then calculate allocation and adjustment totals in a separate SQL command within the same transaction.

**Why:** In PostgreSQL READ COMMITTED, a SELECT with aggregate subqueries and FOR UPDATE can calculate a balance before waiting on the row lock. An append-only allocation does not update the immutable parent row, so waiting does not reliably refresh that aggregate. Two concurrent allocations against different invoices can therefore both see old available credit.

**How to apply:** Every new financial writer must lock its immutable parent and then re-read ledger totals. Keep database-side bounds as a second defense. Concurrency tests must include different target invoices, not only two allocations to the same invoice; an invoice balance check can otherwise hide the payment-credit race.

Account credit is presently bound to one unit, actual payer and currency, not an organization-wide pool.

**Why:** This preserves the household account boundary and prevents an accountant from silently moving one resident's overpayment to another unit. Historical financial parties remain eligible for settlement even after their login access ends.

**How to apply:** Reuse the binding for further allocations. Cross-unit netting, transfers and refunds require an explicit business decision rather than removing authorization checks or editing historical payments.
