# Vernatun — сверка с активной спецификацией

Дата: 6 октября 2026 года.

**Это промежуточный аудит и отчёт о первых исправлениях, не объявление о завершении всех фаз и не сертификат production readiness.**

Активный текст задания сохранён без изменений в `VERNATUN-PLATFORM-SPECIFICATION.md`. Все 15 приложенных изображений просмотрены как ориентиры состава экранов. Показанные на них суммы, даты, имена, графики и статусы интеграций не переносятся в рабочие данные.

## Архитектура и ограничения

- Сохранены React/Vite/TypeScript, Express, Passport/session, PostgreSQL, текущие SQL migrations и общий Workflow.
- Рабочая бизнес-архитектура находится в `artifacts/api-server/archive/vernatun/server`, а не в пустой шаблонной Drizzle-схеме. Нельзя заменять восстановленную базу шаблоном.
- Web, API и Canvas имеют отдельные managed workflows; API запускается с выделенным `PORT`, Web использует прокси `/api`.
- Общая сессия и серверный активный контекст остаются единственным источником полномочий.
- HAYAT и ImTun остаются адаптивными веб-модулями. Expo/native/store builds не входят в текущую спецификацию.
- В этом блоке не менялась схема основной базы, не создавались основные аккаунты и не запускался основной demo seed. Тестовые записи создавались только в изолированной базе/случайной тестовой схеме.
- До применения новых миграций к основной базе требуется согласование, как оговорено ранее.

## Логотипы по продукту и типу пользователя

| Продукт | Типы пользователей | Правило бренда |
|---|---|---|
| Vernatun Console | platform_admin, support | Vernatun Console; не HAYAT/ImTun |
| Vernatun OS | org_admin, portfolio_owner, developer, accountant | Vernatun OS |
| HAYAT by Vernatun | manager, dispatcher, technician, contractor, security | Существующий оригинальный HAYAT |
| ImTun by Vernatun | unit_owner, renter, family | Существующий оригинальный ImTun |

Manager может входить в OS только при уже предусмотренном разрешении. Это переключение поверхности, а не объединение прав. Временный support context выбирает рабочий раздел по фактическим разрешениям.

На референсах часто показан общий Vernatun даже для техника и жильца. При реализации приоритет имеет распределение продуктов из промпта, а не этот общий логотип. В текущем блоке оригинальные логотипы, HAYAT/ImTun CSS и тексты, landing не заменялись.

## Матрица требований

Статусы: **Есть** — текущая реализация обнаружена; **Частично** — базовый механизм есть, но требования шире; **Нет** — соответствующая реализация не обнаружена; **Исправлено** — конкретная найденная ошибка устранена в этом блоке; **Не проверено полностью** — необходим отдельный runtime/внешний прогон.

Пути серверов в таблице относительны `artifacts/api-server/archive/vernatun/server`. UI — `artifacts/vernatun/src`.

