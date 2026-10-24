# Vernatun — аудит почты и Resend

## Итог

**Код и локальные проверки готовы; доступность API подтверждена, но production-доставка пока не подтверждена.** Прямого доступа к переменным и базе Coolify нет. По сообщению пользователя, URL существующего webhook в Resend уже изменён на API-хост. Реальное письмо не отправлялось; DNS и входящая почта Hostinger не менялись.

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
- Повторная production GET-проверка показала:
  - `GET https://api.vernatun.io/api/webhooks/resend` → **405** (маршрут доступен на API-хосте и ожидает POST);
  - `GET https://vernatun.io/api/webhooks/resend` → **500**;
  - `GET https://api.vernatun.io/api/health` → **200**.

**Вывод:** API-хост доступен, webhook-маршрут существует и принимает только POST. Пользователь сообщил, что обновил URL существующего webhook на `https://api.vernatun.io/api/webhooks/resend`; независимо подтвердить настройку в Resend сейчас нельзя, так как доступный Resend API-ключ недействителен. Ответ `500` на старом URL основного сайта сохраняется, но сам по себе не означает ошибку доставки, если существующий webhook теперь направлен на API-хост. Новый webhook не создавался и удалений не выполнялось.

## Что ещё не подтверждено в production

| Проверка | Статус | Что требуется |
|---|---|---|
| `RESEND_API_KEY` в Coolify | По сообщению пользователя, Coolify настроен; проверить из этой среды нельзя | В Coolify убедиться, что ключ задан как server-side secret. Не отправлять его в чат |
| Resend-подключение Replit | GET `/domains` вернул `400 API key is invalid`; reauthorization context определил тип credential как API key | При необходимости обновить ключ в существующем подключении Replit. Это подключение отдельно от Coolify и не подтверждает его состояние |
| `MAIL_PROVIDER` и `EMAIL_FROM` в Coolify | По сообщению пользователя, Coolify настроен; из этой среды не проверено | Проверить `MAIL_PROVIDER=resend`, `EMAIL_FROM=noreply@vernatun.io` |
| `RESEND_WEBHOOK_SECRET` и scope в Coolify | По сообщению пользователя, Coolify настроен; из этой среды не проверено | Убедиться, что существующий signing secret добавлен в Coolify Secret и его scope совпадает с существующим webhook (по умолчанию — `primary`) |
| Отправляющий домен и sender в Resend | Не подтверждены: чтение доменов через доступное подключение не прошло из-за недействительного API-ключа | Проверить, что `vernatun.io` верифицирован для отправки и sender `noreply@vernatun.io` разрешён |
| Существующий webhook в Resend | Пользователь сообщил, что изменил endpoint; API-проверить запись нельзя из-за недействительного ключа | Убедиться в панели Resend, что существующая запись указывает на `https://api.vernatun.io/api/webhooks/resend` и содержит необходимые события. Не создавать новую запись |
| Входящий `support@` | Не проверен | Если нужна пересылка в Resend, настроить её в Hostinger на `b3b72580@fensiko.resend.app`; сохранить текущую MX-конфигурацию Hostinger |
| Live send / delivery / bounce | Не выполнены | Сначала подтвердить ключ, домен, sender и endpoint; затем отправить согласованное тестовое письмо и дождаться событий Resend |

В Replit видны `MAIL_PROVIDER=resend`, `EMAIL_FROM=noreply@vernatun.io` и наличие `RESEND_WEBHOOK_SECRET`; `RESEND_API_KEY` в Replit отсутствует. Это **не подтверждает и не опровергает** Coolify: у этих окружений отдельные настройки. Доступное Replit-подключение Resend вернуло `400 API key is invalid`; его состояние не используется как индикатор ключа Coolify.

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
  --platform-admin-email=<адрес-администратора> \
  --support-email=<адрес-поддержки> \
  --confirm-production-global-account-provision
```

Пользователь должен забрать файл с временными паролями из контейнера по выведенному пути, не пересылать его через GitHub/чат, сменить пароли и включить MFA для `platform_admin`, затем удалить файл. Полная инструкция: `GLOBAL-ACCOUNT-PROVISION-RU.md`.

## Проверки в этой рабочей копии

- `corepack pnpm run typecheck` — успешно.
- `corepack pnpm --filter @workspace/api-server run build` — успешно.
- `corepack pnpm --filter @workspace/api-server run test:delivery` — успешно: 37 тестов доставки/webhook в трёх наборах, ошибок нет.
- Повторный `corepack pnpm --filter @workspace/api-server run test:delivery` — успешно: 37 тестов, ошибок нет.
- Production `GET https://api.vernatun.io/api/health` — `200`; `GET https://api.vernatun.io/api/webhooks/resend` — `405` (ожидаемый ответ для POST-only endpoint); старый адрес на `vernatun.io` отвечает `500`.
- `node --check .../provision-global-accounts.mjs` — успешно.
- `git diff --check` — успешно.

Все тесты доставки выполнялись на изолированной тестовой базе с синтетическими письмами и signing key. Live-письмо не отправлялось. Настройка webhook в Resend не изменялась из этой рабочей среды; обновление endpoint — действие, о котором сообщил пользователь.
