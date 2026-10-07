---
name: Binary upload QA guards
description: Safely intercept file uploads without blocking the browser test itself.
---

For a no-write browser test of a binary upload, count the intercepted request immediately and fulfill its synthetic response before awaiting request-body/header capture. Capture bytes afterwards.

**Why:** An initial guarded upload appeared stuck on Saving with no counted business request. A fresh context and response-first guard verified the 503/frozen-intent path and an explicit retry with identical URL and binary bytes; the earlier result did not establish an application upload defect.

**How to apply:** Keep all business mutations blocked in the restored development app. If a binary test stalls, distinguish worker loss and interception-body waits from application errors before changing production behavior. Use byte equality when the testing runtime lacks hashing APIs.
