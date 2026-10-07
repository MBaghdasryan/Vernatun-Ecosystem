# Vernatun — единый отчёт по мастер-промпту, Phase 0–8

**Дата среза: 7 октября 2026 года, Asia/Yerevan.**

## 1. Общий итог

Восстановленная платформа сохранена и существенно дополнена. Основные бизнес-функции Phase 1–7 реализованы; Phase 8 выполнена частично. **Весь мастер-промпт не закрыт. Готовность к production не заявляется.**

Четыре продукта работают в общей платформе:

- **Vernatun Console** — управление платформой, организациями, подписками, внедрением и поддержкой.
- **Vernatun OS** — управление объектами, пользователями, финансами и документами.
- **HAYAT** — операционные процессы управляющего, диспетчера, техника и других сотрудников.
- **ImTun** — собственник, житель, арендатор и делегированные пользователи.

HAYAT и ImTun восстановлены как адаптивные Web-модули, **не Expo/native приложения**. Сохранены общая идентификация, Workflow, PostgreSQL, серверные полномочия и продуктовый брендинг.

Этот файл объединяет последнее подтверждённое состояние. Старые утверждения «Phase 3–8 ещё не начаты» и «группирование портфеля отсутствует» не считаются текущими.

### Как читать статусы

- **COMPLETE implementation** — функциональность реализована в backend и интерфейсе в указанном объёме.
- **COMPLETE targeted acceptance** — прошли конкретно перечисленные проверки, не любая возможная комбинация ролей/устройств.
- **PARTIAL** — остались функции, приёмка или эксплуатационные проверки.
- **EXTERNAL BLOCKER** — нужны внешняя готовность, настройка или разрешение; наличие кода не устраняет блокер.

Процент готовности не назначается: пункты различаются по сложности. Наличие таблицы или экрана не заменяет работоспособный процесс.

## 2. Сводная таблица всех фаз

| Фаза | Последнее состояние реализации | Проверка / что не позволяет закрыть всё |
|---|---|---|
| **0 — audit + regression baseline** | COMPLETE для development baseline и восстановления | Не является финальным production audit или полной приёмкой 14 ролей |
| **1 — critical blockers** | COMPLETE implementation основных invitation/reset/audit/policy/support-access функций | EXTERNAL BLOCKER: domain/sender/live email; invite→join и reset через настоящий почтовый ящик не подтверждены |
| **2 — core operations** | COMPLETE implementation операционного объёма | Целевая UI/API-проверка выполнена; новые online-intents и intake-фото не восстанавливаются после перезагрузки |
| **3 — maintenance + ImTun lifecycle** | COMPLETE implementation | PARTIAL UI acceptance: полный manager maintenance/lease CRUD и часть конфликтных сценариев не приняты браузером |
| **4 — finance** | COMPLETE implementation business-объёма | PARTIAL browser acceptance: успешный Ignore банковской строки и полный денежный end-to-end не подтверждены браузером |
| **5 — Console operations** | COMPLETE implementation и COMPLETE targeted browser acceptance | Полная role/device matrix, production private-byte delivery и email остаются вне подтверждённой приёмки |
| **6 — ownership/meetings/documents/analytics** | COMPLETE implementation в указанной модели; grouping добавлен позднее в Phase 7 | PARTIAL browser acceptance голосования, протокола, document versions/download ACL и полного CRUD |
| **7 — storage/notifications/branding/limited PWA** | Основная реализация COMPLETE; portfolio grouping функционально закрыт | PARTIAL: реальные mobile/offline сценарии, object edit/assignment UI, production scheduler; EXTERNAL: email/live S3/production storage selection |
| **8 — QA/security/readiness** | PARTIAL: leads, MFA policy, часть paging, role metrics и security remediation реализованы | Остались OpenAPI, масштабируемые списки, timezone/i18n, MFA/UI/14-role matrix, A–H и production checklist |

**Вывод:** реализация большинства основных бизнес-блоков готова для дальнейшей приёмки. Это не утверждение, что все фазы полностью приняты или проект можно безопасно публиковать без оставшихся проверок.

