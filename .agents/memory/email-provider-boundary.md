---
name: Email provider boundary
description: User-required provider-independent email architecture and initial choice of Resend.
---

Общий слой `EmailProvider` должен иметь отдельные адаптеры `ResendEmailProvider`, `SMTPEmailProvider` и `DevelopmentOutboxProvider`. Пользователь выбрал Resend, но архитектуру нельзя привязывать к нему намертво: переключение на SMTP или другой provider должно быть возможно без переписывания бизнес-логики.

**Why:** Пользователь прямо потребовал общий слой и возможность смены провайдера при выборе Resend.

**How to apply:** Приглашения, сброс пароля и другие бизнес-процессы вызывают общий интерфейс; настройка выбирает адаптер. SDK, transport и особенности конкретного сервиса остаются внутри соответствующего адаптера.

Пользователь сообщил, что обновил существующий Resend webhook на `https://api.vernatun.io/api/webhooks/resend` и настроил Resend в Coolify; это пока не подтверждено независимой production-проверкой.

**Why:** Основной сайт и API размещены на разных хостах, а webhook должен достигать API-сервиса.

**How to apply:** Использовать API-хост для Resend webhook. Различать сообщение пользователя о настройках Coolify/Resend и независимо проверенные факты; не объявлять live delivery готовой без успешного production-события.

Пользователь сообщил, что новый Resend API key работает в Coolify, `vernatun.io` отмечен Verified, `noreply@vernatun.io` отправляет, `info@vernatun.io` получает через Hostinger, а существующий webhook возвращает HTTP 204 и обрабатывает `email.sent`/`email.delivered`. Это пользовательский production-отчёт, а не независимая проверка агента.

**Why:** Эти результаты подтверждают рабочий статус, сообщённый пользователем, и отделяют его от недействительного Replit Resend connector.

**How to apply:** Считать Coolify email path работающим по пользовательскому отчёту; не использовать Replit connector error как доказательство неисправности Coolify и не считать `support@` или bounce-путь проверенными без отдельного подтверждения.

Почтовая маршрутизация Vernatun: Resend API используется для исходящих писем от `noreply@vernatun.io`; Hostinger Email остаётся входящим провайдером для `info@vernatun.io` и `support@vernatun.io`. Не заменять MX-записи Hostinger. Существующие Resend webhooks нельзя удалять или дублировать; при необходимости обновлять существующую запись.

**Why:** Пользователь подтвердил разделение исходящей и входящей почты, сохранение Hostinger для входящих сообщений и запрет на пересоздание существующих webhook.

**How to apply:** Проверять фактическое состояние Resend и Coolify отдельно. Любую пересылку поддержки на Resend Receiving настраивать через Hostinger без переноса MX.
