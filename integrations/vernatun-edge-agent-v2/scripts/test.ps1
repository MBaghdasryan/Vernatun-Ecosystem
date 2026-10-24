param(
    [string]$BaseUrl = "http://localhost:8092",
    [switch]$TestBarrierCommand
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"

if (-not (Test-Path $EnvFile)) {
    throw ".env not found. Run scripts\install.ps1 first."
}

$AgentKey = $null
$TenantId = $null
$BlockId = $null
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^VERNATUN_AGENT_LOCAL_KEY=(.+)$') { $AgentKey = $Matches[1].Trim() }
    if ($line -match '^VERNATUN_TENANT_ID=(.+)$') { $TenantId = $Matches[1].Trim() }
    if ($line -match '^VERNATUN_BLOCK_ID=(.+)$') { $BlockId = $Matches[1].Trim() }
}
if (-not $AgentKey) { throw "VERNATUN_AGENT_LOCAL_KEY not found." }

$Headers = @{ "X-Vernatun-Agent-Key" = $AgentKey }

Write-Host "`n==> Agent health" -ForegroundColor Cyan
$health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
$health | ConvertTo-Json -Depth 20

if ($health.local.commandAuthorization -ne "OK") {
    throw "Local Command Authorization Layer is not healthy."
}
Write-Host "Local Command Authorization Layer: PASS" -ForegroundColor Green

Write-Host "`n==> ThingsBoard inventory through Edge Agent" -ForegroundColor Cyan
$inventory = Invoke-RestMethod -Uri "$BaseUrl/v1/inventory" -Method Get -Headers $Headers
Write-Host "Vernatun devices found: $($inventory.devices.Count)" -ForegroundColor Green
$inventory | ConvertTo-Json -Depth 20

Write-Host "`n==> Queue test (offline-safe telemetry envelope)" -ForegroundColor Cyan
$queueBody = @{
    items = @(
        @{
            deviceId = "Barrier-01"
            key = "state"
            value = "CLOSED"
            ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
    )
} | ConvertTo-Json -Depth 20

$queued = Invoke-RestMethod -Uri "$BaseUrl/v1/queue/telemetry" -Method Post `
    -Headers $Headers -ContentType "application/json" -Body $queueBody
$queued | ConvertTo-Json -Depth 10

if ($queued.status -ne "QUEUED") {
    throw "Offline queue test failed."
}
Write-Host "Offline queue: PASS" -ForegroundColor Green

if ($TestBarrierCommand) {
    Write-Host "`n==> Optional local command-path test" -ForegroundColor Cyan
    Write-Host "This test verifies Edge Agent preparation only; Cloud push command requires the Cloud WebSocket API." -ForegroundColor Yellow
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "Vernatun Cloud Edge Agent v2 local preparation test PASSED" -ForegroundColor Green
Write-Host "Cloud health        : $($health.cloud.health)"
Write-Host "Registration state  : $($health.cloud.registrationState)"
Write-Host "Local authorization : PASS"
Write-Host "ThingsBoard inventory: PASS"
Write-Host "Offline queue       : PASS"
Write-Host "============================================================" -ForegroundColor Cyan

if ($health.cloud.registrationState -ne "REGISTERED") {
    Write-Host "`nCloud-side work still required before full Edge registration/heartbeat/commands." -ForegroundColor Yellow
}
