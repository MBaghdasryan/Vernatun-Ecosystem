# Vernatun — keyboard and screen-reader acceptance

**Date:** 2026-10-25
**Status:** source audit and shared-shell fixes complete; full interactive acceptance remains **PARTIAL**.

This report separates source inspection from browser/assistive-technology evidence.
Finding an ARIA attribute or responsive rule in code does not prove that a user can
complete the interaction with a keyboard or screen reader.

## Role and route coverage

The role-to-route mapping below was checked against `ROLE-UI-PARITY.md`. The
shared-shell changes apply to each listed role, but authenticated pages were not
opened and keyboard-tested individually in this pass.

| Role | Primary route | Shared UI shell | Source-level coverage |
|---|---|---|---|
| Platform admin | `/console/overview` | Vernatun OS / Console | Skip link, main landmark, heading focus, visible focus |
| Support | `/console/onboarding` | Vernatun OS / Console | Skip link, main landmark, heading focus, visible focus |
| Organization admin | `/os/organization` | Vernatun OS | Skip link, main landmark, heading focus, visible focus |
| Portfolio owner | `/os/portfolio` | Vernatun OS | Skip link, main landmark, heading focus, visible focus |
| Developer | `/os/development` | Vernatun OS | Skip link, main landmark, heading focus, visible focus |
| Manager | `/hayat/management` | HAYAT | Skip link, main landmark, heading focus, named navigation |
| Dispatcher | `/hayat/dispatch` | HAYAT | Skip link, main landmark, heading focus, named navigation |
| Accountant | `/os/accounting` | Vernatun OS | Skip link, main landmark, heading focus, visible focus |
| Technician | `/hayat/my-work` | HAYAT | Skip link, main landmark, heading focus, named navigation |
| Contractor | `/hayat/contractor` | HAYAT | Skip link, main landmark, heading focus, named navigation |
| Security officer | `/hayat/security` | HAYAT | Skip link, main landmark, heading focus, named navigation |
| Unit owner | `/imtun/owner` | ImTun | Skip link, focusable main landmark, existing heading focus |
| Renter | `/imtun/renter` | ImTun | Skip link, focusable main landmark, existing heading focus |
| Family member | `/imtun/family` | ImTun | Skip link, focusable main landmark, existing heading focus |

## Findings addressed

- Vernatun OS/Console and HAYAT now expose a localized “Skip to main content”
  link. ImTun already had the link, but its visible/accessibility name incorrectly
  said “Home”; it now has the correct localized label.
- The main landmarks are valid skip-link destinations and can receive programmatic
  focus.
- Vernatun OS/Console and HAYAT now move focus to the page heading after an
  in-app route change. ImTun already did this.
- HAYAT's search input had `outline:none`; a shared high-contrast
  `:focus-visible` rule now restores a visible keyboard focus indicator.
- On coarse-pointer devices, buttons, links, selects, and non-checkable inputs in
  all three product shells have a 44 px minimum height. Checkbox/radio controls
  have a 24×24 px minimum size.
- Existing modal focus behavior and mobile navigation focus handling were reviewed
  in source. This is not evidence of a live keyboard interaction test.
- HAYAT modal dialogs now expose their heading as the dialog name and use a
  localized “Close” accessible name instead of repeating the dialog title.
- ImTun’s mobile navigation is now labelled as service navigation, matching its
  desktop navigation rather than being announced as “Home.”
- Source inspection confirmed that Vernatun’s global search dialog captures
  Escape even when the search input contains text, restores focus to its opener,
  and announces loading, failure, and empty-result states through a polite live
  region. These behaviors still need real browser and screen-reader confirmation.

## Viewport evidence

The previous isolated browser pass recorded 560 role/screen/viewport combinations
at **360, 390, 768, 1024, and 1440 px**, with no horizontal overflow on the
combinations it opened. That is historical responsive evidence, not a new
accessibility test. The changes in this pass were not interactively measured at
those widths, and the coarse-pointer rules were not tested on a physical device.

| Width | Previous responsive evidence | Keyboard / screen-reader acceptance in this pass |
|---:|---|---|
| 360 px | Included in the 560-combination pass | Not browser-verified |
| 390 px | Included in the 560-combination pass | Not browser-verified |
| 768 px | Included in the 560-combination pass | Not browser-verified |
| 1024 px | Included in the 560-combination pass | Not browser-verified |
| 1440 px | Included in the 560-combination pass | Not browser-verified |

## Verification limits and remaining acceptance

- The browser preview has no authenticated QA session in this pass; it renders the
  sign-in page. No authentication bypass was added. The signed-in UI therefore
  could not be visually or interactively checked here.
- No live Tab/Shift+Tab run was completed for all menus, dialogs, forms, filters,
  tables, error states, and role-specific screens.
- NVDA, VoiceOver, TalkBack, and a screen-reader announcement/order check were not
  available. ARIA names, state changes, chart descriptions, and live-region
  announcements remain unconfirmed with assistive technology.
- No authenticated browser session was used in this pass. Browser and operating
  system for interactive acceptance: **not run / not recorded**. The 14 role
  routes above were source-audited as shared-shell coverage only, not opened as
  signed-in users.
- No automated axe scan was run against authenticated pages.
- Touch target dimensions were raised in shared CSS, but individual rendered
  controls, spacing exceptions, and overlap at each viewport still need browser
  measurement.
- Manual acceptance is still required for all 14 roles, especially mobile menu
  focus trapping/return, dialogs with populated search inputs, workflow forms,
  validation errors, dense tables, and charts.
- The Vernatun OS compact bottom navigation still needs live mobile verification
  of its current-page announcement; desktop navigation already exposes the
  current link in source.

## Checks run

- `corepack pnpm --filter @workspace/vernatun run typecheck` — **PASS**.
- `PORT=5173 BASE_PATH=/vernatun/ corepack pnpm --filter @workspace/vernatun run build`
  — **PASS**. Vite reports the existing large Portal bundle warning (about 1.09 MB).
- `DANGEROUSLY_ALLOW_GIT=1 git diff --check` — **PASS**.
- Restarted `artifacts/vernatun: web`; the public `/login` route rendered the
  Armenian sign-in page in the preview with no browser console errors. This does
  not verify any authenticated role screen.
