# Vernatun — исходный аудит интерфейсов 14 ролей

Дата: 2026-10-07. **Статус: BASELINE / PARTIAL. Не финальная приёмка нового промпта.**

Источник: новый Product & Interface Completion prompt и 15 приложенных изображений.
Два экрана platform admin относятся к одной роли. Экран resident с надписью «Член семьи»
относится к `family`, не вводит пятнадцатую роль.

Ниже «есть» означает найденную реализацию в исходниках, а не новый успешный браузерный тест.
Подробные блоки, классификация кнопок и остающиеся проверки: `REFERENCE-SCREEN-GAP-REPORT.md`.
Разрешения: `PERMISSION-CATALOG.md`. Целевая модель IAM: `IAM-ARCHITECTURE.md`.

## 1. Сопоставление ролей и экранов

Все изображения лежат в `attached_assets/`.

| Роль | Референс | Точка входа | Основной frontend | Backend |
|---|---|---|---|---|
| platform_admin | Vernatun_SaaS_admin_overview_dashboard_1791289210910.png; Vernatun_super_admin_control_center_1791289210911.png | /console/overview | Portal, OrgConsole, SubscriptionConsole, OnboardingConsole, AuditConsole, EmailConsole | api, organization-console, platform-foundation, onboarding-workflow, email-operations |
| support | Vernatun_implementation_and_support_dashboard_1791289210911.png | /console/onboarding | OnboardingConsole, SupportConsole, TypedImports | onboarding-workflow, support-conversation, typed-imports, grants |
| org_admin | Vernatun_organization_dashboard_1791289210914.png | /os/organization | Portal/Records, InvitationConsole, OrganizationSettings, BrandingEditor | api, paged-records, platform-foundation, branding |
| portfolio_owner | Vernatun_portfolio_oversight_dashboard_1791289210912.png | /os/portfolio | Portfolio, PortfolioObjects, LeaseManage | portfolio-analytics, portfolio-objects, reporting, lifecycle |
| developer | Apartment_handover_and_warranty_dashboard_1791289210910.png | /os/development | Lifecycle, Workflow, DefectReopen | lifecycle, workflow, operations |
| manager | Residential_property_operations_dashboard_1791289210913.png | /hayat/management | HayatApp, Community, Phase2, Maintenance, Governance | hayat, core-operations, services, maintenance, governance |
| dispatcher | Vernatun_dispatcher_control_center_1791289210912.png | /hayat/dispatch | HayatApp, Phase2, Workflow | hayat, core-operations, operation-incidents |
| accountant | Accountant’s_accruals_and_reconciliation_dashboard_1791289210915.png | /os/accounting | FinanceWorkspace, BillingBatches, BankReconciliation, Credits | finance, billing-batches, bank-reconciliation |
| technician | Technician’s_daily_work_dashboard_1791289210916.png | /hayat/my-work | HayatApp, OfflineWork, Phase2 | hayat, workflow, field, core-operations |
| contractor | Contractor_dashboard_for_assigned_repairs_1791289210913.png | /hayat/contractor | HayatApp, OfflineWork, DefectReopen | hayat, workflow, operations |
| security | Security_passes_and_events_dashboard_1791289210917.png | /hayat/security | HayatApp, IncidentPanel | hayat, operations, operation-incidents |
| unit_owner | Vernatun_homeowner_mobile_dashboard_1791289210916.png | /imtun/owner | ResidentApp, FinanceWorkspace, Governance, Delegations | finance, services, governance, resident-lifecycle |
| renter | Vernatun_renter_home_dashboard_1791289210915.png | /imtun/renter | ResidentApp, RequestOps, Lifecycle | resident-lifecycle, lease-policy, finance, core-operations |
| family | Vernatun_resident_home_dashboard_1791289210917.png | /imtun/family | ResidentApp | resident-lifecycle, workflow, services, documents |

## 2. Навигация: фактическая модель и разрывы

Перечни ниже описывают группы функций, не обещают наличие каждой группы в виде
отдельного пункта меню. Путь с пометкой «цель» ещё не является реализованным маршрутом.

