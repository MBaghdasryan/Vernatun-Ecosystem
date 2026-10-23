# Vernatun payments — отчёт готовности

Дата: 2026-10-23. **Общий статус: PARTIAL.**
Это безопасная основа и интерфейсы состояния, не завершённая live-интеграция.

## Дополнение: проверка подключения Ameriabank по vPOS 3.1

Получена официальная спецификация DOCX. В админке достаточно сохранить
Client ID, username и password для выбранного окружения и нажать
«Тест соединения». Выполняется read-only GetBindings по фиксированному адресу
банка; успешная аутентификация, отказ и недоступность различаются.
Результат сохраняется и виден после перезагрузки. Есть таймаут, лимит ответа,
ограничение повторов, проверка revision и безопасный аудит.
Карточные данные из ответа не сохраняются. Успех не активирует checkout.
Live/sandbox-проверки с настоящими реквизитами не выполнялись.
Production, DNS, merchant settings и реальные деньги этим этапом не менялись.

## Provider readiness matrix

| Provider | Purpose | Adapter | Docs | Sandbox | Credentials | Live | Status |
|---|---|---|---|---|---|---|---|
| Ameriabank | SaaS Vernatun | PARTIAL | PARTIAL | CONTRACT REQUIRED | CREDENTIALS REQUIRED | CONTRACT REQUIRED | CONTRACT REQUIRED |
| ArCa/IPay | Платежи своей организации | PARTIAL | CONTRACT REQUIRED | CONTRACT REQUIRED | CREDENTIALS REQUIRED | CONTRACT REQUIRED | CONTRACT REQUIRED |
| Telcell | Utility aggregation | PARTIAL | CONTRACT REQUIRED | CONTRACT REQUIRED | CREDENTIALS REQUIRED | CONTRACT REQUIRED | CONTRACT REQUIRED |

PARTIAL в Adapter означает интерфейс/readiness marker, **не сетевую реализацию**.
SANDBOX VERIFIED и PRODUCTION VERIFIED не присвоены никому.
Отсутствие документации не означает NOT SUPPORTED BY PROVIDER.

## Financial Core

| Пункт | Статус | Фактически |
|---|---|---|
| Intent | CODE READY | Серверная сумма/валюта, route, order, idempotency, unknown outcome |
| Transaction | CODE READY | Верификация identity/amount/currency, один immutable success |
| Allocation | CODE READY | Существующий property ledger и отдельный SaaS allocation |
| Ledger | CODE READY | Atomic success + audit + notification; не новый property engine |
| Credits | CODE READY | Provider surplus в существующем unit/payer/currency credit |
| Refunds | PARTIAL | Тип операции в схеме; service/UI/compensation ещё не реализованы |

## Ameriabank / SaaS

| Пункт | Статус |
|---|---|
| Platform billing/invoice из реального subscription plan | CODE READY |
| Дата/сумма и subscription activation в тестовом порту | CODE READY |
| Адаптер | PARTIAL |
| Documentation verified | PARTIAL |
| Sandbox | CONTRACT REQUIRED |
| Credentials | CREDENTIALS REQUIRED |
| Live payment | CONTRACT REQUIRED |
| Refund/capture/cancel | CONTRACT REQUIRED |
| Production state | CONTRACT REQUIRED |

Нет SaaS proration/auto-renewal, platform credits, ручного bank transfer confirmation,
bindings/autopay. Cancelled/suspended subscription не включается автоматически.

## ArCa / Property

| Пункт | Статус |
|---|---|
| Organization merchant isolation, запрет Ameria fallback | CODE READY |
| ImTun Web selection/receipt и серверные allocations | CODE READY |
| Адаптер | PARTIAL |
| Sandbox | CONTRACT REQUIRED |
| Credentials per organization | CONTRACT REQUIRED |
| Live payment | CONTRACT REQUIRED |
| Refund | CONTRACT REQUIRED |
| Production state | CONTRACT REQUIRED |

## Telcell / Utilities

**TELCELL UTILITY DEBT LOOKUP — CONTRACT/API ACCESS REQUIRED**

| Пункт | Статус |
|---|---|
| Partner docs received / aggregator capability confirmed | CONTRACT REQUIRED |
| Каталог/account schema, capability interface, truthful unavailable UI | CODE READY |
| Создание/редактирование account в UI | PARTIAL |
| Subscriber lookup | CONTRACT REQUIRED |
| Debt lookup и freshness | CONTRACT REQUIRED |
| Payment/status/cancellation/reconciliation | CONTRACT REQUIRED |
| Production status | CONTRACT REQUIRED |

