# Vernatun Product & Interface Completion — исходная матрица разрывов

> Актуализация 2026-10-22: это историческая baseline-матрица, а не список всего
> отсутствующего в текущем коде. IAM, availability, private unit plans и floor readiness
> уже реализованы. Сейчас добавлены role directory panels, header search/notifications,
> read-only база знаний и ограниченная диагностика внедрения.
> Точное разграничение сделанного и оставшегося:
> [PRODUCT-INTERFACE-COMPLETION-STATUS.md](PRODUCT-INTERFACE-COMPLETION-STATUS.md).

Дата: 2026-10-07. **PARTIAL — аудит исходников и референсов, не финальный DONE.**

Аудит проведён до изменений реализации нового этапа. Все 15 изображений просмотрены:
14 ролей, два визуальных варианта platform admin. Полный путь к каждому изображению
и роль приведены в `ROLE-UI-PARITY.md`.

## Обозначения и границы доказательств

- **A** — существующая реализация найдена в коде; браузерное доказательство нового этапа ещё нужно.
- **B** — IMPLEMENT NOW: нет UI, композиции, навигации или необходимой модели; частичный API не закрывает строку.
- **C** — EXTERNAL PROVIDER REQUIRED: допустим информационный экран, нельзя изображать работающий сервис.
- **D** — INTENTIONALLY NOT ALLOWED FOR ROLE: нужен явный отказ/скрытие, а не расширение прав ради картинки.
- UI «часть» — есть вложенная форма/раздел, но нет всей функции на референсном экране.
- API «часть» — есть примитивы; нового endpoint/агрегата/условий ещё недостаточно.
- Все API в таблицах имеют префикс `/api`. «Цель» в маршруте означает ещё не реализованный путь.
- Статус браузера для **всех строк этой исходной матрицы: не проверено в новом этапе**.

Таблица не приравнивает source inspection к WORKING в итоговой приёмке.
Финальный статус A/WORKING потребует API и браузерного доказательства.

## 1. Общие элементы всех применимых референсов

| Блок/действие | UI | API / данные | Permission / scope | Класс | Необходимое действие и тест |
|---|---|---|---|---|---|
| Logo/sidebar/bottom navigation | Есть | Product map + active context | Права текущего контекста | A | Сохранить Console/OS/HAYAT/ImTun, не копировать общий logo скриншота |
| Header search / Ctrl+K | Локальный поиск в отдельных списках | Единого авторизованного поиска нет | По домену и объекту | B | Grouped results, серверный scope, отрицательные cross-tenant tests |
| Language dropdown | Есть | Preferences | Собственная настройка | A | Проверить RU/HY/EN без поломки layout |
| Bell/count/dropdown/open/mark read | Отдельная страница | notifications, destination, read | Собственные notifications | B | Header dropdown, unread, безопасный переход и смена контекста |
| User/profile/logout | Есть | auth/session, logout, sessions | Собственная сессия | A | Logout очищает UI/cache, Back не возвращает данные |
| Organization/building/unit selector | Context picker есть | auth/context; contexts | Активные назначения | B | Нужные dashboard filters; clear/ignore late responses |
| Period/month selector | В финансовых формах | Финансовые агрегаты | Finance + scope | B | Общий период для KPI/таблицы/графика, без смешения валют |
| KPI card/drill-down | Role-insights с реестром: определение, query ID, effective permission, module, scope и no-data metadata; карточки показывают отсутствие финансовых данных | `server/kpi-registry.ts` + role-insights | Permission + module | B | Метаданные прошли API-тест для 14 ролей; полный визуальный parity, drill-down и браузерная проверка остаются |
| Table search/filter/paging/row action | Есть в части таблиц | records paging; доменные списки | По ресурсу | B | Все видимые actions реальны; полнота не ограничена первой страницей |
| Chart/history | Отдельные analytics | Только сохранённые данные | Finance/operations | B | Если нет истории — «Недостаточно данных для графика» |
| Status chips | Есть | Настоящие статусы домена | Read | A | Статус не только цветом, не подменять lifecycle |
| Export | CSV/PDF в части разделов | reports, invoices, meeting results | reports.export / объектное право | B | Не ставить универсальный export без разрешённого источника |
| Error/loading/empty/retry | Частично | Ошибки настоящих API | Без fallback на demo | B | Проверить 401/403/404/409/500 и пустые результаты |

## 2. Platform admin — оба референса

Маршруты: `/console/overview`, organizations, subscriptions, onboarding, support-cases,
audit, email, settings. Новые целевые: users, roles, permissions, integrations/system.

