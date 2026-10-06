# Vernatun Completion Report — фактическое состояние проекта

Дата: **6 октября 2026 года**.

Основание: `VERNATUN-PLATFORM-SPECIFICATION.md`, текущие основные исходники Web/API, восстановленные отчёты HAYAT/ImTun, текущий изолированный regression run и read-only проверки Resend/публикации.

**Это подробный промежуточный отчёт, не финальный acceptance и не объявление готовности к production.** Реализованная в отдельной задаче доставка webhook ещё не объединена с основными исходниками и не считается работающей функцией платформы. Процент готовности не вычисляется: пункты существенно различаются по объёму, а наличие таблицы или экрана не означает завершённый процесс.

## 1. Executive summary

### Что уже работает в основном проекте

- Восстановленная платформа сохранена: React/Vite/TypeScript, Express, Passport/session, PostgreSQL, общий Workflow, исходные продукты и брендовые материалы.
- Четыре продукта используют общую идентификацию и серверные полномочия: Vernatun Console, Vernatun OS, HAYAT, ImTun. HAYAT/ImTun — адаптивные Web-модули, не Expo.
- Ролевые и организационные ограничения, ограничения по зданию/помещению, активные назначения и временные права поддержки проверяются сервером.
- Базовый цикл заявки/работы включает назначение, начало, чек-лист, отчёт, проверку, возврат, подтверждение/повторное открытие; есть история и проверка версии.
- HAYAT теперь содержит реально объединённую офлайн-работу техника/подрядчика: сохраняемые черновики и файлы, явная синхронизация, защита от повторов и конфликтов.
- В ImTun восстановлены пользовательские экраны и ограничения собственника/арендатора/семьи, базовые заявки, начисления, коммуникации и делегирование.
- Реализованы подписки/планы/модули, read-only policy, лимит зданий, причины overrides и соответствующие Console-экраны.
- Реализованы защищённый журнал аудита и временный доступ поддержки с отзывом/истечением.
- Реализованы создание/отзыв/повторная отправка приглашений и серверная логика password reset.
- Общий `EmailProvider` имеет отдельные Resend, SMTP и DevelopmentOutbox адаптеры. Бизнес-логика не привязана к Resend.
- Защищённое файловое хранилище, проверка доступа и очистка изображений сохранены.
- Текущий core regression: **61 passed / 0 failed**. Проверки типов Web/API и production Web build прошли.

### Чего нельзя заявлять

- Весь мастер-промпт **не завершён**; фазы 2–8 имеют существенные незакрытые требования.
- Реальная доставка Resend **не подтверждена**: подключённая интеграция возвращает `API key is invalid`.
- Webhook в основном проекте **не реализован/не активирован** на момент этого среза. Есть отдельная реализация со статусом «реализована», требующая объединения и последующей проверки.
- Проект **не опубликован**, production URL отсутствует. Callback на development URL не выдаётся за production webhook.
- Все 14 ролевых dashboard не воспроизведены в полном функциональном составе референсов.
- Сценарии A–H не пройдены целиком; нельзя заменять их проверку текущими базовыми тестами.

## 2. Architecture

Сохранены существующие стек, авторизация, база и разделение продуктов. Шаблонная Drizzle-схема не заменяет восстановленную бизнес-схему.

| Продукт | Основные типы пользователей | Текущая граница |
|---|---|---|
| Vernatun Console | platform_admin, support | Общая платформа, приглашения, audit, подписки/модули, ограниченная поддержка |
| Vernatun OS | org_admin, accountant, developer, portfolio_owner | Реестры, финансы, документы, передача/гарантии, базовая аналитика |
| HAYAT by Vernatun | manager, dispatcher, technician, contractor, security | Операционные очереди, общий Workflow, исполнительские карточки и ограниченный offline |
| ImTun by Vernatun | unit_owner, renter, family | Жилец/собственник, разрешённые финансовые и пользовательские процессы |

Логотип выбирается по продукту и user type, а не заменяется общим Vernatun со скриншота. Оригинальные HAYAT/ImTun материалы сохранены. Переключение поверхности не расширяет права.

Основная серверная реализация: `artifacts/api-server/archive/vernatun/server`. Web: `artifacts/vernatun/src`. Web/API используют существующие managed workflows и прокси `/api`; отдельное новое приложение не создавалось.

