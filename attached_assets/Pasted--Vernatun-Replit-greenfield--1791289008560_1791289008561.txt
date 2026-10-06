Ты работаешь с существующим проектом **Vernatun** в Replit.

Это уже не greenfield-проект.

В проекте существует рабочая архитектура и значительная часть бизнес-логики. Твоя задача — **не переписать систему**, не создавать параллельную вторую реализацию и не заменять работающие компоненты, а провести техническую сверку текущего репозитория и последовательно довести существующий Vernatun до production-ready состояния.

# 0. ГЛАВНЫЙ ПРИНЦИП

Работай по принципу:

**AUDIT → PRESERVE → FIX → COMPLETE → INTEGRATE → TEST → REPORT**

Не начинай с редизайна или массового refactoring.

Не удаляй работающие endpoints, роли, permissions, таблицы, существующие migrations или UI-компоненты только потому, что можно написать их красивее.

Приоритет:

1. безопасность и целостность данных;
2. работоспособность end-to-end сценариев;
3. завершённость бизнес-логики;
4. UX;
5. визуальный polish;
6. оптимизация.

---

# 1. ТЕКУЩАЯ ПРОДУКТОВАЯ АРХИТЕКТУРА

Vernatun состоит из четырёх продуктовых областей:

### Vernatun Console
Для:
- `platform_admin`
- `support`

Основные маршруты:
- `/console/overview`
- `/console/organizations`
- `/console/subscriptions`
- `/console/onboarding`
- `/console/support`
- `/console/support-cases`
- `/console/imports`
- `/console/audit`

### Vernatun OS
Для:
- `org_admin`
- `portfolio_owner`
- `developer`
- `accountant`

Основные стартовые маршруты:
- `/os/organization`
- `/os/portfolio`
- `/os/development`
- `/os/accounting`

### HAYAT by Vernatun
Для:
- `manager`
- `dispatcher`
- `technician`
- `contractor`
- `security`

Основные маршруты:
- `/hayat/management`
- `/hayat/dispatch`
- `/hayat/my-work`
- `/hayat/contractor`
- `/hayat/security`

### ImTun by Vernatun
Для:
- `unit_owner`
- `renter`
- `family`

Основные маршруты:
- `/imtun/owner`
- `/imtun/renter`
- `/imtun/family`

Также существуют глубокие маршруты ImTun:
- `/imtun/payments`
- `/imtun/requests`
- `/imtun/meters`
- `/imtun/announcements`
- `/imtun/documents`
- `/imtun/access`
- `/imtun/meetings`
- `/imtun/delegations`
- `/imtun/leases`
- `/imtun/notifications`
- `/imtun/settings`

Старые маршруты могут существовать только для backward compatibility.

Не создавай вторую независимую систему авторизации для HAYAT или ImTun.

---

# 2. СТЕК СОХРАНИТЬ

Существующий стек необходимо сохранить, если во время аудита не обнаружена технически критическая причина его менять:

- React
- Vite
- TypeScript
- Express
- Passport/session auth
- PostgreSQL
- существующая RBAC / permissions architecture
- существующие migrations
- существующий Workflow
- общая серверная база Vernatun

НЕ переписывать проект на:
- Next.js;
- NestJS;
- Firebase;
- Supabase;
- другую ORM/DB;
- новый auth provider

только ради modernisation.

---

# 3. НЕ СОЗДАВАТЬ СЕЙЧАС NATIVE APPS

В текущем цикле:

**НЕ создавай Expo / React Native / Android / iOS приложения.**

HAYAT и ImTun сейчас являются adaptive web applications внутри Vernatun.

Сначала необходимо завершить общую SaaS-платформу.

Архитектуру необходимо оставить пригодной для будущего подключения native HAYAT/ImTun, но этот prompt не включает их разработку.

---

# 4. ПЕРВЫЙ ШАГ — ОБЯЗАТЕЛЬНЫЙ AUDIT

До изменения кода изучи текущий проект полностью.

Проверь минимум:

- `package.json`
- frontend entrypoints
- backend entrypoints
- routing
- auth
- sessions
- CSRF
- RBAC
- roles
- permissions
- context switching
- migrations
- schema
- API
- OpenAPI
- tests
- deployment configuration
- environment variables
- Replit workflows
- storage
- email/outbox
- notifications
- finance
- subscriptions
- imports
- support
- HAYAT
- ImTun
- Console
- OS

Особенно проверь:

- `src/hayat/*`
- `src/imtun/*`
- `src/portal/*`
- `server/access.ts`
- `server/auth.ts`
- `server/hayat.ts`
- `server/workflow.ts`
- `server/finance.ts`
- `server/services.ts`
- `server/lifecycle.ts`
- `server/imports.ts`
- `server/grants.ts`
- `server/reporting.ts`
- `server/insights.ts`
- notification code
- photo/document storage
- existing migrations
- API tests

