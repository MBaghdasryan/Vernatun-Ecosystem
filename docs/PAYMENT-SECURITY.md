# Безопасность платёжного контура

## Запреты

- Нет PAN/CVV, собственного card input или хранения полного банковского response.
- Нет клиентского выбора merchant, суммы или ручного online-success.
- Нет cross-domain fallback; tenant/domain foreign keys дополнены SQL guards.
- Не активировать mock/unknown providers через production environment или БД.
- Не отправлять credentials, subscriber identifiers, raw provider error/body в журнал.

## Секреты

Provider credentials принимаются write-only от уполномоченного администратора.
Используется существующий OperationsCipher (AES-256-GCM/HKDF) и purpose binding
к provider instance, organization и provider code.
Чтение API возвращает только `credentials_configured`.
Ротация использует revision; старый form не перезаписывает новые настройки.
Без настроенного encryption key credentials не сохраняются.
Значение ключа не находится в исходниках/документах.
Для отдельной эксплуатации обязательны существующие правила recovery и backup keys.

ArCa credential schema и Telcell scope/credentials требуют контракта;
их произвольная настройка сейчас запрещена.

## Доступ

- Platform Ameriabank/config и выдача SaaS-счетов: global subscriptions.manage.
- Своя SaaS-оплата: org_admin/platform_billing.pay, без обычных write-прав
  на период ограниченной подписки.
- ArCa config: organization.settings своей полной организации.
- Property init: billing.own + актуальный unit/payer; сверка: payments.reconcile.
- Utilities placeholder: billing.own актуальной квартиры.
- CSRF и существующая session/MFA/module/subscription policy сохранены.

## Идемпотентность и учёт

Operation receipt привязан к пользователю/контексту/пути и fingerprint тела.
Один order сохраняется до внешнего обращения.
Параллельное verify блокирует intent; success transaction уникален.
Invoice и payment balances перечитываются после блокировок.
Transactions/allocations защищены от UPDATE/DELETE/TRUNCATE;
обязательство и provider identity не меняются после создания.

## Callbacks

Маршруты `/api/payments/callbacks/ameriabank`,
`/api/payments/callbacks/arca`, `/api/utilities/callbacks/telcell`
сейчас **всегда отклоняют** запрос с 409 provider_contract_required и ничего
не проводят. Они расположены до session/CSRF, но не являются готовыми webhook handlers.
Подписи банков не выдуманы и пока не верифицируются.
Перед live обязательны договорные raw-body/signature/replay/merchant checks
и worker восстановления неопределённых операций.

Успешный тест test port не является sandbox verification банка.
Новые изменения не прошли отдельный полный SAST/dependency scan;
результаты старого аудита этим этапом не закрываются.