## 3. Database migrations

- В основных исходниках присутствуют миграции **001–013**.
- Восстановленные миграции не заменялись. Добавочная `013_platform_foundation.sql` ранее проверена в изоляции и применена к базе проекта.
- Она расширяет platform foundation, subscription/module policy и защищает аудит от UPDATE/DELETE/TRUNCATE.
- Историческая проверка до/после 013 подтвердила сохранность прежних строк/не-добавочных значений. Зафиксированный тогда baseline: 2 организации, 15 пользователей, 16 назначений ролей, 2 здания, 3 помещения, 3 счёта. Это исторический baseline, **не новый пересчёт данных текущего дня**.
- Перед 013 создан парный SQL/file-manifest snapshot. Нулевое число зарегистрированных файлов в том snapshot не доказывает восстановление файлов, отсутствующих в источнике.
- Объединённый HAYAT offline использует существующие operation receipts; в текущем наборе исходников новой миграции для него нет.
- В текущем блоке отчёта **новая основная миграция не применялась**, основной seed не запускался.
- Подготовленная отдельной задачей email delivery схема не считается применённой: её исходников в основном проекте пока нет.

Последующие расширения схемы должны быть добавочными, сначала проходить isolated tests и сохранять старые записи/private bytes. Согласование миграций не является согласием на удаление данных или публикацию.

## 4. Backend changes / текущие возможности

### Реализовано

- Permission/context guards, scoped queries, версии и история операций.
- Platform invitations с разделением platform.invite / people.invite, tenant scope, отзывом и ротацией токена при повторной отправке.
- Password reset с hash, expiry, single-use, rate limiting, нейтральным ответом и отзывом сессий.
- Subscription/plan/module policy, grace/read-only, лимиты зданий, аудируемые причины.
- Atomic support-access expiry и периодическая проверка истечения.
- Structured audit с серверными фильтрами, сортировкой и пагинацией.
- Resend/SMTP/outbox facade, проверка provider receipt, отсутствие тихой подмены неработающего сервиса outbox.
- Основные восстановленные финансовые, lifecycle, import, maintenance, voting, document и field endpoints.
- Offline headers/context/version guards и идемпотентные повторные операции фото/отчётов.

### Не доведено до требований мастер-промпта

Телефонное обращение диспетчера; configurable categories/5 priorities/SLA/escalation; visits; полный набор действий техника; расширенные incidents; recurring maintenance generator; lease-driven access; weighted voting/quorum; finance batch/bank import/multi-allocation; support conversation/SLA queue; typed imports; полный notification catalog/preferences; white-label; весь OpenAPI.

## 5. Frontend changes / текущие возможности

Есть продуктовые оболочки, ролевые маршруты, scoped counters/queues, общие реестры и карточки; Console приглашения, audit, подписки/планы/модули; настройки TOTP; восстановленные HAYAT/ImTun.

В объединённом HAYAT добавлены `OfflineWork.tsx`, offline store/shell и локализация offline действий. Обычный Workflow сохраняется для управляющего/диспетчера.

Остались полноценные формы/карточки/операции для перечисленных незавершённых backend flow. Экран с кнопкой без работающего процесса не считается завершённым. Общие таблицы ещё не везде используют серверную фильтрацию/сортировку/пагинацию. Полный набор блоков всех dashboard, responsive/a11y acceptance и окончательный string scan не завершены.

## 6. HAYAT

### Работает

- Восстановленный Web-модуль с ролевой очередью и серверным scope.
- Назначение работы, запуск, чек-лист, отчёт, проверка/возврат и история.
- Защищённые фотографии и привязка к разрешённой работе.
- Очереди техника, подрядчика и охраны; базовые пропуска/вход/выход/incidents.
- Offline для назначенных заявок техника и дефектов подрядчика:
  - IndexedDB связывает данные с пользователем, контекстом, типом и ID работы;
  - сохраняются текст/чек-лист/версия и выбранные файлы;
  - Service Worker кэширует оболочку/публичные ресурсы, не `/api`, cookies или серверные фото;
  - reconnect **не отправляет данные автоматически**;
  - явная синхронизация, стабильный UUID/payload и receipts защищают от повторов;
  - конфликт/ошибка не удаляют черновик;
  - 401/403 не подменяются cached access;
  - offline session snapshot ограничен временем/контекстом и не даёт серверных прав.

