# ArCa/IPay: платежи ЖКХ

**Состояние: PARTIAL / CONTRACT REQUIRED.**

У каждой организации свой organization-scoped merchant.
Схема и router отклоняют merchant другой организации и платформенный Ameriabank.
Resident billing.own ограничен текущим разрешённым unit/payer и опубликованными
начислениями; семейный пользователь не получает финансовый доступ автоматически.

## Готовая основа

- Draft ArCa своей организации, ревизия настроек, disable и аудит.
- Документированной формы credentials пока нет; произвольные секретные поля отвергаются.
- ImTun Web показывает доступные собственные invoices и их реальные balances.
- Выбираются invoice IDs, а не сумма/merchant из браузера.
- Смешанные валюты и чужие/неопубликованные начисления отклоняются.
- Стратегии selected/oldest/current-period используют выбранный сервером набор.
- Повторный initialize после неизвестного сетевого исхода не выполняется.
- Квитанция получает intent, доказанные transactions и реальные allocations.
- Success идёт в существующие `payments`/`payment_accounts`/`payment_allocations`.
- Переплата остаётся кредитом именно этой квартиры, плательщика и валюты.
- Проверены duplicate и concurrent verification, неверные merchant/order/amount/currency.

## Если ArCa не настроен

Онлайн-оплата недоступна. Существующие начисления, ручной bank transfer,
импорт выписки и бухгалтерская сверка не заменяются и не скрываются.
Нет fallback на SaaS merchant Vernatun.

## Требуется от банка/эквайера

Технический контракт именно merchant API ArCa/IPay: версия, environments и URLs,
authentication/credentials schema, registration/status, hosted redirect,
amount/currency semantics, callback verification/replay, refunds/cancel,
transaction references, reconciliation/fees, terminal success rules.
Название IPay не является разрешением копировать протокол другого банка.

HTTP-адаптер, реальные merchant credentials per org, sandbox/live payment,
возвраты с компенсирующим учётом и production-приёмка ещё не выполнены.
Нельзя делать refund через изменение исходного платежа.
