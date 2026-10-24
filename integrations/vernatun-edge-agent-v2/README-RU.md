# Vernatun Cloud Edge Agent v2

Пакет v2 подключает уже работающий локальный Vernatun Edge к Vernatun Cloud по отдельному версионированному контракту. Существующий Cloud/Agent v1 остаётся для совместимости и продолжает работать в режиме одного здания.

## Модель организации и блоков

- У одной УК/ТСЖ может быть несколько блоков.
- В один блок входит несколько зданий.
- Один Edge v2 node обслуживает один блок и получает из Cloud разрешённый список зданий этого блока.
- В одном блоке можно создать несколько независимых Edge nodes.
- Для устройств не предполагается здание автоматически: каждому ThingsBoard device UUID нужно явно назначить `buildingId`.
- Попытка передать данные или команду в здание за пределами блока отклоняется и в Cloud, и на Agent.

Пример: 4 блока × 6 зданий — в Vernatun создаются 4 блока; к каждому добавляются 6 зданий и выдаётся отдельный bootstrap token одному или нескольким Edge nodes.

## Схема соединения

```text
Vernatun Cloud (api.vernatun.io)
        ↑ исходящие HTTPS / WSS
Edge Agent v2 одного блока
        ├── Vernatun Command Authorization Layer :8091
        ├── ThingsBoard :8080
        └── локальная SQLite очередь
```

Edge сам открывает исходящее соединение. Cloud не подключается к LAN, а ThingsBoard, Command Authorization и Agent не нужно публиковать в Интернет. Docker Compose привязывает порт Agent `8092` только к `127.0.0.1`.

## Настройка

1. В Vernatun OS откройте Edge v2, создайте блок и явно добавьте в него здания.
2. Для каждого запускаемого Edge node создайте отдельный v2 bootstrap token. Токен показывается один раз.
3. В `config/vernatun_edge_cloud_v2.yaml` задайте UUID организации, блока и карту устройств:

```yaml
identity:
  tenant_id: "UUID-ОРГАНИЗАЦИИ"
  block_id: "UUID-БЛОКА"
  device_building_map:
    "UUID-УСТРОЙСТВА-THINGSBOARD-1": "UUID-ЗДАНИЯ-1"
    "UUID-УСТРОЙСТВА-THINGSBOARD-2": "UUID-ЗДАНИЯ-2"
```

Предпочтительно использовать стабильный UUID устройства ThingsBoard как ключ карты. Значением должен быть UUID здания, которое состоит в выбранном блоке. Устройство без явного соответствия не отправляется в Cloud. Если карта указывает здание за пределами блока, запись отклоняется.

4. Скопируйте `.env.example` в `.env`, заполните identity и добавьте одноразовый `VERNATUN_EDGE_BOOTSTRAP_TOKEN`. Не коммитьте `.env` и не пересылайте токен в чат.
5. Убедитесь, что на Edge-сервере уже запущены ThingsBoard и локальный Command Authorization Layer; затем выполните `scripts/install.ps1`.
6. Локальные подготовительные проверки запускаются командами:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1
```

Команда `test.ps1` предназначена для запуска на Edge-сервере с доступом к его локальным сервисам. Тестовый прогон в репозитории не обращается к реальному ThingsBoard и не посылает команд оборудованию.

## Cloud v2 API

```text
POST /api/edge/v2/register
POST /api/edge/v2/heartbeat
GET  /api/edge/v2/config
POST /api/edge/v2/inventory
POST /api/edge/v2/telemetry/batch
POST /api/edge/v2/events/batch
POST /api/edge/v2/alarms/batch
WSS  /api/edge/v2/connect
POST /api/edge/v2/commands/{commandId}/result
```

Машинные запросы требуют Bearer credential и согласованные заголовки `X-Vernatun-Edge-Id`, `X-Vernatun-Tenant-Id`, `X-Vernatun-Block-Id`. Bootstrap token одноразовый; Cloud хранит только его хеш и возвращает машинный credential после успешной регистрации. Agent сохраняет выданный credential локально в своей защищённой SQLite state store.

Cloud v1 endpoints остаются отдельными и не меняют свой single-building контракт.

## Безопасность команд

Интеграционный тест проверяет регистрацию, heartbeat, инвентарь, отклонение здания вне блока и WSS identity. Он не посылает команд устройствам. В конфигурации Agent v2 опасные команды остаются запрещёнными до отдельного согласования, проверки локального слоя и commissioning на площадке.

## Состояние подготовки

В коде Cloud реализованы миграция `041_edge_block_scope.sql`, block-scoped API v2, блоки/одноразовые токены в административном интерфейсе и тесты протоколов v1/v2 на изолированной тестовой базе. Миграция не применялась к production.

Перед реальным подключением нужно собрать и выпустить Vernatun API/Web с миграцией 041, проверить точную конфигурацию Edge на тестовом сервере и пройти приёмку реального heartbeat/inventory. До этих действий интеграция не считается готовой к production.