| Блок/действие | UI | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Organizations KPI/list, active/pilot tabs | Часть | organizations, role-insights, subscriptions | organizations.read | B | Период/состояние, ссылки и filter согласованы |
| Buildings KPI | Часть | role-insights | organizations.read | B | Только platform aggregate, не tenant records |
| Pilot/onboarding KPI | Часть | platform/onboarding | onboarding.manage | B | Отдельные active/pilot определения |
| Support count/badge/alerts | Часть | platform/support-cases | support.cases | B | Неразрешённые обращения и SLA real-data |
| SaaS accrued/paid/revenue graph | Нет реального billing | Platform Billing отсутствует | Не выдумывать | C | Показать billing not configured; без графика demo-выручки |
| + Organization | Есть | POST organizations | organizations.manage | A | Создание, сохранение, повторная загрузка |
| Open organization / status / ... | Есть часть | platform/organizations/:id, state | organizations.manage/read | B | Согласованные допустимые menu actions |
| Subscriptions/plans/modules | Есть отдельные экраны | subscriptions, module policy | subscriptions.manage | A | Entitlement, dependencies, override объяснимы |
| Attention: integration failure | Часть email health | platform/email/health | Platform metadata | B | Отделить webhook/email errors от новых провайдеров |
| Onboarding progress / open | Есть отдельный экран | platform/onboarding | onboarding.manage | B | Встроить реальные стадии в overview |
| Temporary support access / journal | Есть отдельный flow | support grants, audit | support.assign/platform.audit | B | Кнопки ведут в разрешённую очередь/аудит |
| Recent activity / all events | Есть AuditConsole | audit | platform.audit | B | Overview summary + ссылки |
| Team/roles / user card | Нет полноценного IAM | auth/people primitives | Новое явное IAM authority | B | Реализовать новый IAM без tenant superuser |
| CMS/brand / analytics / system | Часть settings/leads | Нет полного набора | По домену | B | Не создавать мёртвые пункты; определить реальные allowed destinations |

## 3. Organization admin

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Houses count → list | Часть /os/properties | properties, role-insights | properties.read | B | Карточка и scoped drill-down |
| Employees count → manage | Часть /os/people | people, records | people.read | B | Считать пользователей отдельно от назначений |
| Active modules count → settings | Часть /os/modules | modules, subscription policy | modules.read | B | KPI и объяснение enabled/entitled |
| Pending invitations → reminder | Есть список /os/invitations | invitations, resend | people.invite | B | Dashboard card, pending filter, delivery status |
| Invite / invite employee | Есть | POST invitations | people.invite | A | Не раскрывать пароль, повтор/отзыв/expiry |
| Employee role/properties/status/date | Частичная таблица | people, role_assignments | people.read | B | Раскрыть assignment status и сроки |
| Employee ... Open/Edit/Scope/Suspend/Revoke/Audit | Только часть | DELETE roles/:id + primitives | roles.assign/audit.read | B | Полная карточка и безопасные mutation endpoints |
| Module switches/dependencies | Есть часть | PATCH modules/:module | modules.manage | B | Explain not included/read-only/dependency/override |
| Integration tiles / all integrations | Нет полной сводки | Только email capabilities | Admin metadata | B | Provider-neutral summary, truthful states |
| Bank/SMS/telephony connected | Не настроены | Нет провайдеров | — | C | Не показывать статус Connected с референса |
| Logo change/color/name/support | Есть settings editor | branding, organization-settings | organization.settings | A | Применение после reload; безопасный logo upload |
| Recent rights changes / all audit | Есть общий audit | audit | audit.read | B | IAM before/after + targeted overview |
| Roles builder/matrix/debugger | Нет | Новая модель нужна | Делегирование по allowlist | B | См. IAM-ARCHITECTURE |

