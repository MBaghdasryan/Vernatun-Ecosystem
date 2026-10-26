# ImTun mobile audit

Audited against the existing Expo app and active resident API source, not against production availability. Reference screenshots are layout references, not sample production data. Existing financial, identity, request, governance and Edge engines remain authoritative.

This table is the pre-change baseline. For implemented changes, actual verification
and still-open scope, see [IMTUN-MOBILE-COMPLETION-REPORT.md](IMTUN-MOBILE-COMPLETION-REPORT.md).

| # / Feature | Existing screen | Existing API | Current state / missing | Action |
|---|---|---|---|---|
| 1 Source of truth | resident hooks/domain gates | workspace, contexts, canonical domains | Present; preserve server authorization | KEEP |
| 2 Navigation | four tabs + More | workspace capabilities | Missing Bills and Community primary tabs | EXTEND |
| 3 Design/languages/themes | colors, useColors, preferences | resident profile | Shared screens inconsistent; top-level screens Armenian-only | POLISH |
| 4 Home | tabs/index, HomeCounts | workspace home summary | Real summary exists; dashboard hierarchy and role variants missing | EXTEND |
| 5 Property switcher | profile context sheet | mobile context switch | Present; add easy Home access and role labels | POLISH |
| 6 Bills | domain/Finance | invoices, utilities, workspace | Basic list; needs structured finance root | EXTEND |
| 7 Monthly ledger | Finance | canonical ledger/invoice sources | Monthly drill-down not complete; no client financial recomputation | BLOCKED_BY_PLATFORM |
| 8 Pay | Finance readiness | canonical payment intents | Provider activation and acceptance required | BLOCKED_BY_PROVIDER |
| 9 Payment history | Finance | canonical finance endpoints | Mobile full search/detail not integrated | EXTEND |
| 10 Bank receipt | finance workflows | canonical receipt workflow | Mobile receipt form not complete | EXTEND |
| 11 Saved cards | readiness only | unsupported capability | No provider vault integration | BLOCKED_BY_PROVIDER |
| 12 Autopay | readiness only | unsupported capability | No mandate integration | BLOCKED_BY_PROVIDER |
| 13 Utilities | Finance | utility accounts | Masked accounts exist; live balances unavailable | POLISH |
| 14 Meters | domain/Meters | resident meters/history/reading | Present; preserve real readings | POLISH |
| 15 Requests | tabs/requests | canonical requests/category/history | Working forms; reference-quality detail and navigation missing | POLISH |
| 16 Photo request | request attachment | media upload; AI unavailable | Camera/photo draft possible, recognition unavailable | EXTEND |
| 17 Community | generic community hub | records, announcements, meetings | Needs coherent community entry with tabs | EXTEND |
| 18 Direct chat | continuity/Chats, Thread | resident DM/messages | Text flow present; full rich messenger is partial | EXTEND |
| 19 Discussions | RecordsList/Thread | records/discussions | Working; improve presentation without changing rules | POLISH |
| 20 Proposal | RecordCard/lineage | dedicated lineage/proposal endpoints | Independent reviewed proposal and direct request implemented | KEEP |
| 21 Voting | domain/Meetings | canonical governance | Real eligibility/quorum; improve native layout | POLISH |
| 22 Announcements | domain/Announcements | resident announcements | Working list; improve feed | POLISH |
| 23 Notifications | domain/Notifications | resident notifications/read | Read states present; scoped routing/filter UX partial | EXTEND |
| 24 Access | no dedicated friendly root | effective device actions | Need resident-friendly capability-driven screen | BUILD |
| 25 Access command UX | existing Edge command engine | effective actions/command lifecycle | Never claim opened before actual confirmation | EXTEND |
| 26 BLE key | none | not configured | Hardware/provider required | BLOCKED_BY_PROVIDER |
| 27 Intercom | none | not configured | Calling adapter required | BLOCKED_BY_PROVIDER |
| 28 Cameras | none | not configured | Authorized streaming provider required | BLOCKED_BY_PROVIDER |
| 29 Guest passes | domain/Passes | canonical access passes | Create/revoke exists; provider QR/PIN/share require supported payload | POLISH |
| 30 Short stay | none | no verified short-stay contract | Do not invent activation/expiry engine | BLOCKED_BY_PLATFORM |
| 31 Household | domain/Family, continuity account | resident household/delegations | Existing server-scoped management; improve mobile forms | POLISH |
| 32 Rental | continuity/Account | canonical lease/household flow | Existing lifecycle; acceptance and mobile QA partial | EXTEND |
| 33 Payer responsibility | continuity/Account | payer policy/delegations | Recipient acceptance; no merchant/ownership change | KEEP |
| 34 Vehicles | generic records | records/vehicles | CRUD present | POLISH |
| 35 Services | records + continuity bookings | services/subscriptions/bookings | Real catalog and booking forms | POLISH |
| 36 One-time order | ServiceOrder/Bookings | service options/bookings | Existing workflow; improve native UI | POLISH |
| 37 Contacts | BuildingInfo/records | published contacts | Real configured links only | POLISH |
| 38 Emergency | home summary/contacts | published emergency contacts | No fake emergency numbers | EXTEND |
| 39 Profile | tabs/profile | mobile session/workspace/avatar | Needs role, property, localized sections | EXTEND |
| 40 Directory | records/directory | opt-in directory | Privacy-preserving scoped API exists | KEEP |
| 41 Building finances | continuity/Finance | resident building finance | Safe building aggregates exist | POLISH |
| 42 Agreements | records + Account | agreements/acceptance | Existing accepted versions and activation requirements | POLISH |
| 43 Settings | PrefsForm/Account | profile/preferences | HY/RU/EN and themes stored; shared rendering partial | EXTEND |
| 44 Mobile security | session storage | canonical server sessions | Native session security/local PIN/biometrics require audit | EXTEND |
| 45 Saved profiles | login | authenticated session | No safe account chooser yet; never retain passwords | BUILD |
| 46 AI assistant | conversation history | AI readiness/history | No live AI provider | BLOCKED_BY_PROVIDER |
| 47 AI action cards | none | no verified typed action contract | Never execute arbitrary model actions | BLOCKED_BY_PLATFORM |
| 48 Marketplace | continuity/Market + records | listing/search/comparison | Existing optional module, native hierarchy partial | POLISH |
| 49 Market search | ListingFilters/Market | listing filters | Existing filters; preserve scope | POLISH |
| 50 Listing | ListingForm/Photos | canonical listing/photos | Real private images/moderation | KEEP |
| 51 Market chat | listing conversation/viewing | inquiry and viewing endpoints | Existing separate conversation lineage | KEEP |
| 52 Help center | Help + help records | localized help | Search/presentation partial | EXTEND |
| 53 Support/feedback | continuity/Help | support + feedback workflows | Correct distinct workflows exist | KEEP |
| 54 Offline | local request drafts | online writes | No payment/access replay; expand safe draft handling only | EXTEND |
| 55 Push | DeviceRegister | installation registration | Provider delivery absent; no push success claim | BLOCKED_BY_PROVIDER |
| 56 Native permissions | image picker | media upload | Request only on use; audit attachment forms | POLISH |
| 57 Capability UI | workspace + domain gates | enabled sections/integrations | Preserve server opt-ins; no fake buttons | KEEP |
| 58 Responsive/device QA | Expo web/native app | n/a | Full real iOS/Android matrix not confirmed | EXTEND |
| 59 Performance | bounded records + queries | bounded APIs | Rich incremental pagination not complete everywhere | EXTEND |
| 60 Accessibility | partial labels/states | n/a | Dynamic text/touch-target/screen-reader audit required | EXTEND |
| 61 Audit | this document | source inspection | Baseline captured before editing | KEEP |
| 62 Implementation order | existing Expo artifact | existing API | Extend shared architecture, no replacement app | KEEP |
| 63 Final scenarios | existing test suites | isolated fixtures | New role-specific UI journey acceptance required | EXTEND |
| 64 Completion report | separate report | verified evidence | Write actual results and blockers, not inferred READY | BUILD |
| 65 Coherence | existing resident modules | canonical backend | Integrate navigation and shared visual language | POLISH |

## Deployment boundary

No production migration, provider configuration, user credential reset, real payment, device command or Edge registration is authorized by this UI implementation. External capabilities stay unavailable until the backend confirms readiness.
