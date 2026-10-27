# ImTun mobile gap audit

**Date:** 2026-10-27  
**Scope:** Existing Expo application in `artifacts/imtun-mobile`, compared with the 65-section ImTun resident super-app prompt.  
**Important:** This is a source/API integration audit, not proof of production behavior. Provider-backed functions and real-device acceptance remain unverified unless stated otherwise.

| # | Feature | Existing screen / API evidence | Current state | Missing / acceptance gap | Action |
|---:|---|---|---|---|---|
| 1 | Backend is authoritative | Generated Vernatun API client, mobile auth contexts, resident workspace/records APIs | UI is API-driven; navigation role is presentation only | Re-run server authorization checks for every role and scope in end-to-end journeys | KEEP |
| 2 | Mobile product structure | Five primary tabs where permissions allow; contextual sections under More | Existing navigation; tabs vary by active permissions | Verify every role gets the intended navigation without hiding its account controls | POLISH |
| 3 | Design language | ImTun palette, HY/RU/EN entry flow, themed components | Existing design system and translations | Full typography, dark/system theme, long-text and device-size matrix is not complete | POLISH |
| 4 | Home | Resident workspace, counts, announcements, requests, finance and access cards | Data-backed dashboard exists | Validate all dynamic interruption, vote, alarm and utility cards; improve empty/no-home state | EXTEND |
| 5 | Multi-building switcher | Mobile auth contexts and profile context switch | Existing server-backed context switching | Verify finance, requests and access refresh correctly across multiple buildings | KEEP |
| 6 | Bills | Bills tab and resident finance domain | Existing finance UI | Verify all charge categories and distinguish unavailable provider data from zero | EXTEND |
| 7 | Monthly ledger | Finance domain and payment/invoice records | Partial ledger UI exists | Confirm January–December balances, allocations, penalties and credit against API data | EXTEND |
| 8 | Pay flow | Vernatun invoice/payment APIs are available to the app | UI/API path exists; live provider acceptance not confirmed | Verify beneficiary, split recipients, processing states and server-confirmed success | BLOCKED_BY_PROVIDER |
| 9 | Payment history | Finance/payment records | Existing history surface | Complete search/filter and verify provider reference, allocations, receipt and refund details | EXTEND |
| 10 | Bank-transfer receipt | Resident record/media flows | Upload building blocks exist | Verify amount/date/reference form, private upload authorization and review status end to end | EXTEND |
| 11 | Saved cards | No provider-hosted card flow confirmed in mobile | Not active | Add only after a compliant provider flow and capability are enabled; never collect PAN/CVV in app | BLOCKED_BY_PROVIDER |
| 12 | Autopay | No active mandate/provider flow confirmed | Not active | Requires provider tokenization, explicit consent, limits and revocation support | BLOCKED_BY_PROVIDER |
| 13 | Utilities | Utilities workspace and resident finance screens | Backend-backed section exists | Verify each provider's unavailable state and latest reading/timestamp across role scopes | EXTEND |
| 14 | Meters | Meters domain screen | Existing API-backed section | Verify history, anomaly and resident reading submission policies with real meter data | POLISH |
| 15 | Requests | Requests tab, detail/timeline, attachments and photo request draft | Existing functional flow | Run owner/renter/family submission and resolution scenarios on device | POLISH |
| 16 | AI photo request | Photo request flow and media picker exist | Editable request path exists; AI analysis is not confirmed active | Connect only after AI/vision provider and moderation policy are approved | BLOCKED_BY_PROVIDER |
| 17 | Community | Community, discussions, meetings/votes and announcements sections | Existing screens | Complete combined role-specific acceptance and unread-state checks | POLISH |
| 18 | Direct chat | Chats and message thread components | Basic messaging surface exists | Verify image/file, reply, reaction, read state, search, retry, drafts, mute, pin and reminders | EXTEND |
| 19 | Discussions | Discussions and thread components | Existing | Complete report/mute/pin and privacy acceptance by role | POLISH |
| 20 | Proposal conversion | Independent request/proposal conversion and discussion lineage components | Existing separate flows and lineage UI | Run joint acceptance while preserving discussion, source-message, request, proposal, meeting and vote links | POLISH |
| 21 | Voting | Meetings/voting domain | Existing | Verify eligibility, quorum, confirmation and immutable recorded-vote behavior against server rules | EXTEND |
| 22 | Announcements | Announcements domain/feed | Existing | Verify media/attachments and notification deep links | POLISH |
| 23 | Notifications | Notification center plus persisted preferences/quiet hours | Existing settings and list surfaces | Complete filter, mark-read, mark-all, snooze and deep-link tests; push delivery is separate | EXTEND |
| 24 | Access | Device list and server-provided capability checks | Existing Cloud-mediated screen | Real Edge remains reported offline and the physical barrier test is paused | EXTEND |
| 25 | Access command UX | Request command API and command-status polling | Lifecycle UI exists | Do not claim OPEN/CLOSE success until the existing Windows Edge returns a real SUCCESS | EXTEND |
| 26 | BLE phone key | Integration-status shell | Inactive; no BLE credential controls enabled | Requires tested provider, native permissions and revocation lifecycle | BLOCKED_BY_PROVIDER |
| 27 | Intercom | Integration card and empty call-area shell | Visible but inactive | Requires a verified call/video provider and device; no fake call controls | BLOCKED_BY_PROVIDER |
| 28 | Camera live view | Integration card and empty preview shell | Visible but inactive | Requires authorized camera stream integration; no stream credentials in mobile | BLOCKED_BY_PROVIDER |
| 29 | Guest pass | Passes domain and pass/QR surfaces | Existing | Verify create/share/revoke, expiry and QR behavior on real iOS/Android devices | POLISH |
| 30 | Short stay | Household/rental-related record flows | Partial | Verify guest, vehicle, access scope, activation and server-side auto-expiry | EXTEND |
| 31 | Household | Family and household screens/actions | Existing | Finish suspend/restore/remove permissions across owner, renter and family | EXTEND |
| 32 | Rental | Household lease flows | Existing owner/renter paths | Complete accept/decline, active/pending/expired states and end-date scope tests | EXTEND |
| 33 | Payment responsibilities | Payer delegation UI/API flow | Existing; recipient acceptance policy captured | Verify allowed categories, recipient-only acceptance, original billing identity and renter cases | EXTEND |
| 34 | Vehicles | Vehicle records in profile/More | Existing | Verify validation and use in guest/parking flows where enabled | POLISH |
| 35 | Services | Service catalog and service actions | Existing | Verify availability, billing units and provider-disabled states | POLISH |
| 36 | One-time orders | Booking/service-order components | Existing scheduling/request flow | Verify final price, time selection and every server status transition | EXTEND |
| 37 | Building contacts | Building information and contacts records | Existing | Verify configured contact methods only; no fabricated contact values | POLISH |
| 38 | Emergency | Home/contacts surfaces | Partial | Confirm building-configured emergency contacts and role-specific visibility | EXTEND |
| 39 | Profile | Profile, avatar and active-home context | Existing | Verify avatar upload, contact verification and profile stats with approved scopes | EXTEND |
| 40 | Resident directory | Directory record section | Existing capability-gated surface | Verify search fields and phone privacy against backend policy | EXTEND |
| 41 | Building finances | Resident finance domain | Partial | Confirm aggregate-only values and never expose neighbor-level payment data | EXTEND |
| 42 | Agreements | Agreement/document section | Existing | Verify version, accepted date, mandatory activation consent and withdrawal rules | EXTEND |
| 43 | Settings | Language, theme, notification preferences and quiet hours | Existing settings; quiet-hours API is present | Complete HY/RU/EN, theme and notification preference matrix on devices | POLISH |
| 44 | Mobile security | Secure local PIN/biometric module and server sessions | Existing | Verify biometric/PIN behavior and device revocation on physical devices | POLISH |
| 45 | Saved profile/login | Saved-profile chooser without plaintext password storage | Existing | Verify account removal, re-login and shared-device session isolation | POLISH |
| 46 | AI assistant | AI-related capability/status surface | No live resident assistant acceptance confirmed | Requires approved AI provider, privacy boundary and server-side data controls | BLOCKED_BY_PROVIDER |
| 47 | AI action cards | No verified complete action-card flow | Not confirmed active | Implement only with a live assistant and explicit confirmation for consequential actions | BLOCKED_BY_PROVIDER |
| 48 | Marketplace | Listings, filters, photos, viewing requests and an explicit empty map shell | List/detail flows exist; map provider is not connected; per-listing external OSM links remain | Add a real map only after selecting a supported provider and verifying listing coordinates | BLOCKED_BY_PROVIDER |
| 49 | Marketplace filters | Listing filter component | Existing | Verify every requested filter/sort against server results | POLISH |
| 50 | Listing management | Listing form/photos and resident listing records | Existing | Verify moderation, hidden, sold/rented and expiry lifecycle | EXTEND |
| 51 | Marketplace messaging | Listing-related conversations/viewing requests | Partial | Verify dedicated listing conversation and viewing-request lifecycle; do not mix work-order chat | EXTEND |
| 52 | Help center | Help component and localized entries | Existing | Verify searchable coverage for all requested topics and available video guides | POLISH |
| 53 | Support/feedback | Feedback and building-management contact flows | Existing | Verify app-problem, management-contact and suggestion routes remain separate | EXTEND |
| 54 | Offline behavior | Local draft and upload retry components | Partial | Prove only safe drafts are cached and access/payment actions never replay offline | EXTEND |
| 55 | Push | No active Expo push registration/delivery confirmed | Not active | Requires native push credentials, backend registration and deep-link acceptance | BLOCKED_BY_PROVIDER |
| 56 | Camera/files/QR permissions | Expo image picker and pass QR surfaces | Partial native permission support | Verify just-in-time permission prompts, denial/retry and real-device camera/QR behavior | EXTEND |
| 57 | Capability-driven UI | Workspace capabilities and integration status gate sections/actions | Existing server-driven gating | Verify missing/disabled/active states for every optional capability | KEEP |
| 58 | Responsive/device QA | Expo preview tested at 402×874 | One preview size only | Android 360/390/412/430 and common iOS sizes, landscape and large text remain unverified | BLOCKED_BY_PLATFORM |
| 59 | Performance | React Query caching and screen-level data loading | Existing foundations | Verify pagination, incremental chat/history, image caching and large lists with production-size data | EXTEND |
| 60 | Accessibility | Labels/test IDs and native controls exist | Partial | Complete screen-reader, touch-target, dynamic text and non-color status checks | EXTEND |
| 61 | Gap audit | This document | Created | Keep findings current as features are accepted | KEEP |
| 62 | Implementation order | Existing app already contains work across phases 1–10 | Partial; actual completion is feature-specific | Continue internal gaps first; defer provider/device work until prerequisites exist | EXTEND |
| 63 | Final end-to-end scenarios | Unit/type/proxy checks exist | Real owner/renter/family and multi-building acceptance is incomplete | Run with authorized test accounts and physical devices; real barrier remains paused | BLOCKED_BY_PLATFORM |
| 64 | Completion report | `IMTUN-MOBILE-COMPLETION-REPORT.md` | Created as a truthful partial report | Update only after acceptance evidence changes | KEEP |
| 65 | Coherent resident-first app | Shared ImTun navigation, context, theme and backend APIs | Existing coherent foundation | Close the listed integration and acceptance gaps without duplicating backend policy | POLISH |

## Immediate next work

1. Keep the Android/iOS entry route consistent and test sign-out → entry → owner registration on a physical Android device.
2. Complete internal end-to-end acceptance for listings, viewing requests and discussion-to-request/proposal lineage.
3. Keep real access commands paused while Edge reports offline; do not send a physical command until the operator confirms the device is online and ready.
4. Select a map provider before implementing the marketplace map. Do not ship a decorative or guessed-location map.