Сервисам не придуманы ID и endpoint. Capabilities пусты; баланс unavailable, не 0.
Scope aggregator account не выбран без контракта.

## Bank Reconciliation

| Пункт | Статус | Комментарий |
|---|---|---|
| Manual import | CODE READY | Существующий CSV-контур сохранён |
| Matching | CODE READY | Существующее scoped сопоставление, без нового auto-matching |
| Allocations | CODE READY | Старые API + новый provider source |
| Credits | CODE READY | Проверка online surplus и последующего распределения |
| Direct banking API | CONTRACT REQUIRED | Не подключён |

## По фазам мастер-промпта

| Фаза | Статус | Остаток |
|---|---|---|
| 1 Financial audit | COMPLETE | Переиспользование ledger описано в architecture doc |
| 2 Shared core | PARTIAL | Refund/reversal services, worker восстановления, полный lifecycle |
| 3 Ameriabank | PARTIAL | Контракт → HTTP adapter/security → sandbox/live |
| 4 ArCa | PARTIAL | Merchant contract → adapter → sandbox/refund/live |
| 5 Reconciliation | PARTIAL | Существующая ручная сверка сохранена; новые bank APIs/расширения не сделаны |
| 6 Telcell foundation | PARTIAL | UI управления accounts/registry после определения договора |
| 7 Telcell payments | CONTRACT REQUIRED | Не активируется без доказанных B2B capabilities |
| 8 UI | PARTIAL | Console/OS/ImTun Web foundation; нет native Expo checkout, refund/utility flows, полной пагинации |
| 9 Security & QA | PARTIAL | Core tests; нет настоящих callback signatures, sandbox и полной production QA |
| 10 OpenAPI/reports | CODE READY | Spec, codegen и документы добавлены; результаты проверок ниже |

## Проверки

- Изолированный `vernatun_test` и отдельная случайная схема, миграции 001–039.
- `test:payments`: unconfigured rails; scope/RBAC/secrets; чужой merchant;
  strict browser input; duplicate/concurrent verification; amount/order/merchant/currency mismatch;
  timeout replay; property surplus/credit allocation; SaaS invoice/activation.
- Использован только test-process provider port, ни одного реального списания.
- Root `corepack pnpm run typecheck` и `PORT=5173 BASE_PATH=/ corepack pnpm run build` — PASS.
- `test:payments` — 8 PASS; это проверки test port, не банковского sandbox.
- `test:api --phase4-only` — 7 PASS: начисления, импорт, сверка, credits и конкуренция.
- Миграции 037–039 применены только в development. До/после сверены количества
  и digest всех строк семи существующих финансовых таблиц — без изменений.
- Браузерная приёмка новых workspace — PASS в изолированном QA: platform admin,
  org admin, unit owner и запрет family; draft/test, выдача SaaS-счёта, disabled Pay,
  сохранение прежней finance страницы, truthful utilities. На 360/390/1024/1440
  нет горизонтального overflow; проверены Tab/Escape в disable modal.
  Это не полная приёмка всех ролей, провайдеров или сценариев refund/utility.
- Во время разработки браузер видел Vite HMR/resource noise; новые payment API
  не давали 404/500. После проверки API/Web штатно перезапущены;
  свежая загрузка `/login` без ошибок browser console.

## Дополнительные незакрытые требования

- Внешние API-key scopes для новых payment/utility операций ещё не подключены;
  новые бизнес-маршруты сейчас используют существующие session/context permissions.
- Нет автоматического provider health polling, provider/domain metrics и recovery worker.
- Нет production webhook signature/replay verification: callbacks только отклоняются.
- Нет полной пагинации/фильтров payment history, полноценного per-domain checkout
  readiness и перехода в реальный hosted checkout.
- Нет финансового refund/reversal workflow и компенсирующих распределений.
- Не выполнена банковская sandbox/live/production-приёмка, а также полная
  responsive/a11y матрица всех старых экранов и 14 ролей.

Эти пункты нельзя считать завершёнными по наличию таблиц, интерфейсов или mock-теста.

## Следующее обязательное действие

Получить merchant technical packages Ameriabank и ArCa и **Telcell B2B aggregator
contract/API access**, затем реализовать их точные адаптеры и recovery/refund services.
Credentials передавать через защищённую настройку, не через исходники или чат.
Публикация/production migrations/live acceptance требуют отдельного согласования.
