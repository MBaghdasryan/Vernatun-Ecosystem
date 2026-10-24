# Vernatun — аудит почты и Resend

## Итог

**Код и тесты готовы к конфигурации Resend API в Coolify, но production-доставка пока не подтверждена.** Прямого доступа к переменным и базе Coolify нет. Реальное письмо не отправлялось, Resend-конфигурация не изменялась, DNS и входящая почта Hostinger не трогались.

## Что подтверждено

### Почтовый слой

- Сохранён общий интерфейс провайдера: `ResendEmailProvider`, `SMTPEmailProvider`, `DevelopmentOutboxProvider`.
- Адаптер Resend теперь отправляет запросы прямо в Resend API и читает `RESEND_API_KEY` только на сервере. Значение не попадает во frontend и не пишется в логи.
- Для каждого письма сохраняются идемпотентность, ограничение времени запроса и безопасная ошибка без ответа провайдера или содержимого письма.
- Проверены через общий слой приглашения и восстановление пароля. Остальные системные письма могут использовать тот же слой, но production-отправка и полный перечень их бизнес-сценариев не подтверждены.
- Выбранная схема адресов сохранена: `info@vernatun.io` — входящие обращения Hostinger; `noreply@vernatun.io` — исходящие письма Resend; `support@vernatun.io` — поддержка/тикеты. Для адреса поддержки указан приёмный адрес Resend `b3b72580@fensiko.resend.app`.

### Webhook и доставка

- Оставлен существующий маршрут приложения `/api/webhooks/resend`; алиас не удалялся.
- В коде сохраняются проверка Svix-подписи по исходному телу, ограничение времени подписи, идемпотентность событий, безопасное хранение результатов и retryable `503` при временной ошибке хранилища.
- Поддержаны события `email.sent`, `email.delivery_delayed`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`.
- Синтетические подписанные события, дубликаты, неверные подписи, bounce/complaint и повтор после временного сбоя проверены локальными тестами.
- Производственный GET-проверочный запрос показал:
  - `GET https://api.vernatun.io/api/webhooks/resend` → **405** (маршрут доступен на API-хосте и ожидает POST);
  - `GET https://vernatun.io/api/webhooks/resend` → **500**;
  - `GET https://api.vernatun.io/api/health` → **200**.

**Вывод:** текущий адрес webhook на основном сайте не подходит для доставки в API. После восстановления доступа к Resend нужно изменить URL существующего webhook на `https://api.vernatun.io/api/webhooks/resend`. Не создавать новый webhook и не удалять существующий.

## Что ещё не подтверждено в production

| Проверка | Статус | Что требуется |
|---|---|---|
| `RESEND_API_KEY` в Coolify | Не могу проверить: доступ к окружению Coolify отсутствует | Убедиться, что ключ добавлен в server-side secrets Coolify. Если переменной нет или Resend отклоняет ключ — обновить её там, не отправляя значение в чат |
| Resend-подключение Replit | Проверка API вернула `400`, ключ подключения отмечен Resend как недействительный | Обновить ключ в существующем подключении Resend Replit, если оно нужно для управления интеграцией. Это не доказывает состояние отдельного ключа в Coolify |
| `MAIL_PROVIDER` и `EMAIL_FROM` в Coolify | Не проверены | Установить `MAIL_PROVIDER=resend`, `EMAIL_FROM=noreply@vernatun.io` |
| `RESEND_WEBHOOK_SECRET` и scope в Coolify | Не проверены | Установить существующий signing secret в Coolify Secret; ожидаемый scope по умолчанию — `primary`, либо задать scope существующего webhook |
| Отправляющий домен и sender в Resend | Не подтверждены | После восстановления API-доступа проверить в Resend домен `vernatun.io` и отправителя `noreply@vernatun.io` |
| Существующий webhook в Resend | Не удалось прочитать через API из-за недействительного ключа | Проверить список, затем изменить только URL существующей записи на API-хост |
| Входящий `support@` | Не проверен | Если требуется пересылка в Resend, настроить её в Hostinger на `b3b72580@fensiko.resend.app`; сохранить текущую MX-конфигурацию Hostinger |
| Live send / delivery / bounce | Не выполнены | Сначала подтвердить ключ, домен, sender и endpoint; затем отправить согласованное тестовое письмо и дождаться событий Resend |

Доступные переменные Replit показывали `MAIL_PROVIDER=resend` и `EMAIL_FROM=noreply@vernatun.io`. Это **не подтверждает** значения или секреты production в Coolify: у этих окружений отдельные настройки.

## Что необходимо внести в Coolify

В API-контейнере, только server-side:

```text
MAIL_PROVIDER=resend
RESEND_API_KEY=<действующий ключ Resend>
EMAIL_FROM=noreply@vernatun.io
RESEND_WEBHOOK_SECRET=<существующий signing secret>
RESEND_WEBHOOK_SCOPE=primary
```

Секреты вводить только в Coolify Secrets/Environment. Не добавлять их в GitHub, frontend, документацию, командную строку общего CI или чат. `info@` и `support@` оставить входящими адресами Hostinger; MX-записи Hostinger не заменять Resend-записями.

## Глобальные аккаунты

Production-аккаунты не создавались; существующие пользователи и пароли не менялись. Добавлен отдельный production-only скрипт, который создаёт обе новые роли в одной транзакции и прекращает работу, если хотя бы один адрес уже существует. Письма он не отправляет; случайные пароли сохраняет только в JSON-файле `/tmp` с режимом `0600`.

После отправки изменений в GitHub и развертывания API команда в Coolify:

```bash
VERNATUN_GLOBAL_ACCOUNT_CONFIRM=CREATE_GLOBAL_ACCOUNTS \
NODE_ENV=production \
corepack pnpm --filter @workspace/api-server run db:provision:global-accounts -- \
  --platform-admin-email=info@vernatun.io \
  --support-email=cubeappmaker@gmail.com \
  --confirm-production-global-account-provision
```

Пользователь должен забрать файл с временными паролями из контейнера по выведенному пути, не пересылать его через GitHub/чат, сменить пароли и включить MFA для `platform_admin`, затем удалить файл. Полная инструкция: `GLOBAL-ACCOUNT-PROVISION-RU.md`.

## Проверки в этой рабочей копии

- `corepack pnpm run typecheck` — успешно.
- `corepack pnpm --filter @workspace/api-server run build` — успешно.
- `corepack pnpm --filter @workspace/api-server run test:delivery` — успешно: 37 тестов доставки/webhook в трёх наборах, ошибок нет.
- `node --check .../provision-global-accounts.mjs` — успешно.
- `git diff --check` — успешно.

Все тесты доставки выполнялись на изолированной тестовой базе с синтетическими письмами и signing key. Live-письмо и production-запросы на изменение webhook не выполнялись.
