# Vernatun Cloud Edge Agent v1

Пакет подготавливает локальный Vernatun Edge к подключению к `Vernatun Cloud`.

## Что уже работает локально

Agent связывает:

```text
Vernatun Cloud
      |
      | outbound HTTPS / WebSocket
      v
Vernatun Cloud Edge Agent
      |
      +--> Vernatun Command Authorization Layer :8091
      |
      +--> ThingsBoard :8080
      |
      +--> local SQLite offline queue
```

## Главное архитектурное решение

Для каждого ЖК устанавливается отдельный Vernatun Edge.

**Edge сам подключается к Cloud исходящим соединением.**

```text
Edge ЖК-1 --\
Edge ЖК-2 ---+--> api.vernatun.io
Edge ЖК-3 --/
```

Cloud не должен знать внешний IP Edge и не должен открывать входящее соединение в LAN здания.

## Текущие Cloud URLs

```text
Website:
https://vernatun.io

API:
https://api.vernatun.io

Health:
https://api.vernatun.io/api/health
```

## Что делает Agent v1

- читает `config/vernatun_edge_cloud_v1.yaml`;
- проверяет Cloud health;
- проверяет локальный Command Authorization Layer;
- имеет уникальную identity `edgeId + tenantId + buildingId`;
- готов к bootstrap registration;
- реализует heartbeat;
- реализует outbound WebSocket client;
- получает Cloud `COMMAND`;
- проверяет tenant/building binding;
- передаёт команду в локальный Authorization Layer;
- отправляет результат обратно в Cloud;
- синхронизирует ThingsBoard inventory;
- имеет SQLite offline outbox;
- принимает локальные telemetry/events/alarms в очередь;
- не открывает ThingsBoard наружу.

## Важно

Cloud Edge API:

```text
/api/edge/v1/register
/api/edge/v1/heartbeat
/api/edge/v1/connect
/api/edge/v1/inventory
/api/edge/v1/telemetry/batch
/api/edge/v1/events/batch
/api/edge/v1/alarms/batch
/api/edge/v1/commands/{commandId}/result
/api/edge/v1/config
```

— это **контракт, который теперь надо реализовать в Vernatun Cloud backend**.

Если endpoints ещё отсутствуют, Agent всё равно запускается и показывает:

```text
WAITING_BOOTSTRAP_TOKEN
```

или после попытки регистрации:

```text
CLOUD_EDGE_API_NOT_IMPLEMENTED
```

Это не ошибка локального Edge.

## Установка

Распакуй:

```text
C:\Vernatun-Edge-Lab\cloud-edge-agent-v1
```

Убедись, что работают:

```text
thingsboard-ce
tb-gateway
vernatun-edge-security
```

Запусти:

```powershell
cd C:\Vernatun-Edge-Lab\cloud-edge-agent-v1

powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Для текущего lab по умолчанию:

```text
edgeId     = edge-building01
tenantId   = uk_001
buildingId = building01
```

Если в Vernatun Cloud будут реальные UUID/ID, запуск:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -EdgeId "edge-XXXXXXXX" `
  -TenantId "REAL_TENANT_ID" `
  -BuildingId "REAL_BUILDING_ID" `
  -SiteCode "building01" `
  -BootstrapToken "TOKEN_FROM_VERNATUN_CLOUD"
```

Bootstrap token сохраняется в локальный `.env`, а не в YAML.

## Проверка

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

Ожидаем минимум:

```text
Local Command Authorization Layer: PASS
ThingsBoard inventory: PASS
Offline queue: PASS
```

Cloud registration будет `REGISTERED` только после того, как Cloud backend реализует Edge endpoints и будет создан bootstrap token.

## Статус

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1
```

## Остановка Agent

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```

## Локальные порты

```text
8091 = Vernatun Command Authorization Layer
8092 = Vernatun Cloud Edge Agent
```

В Docker Compose порт `8092` привязан только к `127.0.0.1`.

Ни `8091`, ни `8092` в production не нужно публиковать в Интернет.

## Следующий шаг

После локального PASS нужно реализовать `Cloud Edge API Contract v1` на `api.vernatun.io`.

Спецификация находится:

```text
docs/cloud-edge-api-contract-v1.md
```
