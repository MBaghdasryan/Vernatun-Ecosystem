---
name: Billing calculation date arithmetic
description: Avoid date representation and fractional BigInt errors in billing formulas
---

Billing calculations compare periods as `YYYY-MM-DD` strings, so dates read from PostgreSQL must be explicitly cast to text first. Keep proration numerators, divisors, and rounding adjustments in integer arithmetic; odd month lengths cannot be converted to BigInt from a fractional half-day value.

**Why:** Integration coverage exposed incorrect resident counts when PostgreSQL dates were JavaScript `Date` objects and a runtime failure when a 29- or 31-day month produced a fractional divisor adjustment.

**How to apply:** When adding period-based formulas, normalize database date fields before comparisons and use fixed-point integers for proration. Cover both odd/even month lengths and assert the preview and persisted invoice explanation.