Сначала составь внутреннюю таблицу:

| Requirement | Already implemented | Partial | Missing | Broken | Files/API involved |

Не переделывай функциональность, которая уже реализована корректно.

---

# 5. СОХРАНИТЬ ВОССТАНОВЛЕННЫЙ HAYAT

HAYAT уже восстановлен.

Сохранить:

- `src/hayat/HayatApp.tsx`
- HAYAT CSS
- HAYAT HY/RU/EN translations
- HAYAT config
- существующий branding
- role-aware navigation
- desktop/mobile navigation
- dispatcher queue
- table/kanban
- `/api/hayat/queue`
- server-side search
- filters
- pagination
- queue statistics
- `Workflow detailOnly`
- technician isolation
- contractor isolation
- существующие permissions
- общий authentication context

Не создавать второй Workflow.

Не создавать HAYAT-specific копии общих business entities.

---

# 6. HAYAT — ДОРАБОТАТЬ ДО ЗАКОНЧЕННОГО WORKFLOW

## 6.1 Dispatcher

Добавить полноценный сценарий:

### Create request by phone

Dispatcher должен иметь возможность создать заявку от имени жильца после телефонного обращения.

Flow:

1. выбрать организацию в разрешённом scope;
2. выбрать building;
3. выбрать unit;
4. определить жителя;
5. если подходящего пользователя нет — разрешить оформить заявку на помещение;
6. выбрать category;
7. выбрать priority;
8. title;
9. description;
10. preferred contact method;
11. preferred visit window;
12. attachments при наличии;
13. создать request;
14. сразу назначить или оставить в общей очереди.

Хранить источник заявки:

- resident_app
- dispatcher_phone
- manager
- system
- import

---

# 6.2 Categories

Добавить нормальную модель категорий заявок.

Минимально:

- plumbing
- electrical
- heating
- elevator
- cleaning
- common_area
- security
- access
- intercom
- meter
- internet
- parking
- landscaping
- emergency
- other

Категории должны быть configurable per organization.

Не hardcode только в UI.

---

# 6.3 Priorities

Добавить:

- low
- normal
- high
- urgent
- emergency

Priority должен влиять на:

- сортировку;
- SLA;
- визуальное отображение;
- overdue;
- escalation.

---

# 6.4 SLA

Добавить SLA policy.

Нужны минимум:

- response deadline;
- assignment deadline;
- arrival deadline;
- resolution deadline.

SLA может зависеть от:

- organization;
- category;
- priority.

Рассчитывать:

- due_at;
- overdue;
- breached SLA.

Не рассчитывать SLA только во frontend.

---

# 6.5 Escalation

Добавить backend job/process для escalation.

При приближении или нарушении SLA:

- notification dispatcher;
- notification manager;
- escalation level;
- audit event.

Не отправлять бесконечные повторные уведомления.

Сделать idempotent.

---

# 6.6 Visit scheduling

Добавить:

- proposed visit;
- confirmed visit;
- reschedule;
- cancellation;
- resident confirmation;
- technician confirmation.

Хранить историю изменения времени.

Никогда не перезаписывать исторические значения без audit trail.

---

# 6.7 Technician

Завершить экран работы техника.

Добавить:

### Accept job
Техник явно принимает назначение.

### Cannot perform
Причины:

- resident unavailable;
- no access;
- missing material;
- requires specialist;
- unsafe condition;
- wrong category;
- other.

### Pause work

С обязательной причиной.

### Resume work

### Materials

Структурированный список:

- material/service;
- quantity;
- unit;
- optional unit cost;
- comment.

Стоимость не должна автоматически становиться финансовой операцией.

### Photo type

Фото:

- before
- during
- after
- evidence

### Visit schedule

Показать:
- сегодня;
- ближайшие работы;
- просроченные;
- будущие визиты.

---

# 6.8 Equipment QR

Если оборудование имеет identifier/QR:

- техник может открыть оборудование по QR/token/id;
- посмотреть историю;
- регламент;
- связанные работы;
- создать/открыть work order.

Не добавлять fake camera access, если browser permission/implementation отсутствует.

Можно реализовать scanner через стандартный browser camera API только если он реально работает и gracefully falls back на manual input.

---

# 7. MAINTENANCE → WORK ORDER

Сейчас обслуживание оборудования не должно существовать как изолированный календарный checkbox.

Добавить связь:

Maintenance Plan
→ Scheduled Maintenance Event
→ Work Order
→ Technician
→ Checklist
→ Report
→ Photos
→ Manager verification
→ Equipment maintenance history.

Поддержать recurring plans:

- daily
- weekly
- monthly
- quarterly
- semiannual
- annual
- custom interval