## 4. Support / Implementation

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Client selector / access-until | Частично /console/onboarding | contexts, support grants | Approved support scope | B | Не путать global support и временный tenant context |
| Stages/responsible/deadline/status/progress | Есть OnboardingConsole | platform/onboarding + change | onboarding.manage | A | Сохранение этапа и прогресса |
| + New task | Частично | platform/onboarding | onboarding.manage | B | Уточнить task/stage distinction в UI, не fake meeting |
| Import rows/valid/errors/file | Есть TypedImports | platform/imports | imports.manage/imports.finance | A | Только разрешённый временный контекст |
| Check import / preview errors / confirm | Есть | imports/:id, confirm | То же | A | Preview не меняет данные; confirm отдельно |
| Support queue/open case/priority/assignee | Есть SupportConsole | platform/support-cases | support.cases | A | Роль, SLA, вложения, refresh |
| Diagnostics/run check | Нет полного workspace | Частично health metadata | Explicit support authority | B | Реальные безопасные проверки; не green placeholder |
| Upcoming meetings/all meetings | Внутренний календарь поддержки в `/console/onboarding`; отдельный источник, создание, изменение времени, confirm/cancel/complete | `platform_support_meetings`, immutable event history, versioned API | `onboarding.manage`; записи оператора ограничены владельцем | B | Изолированные API-сценарии прошли; визуальная browser-приёмка и расширенный периодный календарь остаются |
| Knowledge base | Не подтверждён полноценный UI | Нет подтверждённой модели | Scoped support | B | Не оставлять пустой пункт меню |
| Access journal | Есть общий audit/access flow | grants, audit | В пределах разрешённого grant | B | Собрать scoped destination |

## 5. Accountant

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Navigation Accounts/Tariffs/Accruals/Payments/Reconciliation | Вложено в /os/finance | finance, bank, batches | billing.read/calculate/payments.reconcile | B | Discoverable самостоятельные разделы или устойчивые deep links |
| Debt/Budget/Expenses/Periods/Reports | Частично | portfolio/budgets, expenses, finance, reports | Finance domain | B | Period state и debt filters; не подменять API отсутствующими tabs |
| Period selector/open status | Часть | Finance periods | billing.read | B | Общая фильтрация dashboard |
| Accrued/paid/outstanding/unmatched | Частичные aggregates | finance, bank/transactions, role-insights | billing.read/payments.reconcile | B | Реальный расчёт в выбранной валюте/периоде |
| Payer/account charges table | Есть | finance/accounts/invoices | billing.read | A | Scope, paging, invoice drill-down |
| Unmatched bank rows / match | Есть BankReconciliation | bank/transactions + suggestions/confirm | payments.reconcile | A | Не создавать fake settlement |
| Draft calculation/preview/open batch | Есть BillingBatches | batches/preview, batches | billing.calculate | A | Ошибки входных данных и reload результата |
| Import statement | Есть | bank/imports/preview + create | payments.reconcile | A | Preview не равен импорту/оплате |
| Ignore valid bank row | Есть | transactions/:id/ignore | payments.reconcile | A | Требуется новая целевая UI-проверка |
| Allocate credit | Есть Credits | credits/:id/allocate | payments.reconcile | A | Исключить двойное расходование |
| Publish / adjustments / export | Есть | batches action, adjustments, reports | billing.publish/reports.export | A | Баланс виден жителю после reload |
| Attention missing tariff/area → settings | Часть | Batch preview validation | billing.calculate | B | Переход к разрешённому исправлению, не обход properties.manage |
| Recent operations/all history | Частично | Audit/finance records | Scoped financial read | B | Не давать общий org audit автоматически |
| Bank provider connected | Нет | Провайдер не подключён | — | C | Manual statement ≠ banking integration |

## 6. Manager

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Buildings/Residents navigation | Есть /hayat/properties, people | properties, people | properties.read/people.read | A | Scope и поиск |
| Finance/Reports | Через OS/analytics | finance, portfolio/analytics, reports | billing.read/reports.export | B | Discoverable разрешённое read-only view |
| Requests/Equipment/Announcements/Meetings/Documents | Есть | requests, assets, announcements, governance, documents | Соответствующие domain permissions | A | Создание/детали/обновление согласно роли |
| Meters navigation + screen | Форма есть, меню нет | GET/POST meters; POST readings | meters.manage + meters module | B | Подключить маршрут, create/readings/history и scoped unit selection |
| House/open/overdue/planned-maintenance cards | Часть | role-insights, queue, maintenance | Properties/requests/assets | B | Отдельные реальные KPI + фильтры |
| Today queue / assign / take in work / ... | Есть часть queue | requests/workflow | requests.assign/workorders.accept | B | Не позволять manager выполнять за техника |
| + Create task | Phone intake внутри works | requests, core operations | requests.assign | B | Dashboard shortcut с верным типом заявки |
| Collection summary/history/details | Отдельная analytics | finance/analytics | billing.read | B | Реальный период/история, нет invented trend |
| Latest requests/all requests | Есть queue | hayat/queue | requests.read | B | Ограниченный overview блок + полный список |
| Maintenance calendar/arrows/all calendar | Есть внутри maintenance | maintenance plans/occurrences | assets.read/manage | B | Отдельная календарная композиция и period |
| Completed acts/all acts/accept | Есть workflow | work orders | workorders.accept | B | Фильтр review/accepted и независимая приёмка |
| Announcement/create | Есть /hayat/announcements | announcements/publish | announcements.manage | B | Home preview + shortcut |
| Upcoming meeting/materials/... | Есть /hayat/meetings | governance/meetings | meetings.manage | B | Ближайшая встреча, agenda и материалы |