| Раздел спецификации | Статус и текущая граница | Файлы / API |
|---|---|---|
| 0–5: preserve, архитектура, стек, web-only, аудит, HAYAT | Есть; сохранение проверено текущими core API тестами; полный production audit не завершён | `app.ts`, `auth.ts`, `access.ts`, shared/products, `hayat/*` |
| 6.1: телефонная заявка диспетчера | Нет полного flow от имени жителя/на помещение | `workflow.ts`, `POST /requests`, `portal/Workflow.tsx` |
| 6.2–6.5: категории, 5 приоритетов, SLA, escalation | Нет полной configurable модели и idempotent фонового процесса | `resident_requests`, `hayat.ts`, `workflow.ts` |
| 6.6: согласование и история визита | Нет полной модели proposed/confirmed/reschedule/cancel | `workflow.ts`, общий Workflow |
| 6.7: техник | Частично: назначение, статус, checklist, отчёт, защищённые фото есть; отдельные accept/cannot perform/pause/resume/materials/photo types не завершены | `work_orders`, `work_reports`, `file_attachments`, `/requests/:id/transition` |
| 6.8: equipment QR | Есть оборудование; сканер/полная история и запуск работы по QR не подтверждены | `services.ts`, `/assets` |
| 7: recurring maintenance → work order | Частично: plans и отметка выполнения; не полноценная генерация событий и работ | `/maintenance`, `/maintenance/:id/complete` |
| 8: охрана/incidents | Частично: пропуска, вход/выход, создание incidents; нет полного severity/status/timeline/attachments процесса | `field.ts`, `/passes/*`, `/incidents` |
| 9: realtime/intelligent refresh | Нет полноценного общего SSE или visibility-aware polling | `hayat/HayatApp.tsx`, общие компоненты |
| 10: сохранить ImTun | Есть; текущие tests проверяют роли и финансовую изоляцию | `imtun/*`, `imtun.test.ts` |
| 11–12: новые поля заявки жильца, visit approval | Нет полного процесса | общий Workflow |
| 13: notification deep links / context confirmation | Нет полного безопасного cross-context процесса | `Community.tsx`, `/notifications` |
| 14: семейное делегирование | Частично: отдельный assignment, выбранные права, принятие, отзыв и истечение есть; resend/expiration UI/recent auth/SMTP не завершены | `grants.ts`, `auth.ts`, `/delegations` |
| 15: lease → access lifecycle | Частично: срок назначения защищает доступ; lease не является центральным автоматическим источником lifecycle | `leases`, `role_assignments`, `access.ts`, `lifecycle.ts` |
| 16: ownership shares | Частично: ownership rows и запись; история/полный UI/проверка суммарной активной доли требуют завершения | `reporting.ts`, `/ownerships` |
| 17: полноценные собрания | Частично: meetings/agenda/votes и один голос владельца есть; weighted shares/quorum/protocol lifecycle не завершены | `services.ts`, `Community.tsx` |
| 18: объект/дом/подъезд/этаж/помещение | Частично: таблицы entrances/floors есть; полного управления и объединённой карточки помещения нет | `api.ts`, `011_reporting.sql`, `Records` |
| 19: карточка и lifecycle организации | Частично: организация/settings/brand_color; нет полной карточки active/suspended/archived с указанными связями | `/organizations`, `/organization-settings` |
| 20: invitations/email | Частично; **исправлены platform list/revoke и UI navigation**. SMTP, resend, provider abstraction ещё отсутствуют | `/invitations`, `api.ts`, `Portal.tsx` |
| 21: reset password | Есть hash/expiry/one-time/rate limit/revocation; production сейчас явно блокируется без delivery provider | `auth.ts`, `/auth/forgot-password`, `/auth/reset-password` |
| 22–23: plan/subscription/modules | Частично: отдельные планы, active/paused subscriptions и enabled modules; отсутствуют allowed modules, lifecycle и effective override policy | `lifecycle.ts`, `access.ts`, `/subscriptions`, `/modules` |
| 24: Console audit | **Исправлено** включение organization events и UI structured details; остальные фильтры и server pagination ещё не завершены | `/audit`, `api.ts`, `Portal.tsx` |
| 25: immutable audit | Нет DB append-only защиты audit_events; request_history защищена, это не эквивалент | `005_history_immutable.sql`, `audit_events` |
| 26–27: support conversation/queue | Частично: single reply, assignment, базовые статусы; нет полной messages/attachments/SLA queue модели | `/support-cases`, `lifecycle.ts` |
| 28: временный доступ поддержки | **Исправлено** permission-based start route и imports checkbox; expiry/revoke серверные guards есть. Deduplicated expiry audit ещё отсутствует | shared/products, `access.ts`, `Business.tsx`, `grants.ts` |
| 29: onboarding | Частично: assignee/due/completion; dependencies/order/start/reopen/notes требуют расширения | `reporting.ts`, `/onboarding` |
| 30: imports | Есть units CSV/XLSX preview/validation/atomic confirm; нет остальных typed strategies и полного табличного preview | `imports.ts`, `Community.tsx` |
| 31: mass billing | Частично: единичные calculate/publish/adjustments; нет building batch preview/publish | `finance.ts`, `Business.tsx` |
| 32: bank reconciliation | Частично: payments/allocations tables и single-invoice manual/sandbox flow; нет bank transaction import и multi-invoice/credit UI | `/finance/payments`, `finance.ts` |
| 33–34: portfolio analytics/scorecard | Частично: scoped KPI и базовые показатели; нет полного набора агрегатов, фильтров и scorecard | `insights.ts`, `reporting.ts`, `Insights.tsx` |
| 35: document versioning | Частично: защищённые файлы/visibility есть; нет полного version chain | `documents.ts`, `documents` |
| 36: storage abstraction | Текущий защищённый App Storage уже работает — сохраняется вместо замены на Local/S3. Перенос байтов не выполнялся | `private-files.ts`, storage/backup tests |
| 37–38: notifications/preferences | Частично: notifications и mark read; нет всего event catalog/email preferences/category settings | `services.ts`, `/notifications` |
| 39: white label | Частично: базовый branding, original assets, tenant color; не полный org branding API/UI | `OrganizationSettings.tsx`, HAYAT/ImTun config |
| 40: limited PWA/offline | Частично: в проверенном основном Workflow есть local draft; полноценный PWA/static fallback отсутствует. Отдельный offline результат нельзя считать активным только по статусу задачи без сверки main-кода | `Workflow.tsx` |
| 41: 14 dashboards | Частично: 14 roles/routes, scoped insights и HAYAT queues есть; не все блоки референсов имеют готовые процессы/агрегаты | `insights.ts`, `hayat.ts`, 3 оболочки |
| 42: server pagination/filter/sort | Частично: HAYAT queue server-side; общие Records/DataTable работают client-side, audit ограничен 100 | `hayat.ts`, `api.ts`, `Portal.tsx` |
| 43: security | Есть существенные guards и текущие проходящие API tests; cancelled subscription/новые процессы ещё требуют реализации и проверки | `security.test.ts`, `access.ts`, все routers |
| 44: MFA policy | Есть TOTP/recovery/rate limiting; нет configurable required policy/rollout | `mfa.ts`, `Mfa.tsx` |
| 45–46: HY/RU/EN, AMD, timezone | Есть базовые настройки и translations; новые экраны потребуют string/timezone scan | i18n-файлы, organization settings |
| 47–48: responsive/a11y | Частично: текущие адаптивные оболочки есть; все роли на всех 5 ширинах и accessibility acceptance ещё не проверены | portal/hayat/imtun CSS, dialogs |
| 49–50: tests / scenarios A–H | Текущие core suites проходят; новые отсутствующие сценарии нельзя назвать проверенными | `server/tests/*` |
| 51: no fake success | Сохраняется явное not configured/local/sandbox; статус dashboard integration metadata нужно сверить, часть старых подписей устарела | `api.ts`, public demo dialog |
| 52–53: migrations/demo | Сохранены 001–012; новых основных миграций/seed в этом блоке нет | migrations, `migrate.ts`, scripts |
| 54–55: deployment/observability | Есть managed workflows, `/api/health`, structured/request-id logging и safe error responses; опубликованный production в этом аудите не проверялся | wrapper app/logger, restored app, deployment settings |
| 56: backup/restore | Есть отдельный backup/recovery документ и isolated paired restore tooling; полного нового production drill в этом блоке нет | `artifacts/api-server/BACKUP-RECOVERY.md`, backup modules |
| 57: OpenAPI | Частично: архивный spec есть, обновлены описания изменённых API; полные input/output schemas ещё не покрывают весь backend | `server/openapi.json` |
| 58: landing/lead form | Landing сохранён; `/api/leads` отсутствует в обнаруженном router inventory, реальную серверную обработку формы ещё нужно завершить | `App.tsx`, общие public components |
| 59–67: scope/order/reports | Активный scope принят; фазы 2–8 не завершены, final acceptance report преждевременен | эта матрица, specification, changelog |

