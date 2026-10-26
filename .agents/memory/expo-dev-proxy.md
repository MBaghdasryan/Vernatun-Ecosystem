---
name: Expo development API routing
description: Preview routing and middleware constraints for a private same-origin development API bridge.
---

Expo development bridges need a unique URL prefix, not a bare `/api`.
Preserve Connect's third callback when wrapping Metro middleware.

**Why:** Replit's outer artifact router can intercept `/api` on the Expo
hostname before Metro sees it. A request returning 200 then proves only the
outer route, not the bridge's origin checks. Dropping Connect's third callback
also lets initial bundling succeed but crashes Metro on a later asset request.

**How to apply:** Check the uniquely prefixed bridge through its public preview
origin, including an allowed Origin header, as well as unit-testing middleware.
Expo's own origin middleware may reject foreign origins before the custom bridge
and report 500; this is not evidence of forwarding an unauthorized request.

For Expo web browser tests launched from a Node test runner, explicitly set the
child process `NODE_ENV=development`; the parent’s `NODE_ENV=test` makes React
Native dev middleware throw its `DefaultToolLauncher` test guard. For
cookie-authenticated writes from a resident route, refresh the CSRF token from
the current session and register the API client’s token getter in that route.
Login and context selection succeeding do not prove a later route’s mutation
will carry the token.

**Why:** A browser path reached resident discussion creation but received
`csrf_invalid` after the login and apartment-selection requests had succeeded.
Initializing the token getter from the resident route’s session made the real
UI mutation succeed; running Expo under the inherited test environment failed
before Metro started.

**How to apply:** In browser acceptance tests, exercise a protected write after
navigating into the target route, and start the Expo child in development mode.
