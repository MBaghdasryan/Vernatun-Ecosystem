# Windows Edge v1: приёмка соединения с TEST-организацией

Этот документ — инструкция оператору, не отчёт об успешном подключении.
Нужны обновлённые Cloud frontend/API со схемой до 043 и доступ к тестовому Windows-хосту.
Используется production API, указанный оператором: `https://api.vernatun.io`.
Никаких команд физическим устройствам или симулятору в этой приёмке не отправляем.

## 1. Проверить данные в Cloud

В `/console/edge` выберите организацию `TEST Vernatun Edge Lab`.
Проверьте здание и создайте **v1 / одно здание**, а не v2 / блок:

| Поле | Значение |
|---|---|
| TenantId | `9e8e581c-d8cf-4bb4-9548-d6e1e961e090` |
| BuildingId | `a6e398fc-2f1d-4724-9db4-11e7874683c7` |
| Здание | `TEST Building 01` |
| Тестовое помещение | `TEST Unit 101`, `997910a1-177b-4b38-8e0b-dd3b829c2cf7` |
| EdgeId | `edge-building01` |
| EdgeName | `Vernatun Edge - TEST Building 01` |
| SiteCode | `building01` |
| Protocol | `1` |

Эти ID заданы в `integrations/vernatun-edge-test-lab/manifest.json`; наличие manifest
не доказывает наличие строк в production. Если организация уже существует,
**не запускайте provisioning заново**: он намеренно откажется перезаписывать записи.
Если записи действительно отсутствуют, оператор может выполнить существующий
`db:provision:edge-test-lab` в API-контейнере Coolify после проверки целевой БД;
порядок и ограничения описаны в README тестового пакета.

В TEST-организации должен быть включён только `smart_building`; финансовые,
платёжные, коммуникационные и физические сценарии остаются отключёнными.
Не подменяйте ID существующих зданий и не создавайте дубли.

Если узел уже есть, откройте его, не создавайте второй. Имя в форме, bootstrap
привязке и команде Windows должно совпадать. Изменение имени ожидающего узла
требует нового bootstrap-токена. Зарегистрированный или архивный узел не
переустанавливайте и не очищайте автоматически: сначала выясните его состояние.

Нажмите «Сгенерировать токен» для ожидающего узла. Токен одноразовый; вводится
только на Windows, не отправляется в чат, Git, скриншоты или диагностические логи.

## 2. Выбрать изолированный локальный источник до запуска installer

Скопируйте каталог `integrations/vernatun-edge-test-lab` из обновлённого репозитория
в `C:\Vernatun-Edge-Lab\vernatun-edge-test-lab`, включая `simulators`.
Agent v1 уже должен находиться в `C:\Vernatun-Edge-Lab\cloud-edge-agent-v1`.
Команды ниже предназначены только для отдельного тестового экземпляра:
installer перезаписывает его `.env` и пересоздаёт его compose-контейнер.
Не используйте этот каталог для работающего реального Edge.

В **том же окне PowerShell**, из которого будет запуск installer:

```powershell
cd C:\Vernatun-Edge-Lab\cloud-edge-agent-v1

$lab = 'C:\Vernatun-Edge-Lab\vernatun-edge-test-lab'
$base = Join-Path $PWD.Path 'docker-compose.yml'
$override = Join-Path $lab 'docker-compose.edge-test.override.yml'
if (!(Test-Path $base) -or !(Test-Path $override)) {
    throw 'Не найдены Agent compose или TEST override. Не запускайте installer.'
}
$env:VERNATUN_EDGE_TEST_LAB_DIR = $lab
$env:COMPOSE_PATH_SEPARATOR = ';'
$env:COMPOSE_FILE = "$base;$override"
```

`COMPOSE_FILE` наследуется процессом `powershell`, поэтому встроенный
`docker compose up` из installer сразу применяет оба файла, а не запускает
сначала небезопасную стандартную конфигурацию.
Override использует только ThingsBoard-симулятор с `Barrier-01`, локальный
симулятор авторизации без актуатора и отдельный volume `vernatun-edge-test-data`.
Стандартные контейнеры, наличие которых проверяет старый installer, могут
потребоваться для его preflight, но TEST Agent не должен обращаться к ним.
Не публикуйте локальные порты в Интернет и не выводите `docker compose config`:
он может раскрыть значения private `.env`.

