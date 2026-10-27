# ImTun mobile completion report

**Status: PARTIAL — not complete for production acceptance**  
**Date:** 2026-10-27

## This update

- Aligned Android and iOS startup routing: `/` is now the explicit initial route.
- Added a session/context guard to resident tabs. A signed-out user or a user without an active ImTun resident context returns to the entry screen instead of seeing an empty home.
- Centralized the ImTun resident-context predicate so entry, profile and tab access use the same rule.
- Preserved existing sessions; no account was forcibly signed out.
- The mobile entry screen currently renders the same HY/RU/EN role selection and owner sign-in/registration flow on the 402×874 Expo preview.
- Added the requested marketplace map area as an explicit inactive shell; it does not fabricate map tiles or pins, and existing external OpenStreetMap links remain available from listing details.

## Existing implementation found

The app already has screens/components for owner registration and email verification, context switching, finance, utilities, meters, requests and photo uploads, community/discussions/voting, announcements and notifications, access, guest passes, household/rental, payer responsibility, services/bookings, profile/avatar, saved profiles, security, help/support, listing forms/search, and integration-status shells for camera/intercom.

The full section-by-section status is in `IMTUN-MOBILE-GAP-AUDIT.md`. Existing code is not equivalent to live provider acceptance.

## Verification performed

- `corepack pnpm --filter @workspace/imtun-mobile run typecheck` — passed.
- Mobile development routing tests — 2 passed.
- Mobile development API proxy test — 1 passed.
- Android Expo manifest/bundle check — passed; bundle reachable from the Replit development host.
- Expo preview screenshot at 402×874 — entry screen rendered with owner/family/renter choices and owner registration form.
- Expo Metro started and bundled Android. React Native DevTools reported a missing host `libglib-2.0.so.0`; this did not stop Metro or Android bundling.

## Production and device limits

- The supplied Coolify migration output reports 048–055 applied, with no pending migrations or drift. This does not prove that this mobile build was published.
- The real Windows Edge/barrier test remains paused while the device is shown as offline. No real OPEN/CLOSE command is reported as accepted or successful.
- This turn did not verify a physical Android or iOS install. An Android device with a valid saved session will still open its home screen; use **Profile → Sign out** to return to the same entry/registration screen as iOS.
- Real payments, saved cards/autopay, push delivery, BLE, intercom, camera streaming, AI/vision, and a production marketplace map remain unavailable until their providers/devices are configured and accepted.
- Full responsive, screen-reader, large-text and owner/renter/family end-to-end acceptance remains open.

## Release decision

**Do not report ImTun as complete or production-ready yet.** The code-level startup fix and checks pass, but the physical-device, provider, real Edge, and full role-based acceptance gates remain open.