## Первые изменения PHASE 1

1. `GET /invitations` и `DELETE /invitations/:id` используют существующее `platform.invite` для платформенного пользователя и `people.invite` для ограниченного организационного контекста. Глобальное `people.invite` не выдавалось.
2. Отзыв приглашения и его audit event выполняются в одной transaction. Организационный пользователь по-прежнему не может отозвать чужое приглашение.
3. Платформенный `/audit` включает события организаций, возвращает structured details и resource identifiers. Tenant audit остаётся ограниченным организацией. UI показывает подробности безопасным React text rendering.
4. Раздел и кнопка создания invitations теперь доступны Console admin в соответствии с его платформенным правом.
5. Временный support context стартует на imports/requests/properties по эффективным permissions и modules. Ordinary support route сохранён. Navigation/switch/login используют эту логику.
6. В форме запроса поддержки добавлен `imports.manage` и локализованное отображение выбранного права.

Новые tests: `server/tests/phase1.test.ts`. Router copies Web/API синхронизированы.

## Фактически выполненные тесты после изменений

| Test suite | Passed | Failed |
|---|---:|---:|
| security | 19 | 0 |
| phase1 | 4 | 0 |
| hayat | 4 | 0 |
| imtun | 4 | 0 |
| workflow | 1 | 0 |
| business | 6 | 0 |
| services | 4 | 0 |
| lifecycle | 2 | 0 |
| **Core API total** | **44** | **0** |

