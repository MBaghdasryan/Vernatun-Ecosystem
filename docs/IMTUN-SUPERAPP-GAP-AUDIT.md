# ImTun Super App — исходный аудит

Эта таблица фиксирует состояние **до** текущей реализации. Итоги изменений, доказательства проверок и незакрытые требования: [IMTUN-SUPERAPP-PLATFORM-REPORT.md](IMTUN-SUPERAPP-PLATFORM-REPORT.md). Весь мастер-промпт пока имеет статус PARTIAL.

Источник требований: `attached_assets/Pasted--VERNATUN-IMTUN-RESIDENT-SUPER-APP-PLATFORM-CLOUD-BACKE_1793001035566.txt`.
Аудит исходного состояния, до реализации этого расширения. PARTIAL не означает
браузерную/production-приёмку. Все существующие домены остаются источниками истины.

Обозначения Existing: COMPLETE / PARTIAL / FOUNDATION_ONLY / EXTERNAL_BLOCKER /
NOT_IMPLEMENTED. Backend/UI/Mobile API описывают имеющееся покрытие, а не обещание.

| # | Capability | Existing | Backend | UI | Mobile API | Provider | Missing | Action |
|---|---|---|---|---|---|---|---|---|
|1|Resident product|PARTIAL|3 resident roles|web/native shell|session|—|super-app breadth|EXTEND|
|2|Resident contexts|PARTIAL|access.contexts + lease/delegation guards|switcher|auth/session|—|dedicated contexts API|EXTEND|
|3|Home aggregation|NOT_IMPLEMENTED|separate domain APIs|parallel requests|none|—|single scoped aggregation|BUILD|
|4|Property profile|PARTIAL|units/buildings/ownership|property view|units|—|resident-safe extended profile|EXTEND|
|5|Resident profile|PARTIAL|users + auth settings|settings|auth|—|contact/privacy/preferences model|EXTEND|
|6|Verification state|PARTIAL|ownership/occupancy/email workflows|fragmented|fragmented|SMS absent|truthful verification response|EXTEND|
|7|Activation|PARTIAL|invitations, expiry/revoke/resend|accept invitation|auth|Resend|versioned agreements/default context integration|EXTEND|
|8|Mobile devices|NOT_IMPLEMENTED|sessions only|none|none|push absent|installation registry and revoke|BUILD|
|9|Agreements|NOT_IMPLEMENTED|documents are not consent records|none|none|—|versions/acceptance/withdrawal|BUILD|
|10|Vehicles|NOT_IMPLEMENTED|pass free-text plate only|pass form|passes|LPR absent|scoped vehicle registry|BUILD|
|11|Household|PARTIAL|resident_delegations|family view|delegations|Resend|suspend/restore lifecycle|EXTEND|
|12|Renters|PARTIAL|leases + occupancies|lease view|leases|—|owner invitation/accept/reject workflow|EXTEND|
|13|Payer delegation|FOUNDATION_ONLY|invoice payer + finance allocations|staff finance|invoices|—|separate reviewed responsibility periods|EXTEND|
|14|Resident directory|NOT_IMPLEMENTED|none|none|none|—|opt-in privacy and org setting|BUILD|
|15|Building contacts|NOT_IMPLEMENTED|branding support contact only|partial|none|—|real configured contact directory|BUILD|
|16|Emergency center|FOUNDATION_ONLY|branding contacts|partial|none|—|configured emergency contacts|EXTEND|
|17|Building finance transparency|FOUNDATION_ONLY|staff reporting/ledger|staff|none|—|explicit opt-in aggregate-only resident access|EXTEND|
|18|Personal finance|PARTIAL|immutable invoices/payment allocations|resident finance|domain endpoints|—|aggregate/month breakdown integration|EXTEND|
|19|Payments|PARTIAL|existing Payments domain|workspace/readiness|payment intents|ArCa contract required|provider live acceptance|EXTERNAL_BLOCKER|
|20|Saved methods|EXTERNAL_BLOCKER|no verified tokenization|unavailable|none|contract required|provider tokenization|EXTERNAL_BLOCKER|
|21|Autopay|EXTERNAL_BLOCKER|no verified mandate rail|unavailable|none|contract required|mandate/tokenized provider|EXTERNAL_BLOCKER|
|22|Payment basket|FOUNDATION_ONLY|domain-isolated intents|separate payments|intents|contract required|multi-recipient UX orchestration|EXTEND|
|23|Transfer receipt|PARTIAL|existing payment claims/private files|resident claim form|finance|OCR absent|mobile/optional OCR integration|EXTEND|
|24|Payment history|PARTIAL|payments/intents/claims|finance|domain endpoints|—|unified filters and confirmation|EXTEND|
|25|Utilities|EXTERNAL_BLOCKER|Telcell foundation|readiness states|utilities/workspace|B2B contract required|balance/payment provider|EXTERNAL_BLOCKER|
|26|Meters|PARTIAL|own readings/history|web meters|meters|optional Edge|native screen|EXTEND|
|27|Requests|PARTIAL|existing workflow/messages/evidence|web/native|requests|—|super-app integration|EXTEND|
|28|Device → request|FOUNDATION_ONLY|inventory + requests|separate|separate|—|safe prefill/link|EXTEND|
|29|Guest pass|PARTIAL|visitor_passes/revoke/validate|web passes|passes|QR/PIN adapter absent|provider-supported credential/open flow|EXTEND|
|30|Short stay|FOUNDATION_ONLY|expiring passes/occupancy|passes|passes|adapter absent|restricted guest experience|EXTEND|
|31|Smart access|PARTIAL|Edge command policy|resident OPEN|resident Edge APIs|real test paused|real Windows OPEN/CLOSE acceptance|KEEP|
|32|BLE key|EXTERNAL_BLOCKER|no verified BLE adapter|unavailable|none|hardware required|provider protocol/credential issuer|EXTERNAL_BLOCKER|
|33|Access history|PARTIAL|edge_commands/access_events|staff history|own command receipt|—|own scoped consolidated history|EXTEND|
|34|Intercom|EXTERNAL_BLOCKER|Edge inventory only|unavailable|none|adapter required|calling/routing/session provider|EXTERNAL_BLOCKER|
|35|Camera|EXTERNAL_BLOCKER|Edge inventory only|unavailable|none|adapter required|signed stream authorization|EXTERNAL_BLOCKER|
|36|Credential types|FOUNDATION_ONLY|Edge credentials are machine credentials|none|none|access issuer absent|resident provider credential abstraction|EXTEND|
|37|Parking|FOUNDATION_ONLY|unit types/access scope|properties|units|LPR absent|vehicles/property/access integration|EXTEND|
|38|Elevator|PARTIAL|Edge inventory + alarms|staff view|inventory|safety HARD DENY|resident health without controls|EXTEND|
|39|Service catalog|NOT_IMPLEMENTED|tariffs/assets not resident catalog|none|none|—|catalog/availability/price|BUILD|
|40|Service subscription|NOT_IMPLEMENTED|none|none|none|—|reviewed lifecycle|BUILD|
|41|One-time order|FOUNDATION_ONLY|requests/work orders exist|requests|requests|—|catalog order → existing request|EXTEND|
|42|Chat|FOUNDATION_ONLY|request/support conversations|domain-specific|domain-specific|—|resident management conversation|EXTEND|
|43|Chat QoL|NOT_IMPLEMENTED|none for general messaging|none|none|—|read state/drafts/search/preferences|BUILD|
|44|Discussions|NOT_IMPLEMENTED|announcements/votes only|none|none|—|building discussions/moderation|BUILD|
|45|Discussion → request|NOT_IMPLEMENTED|request domain exists|none|none|—|reviewed conversion relation|BUILD|
|46|Discussion → vote|FOUNDATION_ONLY|weighted governance exists|meetings|governance|—|proposal/agenda link|EXTEND|
|47|Voting|PARTIAL|weighted eligibility/quorum/protocol|web|governance APIs|—|native integration|EXTEND|
|48|Announcements|PARTIAL|scoped published announcements|web|announcements|—|native super-app display|EXTEND|
|49|Notification center|PARTIAL|catalog/preferences/read/destinations|web|notifications|push absent|mark all read/category UX|EXTEND|
|50|Notification preferences|PARTIAL|in-app/email/critical policy|web|preferences|SMS/push absent|quiet hours/additional channels|EXTEND|
|51|My Building|NOT_IMPLEMENTED|separate registry/branding|separate|none|—|safe building aggregate|BUILD|
|52|Resident statistics|PARTIAL|role insights|web cards|role-insights|—|home integration|EXTEND|
|53|AI assistant|EXTERNAL_BLOCKER|no resident model integration|none|none|model configuration absent|permission-scoped model/consent|EXTERNAL_BLOCKER|
|54|Photo → AI request|EXTERNAL_BLOCKER|sanitized request photos exist|request upload|photos|vision model absent|suggestions with explicit approval|EXTERNAL_BLOCKER|
|55|AI preparation|FOUNDATION_ONLY|real mutations require auth|none|domain APIs|model absent|safe prepared-action review|EXTEND|
|56|AI continuity|NOT_IMPLEMENTED|none|none|none|model absent|scoped persisted conversations|BUILD|
|57|Help|NOT_IMPLEMENTED|staff knowledge not resident center|none|none|—|localized configured guides|BUILD|
|58|Platform support|PARTIAL|support_cases/conversations|web|support-cases|Resend|resident intake separation|EXTEND|
|59|Feedback|NOT_IMPLEMENTED|none|none|none|—|feedback separate from work order|BUILD|
|60|Marketplace|NOT_IMPLEMENTED|none|none|none|map provider absent|opt-in listings/search/favorites|BUILD|
|61|Owner listing|NOT_IMPLEMENTED|ownership exists|none|none|—|explicit draft/moderation/publication|BUILD|
|62|Listing inquiries|NOT_IMPLEMENTED|none|none|none|—|listing-linked conversation/viewing|BUILD|
|63|Marketplace moderation|NOT_IMPLEMENTED|none|none|none|—|review/reject/report/hide|BUILD|
|64|Settings|PARTIAL|locale/currency/auth settings|web/native|auth|—|theme/privacy/category channels|EXTEND|
|65|Global search|PARTIAL|workspace search|web header|workspace-search|—|resident super-app source coverage|EXTEND|
|66|API boundary|COMPLETE|Cloud product APIs|Cloud only|Cloud only|no direct device access|preserve|KEEP|
|67|Capabilities response|PARTIAL|context/modules + Edge actions|feature checks|contexts|—|central resident effective capabilities|EXTEND|
|68|External truthfulness|PARTIAL|payment/device readiness|readiness|domain APIs|missing adapters|unified statuses|EXTEND|
|69|Localization|PARTIAL|HY/RU/EN web|web; native HY only|enum codes|—|all newly added surfaces 3 locales|EXTEND|
|70|Privacy|PARTIAL|existing tenant/unit guards|scoped|scoped|—|new-domain tests/opt-in privacy|EXTEND|
|71|Audit|PARTIAL|existing immutable audit|staff audit|server-owned|—|new mutations audited|EXTEND|
|72|Acceptance|PARTIAL|isolated resident/Edge/finance tests|prior browser runs|existing tests|live device paused|new feature/reload/role cases|EXTEND|
|73|No rebuild|COMPLETE|reuse preserved|existing apps|existing APIs|—|preserve|KEEP|
|74|Gap audit|COMPLETE|this document|—|—|—|update evidence after implementation|KEEP|
|75|Final report|NOT_IMPLEMENTED|—|—|—|—|write verified implementation report|BUILD|
|76|Product principle|PARTIAL|shared architecture|existing ImTun|existing API|provider boundaries|extend only audited delta|EXTEND|

## Implementation boundaries

- No production schema/data writes from this workspace. New migration is verified
  in the existing isolated test runner; Coolify application is a separate step.
- No new auth, payment engine, ledger, request workflow, ownership registry,
  notifications engine or Edge protocol.
- No command to an offline Barrier. The real Windows-device test remains paused.
- Missing provider credentials/contracts/hardware are EXTERNAL_BLOCKER, not READY.
- Existing 15 reference screenshots guide changes; unchanged role dashboards are
  not claimed to have received a fresh pixel-parity acceptance.