### Осталось

1. Полноценная заявка по телефону: building/unit/resident либо помещение, источник, категория, приоритет, контакт/окно визита, вложения и назначение.
2. Configurable categories, пять приоритетов, SLA targets/deadlines, pause rules, escalation и дедуплицированные фоновые действия.
3. Proposed/confirmed/reschedule/cancel visits и история согласования.
4. Отдельные accept/cannot perform/pause/resume, материалы и типы before/after/problem/checklist photos.
5. Equipment QR → карточка/история/создание работы.
6. Recurring maintenance → автоматически созданная WorkOrder без дублей.
7. Полный incidents severity/status/timeline/attachments flow.
8. Общая свежесть данных между участниками: SSE либо согласованный visibility-aware polling.

Offline не заменяет эти операции и не делает весь HAYAT завершённым. Safari/iPhone и Android device/browser acceptance отдельно не подтверждён. Локальное хранилище может быть удалено браузером; это не резервная копия сервера.

## 7. ImTun

### Работает

Восстановленные адаптивные экраны, ownership/renter/family scope, базовые заявки и статусы, доступ к разрешённым начислениям/коммуникациям, отдельное семейное назначение с выбранными правами, принятие/отзыв/истечение.

### Осталось

- Полный request contract с category/priority/контактом/окном визита и согласованием visit.
- Безопасные notification deep links с проверкой объекта и подтверждением переключения контекста.
- Полный delegation UI/lifecycle: срок, resend, recent-auth требования и live email verification.
- Lease → access lifecycle как центральный автоматический процесс, а не только expiry назначения.
- Полная карточка помещения и связь с ownership/leases/billing/requests/meters/documents.
- Дополнительные browser E2E owner/renter/family после завершения новых моделей.

## 8. Vernatun OS

### Работает

- Базовые организации, объекты/здания/помещения, люди и назначения.
- Начисления/публикация отдельных счетов, корректировки, платежи и базовые allocations.
- Защищённые документы с visibility.
- Units CSV/XLSX import preview, validation и атомарное подтверждение.
- Maintenance plans/отметка выполнения, базовые meetings/votes.
- Передача/осмотр/дефекты, подрядчики и защищённые фото в разрешённом scope.
- Базовые portfolio/operation aggregates.

### Осталось

Building billing batch preview/publish; bank statement import, matching, unmatched/credits/multi-invoice allocations; полная иерархия объекта/дома/подъезда/этажа; ownership history и суммарная доля; weighted votes/quorum/results/protocol; document version chains; расширенные portfolio aggregates и contractor scorecard.

Реальный банковский/payment gateway не входит в этот этап и не симулируется. Manual/sandbox операции не объявляются реальным банковским зачислением.

## 9. Vernatun Console

### Реализовано

- Ролевая платформа, существующие организации.
- Scoped invitation list/create/revoke/resend, expiry/acceptance и начальные статусы доставки.
- Plan/subscription lifecycle и module overrides с причинами.
- Legacy access для восстановленных организаций до явной активации новой policy.
- Read-only после окончания разрешённого периода/grace и при запрещённых состояниях подписки, без удаления истории.
- Structured/filterable/paged audit; audit mutation guards.
- Ограниченный временный support context, отзыв/истечение и правильный стартовый раздел.

### Осталось

- Полная organization card с active/suspended/archived lifecycle и связанными разделами.
- Support messages/attachments/conversation timeline, расширенная очередь и SLA.
- Onboarding dependencies/order/start/reopen/notes.
- Остальные typed import strategies и полный табличный preview ошибок.
- Все блоки platform/support dashboard.
- Реальная email delivery проверка и последующие webhook outcomes.

## 10. Security

### Подтверждённая база

Session-based auth, CSRF/permission/context guards, запрет чужих объектов, scoped financial access, version conflicts/idempotency, приватные фото/документы, очистка изображений, одноразовые hashed invitation/reset tokens, rate limiting, TOTP/recovery codes, immutable audit.

### Не завершено / не подтверждено