Job создания следующих событий должен быть idempotent.

---

# 8. SECURITY / ОХРАНА

Расширить incidents.

Incident должен содержать:

- building;
- location;
- category;
- severity;
- reporter;
- description;
- photos/files;
- responsible person;
- status;
- timeline;
- comments;
- resolution;
- created_at;
- closed_at.

Severity:

- info
- low
- medium
- high
- critical

Status:

- open
- acknowledged
- investigating
- resolved
- closed

Добавить manager visibility.

Охранник не должен получать финансовые или административные permissions.

Физическое открытие двери НЕ имитировать.

---

# 9. REAL-TIME EVENTS

Не обязательно внедрять тяжёлый WebSocket stack.

Оцени существующую архитектуру.

Если безопасно — реализуй SSE для:

- новых заявок dispatcher;
- изменений статуса;
- новых сообщений;
- назначений;
- incident events.

Если это значительно усложняет deployment — оставить polling, но сделать:

- intelligent refresh;
- tab visibility awareness;
- no request storms;
- clear loading state.

Объяснить решение в отчёте.

---

# 10. ImTun — СОХРАНИТЬ ВОССТАНОВЛЕННОЕ

Сохранить:

- `ResidentApp.tsx`;
- original CSS;
- original HY/RU/EN;
- ImTun config;
- original logo/assets;
- owner;
- renter;
- family;
- permissions;
- shared Workflow;
- finance isolation;
- context isolation;
- building/unit labels;
- documents;
- meters;
- announcements;
- meetings;
- access passes;
- leases;
- internal notifications.

Не создавать второй resident backend.

---

# 11. ImTun — ЗАЯВКИ

Расширить создание заявки жильцом.

Добавить:

- category;
- optional subcategory;
- preferred contact:
  - in-app
  - phone
  - email
- preferred visit date;
- preferred time window;
- access instructions;
- urgency;
- attachments.

Но сервер обязан проверять допустимые значения.

---

# 12. ImTun — VISIT APPROVAL

Житель должен видеть предложенный визит:

Например:

«Техник предлагает 7 октября, 14:00–16:00»

Действия:

- Accept
- Request another time

При переносе:

- reason;
- optional suggested window.

Все изменения должны попадать в историю заявки.

---

# 13. ImTun — NOTIFICATION DEEP LINKS

Исправить notifications.

Для событий заявки notification должен открывать:

`/imtun/requests?requestId=<uuid>`

Но access проверяется backend.

Если notification относится к другому активному assignment пользователя:

НЕ объединять permissions автоматически.

Реализовать безопасную логику:

1. определить target assignment;
2. если пользователь имеет его;
3. предложить switch context;
4. после подтверждения переключить;
5. открыть destination;
6. если доступа нет — показать Access denied.

---

# 14. ImTun — DELEGATION

Довести семейное делегирование до полного цикла:

Owner:

1. вводит email/phone;
2. выбирает permissions;
3. задаёт expiration;
4. отправляет invitation.

Invitee:

1. получает invitation;
2. login/register;
3. принимает invitation;
4. получает отдельный assignment/context.

Owner может:

- view;
- revoke;
- modify expiration;
- resend pending invitation.

Family по умолчанию не получает:

- finance;
- user management;
- ownership rights;
- contract management.

Sensitive changes должны требовать recent authentication.

---

# 15. LEASE → ACCESS LIFECYCLE

Связать lease/rental period с renter access.

Не удалять историю.

Нужно определить policy:

ACTIVE LEASE
→ renter assignment active

LEASE EXPIRED
→ renter cannot execute new protected actions

Но бывший renter может иметь read-only доступ к разрешённым historical documents/receipts, если это допускает policy.

Реализовать policy централизованно в backend.

Не доверять frontend.

---

# 16. OWNERSHIP

Завершить UI ownership shares.

Нужно:

- собственники помещения;
- доля;
- start date;
- end date;
- document basis;
- history.

Сумма активных долей не должна превышать допустимое значение.

Для meetings использовать share data.

---

# 17. MEETINGS / VOTING

Текущие polls не считать полноценным собранием.

Расширить:

Meeting:

- title;
- description;
- building;
- agenda;
- documents;
- voting start;
- voting end;
- quorum rule;
- status.

Agenda Item:

- question;
- voting type;
- options.

Vote:

- owner;
- unit;
- ownership share;
- selected option;
- timestamp.

Result:

- total eligible share;
- participation share;
- quorum;
- votes by option;
- passed/not passed.

Не делать заявления о юридической электронной подписи, если она реально не реализована.

Генерировать итоговый protocol как документ только после завершения голосования.

---

# 18. PROPERTY STRUCTURE

Завершить:

Organization
→ Property/Complex
→ Building
→ Entrance
→ Floor
→ Unit

Не создавать новые сущности, если подходящие таблицы уже существуют.

Нужны UI:

- entrances;
- floors;
- units.

Unit card:

- number;
- type;
- area;
- floor;
- entrance;
- owners;
- renter;
- residents;
- meters;
- requests;
- charges;
- documents;
- passes;
- history.

Показывать только разрешённые разделы.

---

# 19. VERNATUN CONSOLE — ORGANIZATIONS

Сделать полноценную карточку организации.

Нужно:

- organization name;
- legal name;
- tax ID;
- status;
- contact info;
- address;
- timezone;
- currency;
- default language;
- brand settings;
- current plan;
- subscription;
- enabled modules;
- buildings used / limit;
- users;
- onboarding status;
- support cases;
- audit events.

Lifecycle:

- active
- suspended
- archived

Архивирование не должно физически удалять бизнес-историю.

---

# 20. INVITATIONS — КРИТИЧЕСКИЙ BLOCKER

Production сейчас не должен отвечать только `email_not_configured`.

Реализовать provider abstraction:

`EmailProvider`

Минимум адаптеры:

- development outbox;
- SMTP.

ENV:

- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- SMTP_FROM

Если credentials отсутствуют:

development:
можно использовать outbox;

production:
явная configuration error.

Но UI не должен показывать ложное «письмо отправлено».

Invitation management:

- pending
- accepted
- expired
- revoked

Действия:

- resend;
- revoke.

Список приглашений должен быть доступен тому platform admin, который имеет соответствующее platform permission.

Не выдавать `people.invite` глобально просто ради обхода существующей модели — правильно нормализовать platform permission policy.

---

# 21. PASSWORD RESET

Аналогично invitation email.

Добавить:

- secure random token;
- hashed token in DB;
- expiration;
- one-time use;
- rate limiting;
- audit event;
- SMTP provider.

Не хранить reset token plaintext.

---

# 22. SUBSCRIPTION → PLAN → MODULES

Это одна из самых важных связей.

Сейчас нельзя держать modules и subscription как независимые миры.

Модель:

PLAN
- allowed_modules
- building_limit
- user_limit optional
- storage_limit optional
- feature flags optional

SUBSCRIPTION
- organization
- plan
- start
- end
- status

MODULE ENTITLEMENT
должен вычисляться с учётом:
- subscription;
- plan;
- optional explicit override.

При отсутствии active subscription определить policy:

например:
- read-only grace period;
- restricted mode.

Не уничтожать данные.

Статусы:

- trial
- active
- past_due
- suspended
- cancelled
- expired

Для текущей версии НЕ обязательно подключать Stripe.

Но lifecycle должен существовать.

---

# 23. MODULE MANAGEMENT

Platform Admin должен видеть у организации:

- plan modules;
- overrides;
- effective modules.

Разрешить override:

- enabled
- disabled
- inherited

Обязательно audit:

- кто;
- когда;
- что;
- previous;
- new;
- reason.

---

# 24. CONSOLE AUDIT

Исправить текущую архитектуру платформенного аудита.

Platform audit должен включать административные события, даже когда они имеют `organization_id`.

Platform administrator должен иметь возможность фильтровать:

- date;
- organization;
- actor;
- event type;
- resource type;
- resource;
- result.

Нужна pagination.

Показывать `details`.

Audit record должен хранить structured JSON details.

Критичные business update + audit должны выполняться атомарно в одной DB transaction там, где это возможно.

---

# 25. AUDIT IMMUTABILITY

Добавить DB protections.

Обычные application roles не должны:

- UPDATE audit_events;
- DELETE audit_events.

Если проект использует migration-based DB hardening — выполнить новой migration.

Не редактировать старые migrations.

---

# 26. SUPPORT CASES

Переделать single `reply` в conversation model.

Support Case:

- organization;
- creator;
- assignee;
- priority;
- category;
- status;
- SLA;
- timestamps.

Support Message:

- case;
- author;
- body;
- attachments;
- timestamp;
- internal/public.

История не должна перезаписываться.

---

# 27. SUPPORT QUEUE

Добавить:

- unassigned;
- assigned to me;
- all;
- overdue;
- priority;
- organization;
- status.

Platform admin/support lead может assign/reassign.

Обычный support видит только допустимую очередь.

---

# 28. TEMPORARY SUPPORT ACCESS

Исправить текущий flow.

Форма запроса должна включать разрешённое permission:

`imports.manage`

При входе support в approved temporary organization context:

НЕ отправлять его на экран `/support/grants`, если этот context не имеет право его читать.

Начальный экран должен определяться effective permissions.

Expiration:

- автоматически прекращает доступ;
- отдельный background cleanup не должен быть единственной защитой;
- access проверять server-side.

