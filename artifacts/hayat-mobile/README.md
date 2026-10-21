# HAYAT Contractor

Standalone Expo Go project for Vernatun contractors. This directory is deliberately
not registered as a second mobile artifact in the source workspace; copy it into
the separate Replit project selected for HAYAT.

## Configure and run

1. Set `EXPO_PUBLIC_API_URL=https://api.vernatun.io/api`.
2. Install packages with the pinned pnpm version, then run `pnpm run dev` in the
   new project. The dev script preserves Replit's managed Expo Go sign-in step.
3. Scan the HAYAT project's Expo Go QR code. Use a designated contractor account;
   non-contractor contexts are never offered by this app.

## Contractor access

- Sign-in and active-context selection use the Vernatun session API.
- The queue comes from `GET /api/hayat/queue`; the server restricts contractor
  results to defects assigned to the authenticated contractor.
- Start/report use `POST /api/defects/{id}/transition` with the row's current
  version, a CSRF header, and an idempotency key. The API rechecks authorization,
  assignment, status, and version for every transition.
- No password, session token, or work queue is saved in local storage. Logout
  ends the server session.

## Checks

Run `pnpm run typecheck`, `pnpm run test:contract`,
`pnpm run export:android`, and `pnpm run export:web`.

The Android package ID is independent from ImTun (`com.vernatun.hayat.contractor`).
An Android APK is not built by Expo Go export; use the separate project's approved
Android build process after it is created.
