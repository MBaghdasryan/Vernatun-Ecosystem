# Vernatun — сверка с активной спецификацией

Текущие дополнения: [Phase 2](PHASE2-COMPLETION.md) и [Phase 3](PHASE3-COMPLETION.md). Phase 3 закрывает backend/UI maintenance → WorkOrder, делегирование, визиты, notification links и lease policy. 91 core-проверка и финальные 7 проверок Phase 3 прошли. Signed-in ImTun + browser-only fixtures проверены; manager UI acceptance заблокирован 401 сохранённых credentials. Phases 4–8 и реальная email delivery не объявлены завершёнными. Ниже — историческая baseline-сверка.

Дата: 6 октября 2026 года.

**Это промежуточный аудит и отчёт о первых исправлениях, не объявление о завершении всех фаз и не сертификат production readiness.**

Актуальный подробный срез: `VERNATUN-COMPLETION-REPORT.md`; email — `RESEND-WEBHOOK.md`. HAYAT offline и invitation delivery объединены. Webhook расширен до шести событий, общего token-free журнала и Console Email. Основной regression прошёл 76/76, финальное уточнение email/Phase 1 — 35/35; суммарное актуальное покрытие suites — 77 checks. Workspace/API types и codegen прошли. Проверенная migration 015 применена только к development. Домен ещё не готов по сообщению пользователя; реальные письма не отправляются, live verification не выполнена. Target `https://vernatun.io/api/webhooks/resend` не выдаётся за активную публикацию.

Активный текст задания сохранён без изменений в `VERNATUN-PLATFORM-SPECIFICATION.md`. Все 15 приложенных изображений просмотрены как ориентиры состава экранов. Показанные на них суммы, даты, имена, графики и статусы интеграций не переносятся в рабочие данные.

Email Console browser QA: admin reached `/console/email`, реальный health и пустой список, корректные filter/pagination GET, guest 401, org-admin hidden nav; desktop1280/phone390 без page overflow. Detail/timeline отображение отдельно проверено временными browser-only fixtures, затем восстановлены реальные GET. Main business data и письма ради этой проверки не создавались; никакое mock evidence не считается live доставкой.

## Архитектура и ограничения