- Configurable **MFA required** для platform_admin и привилегированного org_admin с безопасным rollout. Существующее добровольное TOTP не является такой policy.
- Полная проверка всех новых процессов, которые ещё не реализованы.
- Новый полный security scan/dependency audit и production security acceptance в этом блоке не выполнялись.
- Секрет, опубликованный в чате, требует замены. Он не скопирован в код/документы; API credentials остаются в интеграции.
- Webhook должен проверять подпись **raw body**, timestamp/replay, event ID и scoped message correlation. Это требования к объединению/проверке готовой задачи, не утверждение о наличии handler в main.
- Старое событие от предыдущей отправки не должно портить новую попытку или менять lifecycle приглашения/права.

## 11. Tests — результаты текущего прогона

Все проверки ниже выполнены на текущих основных исходниках, после объединения HAYAT offline. Runner создаёт отдельную БД/случайную схему и очищает только собственные fixtures/files. Основной seed не выполнялся.

| Suite | Passed | Failed |
|---|---:|---:|
| security | 19 | 0 |
| email providers | 8 | 0 |
| phase1 | 11 | 0 |
| hayat | 4 | 0 |
| imtun | 4 | 0 |
| workflow | 1 | 0 |
| offline | 2 | 0 |
| business | 6 | 0 |
| services | 4 | 0 |
| lifecycle | 2 | 0 |
| **Core total** | **61** | **0** |

Web TypeScript — passed. API TypeScript — passed. Production Web build — passed. `/api/health` — OK.

Текущая команда:

```sh
cd artifacts/api-server/archive/vernatun
node --import tsx server/tests/run.ts --core-only
```

Это не полный повторный backup/storage drill и не live Resend QA. Tests принудительно используют приватный outbox/injected transport и не отправляют реальные письма.

## 12. Browser QA

- Текущий публичный preview проверен screenshot на 1366×900: главная страница загрузилась, ошибок browser console нет. Это не интерактивный E2E защищённых ролей.
- Ранее защищённые Console-экраны invitations/audit/subscription/modules проверены на desktop/mobile; результаты описаны в `VERNATUN-AUDIT.md`, не переименовываются в новый прогон.
- В объединённом `HAYAT-IMPLEMENTATION.md` описан отдельный offline browser pass на изолированном API: reload/drafts/files, reconnect без POST, explicit sync, conflicts, unknown response retry, account/context isolation и offline logout. Это отдельный исторический результат реализации.
- Текущий блок не запускал новый полный browser E2E по всем ролям.
- Все пять требуемых ширин, все 14 dashboard и accessibility acceptance ещё не закрыты.
- iOS/Safari и Android отдельным текущим прогоном не подтверждены.

### Acceptance scenarios A–H

| Сценарий | Что есть | Что мешает считать полный flow пройденным |
|---|---|---|
| A: resident → closed | Базовая заявка, назначение, checklist/report/verification/confirmation | accept/visit/photo types и новые поля ещё не завершены |
| B: phone → SLA/escalation | Общая очередь/назначение | Phone flow, urgent SLA и escalation отсутствуют в полном виде |
| C: schedule → equipment history | Plans, completion, assets | Нет полного recurring generation и QR/history flow |
| D: batch → bank → resident | Счета, manual payment/allocations | Batch, bank import/matching/multi-allocation не завершены |
| E: org → subscription → invite → join | Policy/modules и invitation backend | Реальный email/join end-to-end не проверен |
| F: support → expiry → denied | Limited grant/expiry/guards, isolated tests | Полный conversation/browser E2E всей цепочки не завершён |
| G: family → revoke | Отдельный assignment/accept/revoke/expiry | Полный новый UI/recent-auth/live email acceptance не завершён |
| H: share → quorum → protocol | Базовые meetings/votes | Weighted shares/quorum/protocol lifecycle не завершены |

## 13. External integrations / Resend

### Фактические результаты

| Проверка | Результат |
|---|---|
| Resend authentication | **FAIL/BLOCKED**: read-only GET /domains → 400 validation_error, `API key is invalid` |
| Domain verification | **Не проверено**: список доменов недоступен из-за авторизации |
| Sender verification | EMAIL_FROM сохранён; подтверждение принадлежности verified domain **не выполнено** |
| Test email API acceptance | **Не выполнено**, live receipt/message ID отсутствует |
| Actual mailbox receipt | **Не подтверждено** |
| Invitation email | Backend готов, live письмо **не проверено** |
| Invitation acceptance | Isolated backend tests есть; live end-to-end **не проверен** |
| Password reset email | Backend готов, live письмо **не проверено** |
| Password reset completion | Isolated single-use/session tests есть; live end-to-end **не проверен** |
| Bounce/delivery webhook tracking | Отдельная реализация не объединена; handler/ledger в основном проекте **не обнаружены** |

