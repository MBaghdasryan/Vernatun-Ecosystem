# Phase 5 — организация, поддержка, внедрение и typed imports

7 октября 2026, Asia/Yerevan. Источник объёма — активный Master Completion Prompt и его продолжение. Работа выполнена в существующих Vernatun Web/API; новый продукт, Expo или отдельная панель не создавались.

## Статус

**COMPLETE — реализация серверных и интерфейсных циклов Phase 5 и изолированные регрессионные проверки.**

**PARTIAL — браузерная приёмка:** карточка организации проверена после реального входа platform admin; stale-version save проверен на synthetic ответе, черновик сохранился; status dialog требует причину и acknowledgment. Один общий проход остановился на дефекте onboarding route. Исправление подтверждено двумя pure routing regressions и узким browser pass: click/reload/direct navigation/Overview → Onboarding показывают actual catalog/progress. Остальные перечисленные ниже browser journeys ещё не подтверждены. Backend persistence, authorization и rollback проверены отдельно; бизнес-изменения для browser QA не отправляются в текущую базу.

**EXTERNAL BLOCKER — production/email:** production не мигрировалась и не публиковалась. Домен отправки ещё не готов; реальные и тестовые письма запрещены пользователем и не отправлялись.

## 1. Организация — COMPLETE

- Карточка: юридическое наименование, налоговый идентификатор, адрес, контакты, часовой пояс, валюта и язык по умолчанию.
- Связанные модули, здания, пользователи, подписки и subscription policy, внедрение, обращения и аудит.
- Редактирование профиля, приостановка, архивирование и восстановление; смена статуса требует причины и явного подтверждения в интерфейсе.
- Проверка версии, блокировка строки, transactional audit и idempotency receipt. Повтор одного намерения не создаёт повторную операцию; устаревшая версия не затирает чужие изменения.
- Приостановленные/архивные организации не дают новые обычные и temporary-grant organization contexts. История, memberships, документы и финансовые строки не удаляются. Глобальная Console сохраняет управление карточкой.
- Существующие создание организации, управление модулями и подписками сохранены. Полное редактирование white-label branding относится к Phase 7.

## 2. Поддержка — COMPLETE

- Append-only conversation: автор, тело, время, public/internal, ссылки на явно выбранные документы.
- Организация, creator/assignee, category, priority, status, timestamps, сохранённый серверный SLA deadline.
- Очереди unassigned / mine / all, фильтры overdue, priority, organization, status, поиск и серверная пагинация по 50.
- Platform admin назначает/переназначает активного support; граница полномочий выделена через `support.assign`. Обычный support читает собственные и неназначенные обращения, но отвечает только после назначения себе; чужие назначенные обращения недоступны.
- Решение и явное повторное открытие, оптимистическая версия, повторяемые frozen intents, transactional audit.
- Internal заметки не попадают в customer conversation. Scoped customer contexts видят только допустимые обращения.
- Старые body/reply сохранены без изменения. Экспортированный reply перенесён как legacy snapshot: неизвестные исторические автор и время не выдумываются. Интерфейс показывает импортированную запись и отсутствие достоверных метаданных. Потерянные до экспорта более ранние overwritten replies восстановить нельзя.
- Старые create/reply endpoints совместимы с новой append-only историей; resolved case нельзя скрыто открыть новым reply.

### SLA и вложения: точные границы

Priority policy сейчас фиксирована на сервере: low 72h, normal 48h, high 12h, urgent 4h от времени создания. Изменение приоритета не обнуляет возраст обращения. Старые cases получили производный baseline `created_at + 48h`; это не доказательство исторического SLA или его выполнения. Отдельный configurable SLA engine/уведомления о breach не объявляются выполненными этим этапом.

Вложения выбираются из документов, которые автор уже имеет право читать. Перед отправкой интерфейс требует подтверждения sharing. Раздел документов сохраняет прежнюю бизнес-авторизацию; новые uploads/direct-storage URLs и blanket file grants не добавлялись.

Download использует отдельный case-scoped endpoint: только документ, действительно указанный в видимом сообщении этого обращения, нужная организация и действующая documents policy. Обычный неназначенный support не получает bytes. Разрешённое чтение фиксируется в аудите; ответ private/no-store. Storage keys не возвращаются в conversation. Изолированные тесты проверяли авторизацию metadata-only fixture без записи/чтения новых private bytes; реальная выдача нового case download не проверялась на production файлах.

## 3. Внедрение — COMPLETE

- Title, category, organization, assignee, due date, order, dependencies, status, notes.
- Dashboard с `completed / total`; история событий, назначение/переназначение, start, complete, reopen.
- Dependencies принадлежат той же организации и имеют меньший order: циклический порядок не допускается.
- Начало/завершение блокируется незавершёнными prerequisites; прежний complete endpoint тоже проверяет prerequisites.
- Reopen сохраняет события завершения. Если зависимые этапы уже начаты/завершены, требуется явное подтверждение cascade; затронутые этапы переводятся в pending, а события и предыдущие состояния не стираются.
- Обычный support ограничен собственными назначенными этапами; не может назначать другого исполнителя или скрыто менять чужую зависимую работу.
- Необязательные onboarding attachments не добавлены. Это optional поле исходной спецификации, не замена support attachments.

## 4. Импорты — COMPLETE

Сохранён прежний units CSV/XLSX workflow. Новая отдельная вкладка использует CSV mapping и пять специализированных strategies:

| Тип | Что подтверждается |
|---|---|
| units | Номер, площадь, организация/здание; одинаковые номера в разных зданиях не являются одним import reference |
| owners | Зарегистрированный активный участник организации → unit_owner access assignment |
| residents | Зарегистрированный активный участник → renter assignment и lease с реальными датами, явными rentMinor/currency |
| meters | Помещение, уникальный serial number, water/electricity/gas; учитывается доступность meters module |
| opening_balances | Явный reference, period, currency, подписанная сумма в целых minor units; положительная сумма — published opening debt, отрицательная — привязанный к payer/unit credit |

- Preview показывает source row, mapped fields, validation state и errors. Он сохраняет только staging metadata, не создаёт production entities или проводки.
- Commit только после явного confirm. Повторная проверка актуальных identities, memberships, unit/payer relationship, duplicate references и прав перед записью.
- Если preview устарел/target сменился, confirm возвращает `import_changed`, а не молча переносит данные на другого человека/помещение.
- Все строки и lineage одного job фиксируются атомарно. Ошибка поздней строки откатывает весь job; после устранения ошибки то же намерение можно повторить без partial writes.
- Размер JSON до 1 MiB, 1–1000 строк; нет одного универсального parser для всех entity types.
- Imports не создают пароли, новые accounts, invitations или письма; неизвестный/blocked/inactive account даёт validation error.
- Owner import — access assignment, не доля собственности или legal ownership history: это Phase 6.
- Resident import не придумывает бесплатную аренду: rentMinor/currency обязательны, rent-free — явный `0`. Нет автоматического scaling/default-zero. Даты role access переводятся через timezone организации, end date включительна.
- Opening balances доступны organization-wide финансовому сотруднику с billing publication/reconciliation capabilities. Accountant получает finance-only import capability, не все imports.
- Все суммы — exact integer minor units/BigInt. Avance не становится фиктивным bank deposit; сохраняется immutable payment source `opening_balance` и account binding. Credit расходуется прежним защищённым allocation workflow Phase 4.

Typed XLSX для всех пяти types, создание новых identity accounts и автоматическая юридическая долевая собственность не входили в реализацию.

## 5. Проверки и сохранность

- OpenAPI расширен, client/Zod regenerated; workspace frontend/backend TypeScript прошли.
- Production Vite build прошёл.
- Полный isolated core runner: **106 checks, 0 failed**, включая **8 Phase 5** и прежние 98. Проверены tenant/role boundaries, internal privacy, assignment, dependencies, stale versions, idempotency, signed balances, duplicate rows, large structured JSON, late-failure rollback.
- Intentional PostgreSQL failure в rollback test ожидаем и не означает runtime error приложения.
- Исправлен metadata-only QA fixture для canonical private file identity; финальный runner завершился вместе с безопасным cleanup isolated namespace.
- Миграция `020` сначала проверена на отдельной test schema, затем применена только development.
- Counts/digests прежних полей **17 business tables совпали** до/после migration: исходные users/memberships/assignments, organizations, support/onboarding, units/meters/leases/documents/imports и финансовые таблицы сохранены.
- Main seed/reset, восстановление поверх текущей базы, production migration и удаление пользовательских private bytes не выполнялись.
- Managed API/Web запущены после batch изменений; API listener и Web runtime поднялись.

## 6. Браузерная приёмка

После реального входа platform admin:

- Org card Version 1/Active, modules/users/audit rendered.
- Synthetic `409 stale_version` показал ошибку и сохранил профильный draft.
- Status dialog показал Suspended/Archived, disabled submit до reason ≥3 и acknowledgment; действие отменено, live status не изменялся.
- Support queue filters rendered, но очередь была пустой; conversation/assignment/attachment transitions не проверены браузером.
- Обнаружен route defect: `/console/onboarding` ошибочно интерпретировался как role home alias и отображал overview. Он исправлен; **2 pure route tests passed**, frontend TypeScript и production build после исправления успешны.
- Узкая повторная проверка успешно подтвердила исправленный route/state: click, reload и direct navigation показали onboarding catalog, pending step и `0 / 1`; Overview → Onboarding возвращает именно workflow. Evidence: `ygjmlo`, `gp3aap`, `spzzof`. Не является вторым полным browser pass; steps не менялись.

**Не подтверждены браузером:** customer/internal conversation visibility, legacy unknown metadata rendering, assignment/resolve/reopen, sharing checkbox/download, onboarding transitions/dependent cascade, accountant typed imports/503 exact-intent retry, resident mapping и 390px responsive matrix. Их серверные гарантии проверены isolated tests, но это не подмена UI acceptance.

В overview также замечены duplicate React child-key warnings `openSupport`: это отдельный dashboard acceptance gap Phase 8, не причина исправленного route defect.

Mutation guard блокировал все live business writes; реальные financial/profile/status/role/file изменения не выполнялись. Не объявлять private-byte delivery доказанной результатами synthetic fixtures.

## 7. Что остаётся

- Phase 6: ownership shares/history, weighted voting/quorum/protocol, document versions, portfolio analytics, contractor scorecard.
- При document versioning требуется закрепить exact shared version для support attachment, не автоматически открыть участникам обращения новую заменённую версию.
- Phase 7: notification catalog/preferences, full branding/white-label и безопасное завершение limited PWA.
- Phase 8: все role dashboards, scalable table matrix, required-MFA rollout, полный i18n/timezone/responsive/a11y acceptance, OpenAPI coverage, `/api/leads`, production readiness.
- Отдельный исторический Phase 3 manager login/UI blocker и ограничение browser Ignore evidence Phase 4 сохраняются; этот этап не выдаёт их за решённые.
- Production/email — внешний blocker; реальные отправки возможны только после готовности домена и отдельного разрешения.

Новые Payment Providers, Boon, native applications и дополнительные Platform Operations extensions не начинались.
