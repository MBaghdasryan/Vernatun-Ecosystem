# Vernatun — каталог действующих разрешений

Дата: 2026-10-07. Источник: server/roles.ts. Это текущий системный каталог, не реализованный Custom Role Builder.

Проверено 14 системных ролей и 73 уникальных permission keys.

## Системные роли

| Роль | Shell | Разрешения по умолчанию |
|---|---|---|
| platform_admin | platform | leads.read, organizations.read, organizations.manage, platform.audit, platform.invite, subscriptions.manage, onboarding.manage, support.assign, support.cases |
| support | platform | support.queue, support.access.request, support.cases, onboarding.manage |
| org_admin | workspace | ownership.read, ownership.manage, properties.read, properties.manage, people.read, people.invite, roles.assign, modules.read, modules.manage, audit.read, support.access.approve, imports.manage, support.cases.create, documents.read, documents.manage, organization.settings, requests.configure, incidents.read, incidents.manage, incidents.create |
| portfolio_owner | workspace | ownership.read, properties.read, billing.read, reports.read, expenses.read, expenses.approve, reports.export, leases.read |
| developer | workspace | properties.read, defects.read, defects.manage, defects.accept, handover.read, handover.manage |
| manager | workspace | ownership.read, ownership.manage, properties.read, people.read, requests.read, requests.assign, workorders.accept, announcements.read, billing.read, announcements.manage, assets.read, assets.manage, meters.manage, meetings.read, meetings.manage, expenses.read, expenses.manage, reports.export, documents.read, documents.manage, leases.read, leases.manage, requests.configure, incidents.read, incidents.manage, incidents.create |
| accountant | workspace | properties.read, billing.read, billing.calculate, billing.publish, payments.reconcile, expenses.read, expenses.manage, reports.export, imports.finance |
| dispatcher | workspace | properties.read, requests.read, requests.assign, incidents.read, incidents.manage, incidents.create |
| technician | field | workorders.assigned, workorders.execute, assets.read |
| contractor | field | defects.assigned, defects.execute |
| security | field | access.validate, access.events, incidents.create, incidents.read, incidents.manage |
| unit_owner | home | ownership.read, properties.own, billing.own, requests.own, requests.create, announcements.read, residents.delegate, access.create, meters.own, meetings.read, meetings.vote, documents.read, leases.own |
| renter | home | properties.own, billing.own, requests.own, requests.create, announcements.read, access.create, meters.own, documents.read, leases.own |
| family | home | properties.own, requests.own, requests.create, announcements.read, documents.read |

## Permission → module → роли → исходники

Ссылки указывают на упоминания permission в серверных исходниках. Это подсказки для проверки guard, не доказательство полноты enforcement каждого endpoint. Module соответствует текущему moduleForPermission; «—» не означает неограниченный доступ. Объектные условия и read-only policy продолжают действовать.

