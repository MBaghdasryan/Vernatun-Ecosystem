---
name: Email provider boundary
description: User-required provider-independent email architecture and initial choice of Resend.
---

Общий слой `EmailProvider` должен иметь отдельные адаптеры `ResendEmailProvider`, `SMTPEmailProvider` и `DevelopmentOutboxProvider`. Пользователь выбрал Resend, но архитектуру нельзя привязывать к нему намертво: переключение на SMTP или другой provider должно быть возможно без переписывания бизнес-логики.

**Why:** Пользователь прямо потребовал общий слой и возможность смены провайдера при выборе Resend.

**How to apply:** Приглашения, сброс пароля и другие бизнес-процессы вызывают общий интерфейс; настройка выбирает адаптер. SDK, transport и особенности конкретного сервиса остаются внутри соответствующего адаптера.