- Сохранены React/Vite/TypeScript, Express, Passport/session, PostgreSQL, текущие SQL migrations и общий Workflow.
- Рабочая бизнес-архитектура находится в `artifacts/api-server/archive/vernatun/server`, а не в пустой шаблонной Drizzle-схеме. Нельзя заменять восстановленную базу шаблоном.
- Web, API и Canvas имеют отдельные managed workflows; API запускается с выделенным `PORT`, Web использует прокси `/api`.
- Общая сессия и серверный активный контекст остаются единственным источником полномочий.
- HAYAT и ImTun остаются адаптивными веб-модулями. Expo/native/store builds не входят в текущую спецификацию.
- После разрешения пользователя применена добавочная миграция 013. До неё создана резервная копия с манифестом; существующие записи и значения проверены до/после. Основные аккаунты не создавались, основной demo seed не запускался. Тестовые записи создавались только в изолированной схеме.
- Пользователь разрешил расширение схемы после изолированной проверки. Это разрешение не является разрешением на удаление данных, перезапись файлов или публикацию.

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
| 20: invitations/email | Реализованы scoped list/create/revoke/resend, новый токен, delivery status и общий EmailProvider с Resend/SMTP/outbox. Выбран Resend и сохранён EMAIL_FROM; live setup заблокирован отказом ключа, подтверждение домена не проверено. Доставка в mailbox не подтверждена | `email.ts`, `email-providers/*`, `invitation-delivery.ts`, `InvitationConsole.tsx` |
| 21: reset password | Есть hash/expiry/one-time/rate limit/revocation; production сейчас явно блокируется без delivery provider | `auth.ts`, `/auth/forgot-password`, `/auth/reset-password` |
| 22–23: plan/subscription/modules | Реализованы allowed modules, состояния, grace/read-only, building cap, причины overrides и Console UI. Старые организации сохраняют legacy policy до явного подключения подписки; платежный gateway не симулируется | `subscription-policy.ts`, `platform-foundation.ts`, `SubscriptionConsole.tsx`, migration013 |
| 24: Console audit | Реализованы organization events, structured details, server-side filters/sort/pagination и responsive Console UI | `platform-foundation.ts`, `AuditConsole.tsx` |
| 25: immutable audit | UPDATE/DELETE/TRUNCATE защищены DB trigger; регрессия проверена в изоляции. Это не защита от владельца БД, сознательно отключающего trigger | migration013, `phase1.test.ts` |
| 26–27: support conversation/queue | Частично: single reply, assignment, базовые статусы; нет полной messages/attachments/SLA queue модели | `/support-cases`, `lifecycle.ts` |
| 28: временный доступ поддержки | Реализованы permission-based start route, imports checkbox, expiry/revoke guards и atomic deduplicated expiry audit при разрешении контекста/минутным job | shared/products, `access.ts`, `platform-jobs.ts`, migration013 |
| 29: onboarding | Частично: assignee/due/completion; dependencies/order/start/reopen/notes требуют расширения | `reporting.ts`, `/onboarding` |
| 30: imports | Есть units CSV/XLSX preview/validation/atomic confirm; нет остальных typed strategies и полного табличного preview | `imports.ts`, `Community.tsx` |
| 31: mass billing | Частично: единичные calculate/publish/adjustments; нет building batch preview/publish | `finance.ts`, `Business.tsx` |
| 32: bank reconciliation | Частично: payments/allocations tables и single-invoice manual/sandbox flow; нет bank transaction import и multi-invoice/credit UI | `/finance/payments`, `finance.ts` |
| 33–34: portfolio analytics/scorecard | Частично: scoped KPI и базовые показатели; нет полного набора агрегатов, фильтров и scorecard | `insights.ts`, `reporting.ts`, `Insights.tsx` |
| 35: document versioning | Частично: защищённые файлы/visibility есть; нет полного version chain | `documents.ts`, `documents` |
| 36: storage abstraction | Текущий защищённый App Storage уже работает — сохраняется вместо замены на Local/S3. Перенос байтов не выполнялся | `private-files.ts`, storage/backup tests |
| 37–38: notifications/preferences | Частично: notifications и mark read; нет всего event catalog/email preferences/category settings | `services.ts`, `/notifications` |
| 39: white label | Частично: базовый branding, original assets, tenant color; не полный org branding API/UI | `OrganizationSettings.tsx`, HAYAT/ImTun config |
| 40: limited PWA/offline | Частично: HAYAT offline реально объединён; IndexedDB drafts/files, публичная shell cache, явная sync и server receipts/context/version guards есть. Полный PWA/device acceptance не завершён | `OfflineWork.tsx`, `offline-store.ts`, `offline-shell.ts`, `offline.test.ts` |
| 41: 14 dashboards | Частично: 14 roles/routes, scoped insights и HAYAT queues есть; не все блоки референсов имеют готовые процессы/агрегаты | `insights.ts`, `hayat.ts`, 3 оболочки |
| 42: server pagination/filter/sort | Частично: HAYAT queue и новый audit server-side; общие Records/DataTable ещё client-side | `hayat.ts`, `platform-foundation.ts`, `Portal.tsx` |
| 43: security | Guards и subscription read-only реализованы/проверены; отсутствующие новые процессы и production acceptance ещё требуют завершения | `security.test.ts`, `phase1.test.ts`, `access.ts`, все routers |
| 44: MFA policy | Есть TOTP/recovery/rate limiting; нет configurable required policy/rollout | `mfa.ts`, `Mfa.tsx` |
| 45–46: HY/RU/EN, AMD, timezone | Есть базовые настройки и translations; новые экраны потребуют string/timezone scan | i18n-файлы, organization settings |
| 47–48: responsive/a11y | Частично: текущие адаптивные оболочки есть; все роли на всех 5 ширинах и accessibility acceptance ещё не проверены | portal/hayat/imtun CSS, dialogs |
| 49–50: tests / scenarios A–H | Текущие core suites проходят; новые отсутствующие сценарии нельзя назвать проверенными | `server/tests/*` |
| 51: no fake success | Сохраняется явное not configured/local/sandbox; статус dashboard integration metadata нужно сверить, часть старых подписей устарела | `api.ts`, public demo dialog |
| 52–53: migrations/demo | Сохранены 001–012, добавлена и проверена 013; main seed не запускался, исходные записи сохранены | migrations, `migrate.ts`, private preflight metadata |
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

