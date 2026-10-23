# Vernatun: платёжная архитектура

## Обязательные границы

| Домен | Обязательство | Получатель денег | Выбранный провайдер |
|---|---|---|---|
| platform | Подписка организации на Vernatun | Vernatun | Ameriabank VPOS |
| property | Опубликованные начисления жителя | Конкретная организация | Собственный ArCa/IPay merchant организации |
| utility | Услуга коммунального поставщика | Коммунальный поставщик через агрегатора | Telcell B2B; область учётной записи определяется контрактом |

Нельзя заменять отсутствующий ArCa организации платформенным Ameriabank.
Нельзя зачислять utilities на счёт организации или Vernatun.
Смена провайдера в будущем не должна переписывать обязательства и учёт.

## Аудит существующего учёта

Восстановлены и переиспользуются:

- `invoices`, `invoice_lines`, `adjustments`: начисления и корректировки;
- `payments`, `payment_allocations`: неизменяемые платежи и распределения;
- `payment_accounts`: привязка кредита к квартире, плательщику и валюте;
- `bank_import_batches`, `bank_transactions`, правила сверки и кредиты;
- существующие subscriptions/plans, аудит, notifications и настройки каналов;
- `operation_receipts`: ключ операции, fingerprint и блокировка повторного запроса.

Основные исходники: `finance.ts`, `bank-reconciliation.ts`, `billing-batches.ts`,
`operations.ts` в `artifacts/api-server/archive/vernatun/server`.
Новый параллельный property ledger не создан. Импорт выписки не переписан.

## Добавленная схема

Миграция `039_payment_foundation.sql` добавляет:

- `payment_provider_instances`: тип, домен, scope, environment, ревизия, шифротекст;
- `platform_invoices`: отдельные SaaS-обязательства по плану и периоду;
- `payment_intents`: обязательство, плательщик, серверный provider и order number;
- `payment_intent_invoices`: снимок выбранных существующих начислений;
- `payment_transactions`: неизменяемое подтверждённое свидетельство провайдера;
- `platform_payment_allocations`: SaaS-распределение, отдельно от ЖКХ;
- пустой `utility_service_catalog` и основу `utility_accounts`.

У `payments.source` добавлено значение `provider`. Нет изменений исторических сумм.
Существующая защита credit allocations допускает также provider-платежи.
Кредит не объединяется между квартирами, плательщиками или валютами.

## Запрос и завершение оплаты

1. Сервер проверяет текущий контекст, разрешение, модуль, актуальную аренду/делегацию.
2. Сумма и валюта выводятся из обязательства; клиент не задаёт merchant/amount.
3. Router выбирает domain + organization + environment. Fallback между доменами отсутствует.
4. Intent и ключ запроса сохраняются до обращения к внешнему сервису.
5. После возможного timeout тот же ключ не вызывает повторный initialize.
6. Browser return открывает квитанцию, но не подтверждает деньги.
7. Перед проводкой сверяются merchant identity, order, payment ID, amount и currency.
8. В одной транзакции блокируется intent; создаются provider evidence, существующий
   property payment/allocations либо SaaS allocation; записываются аудит и уведомление.

Сначала берутся блокировки, затем отдельным SQL-запросом читается актуальный баланс.
Защищены повторное подтверждение и параллельные подтверждения одного intent.
Изменившийся долг property ограничивает распределение; остаток — существующий credit.
Несогласованная переплата SaaS останавливается для сверки, не распределяется выдуманно.

## Интерфейсы и границы готовности

`PaymentProvider` обслуживает platform/property; `UtilityAggregatorProvider` отделён.
У utility evidence раздельны aggregator status и utility settlement status.
Названия реальных классов провайдеров сейчас обозначают **readiness markers**,
а не работающие сетевые адаптеры. Их capabilities пусты.
Активировать реальные онлайн-платежи через UI/API пока нельзя.

Test port устанавливается только программно внутри NODE_ENV=test. Нет mock
provider code, environment-переключателя или API активации mock в production.

## API и UI

OpenAPI: `lib/api-spec/payments.yaml`, ссылки из основного `openapi.yaml`.
Клиент и Zod генерируются штатным Orval, а не редактируются вручную.

- Console `/console/payments`: платформенный provider, счета SaaS и intents.
- OS `/os/payments`: ArCa своей организации и разрешённые финансовые сведения;
  org admin также видит собственные SaaS-счета.
- ImTun Web `/imtun/payments`: прежние начисления/сверка сохранены;
  `?view=online-payments` открывает отдельный платёжный workspace.
- ImTun Web `/imtun/utilities`: недоступный lookup, пустой каталог и capabilities,
  не нулевой долг.

Это изменение **Vernatun Web/ImTun Web**, а не новая реализация экранов Expo/APK.
Списки ограничены 100 строками, `hasMore` сигнализирует ограничение;
полноценные курсоры, фильтры и история всех страниц пока не реализованы.

## Что нельзя запускать до следующего этапа

Реальные init/status/callbacks, автоматический recovery worker, capture/cancel,
refund с компенсирующими проводками, utility payment и native mobile checkout.
Не использовать новый контур как production payment system до закрытия этих пунктов.
