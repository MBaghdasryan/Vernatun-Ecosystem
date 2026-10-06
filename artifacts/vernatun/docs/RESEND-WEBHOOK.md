# Vernatun — Resend webhook и Email Operations

Дата: 6 октября 2026 года.

## Статус

- Webhook-код объединён и расширен в основном проекте.
- Изолированные подписанные fixtures проверены. Это **не live verification Resend**.
- `RESEND_WEBHOOK_SECRET` сохранён через защищённую форму; значение не читается и не раскрывается.
- Пользователь сообщил, что webhook создан в Resend. Регистрация через API не проверялась, дубликат не создавался.
- Домен ещё не готов по сообщению пользователя. Реальные отправки запрещены для этого этапа и **не выполнялись**.
- Целевой будущий URL: **https://vernatun.io/api/webhooks/resend**. Это заданный пользователем адрес, не подтверждение активной публикации/DNS/HTTPS.
- Production-ready и подтверждённая live-доставка **не заявляются**.

## Endpoint и подпись

Канонический маршрут: `POST /api/webhooks/resend`.

Старый `/api/email-webhooks/resend` сохранён только как совместимый alias. Оба маршрута используют одну проверку; в новом webhook указывать канонический путь.

Маршрут установлен **перед** Express JSON parsing, session и browser-CSRF middleware. Он не требует session, но не принимает данные без корректной Svix подписи:

- `svix-id`
- `svix-timestamp`
- `svix-signature`

`express.raw()` принимает исходные байты JSON с лимитом 32 KiB. Svix проверяет подпись и допустимое время; JSON разбирается только после успешной проверки. Повторная сериализация для проверки не используется. Успешная Svix-проверка не обязана возвращать JSON — после неё отдельно разбирается то же тело.

Секрет — только server-side `RESEND_WEBHOOK_SECRET`. Наличие настройки означает готовность механизма проверки, **не** доказательство соответствия созданному webhook или live-проверки.

Другие методы возвращают 405 с `Allow: POST`. Маршрут ограничен 300 запросами в минуту на IP. Остальные API сохраняют session/CSRF защиту.

## События и нормализованный статус

| Resend | Vernatun |
|---|---|
| API принял запрос и вернул message ID | accepted |
| email.sent | sent |
| email.delivery_delayed | delayed |
| email.delivered | delivered |
| email.bounced | bounced |
| email.complained | complained |
| email.failed | failed |

`delayed` не означает failure. `delivered` означает приём сервером получателя, не попадание во «Входящие» и не прочтение.

Open/click tracking не включается: `email.opened`, `email.clicked` и неизвестные подписанные типы получают 204, но не сохраняются как delivery evidence.

## Хранение и корреляция

Существующая `email_delivery_events` расширена, вторая таблица webhook-событий не создавалась. Она остаётся append-only.

Общий token-free журнал `email_messages` добавлен потому, что прежние attempts/receipts были только для invitations. Общий `deliverEmail` регистрирует новые сообщения, включая reset, через прежний `EmailProvider`; Resend не встраивается в business logic. Для будущих notification/support/invoice callers предусмотрен общий business context.

Существующие `invitation_email_attempts` и `invitation_email_receipts` сохранены для current attempt, ротации токена и tenant isolation. Никакие старые письма не объявляются доставленными. Общий журнал охватывает новые отправки после этого расширения; исторические invitation evidence доступны в Invitation Console. Поддельный backfill адресатов прошлых попыток не выполняется.

Корреляция: **provider + provider account scope + provider message ID**. Resend message ID — `data.email_id`; адрес и subject не используются для matching. Неизвестные message ID сохраняются как unmatched evidence и получают 204. При появлении receipt раннее событие сопоставляется автоматически.

Уникальность события: `(provider, provider_scope, event_id)`, где `event_id` — подписанный `svix-id`. Повтор возвращает 204 и не создаёт новую запись.

Агрегаты рассчитываются SQL views по сохранённому evidence. Вставка уникального события — атомарная граница обработки: нет отдельного mutable status update, способного оставить событие и статус несогласованными. Короткая обработка не запускает бизнес-операции, новые письма или токены.

Детерминированный приоритет:

`complained > bounced > failed > delivered > delayed > sent > accepted`.

Внутри одного статуса используются occurred_at и стабильный ID. Старый sent/delayed не откатывает delivered; новая положительная запись не стирает отрицательное evidence. Все поддержанные события остаются в timeline.

## Безопасность бизнес-процессов

- Webhook не принимает/revokes invitation, не выдаёт роли и не меняет пользователей.
- Pending invitation с bounced email остаётся pending.
- Исправление адреса/повторная отправка — только прежний авторизованный resend flow с ротацией токена.
- Evidence старой попытки не влияет на новую current invitation attempt.
- Reset delivery — только наблюдение; callback не расходует и не продлевает reset token.
- Public forgot-password response остаётся нейтральным. Ошибка записи receipt **после** принятия провайдером не выдаётся за failed transport и не инвалидирует уже отправленный reset.
- Transport timeout/отсутствие подтверждённого receipt в общем журнале означает unknown, не доказательство недоставки. Автоматических повторных отправок нет.
- Complaint даёт предупреждение в Email Operations, но не блокирует пользователя автоматически.
- SMTP/outbox не становятся delivered от Resend события с совпавшим ID.

