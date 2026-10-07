# Phase 7 contract

Additive development migration 022, isolated before main; no main seed, production migration or real email.

## Notifications
- GET `/api/notifications/catalog`: `{events:[{code,category,critical}],categories:string[],channels:{in_app:"active",email:"pending_domain",sms:"future",push:"future"}}`
- GET `/api/notifications/preferences`: `{email_enabled:boolean,in_app_enabled:boolean,categories:Record<category,{email?:boolean,in_app?:boolean}>,version:number}`. Defaults true, empty categories, version 0; preferences apply to future deliveries, not deleting inbox history.
- PUT same path: full replacement body including `version`; stale 409. User-global, authenticated + CSRF. Only catalog categories accepted.
- GET `/api/notifications`: preserves existing array/targets contract; adds event_code/category/critical. Per-recipient metadata only, destination authorization is rechecked on each resolution.
- POST `/api/notifications/:id/read`: recipient only.
- GET `/api/notifications/:id/destination?contextId=...`: `{targetContextId,requiresSwitch,destination}`; explicit context switch remains required. Handles request, invoice/payment, meeting, announcement, pass, lease, support/onboarding and system destinations. No client-supplied URL.

## Branding
- Context adds optional `branding` (server JSON): `brand_name`, `primary_color`, `accent_color`, `support_email`, `support_phone`, `website_url`, `privacy_url`, `terms_url`, `logo_key`; all nullable. Absent config keeps original per-product HAYAT / ImTun / Vernatun branding.
- GET `/api/organization/branding`: `{branding,version,canManage}` current org only.
- PUT same path: `{version,branding:{...nullable fields except logo_key}}`; full metadata replacement, CAS 409. Requires `organization.settings`.
- POST `/api/organization/branding/logo?version=...`: binary raster image <=2MB. Sanitized JPEG into existing PRIVATE App Storage photos; response branding/version. No SVG/HTML/JS or arbitrary remote logo URL. No automatic byte deletion.
- GET `/api/organizations/:id/branding/logo?key=...`: authenticated active org context, matches current key, private/no-store. 404 absent, 403 other org. Scope access, not uploader identity.
- DELETE `/api/organization/branding/logo?version=...`: removes config reference only, leaves bytes for conservative inventory/backup.
- Metadata/logo changes must refresh auth contexts so HAYAT/ImTun effective branding is visible after reload. Default logo remains fallback on missing/offline configured image.

## Storage/PWA
- GET `/api/storage/status`: authenticated `{mode,explicit,productionReady}`; no bucket paths/credentials.
- Current provider remains App Storage. Local/S3 are optional explicit adapters; no automatic transfer or S3 credentials setup.
- Only static allowlisted app-shell assets are cached. No API/private files/authenticated branding or financial payloads. Offline fallback, manifest/install affordance and explicit technician draft states, never background sync. No native build or simulated push.
