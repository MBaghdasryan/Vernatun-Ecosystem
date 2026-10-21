# Verified product screen captures

Captured 2026-10-21 from the current application code using Chromium and normal password/session/CSRF authentication. Data are the project's seeded demonstration fixtures in a fresh isolated test schema, not customer records. No application authorization was disabled, no screenshot DOM was altered, and no API responses were mocked. Business records were not changed during capture.

## Sources

All paths below are relative to `public/assets/`.

| File | Application route | Authorized role | Viewport |
|---|---|---|---|
| console.jpg | Vernatun Web `/os/organization` | org_admin | 1440 × 1000 |
| organization.jpg | Vernatun Web `/os/people` | org_admin | 1440 × 1000 |
| operations.jpg | Vernatun Web `/hayat/management` | manager | 1440 × 1000 |
| finance.jpg | Vernatun Web `/os/accounting` | accountant | 1440 × 1000 |
| contractor.jpg | Vernatun Web `/hayat/contractor` | contractor | 1440 × 1000 |
| technician.jpg | Vernatun Web `/hayat/works?requestId=…` (opened assigned work) | technician | 1440 × 1000 |
| resident.jpg | Vernatun Web `/imtun/owner` | unit_owner | 430 × 932 |
| imtun-expo.jpg | ImTun Expo Web `/` (signed-in tabs) | unit_owner | 430 × 932 |

Observed rendered data: organization has 12 team members and 2 units; accountant has published invoices totaling AMD 37,000; contractor has an assigned window-adjustment defect; technician and resident see the assigned entrance-lighting request; resident balance is AMD 24,500. ImTun Expo shows that same resident request from the API.

## Boundaries

- Vernatun OS / HAYAT / ImTun Web captures use Armenian UI. Current ImTun Expo UI is Russian with Armenian demonstration record text; its language was not artificially replaced.
- `imtun-expo.jpg` is the actual Expo application's **web renderer**, not an Android device, APK, or Expo Go native screenshot. `resident.jpg` is responsive ImTun Web.
- Expo's production API requests were redirected only in the capture browser to the isolated test API, with browser-local CORS response headers for that transport. Real API responses, session cookies, login and context selection were retained. Production CORS, DNS, auth configuration, databases, and app source were untouched.
- Existing landing.jpg is the prior public-site screenshot, not newly captured here. The product mockups visible *inside the site's own hero artwork* are marketing artwork, not proof of live product screens.
- Slide 5 shows Expo Web and responsive ImTun Web side by side. The approved slide text is unchanged. Native feature parity is not established by these captures.

## Reproduction

Use the existing API test runner's `--browser-only` mode, which migrates and seeds a new randomly named test schema and cleans up that schema on graceful shutdown. Its `browser-sandbox.ts` starts the isolated API. Use the local-only `scripts/iam-browser-proxy.mjs` bridge to the current Vernatun frontend. Read the generated test credentials privately, sign in through `/login`, choose the listed role/product context, and navigate to the routes above. Do not publish test credentials or browser storage state.

For Expo, use its current running web renderer, direct API traffic only to that same isolated backend in the capture browser, and sign in normally as unit_owner. Never substitute production customer credentials.