Добавить audit event при обнаружении expired grant, но избежать массового дублирования.

---

# 29. ONBOARDING

Расширить onboarding steps.

Нужно:

- step title;
- category;
- organization;
- assignee;
- due date;
- order;
- dependencies;
- status;
- notes;
- attachments optional.

Действия:

- assign;
- reassign;
- start;
- complete;
- reopen.

Прогресс организации:

`completed / total`.

Добавить onboarding dashboard.

---

# 30. IMPORTS

Текущий import помещений сохранить.

Добавить табличный preview:

- source row;
- mapped fields;
- validation state;
- errors.

До confirm данные в production entities не записывать.

Расширить architecture для entity types:

- units;
- owners;
- residents;
- meters;
- opening balances

Но не надо делать все import types одним огромным универсальным parser.

Сделать typed import strategies.

---

# 31. FINANCE — MASS BILLING

Текущий invoice flow сохранить.

Добавить batch billing:

- building;
- billing period;
- tariff;
- payer rules;
- preview;
- validation;
- draft batch;
- publish.

До публикации показать:

- number of units;
- charges;
- warnings;
- skipped;
- total.

Publication должна быть atomic.

Опубликованные charges не редактировать напрямую.

Изменения — adjustment.

---

# 32. BANK RECONCILIATION

Создать полноценный слой bank import.

Bank Transaction:

- external ID/reference;
- date;
- amount;
- currency;
- payer text;
- account;
- purpose;
- raw payload;
- import batch.

Matching statuses:

- matched
- partially_matched
- unmatched
- ignored

Позволить:

1. автоматически предложить match;
2. бухгалтер подтверждает;
3. один bank payment может быть распределён между несколькими invoices;
4. partial allocation;
5. overpayment → account credit.

Сумма allocations не может превышать payment amount.

---

# 33. PORTFOLIO OWNER DASHBOARD

Добавить реальные агрегаты:

- occupancy;
- billed;
- collected;
- outstanding;
- collection rate;
- operating expenses;
- budget vs actual;
- cashflow;
- expiring contracts;
- work orders;
- SLA;
- contractor performance.

Фильтры:

- date range;
- property;
- building.

Не использовать fake historical charts.

Если нет исторических данных — показывать empty state.

---

# 34. CONTRACTOR SCORECARD

Считать из реальных данных:

- jobs assigned;
- completed;
- accepted;
- returned;
- avg completion time;
- SLA violations;
- defects reopened.

Manager/portfolio owner может видеть scorecard.

---

# 35. DOCUMENTS

Существующую защищённую загрузку сохранить.

Добавить:

- document version;
- category;
- related entity;
- version number;
- uploaded_by;
- uploaded_at;
- visibility;
- previous_version_id.

Файл нельзя делать публичным URL.

---

# 36. STORAGE ABSTRACTION

Сейчас local private storage оставить рабочим.

Добавить интерфейс:

`PrivateStorageProvider`

Implementations:

- LocalPrivateStorage
- S3CompatibleStorage

ENV для S3:

- S3_ENDPOINT
- S3_REGION
- S3_BUCKET
- S3_ACCESS_KEY
- S3_SECRET_KEY

Если S3 не настроен — development может использовать local storage.

Production должен явно показывать выбранный storage mode.

Не переносить/удалять текущие пользовательские файлы автоматически.

---

# 37. NOTIFICATION CENTER

Сделать единый backend notification service.

Event types минимум:

- request_created
- request_assigned
- visit_proposed
- visit_changed
- technician_started
- technician_completed
- manager_verified
- resident_action_required
- new_charge
- payment_received
- payment_unmatched
- meeting_created
- voting_started
- voting_ending
- announcement_published
- pass_expiring
- lease_expiring
- support_case_updated
- onboarding_task_due
- SLA_warning
- SLA_breached

Channels:

- in_app
- email
- SMS future
- push future

Сейчас обязательны:

- in_app;
- email infrastructure.

SMS/push не имитировать.

---

# 38. NOTIFICATION PREFERENCES

Пользователь должен иметь:

- global notification preferences;
- email enabled;
- in-app;
- category-level preferences.

Security-critical/system notifications могут игнорировать optional opt-out только если policy это явно определяет.

---

# 39. BRANDING / WHITE-LABEL FOUNDATION

Не строить сейчас отдельные App Store builds.

Но довести web white-label configuration.

Organization branding:

- brand name;
- logo;
- primary color;
- secondary/accent optional;
- support email;
- support phone;
- website;
- privacy URL;
- terms URL.

HAYAT и ImTun должны получать effective branding от current organization.

Обязательно graceful fallback на Vernatun defaults.

Не позволять организации загружать arbitrary HTML/JS.

---