Реальных писем в текущем блоке отправлено: **0**. Авторизованный test recipient/выделенный тестовый account для live reset ещё не предоставлены. Existing accounts/sessions ради live QA не изменялись.

### Сохранённая архитектура

```text
Business invitation / reset / delegation
                  ↓
             EmailProvider
              /    |     \
          Resend   SMTP   DevelopmentOutbox
```

Выбран `MAIL_PROVIDER=resend`; sender задаётся общим `EMAIL_FROM`. SDK внутри Resend adapter получает credentials из существующей интеграции. SMTP остаётся заменяемым адаптером. Production outbox запрещён; ошибка выбранного provider не превращается в локальный «успех».

### Запрошенная следующая цепочка

```text
Vernatun attempt
    ↓
Resend accepted + message ID
    ↓
email.sent
    ↓
email.delivered
```

Также нужны `email.bounced` и `email.complained`. По официальной документации:

- `email.sent`: успешный запрос, Resend пытается доставить сообщение;
- `email.delivered`: сообщение принято **почтовым сервером адресата**;
- `email.bounced`: почтовый сервер окончательно отклонил сообщение;
- `email.complained`: после доставки адресат пометил сообщение как спам.

**Delivered не означает, что пользователь прочитал письмо или что оно находится именно в папке «Входящие».** События могут приходить повторно/не по порядку; интерфейс не должен требовать строго последовательного получения всех промежуточных событий.

Перед проверкой объединить готовую delivery задачу и сверить поддержку всех четырёх событий, особенно `email.sent`, persistent message ID, signatures/replay/deduplication, older-attempt protection и provider-neutral UI.

Документация: https://resend.com/docs/webhooks/event-types ; https://resend.com/docs/webhooks/verify-webhooks-requests

## 14. Remaining gaps — сверка по всему мастер-промпту

«Есть» означает наличие текущей реализации указанной базы, не полный production acceptance. «Частично» явно указывает незавершённую часть.

