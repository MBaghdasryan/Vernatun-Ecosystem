# Vernatun — октябрь 2026

## Core operations и managed runtime

Один управляемый owner для Web/API; добавочная миграция 016 после изолированных проверок; телефонный intake, категории/приоритеты/SLA, история визитов, действия техника, материалы, типизированные приватные фото, equipment QR/manual lookup и инциденты. Новые incident bytes включены в inventory/backup. Старые offline receipts сохраняют fingerprint. Реальные email не отправлялись. Подробные проверки и известные ограничения: PHASE2-COMPLETION.md.

## Email Operations и шесть Resend событий

- Объединённая delivery модель расширена без переписывания provider adapters и без дублирования event store. Canonical route `/api/webhooks/resend`, прежний route — совместимый alias.
- Добавлены sent/delayed/failed, безопасные классификации bounce, token-free общий журнал, `/console/email` только для platform_admin, masked log/filter/pagination/timeline и технический health.
- Receipt persistence после acceptance не выдаётся за transport failure. Webhook не меняет invitation/reset validity, roles или account block.
- Migration 015 проверена изолированно и применена к development. Core76/76 и финальный email/Phase 1 профиль35/35, types/codegen прошли.
- Target пользователя — `https://vernatun.io/api/webhooks/resend`. Домен ещё не готов; реальные письма не отправлялись и production readiness не заявляется.
- Подробности: `RESEND-WEBHOOK.md`, `RESEND-WEBHOOK-VERIFICATION.md`.

## 6 октября — текущий подробный completion report

- Создан `VERNATUN-COMPLETION-REPORT.md`: 17 acceptance-разделов, сверка всего мастер-промпта, scenarios A–H, live-mail results и production checklist.
- Учтён реально объединённый HAYAT offline; current core61/61, Web/API types и Web build passed.
- Готовая отдельная email delivery задача не объявляется активной: её handler отсутствует в основных исходниках.
- Read-only Resend auth по-прежнему отклонён; domain/live mail не проверены, сообщений не отправляли.
- Production deployment отсутствует; dev URL не используется вместо callback.

## 6 октября — старт выполнения новой платформенной спецификации

### Changed
- Активная спецификация сохранена отдельно от исторических восстановительных документов.
- Scoped support start route учитывает реальные permissions/modules.
- Invitation list/revoke использует платформенную и организационную policy без выдачи лишних прав.

### Added
- Structured audit details в существующем Console UI.
- Разрешение импорта в существующей форме временного доступа поддержки.
- Изолированные Phase 1 regression tests и отдельные core/phase1 test modes.
- `VERNATUN-AUDIT.md`: карта всех блоков и честный статус неполных функций.

### Fixed
- Платформенный список приглашений ранее ошибочно требовал `people.invite`.
- Audit Console ранее исключал tenant-associated administrative events.
- Временный support context стартовал по названию роли, а не доступным действиям.

### Security
- Tenant isolation и expiry/revocation остаются server-enforced.
- Отзыв приглашения и audit event выполняются атомарно.
- Новые глобальные permissions не выдавались; audit JSON отображается как текст, не HTML.

### Migration
- Новых миграций основной базы и основного seed в этом блоке нет.
- Изолированные tests используют текущие migrations и случайную test schema.

### Tests
- После изменений: core API 44/44, frontend/backend TypeScript, Vite build — passed.
- Начальный full run остановлен по внешнему лимиту времени на storage suite; не считается полностью passing.
- Browser QA Console invitations/audit на desktop1440/mobile390 прошёл; scope и ограничения подробно отмечены в `VERNATUN-AUDIT.md`.

Остальные фазы спецификации пока не выполнены.

## 6 октября — согласованная Phase 1 foundation

### Added
- Добавочная migration013, immutable audit guard, subscription/plan module policy, reasoned overrides, minute support/subscription expiry jobs.
- Три функциональные Console поверхности: subscriptions, paginated audit, invitation lifecycle.
- Защищённый dev/test email outbox и SMTP adapter с честным acceptance status; единая доставка приглашений, семейного делегирования и reset.

### Fixed
- Повторная отправка меняет токен и не восстанавливает отозванное приглашение.
- Status transitions проверяют перекрытие/лимит и не возобновляют закрытый контракт; null grace означает отсутствие grace.
- Даты Console учитывают Asia/Yerevan; stale responses и состояние другого контекста не подменяют текущие значения.

### Preservation / verification
- Основной seed не запускался; accounts/business/private bytes не заменялись. Backup manifest создан до main migration. До/после проверены исходные строки и значения.
- Core50/50, затем final Phase1-only11/11; TypeScript и Vite build passed. Remote storage/full backup drill не объявляется повторно пройденным.
- Реальный SMTP/production не настроен; весь платформенный prompt не завершён.

## 6 октября — общий EmailProvider и выбранный Resend

- Добавлены независимые ResendEmailProvider, SMTPEmailProvider и DevelopmentOutboxProvider, registry и общий facade без изменения business callers.
- SDK интеграции используется только сервером; MAIL_PROVIDER выбирает адаптер, EMAIL_FROM общий для сервисов.
- Resend receipts/ошибки/idempotency проверяются; смена токена меняет ключ отправки. Нет тихого fallback на outbox.
- 8 новых adapter regression tests включены в стандартный core/phase1 runner; полный текущий core59/59, TypeScript и Web build passed.
- Live setup BLOCKED: существующее подключение Resend возвращает API key is invalid, отправитель пока не задан. Реальные сообщения и production publishing не выполнялись.