| Permission | Module | Роли по умолчанию | Серверные ссылки |
|---|---|---|
| access.create | access | unit_owner, renter | grants.ts:16; resident-lifecycle.ts:19; field.ts:34; field.ts:36; field.ts:37; notification-center.ts:45; insights.ts:20 |
| access.events | access | security | field.ts:39; field.ts:40; notification-center.ts:45 |
| access.validate | access | security | hayat.ts:25; field.ts:34; field.ts:38; insights.ts:20 |
| announcements.manage | community | manager | services.ts:8; services.ts:9; services.ts:10; services.ts:11 |
| announcements.read | community | manager, unit_owner, renter, family | grants.ts:16; resident-lifecycle.ts:19; services.ts:9; notification-center.ts:44 |
| assets.manage | maintenance | manager | maintenance.ts:72; maintenance.ts:85; maintenance.ts:99; services.ts:8; services.ts:13; services.ts:15 |
| assets.read | maintenance | manager, technician | core-operation-store.ts:41; core-operations.ts:107; core-operations.ts:126; maintenance.ts:110; services.ts:12 |
| audit.read | — | org_admin | platform-foundation.ts:130; api.ts:28; paged-records.ts:14 |
| billing.calculate | finance | accountant | billing-batches.ts:40; billing-batches.ts:43; billing-batches.ts:52; finance.ts:19; finance.ts:20; finance.ts:21; finance.ts:22 |
| billing.own | finance | unit_owner, renter | finance.ts:27; api.ts:27; bank-reconciliation.ts:138; notification-center.ts:31; notification-center.ts:41; insights.ts:21 |
| billing.publish | finance | accountant | billing-batches.ts:52; finance.ts:23; finance.ts:25; typed-import-strategies.ts:16; typed-imports.ts:15 |
| billing.read | finance | portfolio_owner, manager, accountant | billing-batches.ts:41; finance.ts:18; finance.ts:27; finance.ts:30; api.ts:27; reporting.ts:10; notification-center.ts:31; notification-center.ts:41 |
| defects.accept | handover | developer | field.ts:18 |
| defects.assigned | handover | contractor | hayat.ts:25; field.ts:9; insights.ts:18 |
| defects.execute | handover | contractor | field.ts:18 |
| defects.manage | handover | developer | field.ts:11; field.ts:12 |
| defects.read | handover | developer | field.ts:9; insights.ts:18 |
| documents.manage | documents | org_admin, manager | document-versions.ts:22; document-versions.ts:30; document-versions.ts:35; documents.ts:13; documents.ts:17; governance.ts:43; support-conversation.ts:29 |
| documents.read | documents | org_admin, manager, unit_owner, renter, family | document-versions.ts:21; document-versions.ts:28; documents.ts:13; governance.ts:39; support-conversation.ts:24 |
| expenses.approve | finance | portfolio_owner | services.ts:30 |
| expenses.manage | finance | manager, accountant | reporting.ts:9; services.ts:29; portfolio-analytics.ts:91 |
| expenses.read | finance | portfolio_owner, manager, accountant | reporting.ts:8; services.ts:8; services.ts:28; portfolio-analytics.ts:10; portfolio-analytics.ts:87 |
| handover.manage | handover | developer | lifecycle.ts:11; lifecycle.ts:12; lifecycle.ts:13; lifecycle.ts:14; lifecycle.ts:15 |
| handover.read | handover | developer | lifecycle.ts:10; insights.ts:19 |
| imports.finance | finance | accountant | typed-import-strategies.ts:17; typed-imports.ts:12; services.ts:8 |
| imports.manage | — | org_admin | imports.ts:13; imports.ts:14; imports.ts:15; imports.ts:16; grants.ts:13; typed-import-strategies.ts:17; typed-imports.ts:12; typed-imports.ts:28 |
| incidents.create | access | org_admin, manager, dispatcher, security | operation-incidents.ts:20 |
| incidents.manage | access | org_admin, manager, dispatcher, security | operation-incidents.ts:31; photos.ts:36 |
| incidents.read | access | org_admin, manager, dispatcher, security | operation-incidents.ts:10 |
| leads.read | — | platform_admin | leads.ts:21 |
| leases.manage | finance | manager | resident-lifecycle.ts:64; lifecycle.ts:8; lifecycle.ts:9 |
| leases.own | finance | unit_owner, renter | lifecycle.ts:7; notification-center.ts:46 |
| leases.read | finance | portfolio_owner, manager | lifecycle.ts:7; notification-center.ts:46 |
| meetings.manage | community | manager | services.ts:8; services.ts:26; governance.ts:26; governance.ts:34; governance.ts:36; governance.ts:38; governance.ts:49; governance.ts:63 |
| meetings.read | community | manager, unit_owner | services.ts:20; governance.ts:22; governance.ts:26; governance.ts:32; notification-center.ts:43; notification-center.ts:75 |
| meetings.vote | community | unit_owner | services.ts:22; services.ts:27; governance.ts:97 |
| meters.manage | meters | manager | services.ts:8; services.ts:16; services.ts:18 |
| meters.own | meters | unit_owner, renter | services.ts:16 |
| modules.manage | — | org_admin | api.ts:26 |
| modules.read | — | org_admin | api.ts:15; api.ts:25 |
| onboarding.manage | — | platform_admin, support | reporting.ts:11; reporting.ts:12; reporting.ts:13; organization-console.ts:10; onboarding-workflow.ts:26; onboarding-workflow.ts:35; onboarding-workflow.ts:41; onboarding-workflow.ts:53 |
| organization.settings | — | org_admin | reporting.ts:22; reporting.ts:23; branding.ts:15; branding.ts:18; notification-center.ts:37; notification-center.ts:68; mfa-policy.ts:27 |
| organizations.manage | — | platform_admin | api.ts:17; api.ts:44; platform-ops-shared.ts:6; organization-console.ts:32; organization-console.ts:39; support-conversation.ts:13; mfa-policy.ts:26 |
| organizations.read | — | platform_admin | api.ts:15; api.ts:16; reporting.ts:11; organization-console.ts:16; insights.ts:9; insights.ts:12; paged-records.ts:10 |
| ownership.manage | — | org_admin, manager | ownership.ts:20; ownership.ts:26; ownership.ts:44 |
| ownership.read | — | org_admin, portfolio_owner, manager, unit_owner | ownership.ts:10 |
| payments.reconcile | finance | accountant | finance.ts:24; bank-reconciliation.ts:41; bank-reconciliation.ts:42; bank-reconciliation.ts:44; bank-reconciliation.ts:55; bank-reconciliation.ts:66; bank-reconciliation.ts:70; bank-reconciliation.ts:110 |
| people.invite | — | org_admin | platform-foundation.ts:159; platform-foundation.ts:174; api.ts:29; api.ts:30; api.ts:33; insights.ts:15; paged-records.ts:18 |
| people.read | — | org_admin, manager | api.ts:15; api.ts:23; insights.ts:10; paged-records.ts:25 |
| platform.audit | — | platform_admin | platform-foundation.ts:129; platform-foundation.ts:130; api.ts:28; paged-records.ts:14 |
| platform.invite | — | platform_admin | platform-foundation.ts:158; platform-foundation.ts:159; platform-foundation.ts:173; platform-foundation.ts:174; api.ts:29; api.ts:30; api.ts:32; api.ts:33 |
| properties.manage | — | org_admin | api.ts:19; api.ts:22; reporting.ts:24; portfolio-objects.ts:8 |
| properties.own | — | unit_owner, renter, family | grants.ts:16; resident-lifecycle.ts:19; api.ts:15; api.ts:18; api.ts:20; api.ts:21; insights.ts:11; paged-records.ts:29 |
| properties.read | — | org_admin, portfolio_owner, developer, manager, accountant, dispatcher | grants.ts:13; api.ts:15; api.ts:18; api.ts:20; api.ts:21; portfolio-objects.ts:8; insights.ts:11; paged-records.ts:29 |
| reports.export | — | portfolio_owner, manager, accountant | reporting.ts:10 |
| reports.read | — | portfolio_owner | portfolio-analytics.ts:10 |
| requests.assign | requests | manager, dispatcher | core-operation-store.ts:33; core-operation-store.ts:35; core-operations.ts:36; core-operations.ts:50; core-operations.ts:53; core-operations.ts:70; core-operations.ts:71; workflow.ts:23 |
| requests.configure | requests | org_admin, manager | core-operations.ts:10; core-operations.ts:13; core-operations.ts:17; core-operations.ts:22 |
| requests.create | requests | unit_owner, renter, family | grants.ts:16; core-operation-store.ts:35; core-operations.ts:10; resident-lifecycle.ts:19; resident-lifecycle.ts:21 |
| requests.own | requests | unit_owner, renter, family | grants.ts:16; core-operations.ts:10; core-operations.ts:70; core-operations.ts:71; core-operations.ts:123; workflow.ts:11; workflow.ts:18; workflow.ts:22 |
| requests.read | requests | manager, dispatcher | grants.ts:13; hayat.ts:25; core-operations.ts:10; core-operations.ts:111; core-operations.ts:123; workflow.ts:11; workflow.ts:18; notification-links.ts:9 |
| residents.delegate | — | unit_owner | grants.ts:15; grants.ts:16; grants.ts:17; resident-lifecycle.ts:17; resident-lifecycle.ts:32; resident-lifecycle.ts:46; resident-lifecycle.ts:62 |
| roles.assign | — | org_admin | api.ts:24; typed-import-strategies.ts:16 |
| subscriptions.manage | — | platform_admin | platform-foundation.ts:22; platform-foundation.ts:34; platform-foundation.ts:42; platform-foundation.ts:59; platform-foundation.ts:75; platform-foundation.ts:99; platform-foundation.ts:104; platform-foundation.ts:115 |
| support.access.approve | — | org_admin | grants.ts:12; grants.ts:14; access.ts:31 |
| support.access.request | — | support | grants.ts:11; grants.ts:12; grants.ts:13; insights.ts:13 |
| support.assign | — | platform_admin | platform-ops-shared.ts:8; organization-console.ts:10; support-conversation.ts:13 |
| support.cases | — | platform_admin, support | platform-ops-shared.ts:7; lifecycle.ts:19; lifecycle.ts:21; support-conversation.ts:13; notification-center.ts:36; insights.ts:12 |
| support.cases.create | — | org_admin | lifecycle.ts:19; lifecycle.ts:20; support-conversation.ts:13; support-conversation.ts:66; notification-center.ts:36; access.ts:31 |
| support.queue | — | support | Нет прямого упоминания вне каталога — проверить динамическое использование |
| workorders.accept | requests | manager | workflow.ts:29; workflow.ts:38; portfolio-analytics.ts:10 |
| workorders.assigned | requests | technician | hayat.ts:25; core-operations.ts:10; core-operations.ts:123; workflow.ts:11; workflow.ts:18; notification-links.ts:11; notification-center.ts:40; insights.ts:17 |
| workorders.execute | requests | technician | core-operation-store.ts:35; core-operations.ts:50; core-operations.ts:70; core-operations.ts:71; core-operations.ts:98; workflow.ts:29; workflow.ts:37 |