| Пункт | Статус и оставшаяся работа |
|---|---|
| 0: главный принцип | Соблюдён: preserve/fix/integrate вместо нового greenfield |
| 1: продукты | Есть 4 продукта/14 ролей; общий backend/auth/scope сохранён |
| 2: стек | Сохранён; auth/DB/framework не заменены |
| 3: native apps | Правильно не создавались; HAYAT/ImTun Web |
| 4: audit | Есть текущая сверка и regression baseline; production audit не завершён |
| 5: сохранить HAYAT | Восстановлен и сохранён; offline объединён |
| 6.1: phone request | Нет полного заявленного flow |
| 6.2–6.5: categories/priorities/SLA/escalation | Нет полноценной configurable модели/background flow |
| 6.6: visits | Нет полного согласования/reschedule/cancel/history |
| 6.7: technician | База есть; accept/cannot/pause/resume/materials/photo types остаются |
| 6.8: equipment QR | Assets есть; QR/history/create-work flow не завершён |
| 7: maintenance | Plans/completion есть; recurring WorkOrder generation не завершён |
| 8: security/incidents | Passes/events/base incidents есть; расширенный lifecycle не завершён |
| 9: realtime | Нет полноценного общего SSE/visibility-aware polling |
| 10: сохранить ImTun | Восстановлен; роли/изоляция проверяются core tests |
| 11: resident requests | База есть; полный новый contract остаётся |
| 12: visit approval | Полный процесс не завершён |
| 13: deep links | Полный безопасный cross-context flow не завершён |
| 14: delegation | База assignment/accept/revoke/expiry есть; полный UI/recent auth/live email остаётся |
| 15: lease access | Expiry назначения есть; централизованный lease lifecycle остаётся |
| 16: ownership | Rows/base API есть; history/sum shares/full UI остаются |
| 17: meetings | Базовые agenda/votes есть; shares/quorum/results/protocol остаются |
| 18: property structure | База/таблицы есть; полный hierarchy/unit card management остаётся |
| 19: organizations | Базовые организации/settings есть; lifecycle/card/linked views остаются |
| 20: invitations | Код/Console есть; реальные письма/webhook/live acceptance остаются |
| 21: password reset | Backend есть; controlled live verification остаётся |
| 22: subscriptions | Реализованы lifecycle/grace/read-only/лимиты; полный production QA остаётся |
| 23: modules | Plan allowlist/overrides/policy/Console реализованы |
| 24: audit UI | Structured details, filters/sort/server pagination реализованы |
| 25: immutable audit | DB mutation guards реализованы; не защита от владельца БД, отключившего trigger |
| 26: support cases | База есть; полноценная conversation/attachments/timeline остаётся |
| 27: support queue | Базовая очередь есть; полный SLA/filter/workflow остаётся |
| 28: temporary access | Limited route/permissions/revoke/expiry реализованы |
| 29: onboarding | База assignee/due/completion есть; dependencies/order/start/reopen/notes остаются |
| 30: imports | Units CSV/XLSX preview/confirm есть; другие стратегии/full preview остаются |
| 31: mass billing | Единичные начисления есть; building batch preview/publish остаётся |
| 32: reconciliation | Manual payments/base allocations есть; bank import/matching/credits/multi-allocation остаются |
| 33: portfolio dashboard | Scoped aggregates есть; полный набор KPI/filter/workflows остаётся |
| 34: contractor scorecard | База есть; полный scorecard не завершён |
| 35: documents | Private/visibility есть; version chains остаются |
| 36: storage | App Storage abstraction/authorization/sanitization есть; сохраняется, не заменяется Local/S3 |
| 37: notification center | Notifications/mark-read есть; весь event catalog/actions/delivery остаётся |
| 38: preferences | Locale/currency есть; category/channel notification settings не завершены |
| 39: branding | База tenant color/original assets есть; полный white-label API/UI остаётся |
| 40: PWA | Offline HAYAT реально объединён; весь limited-PWA/device acceptance не завершён |
| 41: dashboards | Маршруты/реальные данные есть; все функциональные блоки 14 интерфейсов не завершены |
| 42: search/filter/sort/pagination | HAYAT queue и audit server-side; общие Records/DataTable ещё не везде |
| 43: security | Guards/core tests есть; новые flows/full scan/production acceptance остаются |
| 44: MFA | TOTP/recovery есть; required policy/rollout остаётся |
| 45: i18n | HY/RU/EN база есть; финальный scan всех новых экранов остаётся |
| 46: timezone | Asia/Yerevan база/Console conversion есть; все новые flows требуют проверки |
| 47: responsive | Адаптивная база есть; все роли на пяти ширинах не проверены полностью |
| 48: accessibility | База есть; полный keyboard/focus/labels/contrast acceptance не выполнен |
| 49: tests | Current core61/61, types/build passed; отсутствующие flows не проверены |
| 50: scenarios A–H | Частично, границы перечислены выше |
| 51: no fake success | Provider acceptance отделён от delivery; mail/production не объявляются работающими |
| 52: migrations | 001–013 сохранены; дальнейшие additive changes сначала isolated QA |
| 53: demo | Main seed не запускался в текущем блоке; скриншотные числа не выдаются за реальные |
| 54: deployment | Managed preview работает; published production отсутствует |
| 55: observability | Health/request IDs/structured safe errors есть; полный production monitoring acceptance остаётся |
| 56: backup | Документ/tooling/предыдущие isolated проверки есть; новый production drill не выполнен |
| 57: OpenAPI | Архивный spec/частичные обновления есть; весь backend не описан полностью |
| 58: landing | Сохранён; полноценная серверная обработка `/api/leads` не обнаружена |
| 59: non-goals | Native/door controller/payment gateway/SMS/push/legal signature не добавлялись |
| 60: order | Phase0 baseline выполнен; Phase1 имеет внешние blockers; Phase2–8 не завершены |
| 61: compatibility | Существующие callers/guards/stack сохранены; current regression проходит |
| 62: checks | Current types/core/build выполнены; не подменяют future-flow tests |
| 63: acceptance report | Этот подробный промежуточный отчёт готов; final acceptance пока невозможно |
| 64: changelog | `CHANGELOG-2026-10.md` есть; дополнен текущим срезом |
| 65: production checklist | Текущий checklist ниже; есть незакрытые обязательные позиции |
| 66: конечная цель | Не достигнута полностью |
| 67: начать сейчас | Audit/foundation/integration выполнены; полный completion продолжается |