# 40. PWA — ОГРАНИЧЕННЫЙ РЕЖИМ

Для текущей web версии можно добавить PWA foundation:

- web manifest;
- icons;
- installable shell;
- offline fallback page;
- cache static assets.

Но НЕ кешировать blindly:

- financial data;
- documents;
- sensitive API responses.

Не обещать полный offline режим.

Для technician workflow можно сохранить существующий local draft, но сделать UI ясно показывающим:

- online;
- offline;
- unsynced;
- conflict.

Фото offline queue пока не обязательна, если она небезопасна.

---

# 41. DASHBOARDS

Не создавать одинаковый dashboard для всех ролей.

Сделать role-specific KPI.

### platform_admin
- organizations
- active subscriptions
- trial
- suspended
- buildings
- users
- support cases
- onboarding
- recent admin activity

### support
- assigned cases
- unassigned
- temporary grants
- onboarding steps
- overdue cases

### org_admin
- buildings
- units
- users
- roles
- enabled modules
- open work
- payments summary where permitted

### manager
- open requests
- overdue
- technicians
- maintenance today
- incidents
- verification queue

### dispatcher
- new
- unassigned
- urgent
- overdue
- today's visits

### technician
- today
- accepted
- in progress
- overdue
- upcoming

### contractor
- defects assigned
- in progress
- returned
- completed awaiting verification

### security
- active passes
- expected visitors
- current incidents
- critical incidents

### accountant
- billing
- collections
- unpaid
- unmatched bank transactions
- adjustments

### developer
- inspections
- open defects
- warranty
- units ready for handover

### portfolio_owner
portfolio analytics.

### owner/renter/family
только данные, разрешённые их context.

---

# 42. SEARCH / FILTER / SORT / PAGINATION

Провести audit всех больших tables.

Не оставлять client-only rendering огромных наборов.

Для потенциально растущих таблиц добавить server-side:

- pagination;
- filter;
- search;
- sort.

Использовать limit constraints.

Не разрешать unlimited SQL result через query parameter.

---

# 43. SECURITY

Обязательно перепроверить:

- session fixation;
- CSRF;
- rate limiting;
- authorization;
- privilege escalation;
- IDOR;
- cross-organization access;
- cross-building access;
- cross-unit access;
- expired assignment;
- revoked assignment;
- expired support grant;
- disabled module;
- cancelled subscription;
- file download permissions.

Любой frontend restriction должен иметь equivalent backend restriction.

---

# 44. MFA

Существующую TOTP MFA сохранить.

Добавить configurable policy.

Для:

- platform_admin
- privileged org_admin

поддержать `MFA required`.

Не включать policy всем существующим пользователям внезапно без migration/rollout path.

---

# 45. I18N

Сохранить:

- HY default;
- RU;
- EN.

Default currency:
- AMD.

После новых экранов прогнать scan на hardcoded strings.

Не переводить автоматически пользовательские:

- messages;
- announcements;
- request descriptions;
- documents.

---

# 46. TIMEZONE

Default:
`Asia/Yerevan`

Хранить timestamps предпочтительно UTC.

Показывать пользователю в organization/user timezone.

Не смешивать server local timezone с business dates.

---

# 47. RESPONSIVE QA

Обязательно проверить:

- 360
- 390
- 768
- 1024
- 1440

Минимум для ключевых сценариев.

Особенно:

- sidebar;
- mobile navigation;
- dialogs;
- tables;
- kanban;
- forms;
- request detail;
- payments;
- dashboard.

Никакого горизонтального page overflow.

Таблицы на mobile могут использовать controlled horizontal scroll или card representation.

---

# 48. ACCESSIBILITY

Проверить:

- tab navigation;
- visible focus;
- dialog focus trap;
- Escape;
- labels;
- aria;
- contrast;
- touch target;
- error association;
- keyboard usage.

---

# 49. TESTS

Не ограничиваться compile success.

Нужны:

### TypeScript
frontend + backend.

### Build
production Vite build.

### API integration tests

Минимум:

#### Auth
- login
- logout
- CSRF
- disabled user
- expired context

#### RBAC
- wrong organization
- wrong role
- disabled module
- expired role

#### HAYAT
- dispatcher queue
- phone-created request
- assignment
- priority
- SLA
- technician accepts
- technician completes
- manager verifies
- resident confirms
- contractor isolation
- security incidents

#### ImTun
- owner
- renter
- family
- financial isolation
- delegation
- visit approval
- deep link
- lease expiration

#### Finance
- batch billing
- adjustment
- bank import
- partial allocation
- multi-invoice payment

#### Console
- organization
- subscription
- module override
- onboarding
- invitation
- support
- audit

---

# 50. END-TO-END SCENARIOS

Пройти минимум следующие цепочки.

## Scenario A