## Особые условия

- Таблица содержит базовые роли, не эффективный доступ конкретного пользователя.
- У temporary support и owner-delegated family effective permissions могут отличаться от базового каталога.
- Owner delegation может отдельно разрешать access.create, хотя его нет в стандартном family; documents.read не входит в этот owner delegation allowlist.
- organizationDelegableRoles допускает назначение существующих tenant-ролей; это не allowlist любых произвольных permissions.
- Org admin не получает финансовые рабочие права от возможности назначить accountant.
- reports.export не привязан к модулю через moduleForPermission: дополнительные endpoint-проверки проверяются отдельно.
- Слово read в имени права не заменяет organization/building/unit/payer/assignee проверки.
- Системные роли остаются неизменяемыми при реализации custom profiles.

## Примеры из промпта не являются готовыми permission keys

finance.read, requests.verify, access.read, access.manage нельзя механически добавлять вместо текущих прав. Сейчас используются billing.read, workorders.accept, access.validate/access.events/access.create. Новый key допустим только вместе с серверным значением и тестами.

## Приёмка будущей permission matrix

Проверить разрешение базового типа и delegation allowlist, module entitlement, subscription mutation policy, scope конкретного объекта, assignment/account status, deny override, MFA/fresh-auth. Проверять также прямой API-вызов в обход меню.