## 7. Dispatcher

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Requests queue/filters/kanban | Есть /hayat/works | hayat/queue | requests.read/assign | A | Scope, statuses, paging, filters |
| Incidents/open incident | Есть /hayat/incidents | incidents | incidents.read/manage | A | Перейти к настоящему инциденту |
| Emergency banner/dismiss | Не собран | incidents | incidents.read | B | Banner из активного incident, dismissal не закрывает incident |
| New/unassigned/overdue/in-progress cards | Часть | queue stats, role-insights | requests.read | B | Карточки с конкретными фильтрами |
| Register request | Есть PhoneRequestForm | requests | requests.assign | A | Property/unit/resident scope |
| Details side panel / close | Есть detail flow | requests/:id | requests.read | B | Согласовать с выбранной kanban карточкой |
| Assign executor / date/time / assign | Есть RequestOps | visits, assignments | requests.assign | A | Проверка доступности и scope исполнителя |
| Reply / internal note / send | Есть workflow | messages/notes | requests.assign + visibility | A | Internal note не видна resident |
| Calendar/day schedule/open calendar | VisitSchedule есть | operations/visits | requests.read/assign | B | Отдельный destination и фильтры |
| Executors/availability/all executors | Частично setup/queue | operations/setup | requests.assign | B | Реальная availability, не online status из demo |
| Communications/Reports | Не отдельные страницы | Есть часть сообщений/статистики | Только допустимые operations | B | Не выдавать общий finance/report permission |
| In progress → map | Нет геоданных/карты | Не подтверждён источник | Scoped requests | B | Нужна реальная функция или объяснённая недоступность |

## 8. Technician

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Today/Works/Equipment/Profile | Есть HAYAT | queue, assets, auth | Assigned work + assets.read | A | Нижнее меню 390px |
| Current date/task/urgent counts | Есть часть | queue stats | workorders.assigned | B | Today selection и локальный timezone |
| Scan QR | Asset lookup/QR primitives | assets/lookup, assets/:id/qr | assets.read | B | Проверить camera/manual fallback и permission denial |
| Urgent task/open work | Есть queue/detail | requests/:id | Assigned work | A | Только назначенные работы |
| Active checklist progress | Есть в карточке работы | work order checklist | workorders.execute | B | Summary/shortcut на home |
| Add photo/materials | Есть внутри OfflineWork/RequestOps | photos/materials | workorders.execute | B | Home shortcut к правильной работе |
| Upcoming tasks | Есть queue/schedule | visits/work orders | workorders.assigned | B | Полный today/upcoming filter |
| Accept/start/pause/resume/cannot perform/report/submit | Есть workflow | workflow transitions | workorders.execute | A | Все переходы + серверные отказы |
| Offline draft status/open/retry | Есть per-work drafts | IndexedDB + explicit send | User/context-bound | B | Общая видимость drafts; не обещать автосинхронизацию |
| “Will send on connection” из картинки | Намеренно не переносить | Policy запрещает automatic submit | — | D | Reconnect не отправляет работу без действия пользователя |

## 9. Contractor

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Tasks/defects tabs | Есть назначенные defects | hayat/queue, defects | defects.assigned | B | Различимые filters, не дублировать WorkOrders |
| In-progress/awaiting-review counters | Часть | defects stats/role-insights | defects.assigned | B | Точные состояния без чужих дефектов |
| Defect photo/location/deadline/status | Есть detail/queue | defects, evidence | defects.assigned | A | Scoped private bytes |
| Documents count/documents tab | Не полный scoped UI | Evidence не равны всем documents | defects.assigned/execute | B | Только связанные допустимые доказательства |
| Add result photo/upload evidence | Есть | defect evidence | defects.execute | A | Сохранение и download permissions |
| Submit for review/return response | Есть workflow | defect transitions | defects.execute | A | После возврата можно исправить и повторно отправить |
| Accept/start | Есть workflow | defects transitions | defects.execute | A | Не confuse с заказчик.accept |
| Clarify | Не подтверждён отдельный conversation UI | Частичная история | Assigned defect only | B | Нужен безопасный комментарий/переписка |
| Generic documents.organization read | Не разрешён | Не предоставлять | Нет documents.read | D | Не открывать общий архив из нижней вкладки |

