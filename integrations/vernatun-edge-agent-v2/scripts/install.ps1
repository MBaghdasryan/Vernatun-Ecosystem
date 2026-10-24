param(
    [string]$EdgeId = "edge-nor-yerevan-block-a",
    [string]$EdgeName = "Vernatun Edge - Nor Yerevan Block A",
    [string]$TenantId = "REPLACE_WITH_ORGANIZATION_UUID",
    [string]$BlockId = "REPLACE_WITH_BLOCK_UUID",
    [string]$SiteCode = "nor-yerevan-block-a",
    [string]$BootstrapToken = "",
    [string]$TbUsername = "tenant@thingsboard.org",
    [string]$TbPassword = "tenant",
    [string]$SecurityEnvPath = "C:\Vernatun-Edge-Lab\security-command-v1\.env"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"

Write-Host "`n==> Vernatun Cloud Edge Agent v2" -ForegroundColor Cyan
Write-Host "Root: $Root"

docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is not available."
}

$required = @("thingsboard-ce", "tb-gateway", "vernatun-edge-security")
$running = @(docker ps --format "{{.Names}}")
foreach ($name in $required) {
    if ($running -notcontains $name) {
        throw "Required container '$name' is not running."
    }
}
Write-Host "Required local Vernatun Edge services are running." -ForegroundColor Green

$LocalSecurityKey = $null
if (Test-Path $SecurityEnvPath) {
    foreach ($line in Get-Content $SecurityEnvPath) {
        if ($line -match '^EDGE_API_KEY=(.+)$') {
            $LocalSecurityKey = $Matches[1].Trim()
        }
    }
}
if (-not $LocalSecurityKey) {
    throw "Could not read EDGE_API_KEY from $SecurityEnvPath"
}
Write-Host "Local Command Authorization API key imported." -ForegroundColor Green

function New-RandomKey {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd("=")
}

$AgentLocalKey = New-RandomKey

@"
VERNATUN_EDGE_BOOTSTRAP_TOKEN=$BootstrapToken
VERNATUN_EDGE_ID=$EdgeId
VERNATUN_EDGE_NAME=$EdgeName
VERNATUN_TENANT_ID=$TenantId
VERNATUN_BLOCK_ID=$BlockId
VERNATUN_SITE_CODE=$SiteCode

VERNATUN_CLOUD_API_BASE_URL=https://api.vernatun.io
VERNATUN_CLOUD_HEALTH_URL=https://api.vernatun.io/api/health

VERNATUN_EDGE_CLIENT_ID=
VERNATUN_EDGE_CLIENT_SECRET=
VERNATUN_EDGE_CLIENT_CERT_PATH=
VERNATUN_EDGE_CLIENT_KEY_PATH=
VERNATUN_EDGE_CA_CERT_PATH=

VERNATUN_EDGE_LOCAL_API_KEY=$LocalSecurityKey
VERNATUN_EDGE_COMMAND_URL=http://host.docker.internal:8091

VERNATUN_TB_URL=http://host.docker.internal:8080
VERNATUN_TB_USERNAME=$TbUsername
VERNATUN_TB_PASSWORD=$TbPassword

VERNATUN_AGENT_LOCAL_KEY=$AgentLocalKey
"@ | Set-Content -Path $EnvFile -Encoding Ascii

Write-Host ".env prepared." -ForegroundColor Green
if (-not $BootstrapToken) {
    Write-Host "No Cloud bootstrap token supplied. Agent will start in preparation mode." -ForegroundColor Yellow
}

Push-Location $Root
try {
    Write-Host "`n==> Building and starting Vernatun Cloud Edge Agent" -ForegroundColor Cyan
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up failed."
    }

    Write-Host "`n==> Waiting for local agent API" -ForegroundColor Cyan
    $health = $null
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri "http://localhost:8092/health" -Method Get
            if ($health.status -eq "ok") { break }
        } catch {}
    }

    if (-not $health -or $health.status -ne "ok") {
        docker logs --tail=150 vernatun-cloud-edge-agent
        throw "Vernatun Cloud Edge Agent did not become healthy."
    }

    Write-Host "Agent API: http://localhost:8092" -ForegroundColor Green
    Write-Host "Cloud health       : $($health.cloud.health)"
    Write-Host "Cloud health HTTP  : $($health.cloud.healthHttp)"
    Write-Host "Registration state : $($health.cloud.registrationState)"
    Write-Host "Local Command Layer: $($health.local.commandAuthorization)"

    Write-Host "`n==> Important" -ForegroundColor Cyan
    if ($health.cloud.registrationState -eq "WAITING_BOOTSTRAP_TOKEN") {
        Write-Host "Edge Agent is ready locally. Cloud registration needs a bootstrap token." -ForegroundColor Yellow
    } elseif ($health.cloud.registrationState -eq "CLOUD_EDGE_API_NOT_IMPLEMENTED") {
        Write-Host "Edge Agent is ready. Vernatun Cloud registration still needs to be available." -ForegroundColor Yellow
    } elseif ($health.cloud.registrationState -eq "REGISTERED") {
        Write-Host "Edge is registered with Vernatun Cloud." -ForegroundColor Green
    }

    Write-Host "`nNext:" -ForegroundColor Cyan
    Write-Host "powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1"
} finally {
    Pop-Location
}
