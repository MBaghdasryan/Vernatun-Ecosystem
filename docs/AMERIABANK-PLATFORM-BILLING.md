# Ameriabank: только SaaS Vernatun

**Состояние: PARTIAL / CONTRACT REQUIRED. Банковский sandbox не проверен.**

## Проверенная официальная информация

Публичная тестовая справка:

- https://servicestest.ameriabank.am/VPOS/Help
- https://servicestest.ameriabank.am/VPOS/Help/Api/POST-api-VPOS-InitPayment
- https://servicestest.ameriabank.am/VPOS/Help/Api/POST-api-VPOS-GetPaymentDetails

Она описывает `InitPayment` и `GetPaymentDetails`, названия
`ConfirmPayment`, `RefundPayment`, `CancelPayment`.
В InitPayment документированы ClientID, Username, Password, Amount,
целочисленный OrderID, BackURL, Description, Currency и дополнительные поля.
В GetPaymentDetails документированы merchant/order, Amount, Currency,
PaymentState/OrderStatus/ResponseCode и дополнительные чувствительные поля.
Пользователь предоставил `vPOS_Eng_3.1_(1)_1792764549640.docx` (vPOS 3.1).
Он документирует redirect, таблицу состояний и read-only GetBindings.

Спецификация описывает общие состояния и checkout, но не подтверждает
договорный режим конкретного merchant и выданные ему разрешения.
Приём платежей пока не включён; запрос проверки подключения реализован отдельно.

## Настройка и тест соединения

В Console → Платежи выберите окружение, внесите **Client ID, username, password**,
сохраните и нажмите **«Тест соединения»** у сохранённого подключения.
API URL вводить не нужно: используются фиксированные адреса банка:

- Sandbox: `https://servicestest.ameriabank.am/VPOS/api/VPOS/GetBindings`
- Production: `https://services.ameriabank.am/VPOS/api/VPOS/GetBindings`
  (подтверждён официальной публичной Help на production-хосте).

Отправляется read-only `GetBindings`, PaymentType=5. Он не создаёт заказ,
не списывает деньги и не изменяет bindings. Ответ `ResponseCode="00"` означает
успешный аутентифицированный доступ; `20` — отклонённые реквизиты.
Другие коды, отсутствие разрешения на bindings, таймаут, HTTP-ошибка
или некорректный ответ не выдаются за успешное подключение.
Если банк не выдал permission GetBindings, проверку нужно согласовать с банком;
приложение не подменяет её платёжной операцией.

Реквизиты расшифровываются только на сервере. Карточные данные и произвольные
сообщения банка не сохраняются, не журналируются и не возвращаются клиенту.
Запрос ограничен 8 секундами и 256 КиБ; повторы — не чаще раза в 30 секунд.
Фиксируются безопасный результат и аудит, проверяется revision конфигурации.
**Connected не означает готовность checkout и не активирует платежи.**
Без банковских реквизитов live-проверка не выполнялась; тесты используют
изолированный HTTP mock, а не sandbox банка.

## Что реализовано независимо от банка

- Только platform-scoped Ameriabank instance; org admin его не настраивает.
- Environment sandbox/production разделён; выбор environment серверный.
- Реквизиты Client ID/username/password принимаются только write-only и шифруются.
- Сохранение draft не означает connected и не включает платежи.
- Счёт создаётся уполномоченным platform administrator из subscription plan,
  периода и организации. Передать произвольную стоимость нельзя.
- Повторный idempotency key возвращает тот же счёт.
- Org admin может платить собственный SaaS-счёт через отдельное
  `platform_billing.pay`, даже когда подписка ограничила обычные изменения.
- Проверенное свидетельство в test port создаёт SaaS allocation и оплачивает счёт.
- Для действующей по датам trial/past_due подписки допускается active.
  Срок подписки самовольно не продлевается, suspended/cancelled не снимается.

## Что ещё требуется

1. Подтверждение merchant-режима и выданных банком разрешений.
2. Реализация точной конверсии minor units Vernatun в Amount банка и обратно.
3. Реализация сверки PaymentState/OrderStatus/ResponseCode по таблицам vPOS 3.1.
4. Реализация hosted checkout и серверной перепроверки после BackURL.
5. Capture, cancellation, partial/full refund с учётом режима merchant.
6. Ввод официальных credentials через админку, не в чат.
7. Status reconciliation worker и recovery после пропавшего ответа.
8. Sandbox happy/failed/pending/timeout/duplicate/refund tests.
9. Согласованная live-проверка и production-приёмка.

Refund, reversal, binding/autopay, platform credit и подтверждение ручного SaaS
bank transfer в этом этапе не реализованы. Их нельзя подменять property payment.
PAN/CVV и полный ответ GetPaymentDetails не сохраняются.