## 10. Security

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Passes/Events/Incidents/Profile | Есть HAYAT | passes/events/incidents/auth | access.validate/events | A | Все четыре destinations |
| Controller online | Нет реального provider | AccessControlProvider отсутствует | — | C | Controller not configured, не зелёная online-точка |
| Scan pass/manual code or vehicle | Есть validation/search primitives | pass validation / queue | access.validate | B | Camera/manual flow и ошибки |
| Expected/On territory/History tabs | Есть фильтры/состояния | expected/inside/exited | access.validate/events | A | Entry/exit меняют правильные группы |
| Valid/expired/revoked chips | Есть validation | visitor_passes | access.validate | A | Время и revoked проверяются сервером |
| Mark entry/exit | Есть | access events | access.events | A | Повтор/невалидный state не создаёт ложное событие |
| Recent events/all events | Есть | access events | access.events | A | Scope, порядок и список |
| Report incident | Есть | incidents | incidents.create | A | Сохранение и видимость dispatcher/manager |

## 11. Developer / handover

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Projects/Units | Часть /os/properties, units | properties/units | properties.read | B | Не считать project отдельным engine без нужды |
| Handover/Inspections/Defects/Warranty | Вложено в Lifecycle/Workflow | handovers, inspections, warranties, defects | handover.*, defects.* | B | Discoverable страницы/filters |
| Project/building selector | Частично | Context + properties | Scope | B | Reset selected unit/plan при смене |
| Ready/today/open/on-review cards | Частичные metrics | role-insights + handovers/defects | handover.read/defects.read | B | Definition и real counts |
| Schedule inspection | Есть | handovers/:id/inspect | handover.manage | A | Дата, статус, reload |
| Floor/unit readiness matrix | Нет | Units + handover state частично | handover.read | B | Реальная этажность и readiness, без demo grid |
| Floorplan/open full/zoom | Нет полного объекта plan | Новые metadata/storage нужны | handover.manage/read | B | Upload/configure/empty; private file authorization |
| Defect markers / select marker | Нет | Coordinates/plan link отсутствуют | defects.read/manage | B | Связь defect с планом; bounds/version |
| Selected unit defects/add defect | Есть общий defects flow | defects | defects.manage | B | Привязать к selected unit |
| Contractors jobs/status/list | Есть defects assignments | defects | defects.read/manage | B | Таблица назначенных работ, не generic contractor user dump |
| Upcoming inspections/all inspections | Есть данные | inspections | handover.read | B | Календарный dashboard block |
| Expiring warranty/all warranties | Есть данные | warranties | handover.read | B | Сроки и drill-down |
| Documents/Reports | Не полная роль-специфичная функция | Domain evidence частично | У developer нет общего documents.read/reports.export | B | Определить допустимый domain access, не расширять молча |

## 12. Portfolio owner

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Objects/Lease/Budget/Expenses | Есть отдельные экраны | portfolio/objects, leases, budgets, expenses | properties.read/leases.read/expenses.read | A | Только свой portfolio scope |
| Objects/occupancy/income/expenses cards | Есть analytics | portfolio/analytics | billing.read/expenses.read | B | Overview composition + period consistency |
| Cashflow chart/month selector | Есть analytics | Actual cashflows | Finance scope/currency | A | Empty history и отсутствие fake projection |
| Object table/status/service issues | Часть | objects + analytics | properties.read | B | Единые агрегаты по объекту |
| Approve expenses/view all/review | Есть expense approval | expenses/:id/approve | expenses.approve | A | Независимость согласования и актуальная версия |
| Contractor scorecard/all contractors | Endpoint есть, role access не готов | contractors/scorecard | Нужен явный разрешённый policy | B | Не давать defects tenant-wide автоматически |
| Expiring leases/all leases | Есть leases data | leases | leases.read | B | Dashboard card + date filtering |
| Service/Documents navigation | Нет полного безопасного view | Доменные read models нужны | В default role нет requests.read/documents.read | B | Отдельный scoped доступ либо явное объяснение |
| Reports/export | Есть | reports/invoices.csv | reports.export | A | Проверить область/валюту |

