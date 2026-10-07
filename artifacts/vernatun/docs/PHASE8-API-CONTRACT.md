# Phase 8: first-party leads and MFA rollout

Existing auth/CSRF/session and legacy responses remain compatible.

- POST /api/leads: name(2..120), contact(valid email/phone, <=254), organization(optional <=160), productInterest(<=80), audience(<=160), message(optional <=2000), consent=true, language(hy/ru/en), website(honeypot, empty only). Returns 201 {received:true,id}; this acknowledges database persistence, not email delivery. Public but CSRF/origin checked and rate limited.
- GET /api/leads: separate leads.read; page(1..10000), pageSize(1..100), q(<=160), sort(created_at/name), direction(asc/desc), language(optional). Returns {rows,total,page,pageSize}. No PII in audit details.
- GET /api/mfa/policy: selected fresh context, self policy and capability. {policy:{required,enforceAfter,version},enrolled,verified,canManage}. Scope fixed to platform_admin globally or unscoped org_admin's own organization.
- PUT /api/mfa/policy: {required,enforceAfter:null|ISO,version,reason}. Privileged scoped admin only, own MFA enabled and proof <=15 minutes old, CAS. Required activation at least 24 hours ahead. No policy rows/grants activated on existing users by migration.
- GET /api/mfa/status: existing fields plus required/enforced/verified/enforceAfter for selected context.
- Enforced privileged contexts reject business context access without MFA enrollment/proof. Auth session, context selection, logout and MFA setup/enable remain available. Required users cannot disable MFA.
- Successful login/reauth/enable records session MFA proof; one-time TOTP/recovery semantics remain unchanged.