## 3. Phase 0 — audit, восстановление и regression baseline

### Сделано

- Восстановлены существующие Vernatun Web/API и модули HAYAT/ImTun.
- Сохранены архитектура, продукты, исходные брендовые материалы и восстановленные данные; не создана новая параллельная платформа.
- Зафиксирована спецификация мастер-промпта, выполнена сверка возможностей и пробелов.
- Созданы изолированные regression-проверки с собственными тестовыми схемами и файлами.
- Исправлен lifecycle Web/API: один управляемый процесс-владелец на сервис, корректное завершение, ожидание свежей API-сборки, повторный restart без конфликта портов.
- Дополнительные development-миграции выполнялись после изолированной проверки; подтверждалась сохранность исходных полей, количества и хешей записей.

### Осталось / границы

- Полная итоговая межролевая и production-приёмка относится к Phase 8.
- Исторические тестовые результаты являются доказательствами конкретных прогонов, а не вечной гарантией после любых будущих изменений.
- Основная база не сбрасывалась и не заполнялась новым QA seed; production migration/publication не выполнялись.

## 4. Phase 1 — critical production blockers

### Сделано

**Приглашения и password reset**

- Создание, отзыв, повторная отправка и истечение приглашений.
- Hash вместо открытого токена, срок действия, single-use; повторная отправка делает предыдущую ссылку недействительной.
- Серверная логика принятия приглашения и безопасного сброса пароля.

**Почтовая архитектура и webhook**

- Общий `EmailProvider` с `ResendEmailProvider`, `SMTPEmailProvider`, `DevelopmentOutboxProvider`; бизнес-логика не привязана намертво к Resend.
- Resend подключён как выбранная интеграция.
- Endpoint `/api/webhooks/resend`: raw body, Svix signature verification, idempotency и обработка `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`.
- Журнал delivery evidence и Console Email; принятие провайдером не выдаётся за доставку адресату.
- Opens/clicks tracking не добавлялся.
- Целевой адрес, заданный пользователем: **https://vernatun.io/api/webhooks/resend**. Это согласованный target, не доказательство публикации или успешной live-доставки.

**Audit, subscriptions, support access**

- Защищённый аудит и интерфейс журнала.
- Планы, подписки, модули, ограничения зданий, read-only policy, причины overrides.
- Восстановленные организации не лишаются legacy-доступа до явной активации новой политики.
- Временный доступ поддержки с ограниченным scope, сроком, отзывом и свежей серверной проверкой.
- Назначения разных контекстов не объединяют права; завершившийся grant не даёт продолжать защищённые действия.

### Осталось / EXTERNAL BLOCKER

- Почтовый домен и verified sender не готовы/не подтверждены.
- Актуальная production-авторизация провайдера и вся цепочка accepted → sent → delivered → mailbox не приняты live.
- Настоящие invitation→delivery→join и reset→delivery→new password не проверены end-to-end.
- По указанию пользователя **реальные и тестовые письма не отправляются** до готовности домена и отдельного разрешения.
- Production rollout схемы, настроек и webhook ещё требует собственной приёмки.

## 5. Phase 2 — core operations

### Сделано

- Телефонная заявка диспетчера: разрешённые org/building/unit, действующий житель либо заявка помещения, категория, приоритет, связь, время, фотографии и необязательное немедленное назначение.
- Создание заявки и назначение выполняются атомарно; источник определяет сервер.
- Категории организации: создать/переименовать/деактивировать с version check; история не удаляется.
- Пять приоритетов, общий или категорийный SLA; четыре срока и снимок политики при создании.
- SLA due/overdue, approaching/breached, минутный worker, аудит и дедупликация эскалации.
- Предложение, подтверждение жильцом/техником, перенос, отмена и неизменяемая история визита.
- Техник: принять, cannot-perform с причиной, pause/resume.
- Структурированные материалы и услуги: количество, единицы, цена minor units, комментарий/автор; не фиктивный invoice.
- Приватные before/during/after/evidence-фотографии.
- QR оборудования, scoped поиск, камера при поддержке и ручной fallback; QR не выдаёт права.
- Инциденты: severity, lifecycle, версия, timeline и приватные санитизированные изображения.
- Visibility-aware polling 30 секунд вместо отдельного SSE: скрытая вкладка не опрашивает, возврат обновляет, scope-change очищает прежние данные.
- Явный повтор неизвестного результата с тем же UUID/payload; защита от дублей и поздних ответов.

