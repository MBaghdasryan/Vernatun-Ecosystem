# Vernatun — аудит почты и Resend

## Итог

**По последнему отчёту пользователя, production Resend-доставка работает:** ключ принят, домен подтверждён, `noreply@vernatun.io` отправляет письма, `info@vernatun.io` получает через Hostinger, webhook возвращает HTTP 204, события `email.sent` и `email.delivered` зафиксированы. Эти статусы предоставлены пользователем и отдельно из этой среды не проверялись. Доступа к переменным Coolify нет; DNS и входящая почта Hostinger не менялись.

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

**Вывод:** API-хост доступен, webhook-маршрут существует и принимает только POST. Пользователь сообщил, что существующий webhook направлен на `https://api.vernatun.io/api/webhooks/resend`, и что production POST завершился HTTP 204 с последующими `email.sent` и `email.delivered`. Старый URL основного сайта всё ещё отвечает `500`, но это не указывает на сбой, если Resend использует API-хост. Новый webhook не создавался и удалений не выполнялось.

## Что ещё не подтверждено в production

| Проверка | Статус | Что требуется |
|---|---|---|
| `RESEND_API_KEY` в Coolify | Пользователь сообщает, что новый ключ настроен и работает; отдельно проверить из этой среды нельзя | Не публиковать ключ; если отправка снова перестанет работать, проверить наличие значения в server-side secrets Coolify |
| Resend-подключение Replit | GET `/domains` вернул `400 API key is invalid`; reauthorization context определил тип credential как API key | При необходимости обновить ключ в существующем подключении Replit. Это подключение отдельно от Coolify и не подтверждает его состояние |
| `MAIL_PROVIDER` и `EMAIL_FROM` в Coolify | Production отправка `noreply@vernatun.io` подтверждена пользователем | Сверять `MAIL_PROVIDER=resend`, `EMAIL_FROM=noreply@vernatun.io`, если отправка изменится |
| `RESEND_WEBHOOK_SECRET` и scope в Coolify | По пользовательскому отчёту webhook обработал событие с HTTP 204; значения секретов недоступны для независимой проверки | При последующем сбое сверить секрет webhook в Coolify с текущим существующим webhook (scope по умолчанию — `primary`) |
| Отправляющий домен и sender в Resend | Пользователь сообщает: `vernatun.io` Verified, `noreply@vernatun.io` отправляет | Независимое чтение панели через Replit connector пока не работает; это не отменяет успешный результат Coolify |
| Существующий webhook в Resend | Пользователь сообщает: endpoint отвечает HTTP 204, `email.sent` и `email.delivered` успешно обработаны | Не создавать новый webhook; использовать существующую запись |
| Входящие адреса | Пользователь сообщает, что `info@vernatun.io` получает почту через Hostinger; состояние `support@` отдельно не указано | Сохранять MX Hostinger; не считать поддержку подтверждённой без отдельной проверки |
| Live send / delivery / bounce | `email.sent` и `email.delivered` подтверждены пользователем; bounce не подтверждён | При необходимости проверять bounce отдельным контролируемым сценарием |

В Replit видны `MAIL_PROVIDER=resend`, `EMAIL_FROM=noreply@vernatun.io` и наличие `RESEND_WEBHOOK_SECRET`; `RESEND_API_KEY` в Replit отсутствует. Это **не подтверждает и не опровергает** Coolify: у этих окружений отдельные настройки. Доступное Replit-подключение Resend вернуло `400 API key is invalid`; его состояние не используется как индикатор ключа Coolify.

## Контрольные значения для Coolify

Пользователь сообщил, что эти настройки уже внесены. Ниже — контрольный список для диагностики, а не просьба менять рабочую конфигурацию. Переменные должны находиться только в API-контейнере:

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

Все локальные тесты доставки выполнялись на изолированной тестовой базе с синтетическими письмами и signing key. Production-письмо и успешную обработку `email.sent`/`email.delivered` сообщил пользователь; из этой рабочей среды live-письмо не отправлялось и настройки Resend не менялись.

## Дополнительная проверка отправки и входящей почты

- В Replit production environment видны `MAIL_PROVIDER=resend` и `EMAIL_FROM=noreply@vernatun.io`; secret `RESEND_WEBHOOK_SECRET` существует, `RESEND_API_KEY` отсутствует. Это состояние Replit, а не Coolify.
- Coolify secrets/API container не доступны для независимой проверки. Значения секретов не запрашивались и не выводились.
- Попытка прочитать домены через существующее Resend API-подключение завершилась `400 API key is invalid`; текущий статус `vernatun.io` и разрешённый sender `noreply@vernatun.io` поэтому отдельно не проверены. Пользователь ранее сообщил, что домен Verified и sender отправляет.
- Публичные MX-записи `vernatun.io` сейчас указывают на `mx1.hostinger.com` (priority 5) и `mx2.hostinger.com` (priority 10). Записи DNS не изменялись.
- Пользователь подтвердил, что в Coolify API заданы `MAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` и `RESEND_WEBHOOK_SECRET`, а `vernatun.io` Verified и `noreply@vernatun.io` разрешён. Значения секретов не запрашивались; это подтверждение пользователя, а не независимый доступ к Coolify/панели Resend.
- Пользователь разрешил одно тестовое письмо на `cubeappmaker@gmail.com`. Оно пока не отправлено: в приложении нет изолированного test-send маршрута, а `/api/auth/forgot-password` создаёт токен сброса и аннулирует прежние активные ссылки. Без отдельного согласия на этот побочный эффект он не использовался.
- Затем пользователь выбрал не отправлять новое письмо и принять ранее сообщённую production-проверку: HTTP 204 для webhook и события `email.sent`/`email.delivered`. В этой задаче дополнительная отправка и независимое чтение истории событий не выполнялись.