## 13. ImTun owner

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Greeting/unit/context | Есть /imtun/owner | session/context | properties.own | A | Правильное помещение после switch |
| Amount/period/charges | Есть finance | finance own invoices | billing.own + payer | A | Не сумма всех счетов помещения |
| Pay | Открывает finance | Gateway отсутствует | billing.own | C | Invoice/payment information, provider state; не fake charge |
| Meters/Request/Pass/Documents | Есть quick actions | meters/requests/passes/documents | Соответствующие own permissions | A | Каждая кнопка ведёт в разрешённый workflow |
| Meetings/materials/vote | Есть governance | governance/meetings, vote | meetings.read/vote + legal ownership | A | Snapshot, eligibility, повторное голосование |
| Family | Есть Delegations | delegations | residents.delegate | A | Permission allowlist и expiry |
| Recent work/check result | Есть request detail | workflow | requests.own | B | Вывести актуальный review CTA на home |
| Announcements/upcoming meeting | Есть отдельные данные | announcements/governance | announcements.read/meetings.read | B | Композиция и быстрые переходы |
| Home/Payments/Requests/Profile bottom nav | Есть | Product navigation | Фильтрация permissions/modules | A | 390px, focus/aria |

## 14. ImTun renter

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Lease/access-until badge | Данные есть | leases/current assignment | leases.own | B | Видимое актуальное окончание доступа |
| Assigned charges | Есть finance | finance own payer | billing.own | A | Не счета собственника |
| Pay | Invoice flow | Gateway отсутствует | billing.own | C | Правдивое состояние способа оплаты |
| Meters/Request/Guests/Documents | Есть | Own domain APIs | Own permissions | A | Lease expiry/module denial |
| Own requests/all requests | Есть | requests own | requests.own | A | Не заявки другого жильца |
| Approve visit | Есть RequestOps | requests/:id/visits/:visitId | Own request | B | Доступный home shortcut + подтверждение следующей ролью |
| News/all news | Есть | announcements | announcements.read | A | Правильное здание |
| Lease card/open | Есть отдельный leases screen | leases | leases.own | B | Устойчивый home destination |
| Ownership/vote/family admin | Намеренно нет | Не давать | Нет соответствующих прав | D | Negative route/API checks |

## 15. ImTun family

| Блок/действие | UI / маршрут | API / данные | Permission | Класс | Разрыв / проверка |
|---|---|---|---|---|---|
| Greeting/unit/service card | Есть /imtun/family | session/context | Active assignment/delegation | A | Не превращать family в resident super-role |
| Create request/my requests | Есть | requests | requests.create/own, если делегированы | A | Denied permission скрывает CTA и блокирует API |
| Announcements | Есть | announcements | announcements.read | A | Правильное здание |
| Management contacts/emergency call | Branding support details есть | organization branding | Allowed context | B | Реальный tel/contact; без выдуманного номера |
| Home documents | Условно есть | documents | documents.read, если действительно в контексте | A | Default role ≠ owner-delegated permissions |
| My key/credential status | Нет общего credential UI | Delegation/pass data частично | access.create только если делегировано | B | Не подменять физический credential гостевым pass |
| Open door | Не подключено | Physical provider отсутствует | — | C | Сообщить «Physical access provider not configured» |
| Own request detail | Есть | requests own | requests.own | A | Не показать все заявки семьи/квартиры |
| Finance/ownership/vote | Намеренно нет | — | Отсутствуют | D | Negative checks |
| Bottom Home/Requests/Announcements/Profile | Частично общий Resident nav | Product features | Delegated permissions | B | Role-specific discoverable menu |

## 16. Сквозной IAM backlog по новому промпту

| Возможность | UI | API/model | Статус | Проверка |
|---|---|---|---|---|
| Platform user directory/search/filter | Нет полного | Есть users/account primitives | B | Paging, safe fields, no tenant business leakage |
| Account create/invite/activate | Invite есть | Invitation flow есть | B | Без plaintext password, explicit creation policy |
| Disable/reactivate/lock/unlock | Частично blocked | Lifecycle расширить | B | Независимость от assignment и немедленное прекращение сессий |
| Force logout/revoke sessions/reset required/MFA state | Только self-service часть | Admin APIs нужны | B | No tokens/secrets, fresh-auth |
| Platform/organization assignments | Частичный invite/revoke | Existing assignments | B | Scope/date/state/version/history |
| Custom roles/global templates | Нет | Эквивалент не найден | B | Immutable system roles; delegation allowlist |
| Permission matrix/domain filters | Нет | Catalog есть | B | UI labels совпадают с server keys |
| Per-user restrictions | Нет | Новая модель нужна | B | Deny priority; не расширяет scope |
| Exceptional grants | Нет | Отдельный audited allowlist нужен | B | Не bypass module/subscription/ownership |
| Effective access debugger | Нет | Нужно reuse evaluator | B | Совпадает с endpoint для конкретного объекта |
| Structured before/after audit | General audit есть | Новые events нужны | B | Все IAM mutations, без secrets |