### Осталось / ограничения

- Новые online-form intents и файлы телефонного intake остаются в памяти компонента: перезагрузка/уход со страницы не гарантируют восстановление.
- Persistent IndexedDB-черновики HAYAT сохранены, но это не означает persistence всех новых online-форм.
- Вложения этого блока — изображения, не любые документы.
- Полная сквозная/мобильная матрица остаётся частью Phase 8.

### Подтверждение

Изолированные API-проверки, signed-in UI и controlled phone/photo retry. В повторе подтверждены один create, одинаковый UUID и неизменные bytes; основные бизнес-данные не изменялись ради QA.

## 6. Phase 3 — maintenance и ImTun lifecycle

### Сделано

**Maintenance → WorkOrder**

- Разовые и периодические планы, категория/приоритет/инструкции/checklist, явное включение auto-generation.
- Plan → cycle event → настоящая заявка → существующий WorkOrder, без дублирующего Workflow.
- Building scope и системное происхождение общедомовой работы, без фиктивной квартиры/сотрудника.
- Назначение, выполнение, checklist, обязательная приватная фотография, возврат или приёмка управляющим, следующий цикл и история оборудования.
- Защита конкуренции, уникальность цикла, replay старого действия; максимум одно незакрытое событие плана.
- Восстановленные планы не активируются автоматически; прежний shortcut completion не обходит проверку работы.

**ImTun и доступ**

- Delegation: email, optional phone, ограниченные права, срок, отдельный invitation/assignment, изменение срока, resend/revoke.
- Чувствительные операции требуют свежей авторизации; нет автоматического resubmit после reauthentication.
- Житель подтверждает визит или запрашивает другое время с причиной; прежние предложения сохраняются.
- Notification deep links повторно проверяют доступ; переход между assignments требует подтверждения и re-resolution.
- Lease lifecycle: периоды, продление, отмена, версии, запрет пересечений и проверка доступа по действующему договору.
- Legacy renter access сохраняется до первого записанного договора; после него применяется периодная политика.

### Осталось / ограничения

- Полный manager maintenance/lease CRUD и stale-version UI не прошли отдельную исчерпывающую browser-приёмку.
- Ранний 401 входа управляющего из Phase 3 не является текущей общей неисправностью: в Phase 6 вход управляющего и HAYAT read-only были подтверждены. Однако прежние непроверенные мутации автоматически не становятся принятыми.
- Доступ бывшего арендатора к historical receipts/documents не активирован как отдельная политика.
- Реальная доставка delegation invitation — внешний email-блокер.
- SMS и phone-only authentication не реализованы; телефон остаётся контактом.

## 7. Phase 4 — finance

### Сделано

- Mass billing: здание/месяц/тариф, правила плательщиков, preview количества/сумм/пропусков/warnings.
- Черновик не создаёт ledger-записи; publish повторно проверяет расчёт и подтверждение warnings.
- Atomic publish: счета, строки и связи пакета целиком либо rollback, без частичного результата.
- CSV bank statements с явным mapping, units/decimal/date/currency; preview duplicates/conflicts, до 1000 строк / 1 MB.
- Структурированная evidence и исходные поля; импорт сам не создаёт платежи.
- Явная reconciliation, unmatched/partially_matched/matched/ignored, подсказки без автоматического подтверждения.
- Частичные и multi-invoice allocations, account credit, отдельное распределение аванса.
- Точные minor-unit/BigInt расчёты; блокировки финансовых родителей и защита конкурентного расходования.
- Tenant/unit/payer/currency guards; опубликованные записи не переписываются, исправления отдельными корректировками.
- ImTun показывает только собственные счета/кредит/историю, без банковской evidence и бухгалтерских действий.
- Frozen intents и явный одинаковый retry; scope/polling/late response не подтверждают деньги автоматически.

