---
name: Browser QA transport
description: Binary interception guards and isolated browser transport failures that are not application bugs.
---

For a no-write browser test of a binary upload, count the intercepted request immediately and fulfill its synthetic response before awaiting request-body/header capture. Capture bytes afterwards.

**Why:** An initial guarded upload appeared stuck on Saving with no counted business request. A fresh context and response-first guard verified the 503/frozen-intent path and an explicit retry with identical URL and binary bytes; the earlier result did not establish an application upload defect.

**How to apply:** Keep all business mutations blocked in the restored development app. If a binary test stalls, distinguish worker loss and interception-body waits from application errors before changing production behavior. Use byte equality when the testing runtime lacks hashing APIs.

For mutating tests against an isolated API, prefer a loopback streaming proxy when browser-driver interception contradicts direct API checks.

**Why:** Valid fixture login succeeded directly but repeatedly returned 400 through driver interception despite reported matching field lengths and body forwarding. Removing interception and using a streaming bridge allowed the IAM acceptance to pass without changing authentication.

**How to apply:** Route every `/api` request exclusively to the isolated backend, retain cookies and CSRF, adapt Origin/Referer to its configured origin, and leave other traffic with the existing frontend. Remove old interception before retesting. Stop both QA bridge and harness afterwards. A transport failure is not evidence that application authentication should be weakened.

Bind browser fixture credentials to their exact isolated schema; do not assume
another test run generates the same passwords.

**Why:** Running API tests while browser QA was open overwrote the shared fixture
credential file with newly randomized passwords. The existing browser database
retained its original hashes, so a healthy login endpoint correctly returned 401.

**How to apply:** Finish other seeding runs before starting browser QA, preserve
a private schema-specific credential snapshot, and tell the tester which
snapshot belongs to its bridge. Do not reset working accounts to repair QA.