## 17. Порядок выполнения и итоговые таблицы

1. Завершить подключение уже существующих функций к меню, начиная со счётчиков управляющего.
2. Реализовать IAM модель/guards и негативные тесты в изоляции.
3. Подключить Users & Access, employee card, role builder/matrix/debugger.
4. Общие header search/notifications/context и dashboards по ролям.
5. Новые domain gaps: планы/markers, недостающие aggregates/contacts/scheduling.
6. Выполнить 14-role browser acceptance и семь cross-role journeys.
7. Повторно классифицировать все строки; только тогда сформировать финальные числа.

| Роль | Референсные блоки | Реализовано | Не хватает | Внешне заблокировано | Browser accepted |
|---|---|---|---|---|---|
| platform_admin | §2 + общие | Частичные Console flows | IAM, overview composition, integrations/system | Platform Billing | Нет новой полной приёмки |
| org_admin | §3 + общие | Registry/invites/modules/branding | Employee IAM/custom roles/overview | Bank/SMS/telephony | Нет |
| support | §4 + общие | Onboarding/support/imports | Diagnostics/meetings/composition | Инфраструктура отдельных diagnostics | Нет |
| accountant | §5 + общие | Finance/batches/bank statement | Navigation/dashboard/history | Bank settlement provider | Нет |
| manager | §6 + общие | Operational workflows | Meters navigation/dashboard composition | Нет нового provider blocker для meters | Нет |
| dispatcher | §7 + общие | Queue/kanban/visits/incidents | Full control center | Не симулировать telephony | Нет |
| technician | §8 + общие | Work execution/offline per-work | Home shortcuts/draft overview | Native не входит в этап | Нет |
| contractor | §9 + общие | Defects/evidence/transitions | Scoped docs/clarification/navigation | Нет обязательного нового provider | Нет |
| security | §10 + общие | Pass/event/incident workflows | Scan UX/controller state | Physical controller | Нет |
| developer | §11 + общие | Handover/defect primitives | Matrix/plan/markers/full dashboard | Нет обязательного нового provider | Нет |
| portfolio_owner | §12 + общие | Portfolio/finance/lease | Overview/scoped service-doc-scorecard | Нет обязательного нового provider | Нет |
| unit_owner | §13 + общие | Own workflows | Home review/meeting composition/header | Payment gateway | Нет |
| renter | §14 + общие | Own finance/request/lease | Home expiry/visit shortcuts | Payment gateway | Нет |
| family | §15 + общие | Scoped requests/news/docs | Contacts/credential/nav | Physical access | Нет |

Таблица Screenshot → Visible functions → Working → Newly implemented → Remaining
пока представлена детальными разделами 2–15: у каждой функции есть свой класс и gap.
**Newly implemented на момент этого baseline: 0.** Число Working не выдумывается:
пока это только source evidence A, не новая runtime acceptance.
Произвольные проценты завершённости не используются.

## 18. Реализация после baseline: счётчики управляющего

Закрыт конкретный навигационный разрыв §6: `/hayat/meters` подключён к меню HAYAT
на desktop и mobile. Используются прежние meter API и Community forms:
список → создание → выбор прибора → подача показания → история.
Названия переведены на RU/HY/EN. Пункт требует `meters.manage` и meters module.
При смене контекста компонент перемонтируется; права на данные проверяет сервер.

| Проверка 2026-10-07 | Результат |
|---|---|
| Frontend TypeScript | PASS |
| Routing/navigation tests | 5 PASS: три новых, два существующих |
| Vite production build | PASS; существующее предупреждение о большом Portal chunk остаётся |
| Manager desktop: открыть меню и увидеть meter UI | PASS |
| Создать water meter на разрешённом fixture unit | PASS |
| Подать показание 12.345 за прошлый месяц | PASS |
| История после reload и повторного выбора | PASS |
| Перейти на dashboard и обратно; direct-link reload | PASS |
| Manager 390×844: controls и нижнее меню без горизонтального overflow | PASS |
| Dispatcher: пункта нет, direct route не раскрывает форму | PASS |
| Dispatcher: GET /api/meters | 403 forbidden |
| Изоляция QA | Отдельная vernatun_test schema; main business data не изменялись |
| Остановка QA / cleanup | Runner завершился с кодом 0 |

