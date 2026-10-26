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