## 15. Production blockers — приоритеты

### P0: завершить безопасную почтовую настройку

1. Заменить ключ, попавший в чат, и обновить **существующее** Resend connection.
2. Получить успешную read-only авторизацию, verified domain и соответствующий sender.
3. Объединить delivery implementation; проверить все четыре события и security/correlation.
4. Согласовать publication/public callback и production settings; не использовать dev URL как production endpoint.
5. Настроить webhook signing secret через Secrets, не чат/код.
6. Получить явный разрешённый test recipient и выделенный test account.
7. Controlled live email → receipt → actual receipt; invitation → single use; reset → expiry/single use/session revocation. Не сбрасывать доступ реальных пользователей ради QA.

### P0: обязательная общая readiness

MFA-required rollout для привилегированных пользователей; корректные production APP_ORIGIN/HTTPS/session/DB/storage settings; актуальный безопасный backup/restore drill; проверка критических сценариев и production visibility.

### P1: закрыть основную бизнес-функциональность

Dispatcher/SLA/visits/technician/incidents → recurring maintenance/ImTun lifecycle → finance batches/reconciliation → Console support/onboarding/imports → ownership/meetings/documents/analytics.

### P2: завершить общую поверхность

Notification catalog/preferences, white-label, все dashboard блоки, общая server pagination, i18n/timezone scan, responsive/a11y matrix, OpenAPI и реальные landing leads.

## 16. Environment variables — без значений секретов

| Настройка | Состояние / назначение |
|---|---|
| MAIL_PROVIDER | Resend выбран в shared environment; переключает адаптер |
| EMAIL_FROM | Сохранён в shared environment; verified-domain proof ещё нет |
| Resend API credential | В существующем connection; read-only запрос отклонён. Не переносить ключ в код |
| RESEND_WEBHOOK_SECRET | На момент проверки отсутствует; окончательное имя сверить с объединённой реализацией |
| APP_ORIGIN | Для production требуется подтверждённый published origin; production URL сейчас нет |
| SESSION_SECRET | Существующий secret; значение не читалось/не печаталось |
| DATABASE_URL | Runtime-managed; не заменять базу |
| App Storage settings | Существующие bucket/private/public settings сохранены; секретные значения не приводятся |
| SMTP_* | Альтернативный adapter; реальные SMTP credentials не настраивались в этом блоке |
| PORT / BASE_PATH | Managed service settings; не задавать конфликтующие legacy workflows |

API credential и webhook signing secret — разные значения. Включение Resend connection не создаёт подписанный callback автоматически.

## 17. Deployment notes / production checklist

`getDeploymentInfo()` вернул: **isDeployed=false**, successful published build отсутствует, primaryUrl отсутствует. Production callback зарегистрировать сейчас нельзя без публикации; development домен не подставляется вместо него.

После подтверждённой публикации нужно проверить доступность извне. Private/password deployment может блокировать отправителя webhook; это необходимо решить до обещания работающей доставки.

- [x] Сохранены архитектура, авторизация, исходные данные и product logos.
- [x] Текущие Web/API type checks.
- [x] Current core regression61/61.
- [x] Production Web build.
- [x] Managed preview / API health.
- [x] Общий заменяемый EmailProvider.
- [ ] Исправный и заменённый после раскрытия Resend credential.
- [ ] Verified sending domain/sender.
- [ ] Объединённая и проверенная webhook реализация всех четырёх событий.
- [ ] Published production URL и подходящая external visibility.
- [ ] Signing secret/signature/replay/deduplication проверены в рабочей среде.
- [ ] Authorized live email/invitation/reset tests.
- [ ] Required-MFA policy и rollout.
- [ ] Критические сценарии A–H.
- [ ] Полные finance/operations/Console/resident lifecycle.
- [ ] Все role dashboard, responsive/a11y и device checks.
- [ ] Полный OpenAPI, leads backend и безопасный production monitoring.
- [ ] Актуальная production backup/restore проверка.

**Следующее действие:** объединить готовую delivery задачу и обновить ключ существующего Resend connection. После этого сверить webhook код с четырьмя запрошенными событиями и обновить этот отчёт результатами реальных проверок, а не предположениями.
