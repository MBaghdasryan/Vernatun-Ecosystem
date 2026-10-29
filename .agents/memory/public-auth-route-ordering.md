---
name: Public auth route ordering
description: Keep public authentication bootstrap endpoints reachable when application routers mount before auth routes.
---

Routers mounted before session bootstrap routes must not apply a router-wide authentication middleware. Public endpoints such as session discovery and CSRF initialization need to remain reachable; enforce access on each protected handler instead.

**Why:** A router-level guard intercepted `/auth/session` before the authentication route could initialize the browser session, making all unauthenticated requests appear broken.

**How to apply:** When mounting platform or CMS routers early in the API stack, keep the router itself public and use existing permission checks inside each private route.
