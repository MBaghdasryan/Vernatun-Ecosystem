# Resend webhook — текущая проверка

Дата: 6 октября 2026 года. Заменяет срез до объединения реализации.

| Проверка | Результат |
|---|---|
| Canonical endpoint | В основном коде: POST `/api/webhooks/resend` |
| Target URL | `https://vernatun.io/api/webhooks/resend`, задан пользователем; домен ещё не готов |
| Signature / raw body | Svix, три headers, исходные байты до JSON/session/CSRF; изолированные fixtures прошли |
| Events | sent, delivered, delivery_delayed, bounced, complained, failed |
| Idempotency / ordering | Проверены; уникальный svix-id в account scope, детерминированный aggregate |
| Generic send ledger | Добавлен без token/body/URL; прежние invitation attempts/receipts сохранены |
| Console | `/console/email`, platform_admin only; список, фильтры, health, timeline |
| Browser QA | Desktop 1280px / phone 390px; реальный empty/health, filters, navigation/guest access; timeline — только временные browser GET fixtures |
| Signing secret | Наличие подтверждено; значение не читалось; live соответствие ещё не подтверждено |
| Webhook registration | По сообщению пользователя создан; API-проверки регистрации не было |
| Provider credentials/domain | Live authorization/domain/sender не подтверждены; последнее ранее выполненное read-only обращение вернуло invalid API key |
| Final isolated email/Phase 1 tests | 35/35; реальных provider calls нет |
| Main development schema | Проверенная migration 015 применена; production schema не менялась |
| Live signed event | Нет подтверждения |
| Live delivered / bounce / complaint | Не выполнялись |
| Real test emails | 0 — пользователь запретил отправку до готовности домена |

Подробный контракт, политика состояний, setup и отложенная live-проверка: `RESEND-WEBHOOK.md`.