Это одна принятая часть manager workspace, не полная приёмка роли.
Не выполнены в этом проходе: прочие 13 ролей, все пять ширин, полная accessibility,
module-disabled browser case, новые IAM сценарии и семь cross-role journeys.
Общий статус нового промпта остаётся **PARTIAL**.

Миграций и нового backend business engine в этом изменении нет. Production не публиковался,
письма не отправлялись. Четыре документа первого аудита созданы в каталоге документации
существующего Vernatun, а не в отдельном продукте.

## 19. Продолжение IAM

Исходный аудит принят; повторный аудит не проводился. Реализованы IAM foundation,
платформенный реестр пользователей и организационный редактор сотрудников/ролей.
IAM milestone завершён: целевые API/browser проверки прошли. Точная матрица результатов
и границы проверенного объёма — `IAM-IMPLEMENTATION-PROGRESS.md`.
Исходные статусы baseline выше не следует читать как актуальный список отсутствующего кода;
закрытие IAM не означает завершения всех остальных панелей или общеплатформенной регрессии.

## 20. Browser acceptance update — 2026-10-23 (исторический снимок)

В изолированной QA-схеме проверены 14 ролей, 112 видимых пунктов меню и 560
сочетаний роли, экрана и ширины (360, 390, 768, 1024 и 1440 px). На проверенных
страницах не обнаружены горизонтальное переполнение, пропущенные заголовки,
ошибки JavaScript или ответы 5xx. Одна кнопка переключения модуля без доступного
имени исправлена.

Эти результаты подтверждают базовую навигацию и responsive-раскладку, но не
полную приёмку каждой мутации 14 ролей, не keyboard/screen-reader аудит и не
пиксельное совпадение с 15 скриншотами. Существующий KPI registry содержит
определения, запросы, права, модули, scope и no-data поведение для role KPI;
связь каждого видимого блока каждого референса с реальным компонентом и
проверенным drill-down ещё не принята целиком.

На момент этого снимка из семи сквозных UI-процессов были подтверждены
приглашение, custom role/debugger, заявка жителя, начисление/сверка,
дефект/подрядчик и пропуск/охрана. Результат собрания обновлён в разделе 21 ниже.

Сводки, графики, визуальная композиция всех 15 референсов и соответствие каждой
их карточки реальному источнику данных по-прежнему имеют статус **PARTIAL**.
Промышленная база и внешние интеграции в браузерном QA не использовались.

Финальные проверки того же прохода: общий workspace typecheck и Vernatun Vite
production build прошли; `git diff --check` прошёл. Preview `/login` загрузился.
Успешный frontend build не означает, что визуальные разрывы или production
приёмка закрыты.

## 21. Browser acceptance: weighted meeting, vote, and protocol — 2026-10-23

Повторный сценарий прошёл в отдельной `vernatun_test` QA-схеме. Собрание было
создано и опубликовано, собственник подал голос внутри окна голосования, затем
управляющий завершил собрание. После повторной загрузки страницы отображались
итоги, кворум и защищённая ссылка на протокол.

| Проверка | Результат |
|---|---|
| Действительный голос до `ends_at` | PASS — собственник с долей 100% |
| Подсчёт и порог кворума | PASS — участие 100%, кворум 50%, вариант принят |
| Повторная загрузка результата | PASS — итог сохранён и виден в UI |
| Протокол | PASS — PDF скачан, `application/pdf`, сигнатура `%PDF-` |
| Разрешённые / запрещённые роли для скачивания | PASS — менеджер и проголосовавший собственник получили 200; подрядчик получил 403 |
| Изоляция | PASS — временная тестовая схема удалена после остановки runner; production не затронут |

Таким образом, каждая из семи перечисленных цепочек имеет отдельное UI
подтверждение в изолированной QA-среде. Полный повторный regression-run всех
семи цепочек одним проходом и production-приёмка не выполнялись.

Остаток для полного закрытия референсного промпта: pixel/parity-разбор каждого
блока 15 экранов; исчерпывающая проверка всех разрешённых и запрещённых ключевых
мутаций 14 ролей (представительная матрица по одной разрешённой и запрещённой
операции на роль завершена; см. раздел 22
`PRODUCT-INTERFACE-COMPLETION-STATUS.md`); keyboard/focus, screen-reader и
touch-target проверка всех экранов; формальное сопоставление каждого показателя
и drill-down с его реальным источником; оставшиеся композиции overview, графики
и доменные сводки. Это остаётся **PARTIAL** и не выводится из успешного meeting test.