## Приватность и operational logging

Общий журнал не хранит subject/body/HTML/URL/token. Адрес нужен для защищённого server-side filtering, но ответы Console содержат только masked recipient. ID сообщения в списке сокращён.

Webhook сохраняет нормализованные поля, не raw payload и не provider diagnostics. Bounce metadata ограничены известными безопасными classification codes type/subType; произвольные reason/message, адресаты и содержимое письма отбрасываются.

Structured logs содержат generated correlation ID, verified flag, безопасные event/message ID после проверки, результат stored/duplicate/ignored/rejected/storage_failure. Секреты, подпись, raw payload и бизнес-токены не логируются.

## Console и API

`/console/email` доступен только в активном контексте `platform_admin`. Для других ролей навигация скрыта, сервер независимо возвращает 403. Guest получает 401.

- `GET /api/platform/email/health?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/platform/email/messages?page=1&pageSize=20&from=...&to=...&status=...&provider=...&businessType=...&recipient=...`
- `GET /api/platform/email/messages/:id`

Console показывает provider/configuration, sender, counters, последние accepted/delivered/bounce/complaint/failure, webhook health и timeline. Есть date/status/provider/business/recipient filters, server pagination, refresh и HY/RU/EN.

Configuration status `configured_unverified` означает только наличие настроек adapter, не проверенный ключ/домен.

Delivery rate — доля сообщений выбранной когорты отправки, у которых текущий aggregate статус delivered, среди accepted/sent/delayed/delivered/bounced/complained/failed. Local/unknown исключены. API возвращает fraction 0–1 или null; это подтверждённая evidence-доля, не оценка физической доставки неизвестных SMTP писем.

Период задаётся календарными UTC датами, по умолчанию последние 30 дней, максимальный диапазон 366 дней. Page size — до 100. Health counters failures агрегируются по UTC-дням, не по raw payload. Последние event timestamps берутся из истории, даже если финальный aggregate позже изменился.

## Ответы и retry

- 204 — сохранено, duplicate или подписанное игнорируемое событие.
- 400 — неправильная подпись, timestamp или payload.
- 405 — не POST.
- 413 — превышен лимит тела.
- 429 — ограничение частоты; повторить позже.
- 503 — секрет не настроен или временная недоступность.
- Прочие ошибки записи — 5xx; провайдер может повторить событие.

Telemetry failure не меняет committed evidence. Собственная PostgreSQL история не зависит от retention Resend. Дополнительного публичного endpoint для подделки событий нет.

## Проверки

- Основной изолированный regression: 76/76 до последнего уточнения.
- Финальный профиль email/Phase 1: **35/35** — providers 8, delivery 16, Phase 1 11.
- Всего текущие suites покрывают 77 checks: остальные неизменённые core suites прошли в основном прогоне.
- API-контракты OpenAPI обновлены, codegen прошёл; workspace typecheck прошёл, финальный API typecheck прошёл.
- Миграция 015 сначала проверена на изолированной БД, затем применена только к development. Исторические migrations 001–014 не изменялись, production migration/seed не выполнялись.
- Подпись, изменённые байты, missing headers, старое/будущее время, duplicate, ordering, шесть статусов, unmatched/cross-provider/cross-account, token isolation, append-only и временный DB failure проверены на синтетических fixtures.
- Реальных писем отправлено: **0**. Live signed event, live delivered/bounce/complaint от Resend не подтверждены.
- Browser QA `/console/email` прошла на desktop 1280px и phone 390px: реальный health/пустой список, filters/pagination requests, guest 401, org-admin hidden navigation, Invitation Console delivery filters. Runtime ошибок и page-level overflow на реальном refresh нет.
- Поскольку реальных записей ещё нет, отображение timeline accepted/sent/delayed/delivered/complained/failed проверено временными browser-only GET fixtures. После снятия interception реальное пустое состояние восстановилось. Это не live delivery evidence и не запись fixtures в main.

## Подключение после готовности домена — отложено

Не выполнять сейчас реальные отправки.

Когда пользователь подтвердит готовность домена:

1. Проверить фактическую public production publication, DNS/HTTPS и доступность `https://vernatun.io/api/webhooks/resend`. Не заменять её development preview.
2. Проверить valid credential существующей интеграции Resend, verified domain и sender, не раскрывая key.
3. В существующем webhook выбрать шесть событий из таблицы выше; не создавать дубликат.
4. Проверить соответствие signing secret созданному endpoint. На смене provider account менять account scope и signing secret согласованно; ротация секрета того же аккаунта не требует потери корреляции.
5. Только после отдельного разрешения на конкретного получателя отправить ровно одно контролируемое письмо; сопоставить message ID, подписанные события, DB и Console timeline.
6. Негативные сценарии использовать в изолированных fixtures, не вызывать реальную spam complaint или намеренный bounce адресатам.