### Осталось / ограничения

- Успешный Ignore outcome не подтверждён браузером; real isolated API-сценарий прошёл.
- Полный batch→bank→allocation→resident end-to-end в браузере ещё не принят.
- Списки billing batches и imports ограничены последними 100; унификация scalable tables остаётся Phase 8.
- Credit ограничен одним unit/payer/currency; перенос между помещениями не реализован.
- Не подключены bank gateway, acquiring, refund provider или фоновые банковские интеграции.
- Это не production financial acceptance на реальных платежах.

## 8. Phase 5 — Console, support, onboarding, imports

### Сделано

**Organization lifecycle**

- Юридическое название/идентификатор/адрес/контакты/timezone/default currency/language.
- Связи с модулями, зданиями, пользователями, подписками, внедрением, поддержкой и аудитом.
- Profile edit, suspend/archive/restore с причиной, подтверждением, version/idempotency и аудитом.
- История и данные не удаляются; suspended/archive contexts не дают новые обычные бизнес-действия.

**Support**

- Append-only public/internal conversation, автор/время/вложения выбранных документов.
- Category/priority/status/assignee, серверный SLA deadline.
- Unassigned/mine/all queues, overdue/priority/org/status filters, поиск и server pagination.
- Assignment, resolve/reopen, версии, privacy и case-scoped document access.
- Старые ответы сохраняются как legacy snapshots; неизвестные исторические авторы/время не выдумываются.

**Onboarding**

- Этапы, assignee, срок, order, dependencies, notes, progress/history.
- Prerequisites блокируют start/complete; зависимости только одной организации, без циклов.
- Reopen с явным подтверждением cascade для затронутых этапов; прежняя история сохраняется.

**Typed imports**

- Units, owners, residents, meters, opening balances.
- Mapping/preview/staging → явный confirm → повторная validation → atomic commit.
- Tenant/account/payer/module/duplicate guards; rollback всего job при поздней ошибке.
- Resident import создаёт access/lease с явными rent/currency/dates; owner import — access, не юридическая доля.
- Opening balances: точные signed minor units, опубликованный долг либо account-bound credit, не выдуманный банковский депозит.

### Осталось / ограничения

- Support SLA фиксирован на сервере, не отдельный configurable SLA engine; исторический derived deadline не доказывает старое выполнение.
- Полный case private-byte download на production-файлах не принят.
- Optional onboarding attachments не добавлены.
- Typed XLSX всех пяти типов и автоматическое создание identity accounts не реализованы.
- Полная role/device matrix остаётся Phase 8.

### Подтверждение

**COMPLETE targeted browser acceptance:** organization guards/routing, staff/customer conversation, resident mapping, finance-only imports, exact-intent retry, onboarding prerequisites/cascade/history и выбранные mobile screens. Это не универсальная production-приёмка.

## 9. Phase 6 — ownership, meetings, documents, analytics

### Сделано

- Юридические доли отделены от role assignments; периоды, основание, конкретная версия документа, immutable history.
- Серверная/DB защита суммы одновременно действующих долей ≤100%, конкуренции и stale versions.
- Weighted meetings: draft/agenda/options/rules/quorum/period/documents.
- При publish фиксируются ownership snapshot, участники и версии приложений; последующие изменения долей не меняют голос.
- Одно голосование по доле/вопросу, weighted quorum/results, предварительный статус до окончания.
- Неизменяемый итог и приватный Unicode PDF protocol.
- Version-aware documents: initial upload/new version, предыдущие bytes сохраняются, ACL, sanitization, private downloads.
- Frozen binary intent, explicit retry и ограничение ожидания UI 35 секунд.
- Support sharing закреплено за выбранной версией, не всеми будущими версиями.
- Portfolio analytics: period/currency/object/building, начисления, allocations, остаток/сбор, согласованные расходы, бюджеты, договоры, работы/SLA.
- Exact money arithmetic; неизвестная occupancy/history не заменяется выдуманным нулём или 100%.
- Contractor scorecard из реальных defects/history: завершения/приёмки/возвраты/SLA/reopen/time, без выдуманных звёзд.
- **Grouping зданий в самостоятельные portfolio objects реализован в Phase 7; старый gap Phase 6 закрыт функционально.**

