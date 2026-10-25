# Operations Center browser acceptance — 2026-10-22

## Test setup

- Tested the Vernatun web app in Chromium at 1440×1000 and 390×844.
- Signed in through the regular login flow as `platform_admin`, `support`, and
  `org_admin`. The API was routed through the existing local QA bridge to a
  per-run isolated schema in `vernatun_test`; no production or development
  records were used.
- Authentication and CSRF protection remained enabled. No auth bypass or
  application code change was made. The isolated browser API exited successfully
  and removed its temporary schema after the checks.

## Results

### Platform administrator

- The system console displayed all 15 permission-gated tabs: Overview, Health,
  Logs, Errors, Jobs, Retention, Cache, Sessions, Environment, Backups, API,
  Integrations, Webhooks, Modules, and Updates.
- The required API Center, system connections, operational logs and diagnostics,
  module registry, and update screens loaded. Normal admin navigation produced
  no failed API responses, browser console errors, or page errors.
- The overview and health requests succeeded, though their aggregate status was
  `warning` in the isolated test environment. This is not evidence of production
  health.
- Empty states rendered for error groups, jobs, backups, API clients,
  integrations/webhooks, and update history. The module registry and operational
  overview displayed data.
- A browser-only synthetic `503` for the Health request displayed the error
  message with `HTTP 503` and a Retry button. This confirms the error UI path;
  it does not represent a real service outage.

### Support and organization administrator

- Opening `/console/system/updates` did not expose the System Console, its tabs,
  or system action buttons. The organization administrator saw the access-denied
  page; support remained on its allowed console surface.
- For each role, all 15 protected API routes below returned `403` when called
  directly:
  `/system/overview`, `/system/health`, `/system/logs`, `/system/jobs`,
  `/system/errors`, `/system/cache`, `/system/environment`, `/system/sessions`,
  `/system/backups`, `/system/api/docs`, `/system/api`, `/system/integrations`,
  `/system/webhooks`, `/system/modules`, and `/system/updates`.
  Result: 30 denied requests, with no unexpected status.

### Mobile and authentication

- All 15 system tabs were opened at 390×844. `documentElement.scrollWidth` and
  `body.scrollWidth` remained 390 on every tab; no page-level horizontal
  overflow was observed.
- Desktop and mobile screenshots were captured for the main administrative
  screens. Temporary screenshots are in the ignored local QA directory
  `.local/qa/operations-center/` and are not part of the application build.
- An authenticated overview request returned `200`; the same protected request
  without a session returned `401` after testing. Authentication remained on.

## Limits

This was an isolated development-browser acceptance pass, not production
acceptance. The injected `503` was synthetic. Empty lists describe the seeded QA
schema, not live system data. No destructive system action, backup recovery,
external provider connection, or update installation was performed.