TypeScript frontend/backend и Vite production build прошли.

Из archive каталога:

```sh
node --import tsx server/tests/run.ts --core-only
node --import tsx server/tests/run.ts --phase1-only
```

До изменений первый full run также завершил backup suite (2/2), но весь процесс был остановлен 300-секундным лимитом во время storage suite. Один storage check прошёл; suite целиком не завершилась, storage-inventory не прогонялся до конца этой цепочки. Это **не полный passing full run**. Runner-created схема была определена по точному совпадению случайных fixtures; только её файлы/схема очищены. Основная база не затронута.

Длительные remote storage/backup suites запускать отдельным background process с ожиданием завершения и cleanup, а не под общим пяти­минутным foreground лимитом.

## Browser QA текущего блока

Browser QA изменённых защищённых экранов Console прошёл на 1440px и 390px:

- Platform admin вошёл в уже существующий разрешённый контекст.
- `/console/invitations` открылся без 403; API вернул корректный пустой список. Invite dialog открылся с organization administrator ролью и существующими организациями, затем закрыт без отправки.
- `/console/audit` открылся без ошибки; API вернул 100 событий, включая 12 tenant-associated. Details раскрыты на desktop/mobile и показаны как текст.
- На этих двух экранах не обнаружен page-level horizontal overflow; мобильный audit использует карточки.
- Browser/API ошибок не обнаружено. Business records, preferences, permissions и приглашения не менялись ради браузерного прогона; обычный вход создаёт стандартное событие аудита сессии.

Исторический ImTun/HAYAT QA не записывается как новый прогон этой спецификации. Временный support grant проверен в изолированных API/router tests; на основной базе новый grant ради браузерного теста не создавался. Все 14 новых dashboard designs на всех ширинах пока не реализованы и не проверены.

## Следующий требующий согласования шаг

Новые numbered additive migrations для недостающих моделей: subscription entitlement/lifecycle, delivery infrastructure/immutability, categories/SLA/visits/incidents, recurring maintenance, расширенные support/onboarding/finance/meeting/document/branding модели.

Старые migrations, существующие записи, роли, passwords и private bytes не заменяются. Перед применением к основной базе новые миграции должны пройти isolated regression tests. Разрешение на изменение schema проекта не является разрешением на production publish, destructive restore или автоматическое заполнение demo users.