Resident
→ create request
→ dispatcher
→ assign technician
→ technician accept
→ visit
→ checklist
→ before/after photos
→ report
→ manager verification
→ resident confirmation
→ closed.

## Scenario B

Dispatcher
→ telephone request
→ priority urgent
→ SLA
→ assignment
→ overdue/escalation.

## Scenario C

Maintenance schedule
→ generated work order
→ technician
→ completion
→ equipment history.

## Scenario D

Accountant
→ create billing batch
→ preview
→ publish
→ import bank statement
→ match transaction
→ allocate payment
→ resident sees payment.

## Scenario E

Platform Admin
→ organization
→ subscription
→ modules
→ invite org admin
→ org admin joins.

## Scenario F

Support
→ case
→ temporary access request
→ org admin approve
→ switch into limited context
→ perform allowed action
→ expiry
→ access denied.

## Scenario G

Owner
→ family invitation
→ family accepts
→ family uses permitted modules
→ owner revokes
→ family access disappears.

## Scenario H

Owner
→ meeting
→ vote weighted by ownership share
→ quorum
→ result
→ protocol.

---

# 51. НИКОГДА НЕ ДЕЛАТЬ FAKE SUCCESS

Особенно:

- payment;
- email;
- SMS;
- door opening;
- push;
- analytics;
- external integration.

Если provider не подключён:

показывать:

`Not configured`

или

`Manual process`

или

`Sandbox`

в зависимости от реального состояния.

---

# 52. MIGRATIONS

Если нужна schema change:

создавать новые numbered migrations.

Не редактировать уже применявшиеся старые migrations.

Migration должна быть:

- deterministic;
- transaction-safe где возможно;
- rerun-safe согласно существующей migration architecture.

Не удалять production-like data.

---

# 53. DEMO DATA

Demo seed разрешён только:

- development;
- test.

Production startup не должен автоматически создавать demo organizations/users.

Любые demo records должны иметь явную маркировку.

---

# 54. REPLIT DEPLOYMENT

Проверить:

- frontend workflow;
- API workflow;
- ports;
- healthcheck;
- production env;
- DB connection;
- session secret;
- reverse proxy;
- static assets;
- API base URL;
- uploaded file persistence.

Добавить:

`GET /health`

Если аналог уже есть — использовать его.

Health response не должен раскрывать секреты.

Можно показывать:

- application;
- DB connectivity;
- version;
- uptime;
- environment.

---

# 55. OBSERVABILITY

Добавить structured server logs.

Не логировать:

- passwords;
- MFA secrets;
- reset tokens;
- invitation raw tokens;
- cookies;
- authorization headers;
- sensitive documents.

Добавить request correlation ID.

Error response production не должен возвращать stack trace клиенту.

---

# 56. BACKUP DOCUMENTATION

Создать документ:

`docs/BACKUP-RESTORE.md`

Включить:

- PostgreSQL;
- private photos;
- private documents;
- storage provider;
- SESSION_SECRET;
- environment;
- restore order;
- restore validation.

Не выполнять destructive restore на рабочей БД.

---

# 57. OPENAPI

После новых API обновить существующий OpenAPI.

Не оставлять документацию расходящейся с реальным endpoint.

---

# 58. LANDING

Не переписывать landing.

Сохранить:

- `/`;
- current Vernatun visual identity;
- Vernatun OS/HAYAT/ImTun ecosystem;
- HY/RU/EN;
- existing anchors;
- `/login`.

Но проверить lead form.

Если server endpoint отсутствует — реализовать:

`POST /api/leads`

Минимум:

- name;
- contact;
- organization optional;
- productInterest;
- audience;
- message optional;
- consent;
- language;
- created_at.

Защита:

- validation;
- rate limit;
- spam honeypot;
- length limits.

Не подключать CAPTCHA без необходимости.

Console platform admin может видеть leads только при отдельном permission.

---

# 59. ЧТО НЕ НАДО ДЕЛАТЬ В ЭТОМ ЭТАПЕ

Не делать сейчас:

- отдельный microservice architecture;
- Kubernetes;
- native iOS;
- native Android;
- App Store;
- Google Play;
- real banking gateway;
- real door controller;
- SMS provider;
- push provider;
- legal digital signature;
- AI chatbot;
- ML;
- blockchain;
- complete BI warehouse.

Архитектура должна позволять их добавить позже.

---

# 60. ПОРЯДОК РАБОТ

Используй следующий порядок.

## PHASE 0
Audit + regression baseline.

## PHASE 1
Critical production blockers:

- invitation email;
- password reset;
- audit;
- subscription/module policy;
- support temporary-context bug.

## PHASE 2
Core operations:

- dispatcher telephone request;
- category;
- priority;
- SLA;
- scheduling;
- technician actions;
- incidents.