### Осталось / ограничения

- Полный browser CRUD долей, voting/quorum/protocol, version history/download ACL и new-version modal не принят.
- Источник scorecard — contractor-assigned defects; отдельной модели всех contractor work assignments нет. Technician WorkOrders не смешиваются с ними.
- PDF protocol сам по себе не является квалифицированной электронной подписью и не доказывает юридическую силу решения.
- Предупреждение `MaxListenersExceededWarning` в private-storage тестах требует исследования; тесты прошли.
- Большой Portal chunk — performance debt, не ошибка успешной сборки.

### Подтверждение

8/8 isolated integration groups, private-byte/version/backup проверки; read-only OS/HAYAT/ImTun/portfolio и отдельные mobile screens. Guarded binary retry/abandon подтверждён synthetic transport, не реальной загрузкой в main.

## 10. Phase 7 — storage, notifications, branding, limited PWA

### Сделано

- Каталог 21 обязательного notification event, отдельное security event и legacy совместимость.
- Реальные in-app события, глобальные настройки и восемь категорий, version conflicts/deduplication.
- Security mandatory policy явная; обычные события не обходят opt-out.
- Scope-aware links и подтверждение смены контекста; ручная идемпотентная проверка сроков.
- Email intentions остаются `pending_domain`, не «доставлено».
- Organization branding: имя, цвета, support/site/privacy/terms, версии и `organization.settings`.
- Безопасный приватный PNG/JPEG/WebP logo upload с преобразованием в JPEG; private/no-store и fallback исходных продуктовых логотипов.
- `PrivateStorageProvider`: App Storage, Local, S3-compatible; переключение только явно, без автоматического переноса/удаления/fallback.
- Inventory/backup сохраняют file authorization и sanitization; инструменты не работают молча с неподходящим provider.
- Limited PWA: manifest, 192/512 icons, install prompt/instructions, public-static cache allowlist, offline fallback.
- API/auth/finance/documents/private photos не кешируются; черновики IndexedDB не удаляются обновлением оболочки.
- **Portfolio objects:** create/edit/view, building attach/detach, version/CAS, org scope, максимум один объект у здания.
- Перенос требует отвязки; удаление только пустого объекта, без удаления зданий/истории.
- Независимый object/building filter analytics/scorecard; основные данные автоматически не перегруппировывались.

### Осталось / ограничения

- Browser edit/assignment portfolio object не принят на непустом изолированном сценарии; API/формы реализованы и проверены отдельно.
- iPhone/Android install/offline/reload/device acceptance не выполнена.
- Новые online-intents/intake-фото не стали persistent; существующая offline-работа HAYAT сохранена.
- Production scheduler due-reminders не установлен.
- Live S3 endpoint/versioning/migration не проверены; production storage selection не подтверждён.
- Local reviewed-generation deletion отключён; S3 deletion требует versioning.
- SMS/push, native packaging и новая offline photo queue не заявляются готовыми.

## 11. Phase 8 — общая QA, security и readiness

### Сделано

**Leads**

- Реальный `POST /api/leads`, DB persistence, validation/consent/honeypot/отдельный rate limit.
- CSRF bootstrap landing перед POST; при ошибке форма сохраняется, при подтверждённом успехе очищается.
- Console Leads с `leads.read`, server search/sort/language filter/pages.
- Browser подтвердил anonymous session 200 → lead 201 → success/reset → admin list/search на отдельной настоящей тестовой базе.
- Email не отправляется; сообщение означает сохранение, не доставку.

**MFA-required rollout**