## Дальнейшие модели в пределах согласованной спецификации

Subscription entitlement/lifecycle и audit immutability реализованы добавочной migration013. Дальнейшие numbered additive migrations нужны для categories/SLA/visits/incidents, recurring maintenance и расширенных support/onboarding/finance/meeting/document/branding моделей.

Старые migrations, существующие записи, роли, passwords и private bytes не заменяются. Перед применением к основной базе новые миграции должны пройти isolated regression tests. Разрешение на изменение schema проекта не является разрешением на production publish, destructive restore или автоматическое заполнение demo users.

## 6 октября — согласованная серверная основа первой фазы

- Миграция `013_platform_foundation.sql` сначала применена только в случайной изолированной схеме, затем в базе проекта. До основного применения создан парный snapshot SQL + файлового манифеста: 66 таблиц, 0 зарегистрированных private file references. Это не обещание восстановления отсутствующих в источнике файлов.
- Проверка до/после миграции: сохранены все прежние строки и все не-добавочные значения в организациях, пользователях, назначениях ролей, зданиях, помещениях, счетах, платежах, планах/подписках, приглашениях и support grants. В базе проекта осталось 2 организации, 15 пользователей, 16 назначений ролей, 2 здания, 3 помещения и 3 счёта.
- Audit append-only: UPDATE/DELETE/TRUNCATE блокируются database trigger, включая операции в transaction. Структурированные детали и серверная пагинация/фильтры доступны через новый Audit Console.
- Подписки: trial/active/past_due/suspended/cancelled/expired; причины обязательны для изменений. Перекрытие контрактов запрещено как при создании, так и при возобновлении. Явный `graceUntil:null` удаляет льготный срок, а не создаёт новый.
- Policy: до явного подключения подписки/политики восстановленные организации работают по прежним правилам. При включённой политике trial/active и past_due внутри действующего контракта с неистёкшим grace разрешают изменения; после grace, при suspended/cancelled/expired/no subscription/not_started включается режим только чтения. Права роли и unit/building scope всё равно проверяются на каждом запросе. Данные и исторические финансовые строки не удаляются.
- Модули определяются планом и явно аудируемыми overrides; organization admin не может включить отсутствующий в плане модуль. Override не снимает ограничения read-only. Лимит зданий проверяется при создании, редактировании плана и возобновлении подписки.
- Истечение support access фиксируется атомарно и один раз; проверяется на разрешении контекста и минутным job. Выдача новых прав и чтение чужих финансов по этому пути невозможны.
- Invitation Console: создание по существующей серверной role policy, scoped building/unit, повторная отправка и отзыв, статусы принятия/истечения/отзыва и доставки. Delegation invite нельзя перевыпускать обычной административной resend-ручкой.
- Email: dev/test private outbox; SMTP с TLS и timeout, отказ в production при отсутствии настройки/credentials. Канонический секрет из промпта — SMTP_PASS; SMTP_PASSWORD поддержан как совместимый alias. SMTP accepted означает принятие сервером, а не доставку в mailbox. Production URL/живой токен не возвращается в API; токены не попадают в audit. Password reset использует ту же доставку, нейтральное подтверждение запроса и single-use token/session revocation. При неудаче SMTP reset-токен инвалидируется; текст ответа не раскрывает наличие адреса в базе.
- Console даты и datetime-local преобразуются через Asia/Yerevan, а не через timezone браузера; запоздавшие ответы не подменяют выбранную организацию/фильтры. Контексты имеют отдельные экземпляры Console state.
- Проверки: полный core run 50/50; после последнего усиления transitions/grace — Phase 1 11/11. Это 51 проверенный distinct core case по этим прогонам, НЕ повторный полный storage/backup drill. Frontend/backend TypeScript и production Web build прошли. Старый отчёт 44/44 выше относится к предшествующему блоку.
- Managed API и Web workflow перезапущены после согласованного batch; старт чистый. Production deployment не выполнялся.
- Browser QA новых защищённых Console экранов прошёл на 1440px и 390px: реальные GET/form controls, две существующие организации, legacy policy, восемь модулей, audit filters/sort/reset/page2, быстрый выбор разных организаций и round-trip Asia/Yerevan. Таблицы прокручиваются внутри контейнеров, документ не выходит за экран. Main business mutations при QA не выполнялись; проверка сохранений выполнена в изолированной схеме. Runtime/500 ошибок не обнаружено; первоначальный dev Fast Refresh notice не мешал загрузке.