| Роль | Сейчас доступные группы по правам | Разрыв с референсом |
|---|---|---|
| platform_admin | Организации, приглашения, подписки, внедрение, обращения, аудит, email, настройки | Users & Access, роли/матрица, единый integration/system status; SaaS revenue заблокирован отсутствием Platform Billing |
| support | Внедрение, обращения, запрос временного доступа; импорт в разрешённом tenant-контексте | Сводный экран этапов/импортов/диагностики/встреч; диагностика не должна быть статической «зелёной» |
| org_admin | Здания/помещения, люди, приглашения, модули, аудит, настройки/брендинг, импорт, документы | Карточка сотрудника; редактирование/приостановка назначения; пользовательские роли; сводные cards/action menu |
| portfolio_owner | Объекты, analytics, бюджеты/расходы, аренда, invoices/reporting | Единая стартовая композиция; service/documents/scorecard требуют проверки прав, нельзя открыть только по наличию картинки |
| developer | Помещения, handovers, defects | Отдельные календарь/гарантии, readiness matrix, план и markers, допустимые документы/отчёты |
| manager | Работы, объекты, люди, оборудование, объявления, собрания, документы, аналитика/финансы | Счётчики не подключены к меню; обзор домов/ТО/финансов/объявлений/собрания не собран как референс |
| dispatcher | Очередь, канбан, заявки, инциденты, визиты/исполнители внутри workflow | Отдельные Calendar/Executors/Communications/Reports, единая боковая карточка, emergency banner |
| accountant | Finance workspace и вложенные операции, budgets/expenses/reporting | Раздельные discoverable Accounts/Tariffs/Accruals/Payments/Reconciliation/Debt/Periods и стартовая сводка |
| technician | Сегодня/работы/оборудование/профиль; действия внутри карточки | Домашние active/checklist/material/photo shortcuts; общая видимость неотправленных черновиков |
| contractor | Назначенные defects и действия; профиль | Documents count/list требует отдельного scoped evidence UI; вкладки не должны открывать чужие документы |
| security | Пропуска, события, инциденты, профиль | Проверить все фильтры/entry-exit; явное состояние физического контроллера |
| unit_owner | Home, finance, requests, meters, announcements, documents, passes, delegation, meetings, ownership/leases | Композиция home, уведомления, чёткая оплата без gateway, быстрый переход к приёмке результата |
| renter | Home, собственные счета/заявки, meters, passes, документы/объявления, lease | Видимый срок доступа, карточка аренды и visit approval на home |
| family | Home, own requests, announcements, разрешённые документы; delegated pass при соответствующем праве | Контакты УК, emergency call, состояние credential; физическое открытие не подключено |

## 3. Карточки и KPI

Общий `/api/role-insights` уже выдаёт ролевые агрегаты. Это не доказывает, что каждый
показатель референса существует с нужным фильтром и определением.

- Разделять открытые заявки, просроченные заявки и назначенные работы.
- Не считать количество строк текущей страницы количеством всех объектов.
- Finance — только нужная валюта, payer и период; paid ≠ сумма импортированных строк банка.
- Occupancy — по действующим договорам/периодам и допустимому портфелю.
- Contractor scorecard сейчас основан на дефектах, не универсальная оценка всех подрядов.
- Исторический график не строить из одного текущего значения.
- Нулевое значение, ошибка загрузки и отсутствие интеграции — разные состояния.
- Цифры и имена с картинок не переносить в реальные dashboard.

## 4. Права, которые нельзя расширить молча

- Org admin не получает `billing.publish` как собственное рабочее право.
- Dispatcher не получает `workorders.accept`.
- Contractor defects и technician WorkOrders остаются разными объектами.
- `family` не получает финансы, голосование или ownership.
- Owner voting требует реальной доли и snapshot, не только имени роли.
- Renter видит свои payer assignments и действует в сроках аренды.
- Platform IAM не предоставляет чтение tenant business records.
- Support работает через отдельно одобренный временный контекст.
- Дефолтные family permissions и явно делегированные family permissions могут отличаться.

## 5. Браузерная приёмка

Новая полная матрица 14 ролей **не выполнена**. Предыдущие фазовые тесты не переносятся
автоматически на новый объём. Для каждой роли требуются login → dashboard → все nav items
→ ключевые actions → отказы → logout на изолированных данных.

Ширины: 360, 390, 768, 1024, 1440. Отдельно keyboard/focus/dialog trap/labels/zoom/touch targets.
Cross-role journeys берутся из раздела 44 нового промпта. Ни один из них не считать
принятым без проверки результата следующей ролью.

## 6. Изменения после исходного аудита

В HAYAT подключён `/hayat/meters`: пункт «Счётчики» в боковом и нижнем меню,
существующие список/создание/показания/история из Community. Навигация проверяет
`meters.manage` и модуль meters; API остаётся источником авторизации.
При смене контекста компонент перемонтируется. Переводы названия есть для RU/HY/EN.
Новый business engine и миграции не создавались.

Проверка TypeScript прошла; пять routing/navigation tests прошли.
Это не закрывает остальные пункты роли manager или полный новый этап.

Целевая browser acceptance счётчиков прошла на изолированной БД: создание, подача 12.345,
сохранение истории после reload, desktop и 390px, отсутствие пункта/формы у dispatcher,
API отказ 403. Production build прошёл. Полная приёмка 14 ролей по-прежнему не выполнена.

## 7. IAM implementation

Добавлены `/console/users`, `/console/roles`, `/console/permissions`, `/os/roles`;
`/os/people` получил IAM employee directory и карточки. Реализованы API профилей,
персональных правил, account/assignment статусов, сессий и аудита.
Подробная матрица Before/After/API/Browser/Negative находится в
`IAM-IMPLEMENTATION-PROGRESS.md`. Общий статус IAM — PARTIAL; browser — EXTERNAL BLOCKER.
Новые панели остальных ролей не начинались.