- Role/org policies для platform_admin и полного org_admin.
- По умолчанию обязательность не активируется.
- Собственная enrolled MFA и proof ≤15 минут для управления; reason/CAS, activation минимум через 24 часа.
- Fresh-context enforcement после срока, защита старой неподтверждённой сессии, запрет disable при применимой required policy.
- Recovery одноразовые, TOTP anti-replay; UI status/policy/reauth подключены.
- Backend rollout проверен изолированно; полный browser enrollment→policy→enforcement ещё не принят.

**Paging и dashboards**

- Scoped SQL paging для organizations/properties/units/people/invitations/audit.
- Bounds/allow-list sorting/stable tie-breaker/search/tenant-building-unit authorization.
- Canonical record tables подключены к server contract; legacy lookup arrays четырёх ресурсов ограничены 1000.
- API dashboards проверены для 14 ролей, устранён duplicate `openSupport`, effective modules учитываются.

**Readiness**

- Canonical OpenAPI расширен новыми paths/schemas, codegen и typechecks прошли.
- Static inventory: **228 найденных mounted операций / 110 documented / 118 gaps**.
- Dependency remediation: до 1 critical / 6 high / 3 moderate; после **0 critical / 1 high / 0 moderate**.
- Остался `braces@3.0.3` tooling advisory без доступного fix; пакет не найден в API-server dependency graph, workspace risk остаётся.
- SAST/privacy scan не вернули замечаний; это не полная security certification.
- Public widths 360/390/768/1024/1440, responsive navigation/logo/skip-link/required errors проверены; реальная login-форма на 390 px загружается.

### Осталось для закрытия Phase 8

1. Остальные растущие operational/financial/document tables и searchable lookups.
2. 118 static OpenAPI gaps, точные схемы, dynamic routes и legacy served contract.
3. Полный hy/ru/en и org/user timezone scan; UTC-derived defaults в Maintenance/Ownership/EmailConsole ещё не закрыты.
4. Browser MFA policy/enrollment/enforcement и новые record-table controls.
5. Authenticated 14-role × responsive matrix, keyboard/dialog/focus/contrast acceptance.
6. Сквозные A–H journeys, а не только независимые backend tests и частичные UI.
7. Оставшийся tooling advisory либо утверждённая mitigation.
8. Production prerequisites и deployment acceptance.

Первый intercepted browser run завис из-за тестового cookie/header forwarding, не общей неисправности main login. После исправления harness повторены только login/lead checks. Отдельно исправлен настоящий пропуск landing CSRF bootstrap. Остальные сценарии не объявлены пройденными.

## 12. Сквозные сценарии A–H: текущая оценка

| Сценарий | Реализация | Что осталось подтвердить |
|---|---|---|
| A — resident request → closed | Заявка, назначение, визит, работа, checklist/photos/report, проверка/возврат/подтверждение | Полный последовательный browser journey с разными действующими ролями |
| B — phone request → SLA/escalation | Phone intake, пять приоритетов, SLA, deadlines, идемпотентная escalation | Единый browser/worker end-to-end и устойчивость нового intake после reload |
| C — schedule → equipment history | Recurring plan, cycle, WorkOrder, checklist/photo, manager acceptance/history и QR | Полный manager/technician browser flow, включая конкуренцию/следующий цикл |
| D — batch → bank → resident | Atomic billing, CSV evidence, matching/allocations/credit/own view | Единая финансовая browser-цепочка и успешный Ignore outcome |
| E — organization → subscription → invite → join | Organization/policy/modules/invitation/acceptance backend | Реальный email и join; EXTERNAL BLOCKER domain/sender |
| F — support → expiry → denied | Conversation, scoped assignment/grant/expiry/revoke, guards и аудит | Полный browser flow до expiry и production private-byte delivery |
| G — family → revoke | Delegation, limited rights, acceptance, срок/revoke и recent-auth | Live invitation/acceptance и цельная browser-цепочка; email blocker |
| H — share → quorum → protocol | Ownership periods/snapshots, weighted voting/quorum/results/PDF | Full browser creation/vote/finalize/download с несколькими участниками |

**Ни один partial UI/API результат не подменяет полную сквозную приёмку всей таблицы.**

## 13. Проверки: что реально подтверждено