**Весь исходный платформенный промпт ещё не завершён.** Расширенная диспетчерская работа/SLA, материалы и выезды, генерация recurring maintenance, пакетные начисления и bank reconciliation, расширенный onboarding/import/support, доли/quorum/versioning, notification/preferences, required-MFA rollout и завершающая production-проверка остаются в дальнейших фазах согласно матрице выше. SMTP требует реальной конфигурации и отдельной проверки доставки; его наличие в исходниках не считается подключённым почтовым сервисом.

## 6 октября — подключение Resend без привязки бизнес-логики

- По требованию пользователя общий `EmailProvider` реализован отдельными `ResendEmailProvider`, `SMTPEmailProvider` и `DevelopmentOutboxProvider`. Выбор через registry/settings; invitation/reset/delegation callers не переписаны под Resend. SMTP receipt сохранён для совместимости.
- Resend использует server-only Replit Connectors SDK, без отдельного API-ключа в исходниках/Secrets приложения. `MAIL_PROVIDER=resend` выбран явно; для sender общий `EMAIL_FROM`, совместимый fallback `SMTP_FROM`.
- API receipt проверяется, ошибки и malformed success не выдаются за отправку. Идемпотентность привязана к содержимому: обновление токена не возвращает старое письмо. Токен/URL не возвращается для реального provider; audit содержит provider name, не email body/ключ.
- Test mode всегда приватный local outbox. Resend/SMTP unit transports подменены, реальные письма при QA не отправлялись. Production outbox запрещён; неисправный provider не подменяется автоматически другим.
- **Current core run: 59/59**, включая 8 новых adapter tests; frontend/backend types и Web build прошли. Основная схема не менялась, main seed не запускался.
- Read-only `/domains` через подключённую интеграцию и SDK вернул 400 `validation_error`: «API key is invalid». Credential recovery определил API-key connection, не OAuth. Требуется обновить ключ в существующем подключении, затем выбрать подтверждённый `EMAIL_FROM`; live delivery/acceptance/reset не проверены.
- Асинхронные delivered/bounced/complained события пока не отслеживаются. Invitation «sent» означает принятие сервисом, не доказательство доставки во входящие.
- После сохранения пользователем `EMAIL_FROM`: sender настроен в shared environment, но повторный read-only `/domains` всё ещё вернул `API key is invalid`. Отправитель больше не является отсутствующей настройкой; остаются исправление ключа, проверка домена и согласованный live delivery test.
