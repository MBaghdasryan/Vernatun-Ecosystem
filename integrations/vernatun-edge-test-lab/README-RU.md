# Изолированный TEST-набор Vernatun Cloud ↔ Edge

Пакет готовит **не секретные** тестовые записи и отдельный режим симуляции. Он сам ничего не создаёт в production: provisioning-команда требует явного подтверждения и запускается оператором из API-контейнера Coolify. До этого момента production база не изменена.

## Постоянные тестовые идентификаторы

| Объект | Значение |
|---|---|
| Организация / `TenantId` | `TEST Vernatun Edge Lab` / `9e8e581c-d8cf-4bb4-9548-d6e1e961e090` |
| Здание / `BuildingId` | `TEST Building 01` / `a6e398fc-2f1d-4724-9db4-11e7874683c7` |
| Помещение | `TEST Unit 101` / `997910a1-177b-4b38-8e0b-dd3b829c2cf7` |
| Edge v1 ID | `edge-building01` |
| Site code | `building01` |
| Виртуальное устройство | `Barrier-01` |
| ThingsBoard test ID | `b40f54f2-fd70-4024-b4b1-63fe65963a90` |

Это зарезервированные ID из manifest, а не подтверждение существующих production-записей. Provisioner остановится, если обнаружит совпадение или несовпадение по имени.

## Что создаёт provisioning-команда

- `TEST` организацию, demo-здание и demo-помещение;
- по одной временной учётной записи на каждую из 12 ролей внутри организации: `org_admin`, `portfolio_owner`, `developer`, `manager`, `accountant`, `dispatcher`, `technician`, `contractor`, `security`, `unit_owner`, `renter`, `family`;
- роль `platform_admin` и `support` не создаёт: они глобальные и нарушили бы изоляцию;
- включает только модуль `smart_building`; остальные восемь модулей, в том числе финансы, заявки и пропуска, отключены;
- назначает ролям срок действия 30 дней.

Команда не создаёт счета, начисления, платежи, банковские/PSP операции, заявки, приглашения, записи рассылки, пропуска, Edge-устройства или физические замки. Все пользовательские адреса используют зарезервированный домен `.invalid`; письма по ним не доставляются.

## Создание базы TEST

Сначала проверьте, что в Coolify production API установлена схема с v1 Edge (`edge_bootstrap_tokens`), в частности миграция `040_edge_management.sql`. Скрипт безопасно откажется работать, если таблиц/ролей/полей не хватает.

Запускать **только вручную** в контейнере API, подключённом к production базе `vernatun`:

```bash
NODE_ENV=production corepack pnpm --filter @workspace/api-server run db:provision:edge-test-lab -- --confirm-production-test-provision
```

Дополнительные предохранители скрипта: точное имя базы `vernatun`, `NODE_ENV=production`, отдельный флаг подтверждения, транзакция, advisory lock и полный rollback при ошибке. Он никогда не переиспользует существующую организацию, reserved ID или email.

В ответе будет путь к временному файлу с паролями созданных тестовых аккаунтов (`/tmp`, права `0600`). Файл не входит в Git. Передайте его оператору безопасно, сохраните учётные данные в приватном менеджере паролей и удалите временный файл. **Не прикладывайте этот файл к GitHub или сообщению.** Приглашения и письма не отправляются.

## Выпуск bootstrap token

После создания базы через административную консоль Vernatun создайте Edge v1 bootstrap token, выбрав исключительно `TEST Vernatun Edge Lab` и `TEST Building 01`. Убедитесь, что `edge-building01` ещё не зарегистрирован у другого клиента: `edge_id` уникален. Используйте стандартный короткоживущий одноразовый токен. Он не создаётся и не печатается provisioning-скриптом; передавайте его только в локальный `.env`/команду установщика Edge, не сохраняйте в GitHub.

В команде установщика v1 значения будут такими:

```powershell
-EdgeId "edge-building01" `
  -TenantId "9e8e581c-d8cf-4bb4-9548-d6e1e961e090" `
  -BuildingId "a6e398fc-2f1d-4724-9db4-11e7874683c7" `
  -SiteCode "building01" `
  -BootstrapToken "<одноразовый токен из админ-консоли>"
```

## Безопасный Edge dry-run

Не запускайте исходный Edge compose без test override: обычная конфигурация может обращаться к ThingsBoard и локальному сервису команд Edge-хоста.

1. На Edge-сервере используйте тестовую копию/отдельный экземпляр v1 Agent и остановите прежний контейнер с тем же `edgeId`.
2. Скопируйте каталог `integrations/vernatun-edge-test-lab` на Edge-хост. В PowerShell укажите его путь с `/`:

   ```powershell
   $env:VERNATUN_EDGE_TEST_LAB_DIR = "C:/Vernatun/vernatun-edge-test-lab"
   ```

3. В локальном, не коммитимом `.env` v1 Agent задайте TEST значения `VERNATUN_EDGE_ID`, `VERNATUN_TENANT_ID`, `VERNATUN_BUILDING_ID`, `VERNATUN_SITE_CODE` и одноразовый `VERNATUN_EDGE_BOOTSTRAP_TOKEN`. Существующий локальный `VERNATUN_EDGE_LOCAL_API_KEY` оставьте только в этом файле.
4. Из каталога v1 Agent запустите compose **с обоими файлами**:

   ```powershell
   docker compose -f docker-compose.yml -f "$env:VERNATUN_EDGE_TEST_LAB_DIR/docker-compose.edge-test.override.yml" up -d --build
   ```

Override заменяет ThingsBoard на источник с единственным синтетическим устройством `Barrier-01`, а локальную авторизацию — на закрытый внутри compose dry-run симулятор. Оба симулятора не публикуют порты на Edge-хост, не подключаются к физическим устройствам и не выполняют действие. Для Agent создаётся отдельный volume `vernatun-edge-test-data`; данные прежнего Edge volume не переиспользуются.

Dry-run принимает только `BARRIER.OPEN` для `Barrier-01` при точном совпадении Edge/Tenant/Building и локального ключа. Другие устройства, роли/объекты или команды отклоняются. Устройство появляется в Cloud только после регистрации и инвентаризации Agent. Затем администратор может назначить доступ **только тестовому unit/user** и отправить команду из Vernatun; симулятор вернёт `execution=DRY_RUN`, `physicalAction=false`.

Перед остановкой теста сохраните диагностические логи, затем остановите compose. Не подключайте к этому профилю локальный ThingsBoard, реальный Command Authorization Service, шлюз, реле, шлагбаум или замок.

## Быстрая локальная проверка политики симулятора

```bash
python3 -m unittest discover -s integrations/vernatun-edge-test-lab/simulators/barrier -p 'test_*.py'
```

Тесты проверяют, что разрешён только тестовый `BARRIER.OPEN`, а неверный ключ, scope, Edge ID, устройство или capability отклоняются без физического действия.
