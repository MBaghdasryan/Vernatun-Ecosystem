# Сверка и кредиты

Существующий property-контур сохранён:
CSV import → проверка/дубликаты → unmatched transaction → ручное соответствие
квартире/плательщику → подтверждённый payment → allocations → credit.

Основной код: `bank-reconciliation.ts`, `billing-batches.ts`, `finance.ts`.
Правила и допустимые поля CSV не изменены этим платежным этапом.
Сверка требует `payments.reconcile`; житель не сопоставляет произвольные
банковские строки и видит только собственный credit.

## Provider payments

Подтверждённый online property payment использует тот же ledger.
Если сумма текущего долга уменьшилась до provider verification, распределение
ограничивается текущим балансом, остаток хранится существующим account credit.
Тот же бухгалтерский endpoint распределения кредита поддерживает source=provider.
Нельзя перенести такой credit другой квартире/плательщику/валюте.
Тест проверяет оплату долга вручную между checkout и provider verification.

Сначала блокируется payment, затем invoice; баланс читается новым запросом
после блокировки. Не рассчитывать доступный остаток в том же запросе,
который ожидает FOR UPDATE: snapshot может быть уже устаревшим.

## Границы

Прямые банковские balance/transaction APIs не подключены.
Нет новых ML/автоматических правил сопоставления или импортов statement форматов.
SaaS manual transfer и utility reconciliation не приравниваются к property ledger.
Refund compensation не реализована: возврат не отмечается ручной правкой payment.
