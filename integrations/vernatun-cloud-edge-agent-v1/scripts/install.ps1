param(
    [string]$EdgeId = "edge-building01",
    [string]$EdgeName = "Vernatun Edge - Building 01",
    [string]$TenantId = "uk_001",
    [string]$BuildingId = "building01",
    [string]$SiteCode = "building01",
    [string]$BootstrapToken = "",
    [string]$TbUsername = "tenant@thingsboard.org",
    [string]$TbPassword = "tenant",
    [string]$SecurityEnvPath = "C:\Vernatun-Edge-Lab\security-command-v1\.env"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"
$ExistingEnv = @{}
$ProvidedParameters = $PSBoundParameters
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') {
            $ExistingEnv[$Matches[1]] = $Matches[2]
        }
    }
}

function Get-ExistingValue([string]$Name, [string]$Fallback = "") {
    if ($ExistingEnv.ContainsKey($Name) -and $ExistingEnv[$Name] -ne "") {
        return $ExistingEnv[$Name]
    }
    return $Fallback
}

function Resolve-ProvidedOrExisting([string]$Name, [string]$Provided, [string]$Fallback = "") {
    if ($ProvidedParameters.ContainsKey($Name) -and $Provided -ne "") {
        return $Provided
    }
    return Get-ExistingValue $Name $Fallback
}

Write-Host "`n==> Vernatun Cloud Edge Agent v1" -ForegroundColor Cyan
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

$AgentLocalKey = Get-ExistingValue "VERNATUN_AGENT_LOCAL_KEY"
if (-not $AgentLocalKey) { $AgentLocalKey = New-RandomKey }
$EffectiveEdgeId = Resolve-ProvidedOrExisting "EdgeId" $EdgeId "edge-building01"
$EffectiveEdgeName = Resolve-ProvidedOrExisting "EdgeName" $EdgeName "Vernatun Edge - Building 01"
$EffectiveTenantId = Resolve-ProvidedOrExisting "TenantId" $TenantId "uk_001"
$EffectiveBuildingId = Resolve-ProvidedOrExisting "BuildingId" $BuildingId "building01"
$EffectiveSiteCode = Resolve-ProvidedOrExisting "SiteCode" $SiteCode "building01"
$EffectiveBootstrapToken = Resolve-ProvidedOrExisting "BootstrapToken" $BootstrapToken
$EffectiveTbUsername = Resolve-ProvidedOrExisting "TbUsername" $TbUsername "tenant@thingsboard.org"
$EffectiveTbPassword = Resolve-ProvidedOrExisting "TbPassword" $TbPassword "tenant"
$CloudBaseUrl = Get-ExistingValue "VERNATUN_CLOUD_API_BASE_URL" "https://api.vernatun.io"
$CloudHealthUrl = Get-ExistingValue "VERNATUN_CLOUD_HEALTH_URL" "$CloudBaseUrl/api/health"
$EdgeClientId = Get-ExistingValue "VERNATUN_EDGE_CLIENT_ID"
$EdgeClientSecret = Get-ExistingValue "VERNATUN_EDGE_CLIENT_SECRET"
$EdgeClientCert = Get-ExistingValue "VERNATUN_EDGE_CLIENT_CERT_PATH"
$EdgeClientKey = Get-ExistingValue "VERNATUN_EDGE_CLIENT_KEY_PATH"
$EdgeCaCert = Get-ExistingValue "VERNATUN_EDGE_CA_CERT_PATH"
$MediaUrl = Get-ExistingValue "VERNATUN_EDGE_MEDIA_URL" "http://host.docker.internal:8093"
$CommandUrl = Get-ExistingValue "VERNATUN_EDGE_COMMAND_URL" "http://host.docker.internal:8091"
$TbUrl = Get-ExistingValue "VERNATUN_TB_URL" "http://host.docker.internal:8080"

@"
VERNATUN_EDGE_BOOTSTRAP_TOKEN=$EffectiveBootstrapToken
VERNATUN_EDGE_ID=$EffectiveEdgeId
VERNATUN_EDGE_NAME=$EffectiveEdgeName
VERNATUN_TENANT_ID=$EffectiveTenantId
VERNATUN_BUILDING_ID=$EffectiveBuildingId
VERNATUN_SITE_CODE=$EffectiveSiteCode

VERNATUN_CLOUD_API_BASE_URL=$CloudBaseUrl
VERNATUN_CLOUD_HEALTH_URL=$CloudHealthUrl

VERNATUN_EDGE_CLIENT_ID=$EdgeClientId
VERNATUN_EDGE_CLIENT_SECRET=$EdgeClientSecret
VERNATUN_EDGE_CLIENT_CERT_PATH=$EdgeClientCert
VERNATUN_EDGE_CLIENT_KEY_PATH=$EdgeClientKey
VERNATUN_EDGE_CA_CERT_PATH=$EdgeCaCert

VERNATUN_EDGE_LOCAL_API_KEY=$LocalSecurityKey
VERNATUN_EDGE_COMMAND_URL=$CommandUrl
VERNATUN_EDGE_MEDIA_URL=$MediaUrl
VERNATUN_EDGE_MEDIA_API_KEY=$LocalSecurityKey

VERNATUN_TB_URL=$TbUrl
VERNATUN_TB_USERNAME=$EffectiveTbUsername
VERNATUN_TB_PASSWORD=$EffectiveTbPassword

VERNATUN_AGENT_LOCAL_KEY=$AgentLocalKey
"@ | Set-Content -Path $EnvFile -Encoding Ascii

Write-Host ".env prepared." -ForegroundColor Green
if (-not $EffectiveBootstrapToken) {
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
        Write-Host "Edge Agent is ready. Vernatun Cloud still needs /api/edge/v1/* endpoints." -ForegroundColor Yellow
    } elseif ($health.cloud.registrationState -eq "REGISTERED") {
        Write-Host "Edge is registered with Vernatun Cloud." -ForegroundColor Green
    }

    Write-Host "`nNext:" -ForegroundColor Cyan
    Write-Host "powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1"
} finally {
    Pop-Location
}