## 3. Установить с точными привязками

В том же окне:

```powershell
$secureToken = Read-Host 'Bootstrap token из Cloud (не отправляйте в чат)' -AsSecureString
$bootstrapToken = [System.Net.NetworkCredential]::new('', $secureToken).Password
try {
    powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
      -EdgeId "edge-building01" `
      -EdgeName "Vernatun Edge - TEST Building 01" `
      -TenantId "9e8e581c-d8cf-4bb4-9548-d6e1e961e090" `
      -BuildingId "a6e398fc-2f1d-4724-9db4-11e7874683c7" `
      -SiteCode "building01" `
      -BootstrapToken $bootstrapToken
    if ($LASTEXITCODE -ne 0) { throw 'Installer завершился с ошибкой; не продолжайте.' }
} finally {
    Remove-Variable bootstrapToken, secureToken -ErrorAction SilentlyContinue
}
```

Не удаляйте SQLite/volumes для обхода ошибки регистрации. После успешной
регистрации Agent использует сохранённый машинный credential, а не новый
bootstrap-токен. Секрет остаётся в private `.env`, как предусмотрено installer;
не копируйте этот файл в репозиторий и не переиспользуйте одноразовый токен.

## 4. Снять безопасный диагностический срез

Подождите 60–90 секунд, затем выполните дважды с интервалом 45 секунд:

```powershell
$h = Invoke-RestMethod 'http://localhost:8092/health' -Method Get
[pscustomobject]@{
    CloudHTTP       = $h.cloud.healthHttp
    Registration    = $h.cloud.registrationState
    RegistrationHTTP = $h.cloud.registrationHttp
    WebSocket       = $h.cloud.websocketState
    HeartbeatAt     = $h.sync.lastHeartbeatAt
    HeartbeatStatus = $h.sync.lastHeartbeatStatus
    InventoryAt     = $h.sync.lastInventoryAt
    InventoryStatus = $h.sync.lastInventoryStatus
    QueueDepth      = $h.local.queueDepth
    LastCommandAt   = $h.commands.lastCommandAt
} | Format-List
```

Не запускайте пока `scripts/test.ps1`: он не только читает состояние, но и
добавляет синтетическую telemetry в очередь. Для этой приёмки достаточно
автоматических registration/heartbeat/inventory и чтения health.

## 5. Критерии приёмки

| Этап | Доказательство |
|---|---|
| HTTPS | `CloudHTTP=200`; само по себе не подтверждает остальные этапы |
| Registration | `REGISTERED`, успешный HTTP; в Cloud ровно существующий узел с теми же Edge/Tenant/Building/Site |
| WSS | `CONNECTED` на Windows и подключённая сокет-сессия в Cloud; не только открытый HTTPS |
| Heartbeat | Успешный статус, время увеличивается на втором срезе и в Cloud |
| Inventory | Успешный статус и время синхронизации; в Cloud только синтетический `Barrier-01`, правильное здание, никаких реальных устройств |
| Безопасность | Команд не создавали, физические действия не выполнялись, другие организации не менялись |

Для повторной синхронизации inventory учитывайте заданный интервал Agent, а не
ожидайте нового времени каждые 45 секунд. Пустая очередь не доказывает доставку
inventory — проверяется подтверждённый статус и наличие устройства в Cloud.

Если WSS не подключается, сначала сопоставьте безопасный health и Cloud
connection-check; затем по времени проверьте Coolify API logs и WebSocket
upgrade на reverse proxy. Не меняйте DNS, TLS-проверки, базу или credentials
наугад. Не публикуйте raw логи до проверки, что в них нет токенов.

Запись о завершении делается только после получения обоих срезов и проверки
Cloud. Готовая инструкция и HTTP 200 не являются доказательством реального E2E.