## PHASE 3
Maintenance + ImTun flows:

- maintenance → WorkOrder;
- delegation;
- visit approval;
- notification deep links;
- lease lifecycle.

## PHASE 4
Finance:

- mass billing;
- bank reconciliation;
- allocations;
- unmatched payments.

## PHASE 5
Console:

- organization card;
- subscription lifecycle;
- module override;
- onboarding;
- support queue;
- imports.

## PHASE 6
Meetings / ownership / documents / analytics.

## PHASE 7
Storage + notifications + branding + limited PWA.

## PHASE 8
QA + security + deployment readiness.

Не переходить к cosmetic polishing, пока critical workflows не работают.

---

# 61. ВАЖНО: НЕ ЛОМАТЬ СОХРАНЁННУЮ ЛОГИКУ

До изменения существующего endpoint проверить:

1. кто его использует;
2. frontend calls;
3. tests;
4. permissions;
5. compatibility.

Если контракт меняется — сохранить backward compatibility там, где это практически возможно.

---

# 62. ПОСЛЕ КАЖДОГО КРУПНОГО БЛОКА

Запускать:

- TypeScript;
- relevant tests;
- build.

Не ждать самого конца, чтобы обнаружить regression.

---

# 63. ФИНАЛЬНЫЙ ACCEPTANCE REPORT

После реализации создай:

`docs/VERNATUN-COMPLETION-REPORT.md`

Структура:

# Vernatun Completion Report

## 1. Executive summary

Что было сделано.

## 2. Architecture

Текущая архитектура.

## 3. Database migrations

Для каждой migration:

- file;
- purpose;
- tables affected.

## 4. Backend changes

Endpoint by endpoint.

## 5. Frontend changes

Screen by screen.

## 6. HAYAT

Отдельно:

- manager;
- dispatcher;
- technician;
- contractor;
- security.

## 7. ImTun

Отдельно:

- owner;
- renter;
- family.

## 8. Vernatun OS

- org_admin
- portfolio_owner
- developer
- accountant

## 9. Console

- platform_admin
- support

## 10. Security

Что проверено.

## 11. Tests

Точная таблица:

| Test suite | Passed | Failed |

Не использовать исторические числа.

Только фактически выполненные в этом запуске тесты.

## 12. Browser QA

Какие роли и размеры реально проверены.

## 13. External integrations

Таблица:

| Integration | Real | Sandbox | Manual | Not configured |

## 14. Remaining gaps

Честно перечислить всё оставшееся.

## 15. Production blockers

Отдельный список.

## 16. Environment variables

Без значений секретов.

## 17. Deployment notes

Как запускается Vernatun Web и API Server в Replit.

---

# 64. СОЗДАТЬ CHANGELOG

Создать:

`docs/CHANGELOG-2026-10.md`

Для каждого блока:

- Changed
- Added
- Fixed
- Security
- Migration
- Tests

---

# 65. СОЗДАТЬ PRODUCTION CHECKLIST

Создать:

`docs/PRODUCTION-CHECKLIST.md`

Разделы:

- Environment
- Database
- Storage
- Email
- Sessions
- Security
- Backups
- Monitoring
- Domain/SSL
- Tests
- Demo data
- Admin account
- MFA
- Restore test
- External integrations

Каждый:

- PASS
- FAIL
- NOT CONFIGURED
- MANUAL ACTION REQUIRED

---

# 66. КОНЕЧНАЯ ЦЕЛЬ

Результат этого задания — не красивый prototype.

Нам нужен фундамент коммерческой SaaS-платформы управления недвижимостью:

**Vernatun OS**

с отдельными пользовательскими продуктами:

**HAYAT by Vernatun**
для эксплуатационной команды

и

**ImTun by Vernatun**
для жильцов.

После выполнения проекта должно быть возможно пройти реальные end-to-end процессы без fake data и без обхода permissions.

При этом система должна сохранить единый backend, единый источник прав, единую модель объектов недвижимости и единый audit trail.

Главная архитектурная идея:

**One platform. Multiple products. One source of truth. Strict context isolation.**

---

# 67. НАЧНИ СЕЙЧАС

Сначала выполни полный audit текущего кода и сопоставь его с этим specification.

Затем:

1. не переделывай уже готовые части;
2. исправь обнаруженные regression/broken links;
3. реализуй PHASE 1;
4. переходи последовательно по фазам;
5. запускай тесты после каждого крупного изменения;
6. не заявляй о готовности того, что реально не проверено;
7. не симулируй внешние сервисы как production;
8. в конце дай полный completion report.

Если конкретная возможность уже существует и реализована лучше, чем описано здесь, **сохрани существующую реализацию**, проверь её и отметь как already compliant вместо создания дубликата.