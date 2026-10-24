---
name: Email provider boundary
description: User-required provider-independent email architecture and initial choice of Resend.
---

Общий слой `EmailProvider` должен иметь отдельные адаптеры `ResendEmailProvider`, `SMTPEmailProvider` и `DevelopmentOutboxProvider`. Пользователь выбрал Resend, но архитектуру нельзя привязывать к нему намертво: переключение на SMTP или другой provider должно быть возможно без переписывания бизнес-логики.

**Why:** Пользователь прямо потребовал общий слой и возможность смены провайдера при выборе Resend.

**How to apply:** Приглашения, сброс пароля и другие бизнес-процессы вызывают общий интерфейс; настройка выбирает адаптер. SDK, transport и особенности конкретного сервиса остаются внутри соответствующего адаптера.

Пользователь указал `https://vernatun.io/api/webhooks/resend` как будущий webhook endpoint Vernatun.

**Why:** Пользователь выбрал этот адрес, когда домен ещё не был готов.

**How to apply:** Считать его целевым адресом, а не доказательством активного deployment; не объявлять live readiness по одной конфигурации секрета.

Почтовая маршрутизация Vernatun: Resend API используется для исходящих писем от `noreply@vernatun.io`; Hostinger Email остаётся входящим провайдером для `info@vernatun.io` и `support@vernatun.io`. Не заменять MX-записи Hostinger. Существующие Resend webhooks нельзя удалять или дублировать; при необходимости обновлять существующую запись.

**Why:** Пользователь подтвердил разделение исходящей и входящей почты, сохранение Hostinger для входящих сообщений и запрет на пересоздание существующих webhook.

**How to apply:** Проверять фактическое состояние Resend и Coolify отдельно. Любую пересылку поддержки на Resend Receiving настраивать через Hostinger без переноса MX.