| Проверка | Последнее подтверждённое доказательство |
|---|---|
| Общий core regression | 114 passed / 0 failed в Phase 8 |
| Новая Phase 8 API suite | 6/6 отдельно |
| Phase 7 suite | 9/9 отдельно |
| Phase 6 integration | 8/8 отдельно |
| Backup + SQL/private-byte restore | 2/2 изолированно |
| Private storage migration/restart | 2/2 изолированно |
| Inventory/concurrency | 5/5 изолированно |
| Shared/API/Web TypeScript, codegen | PASS |
| Vite production build | PASS; Portal chunk-size warning |
| Main Web/API runtime | Работают после managed restart; session/dashboard/insights 200 |
| Public/login и выбранные mobile UI | Подтверждены в перечисленных targeted checks |
| Lead save → Console search | Browser PASS на отдельной базе |
| Полная ролевая/устройственная/A–H приёмка | НЕ ЗАВЕРШЕНА |
| Production publication/schema acceptance | НЕ ВЫПОЛНЕНА |
| Test/live email и mailbox receipt | НЕ ВЫПОЛНЕНЫ |

Числа разных suites нельзя складывать в «уникальное общее покрытие»: отдельные прогоны могут пересекаться. Тесты ради подготовки этого отчёта повторно не запускались.

## 14. Данные, безопасность и внешние ограничения

### Сохранность

- Development migration проходила изолированную проверку до применения.
- Для последних этапов подтверждено совпадение исходных полей/counts/digests **23 бизнес-таблиц**. Новые таблицы/поля ожидаемо добавлены.
- Main seed/reset, восстановление поверх текущих данных, тестовые финансовые записи в main, удаление/перенос основных private bytes и production migration не выполнялись.
- Backup SQL не означает автоматическую сохранность файлов: private-byte restore проверялся отдельно в парном изолированном восстановлении.

### Production / EXTERNAL BLOCKER

| Пункт | Состояние |
|---|---|
| Domain/verified sender/Resend live delivery | Не подтверждены; отправки отложены пользователем |
| Production webhook target | Согласован `https://vernatun.io/api/webhooks/resend`, live endpoint/delivery не подтверждены |
| Production schema rollout | Не выполнялся |
| Publish/custom-domain/production smoke test | Не выполнялись в этих этапах |
| Production storage selection/live S3 | Не приняты |
| Production reminder scheduler | Не установлен |
| Реальные устройства PWA/offline | Не приняты |
| Полный security/release checklist | Не закрыт |

В отчёте отсутствуют значения ключей, signing secrets, passwords, cookies и данные пользователей.

## 15. Порядок оставшейся работы

1. **Закрыть Phase 8 технические gaps:** scalable lists/searchable lookups, OpenAPI, timezone/i18n.
2. **Завершить приёмку:** MFA, record tables, оставшиеся manager/finance/documents/portfolio/offline UI, 14 ролей, responsive/a11y.
3. **Пройти A–H** на безопасных изолированных данных, отдельно фиксируя real API, synthetic transport и browser-only доказательства.
4. **Закрыть security/performance debt:** tooling advisory, listener warning, крупные frontend chunks.
5. **Подготовить production**: schema/backup/storage/scheduler/domain checklist и smoke acceptance без автоматической публикации.
6. **Email live verification** — только после готовности домена и явного разрешения пользователя.

Новые Payment Provider integrations, Boon, native apps и дополнительные Platform Operations extensions **не начинались**: по продолжению мастер-промпта они отложены до завершения или явной паузы Phase 2–8.

## 16. Основания отчёта

Сверены сохранённая `VERNATUN-PLATFORM-SPECIFICATION.md`, продолжение Master Completion Prompt, историческая foundation/Phase 1 сверка, отчёты Phase 2–7 и latest `PHASE8-READINESS-REPORT.md`. При конфликте исторического ограничения с позднее подтверждённой работой использовано позднее доказательство; остатки приёмки не удалены.

**Итог: бизнес-реализация значительно продвинута, grouping закрыт функционально, Phase 8 и финальный production acceptance ещё не завершены.**
