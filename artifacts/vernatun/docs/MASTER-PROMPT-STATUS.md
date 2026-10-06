# Vernatun — что выполнено из мастер-промпта

Дата: 6 октября 2026 года.

Вложенный мастер-промпт совпадает с `VERNATUN-PLATFORM-SPECIFICATION.md`. Это сверка текущих исходников и последних доказательств, не новый build, test run или production acceptance.

## Краткий вывод

Архитектура и восстановленные модули сохранены. Значительная часть PHASE 1 реализована и проверена локально/изолированно. Полный мастер-промпт не выполнен; PHASE 2–8 имеют существенные пробелы. Процент готовности не назначается: пункты различаются по объёму, многие требуют законченного UI + backend + сквозного сценария.

«Реализовано» ниже означает конкретную возможность в коде, а не готовность всей продуктовой области.

## Сверка по этапам

| Этап | Сделано | Что остаётся |
|---|---|---|
| PHASE 0 — audit/baseline | Восстановление, сверка архитектуры, отчёты, изолированный regression baseline | Это не production audit или полная проверка всех 14 dashboards |
| PHASE 1 — критическая основа | Invitation create/revoke/resend/expiry, reset hash/single-use/expiry, audit UI/immutability, subscription/module policies, temporary support context/expiry; общий EmailProvider и six-event webhook | Домен/verified sender/валидная авторизация/реальная доставка и invite→join/reset end-to-end не подтверждены |
| PHASE 2 — HAYAT | Очереди/назначение/start/checklist/report/verification/history, защищённые фото, базовая охрана; offline drafts/explicit sync | Полная telephone request, configurable category/5 priorities/SLA/escalation, visits, accept/cannot/pause/resume/materials/photo types, расширенные incidents |
| PHASE 3 — maintenance/ImTun | Maintenance plans/completion, resident requests, семейные assignments/accept/revoke/expiry | Recurring generation WorkOrder, visit approval/reschedule, безопасные cross-context notification links, полный delegation UI/recent-auth, lease-driven access |
| PHASE 4 — финансы | Отдельные начисления/публикация, корректировки, manual payments/base allocations | Building mass billing preview/publish, bank statement import/matching, unmatched, multi-invoice/partial allocations, overpayment credit |
| PHASE 5 — Console | Базовые организации, subscriptions/modules, audit, ограниченная поддержка, units CSV/XLSX preview/confirm, Email Console | Organization lifecycle/card, support conversation/attachments/SLA queue, onboarding dependencies/start/reopen/notes, другие typed imports, весь dashboard |
| PHASE 6 — ownership/meetings/docs/analytics | Базовые ownership rows, agenda/votes, private documents, portfolio aggregates | Ownership history/share totals, weighted voting/quorum/results/protocol, document version chains, полный portfolio KPI и contractor scorecard |
| PHASE 7 — storage/notifications/branding/PWA | Private storage/authorization/sanitization, notifications/mark-read, tenant color/locale/currency, HAYAT offline shell | Полный notification event catalog/preferences/actions, white-label API/UI, весь limited PWA; iPhone/Safari/Android acceptance |
| PHASE 8 — QA/security/deployment | Базовые guards/CSRF/RBAC/scopes, TOTP/recovery, tests/types, отдельные browser checks, health/errors/backup tooling | Required MFA rollout, полный security/dependency audit, A–H end-to-end, все роли/5 ширин/a11y/i18n/timezone checks, весь OpenAPI, production readiness |

## Что реально добавлено в почте

- Сохранились общий `EmailProvider`, Resend, SMTP, DevelopmentOutbox. Production не подменяется outbox.
- Raw-body Svix endpoint `POST /api/webhooks/resend`; старый путь — alias.
- sent/delivery_delayed/delivered/bounced/complained/failed, idempotency и provider-account/message correlation.
- Общий token-free send ledger и append-only delivery events, без raw payload/HTML/token.
- `/console/email`: admin-only, masked recipient, filters/pagination/health/timeline.
- Delivery evidence не меняет роли, lifecycle invitation или reset token. Receipt persistence после acceptance не выдаётся за transport failure.
- Реальных писем отправлено 0. Configured provider/secret не означают verified key/domain или live delivered.
- Целевой будущий URL пользователя — `https://vernatun.io/api/webhooks/resend`, не подтверждённый опубликованный endpoint.

## Интерфейсы и landing

Четыре продукта и 14 типов ролей существуют, исходные HAYAT/ImTun logos сохранены, бренд выбирается по продукту/роли. Исправления известных перекрытий на landing выполнены ранее; public landing сохранён. Но полный функциональный состав всех 14 приложенных dashboard ещё не реализован. Ни отдельная карточка, ни реестр не считаются полной реализацией dashboard.

Остаются общие server filters/sort/pagination для всех таблиц, полная карточка помещения/иерархия, окончательная responsive/a11y/i18n проверка. Полноценный backend `/api/leads` в текущей сверке не найден.

## Последние проверки — не новый прогон

- Core: 76/76 до финального email уточнения.
- Финальный email/Phase 1: 35/35 после уточнения. Совокупное покрытие suites — 77 checks, не новый единый прогон 77/77.
- Workspace/API types и API codegen прошли; production Web build проходил раньше и не означает публикацию.
- Email Console browser QA: desktop1280/phone390, реальные health/empty/filter requests, guest401/org-hidden navigation, без page overflow. Timeline rendering — browser-only synthetic fixtures, не live evidence.
- Миграции 001–015 в исходниках; 015 проверена в изоляции и применена к development на предыдущем этапе. Production schema/main seed ради отчёта не менялись.
- Current read-only smoke: Web и API health — HTTP200. Managed Web/API workflow state при этом failed из-за уже занятых портов 23227/8080; lifecycle listener требует отдельной проверки. Это не исправлялось уничтожением процессов.

## Что не подтверждено

1. Внешняя авторизация Resend/domain/sender и подписанное live event→delivered. Последняя ранее выполненная auth-проверка вернула invalid API key; новый check не проводился.
2. Все сквозные сценарии A–H: resident→closure, phone→SLA, maintenance→history, billing→bank→resident, org→subscription→invite→join, support→expiry, delegation→revoke, share→quorum→protocol.
3. Public production readiness. Последняя deployment metadata проверка не нашла publication; metadata ради отчёта не запрашивалась повторно.
4. Безопасная ротация ранее раскрытых в чате credentials — значения не копируются и не показываются.
5. Полное восстановление private bytes, которых не было в предоставленном источнике. SQL rows сами по себе не доказывают существование файлов.

## Что намеренно не делалось

Native/Expo apps, физический door controller, real bank/payment gateway, SMS/push и юридическая электронная подпись исключены мастер-промптом из данного этапа. Это не забытые пункты.

## Порядок продолжения

Не считать PHASE 1 полностью принятой до внешней email проверки; она отложена по прямому указанию пользователя до готовности домена. Завершать локальные бизнес-процессы в порядке PHASE 2 → PHASE 3 → PHASE 4 → PHASE 5 → PHASE 6 → PHASE 7, затем полный PHASE 8. Не переходить к cosmetic polishing вместо рабочих сквозных сценариев.

Полная матрица пунктов 0–67, 17 разделов completion report и подробные ограничения: `VERNATUN-COMPLETION-REPORT.md`. Почтовый контракт: `RESEND-WEBHOOK.md`.
