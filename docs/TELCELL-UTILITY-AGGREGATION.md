# Telcell: utility aggregation

**TELCELL UTILITY DEBT LOOKUP — CONTRACT/API ACCESS REQUIRED**

**Состояние: CONTRACT REQUIRED.**

Не получена официальная B2B-документация, доказывающая право Vernatun
получать информацию об абоненте/долге и проводить коммунальный платёж.
Публичные consumer/merchant страницы не подтверждают aggregator capability.
Проверенный публичный developer URL не предоставил пригодную спецификацию.

## Что подготовлено

- Отдельная категория Utility Aggregators и отдельный интерфейс.
- Capability names: registry, subscriber_check, balance_lookup, payment, status, cancel.
- Не смешиваются aggregator transaction success и utility settlement status.
- Схема каталога хранит внешний service ID, тип услуги, subscriber field definition
  и метку актуальности; схема account — unit/organization, шифротекст абонента,
  маску, статус верификации и timestamps.
- Реальные услуги/номера абонентов не выдуманы и не посеяны.
- ImTun Web показывает CONTRACT_REQUIRED, `balanceState=unavailable`, не «0».
- Telcell setup недоступен до определения scope договором.

## Не реализовано без подтверждённого контракта

Создание/валидация account в UI, registry sync, subscriber lookup,
debt lookup/cache/freshness/история, utility checkout, статусы и settlement,
cancel/refund/reconciliation, webhook verification, production credentials.
Наличие таблицы account не означает готовый пользовательский сценарий.

## Что получить

1. Договор B2B aggregator и подтверждённые права Vernatun.
2. Платформенный или организационный scope; не решать это предположением.
3. Список услуг и точные subscriber fields/validation.
4. Документированные check/balance/payment/status/cancel, idempotency и timeout rules.
5. Отдельные состояния принятия агрегатором и зачисления utility provider.
6. Authentication, callback security, domains/IP allowlists, environments.
7. Реестр долгов, currency/minor units, fees и reconciliation contract.
8. Sandbox доступ и затем отдельно согласованная live-проверка.

Если контракт не поддерживает lookup, capability останется выключенной,
а интерфейс будет сообщать об отсутствии данных. NOT SUPPORTED BY PROVIDER
допустимо ставить только после такого договорного подтверждения.
Нет scraping, reverse engineering, прямых utility APIs или вымышленных endpoints.
Utilities не зачисляются на счёт Vernatun/организации.
