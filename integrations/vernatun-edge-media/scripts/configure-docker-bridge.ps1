param(
    [string]$AgentContainer = "vernatun-cloud-edge-agent"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RuleName = "Vernatun Edge Media 8093 from Edge Agent"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script in an elevated PowerShell window."
}

$containerInfo = docker inspect $AgentContainer 2>$null | ConvertFrom-Json
if (!$containerInfo) {
    throw "The existing Edge Agent container '$AgentContainer' is not running."
}
$networkNames = @($containerInfo[0].NetworkSettings.Networks.PSObject.Properties.Name)
$subnets = @()
foreach ($networkName in $networkNames) {
    $networkInfo = docker network inspect $networkName | ConvertFrom-Json
    $subnets += @($networkInfo[0].IPAM.Config | ForEach-Object { $_.Subnet } | Where-Object { $_ })
}
$subnets = @($subnets | Sort-Object -Unique)
if (!$subnets.Count) {
    throw "Docker Agent network subnet could not be identified; no firewall rule was created."
}

$envFile = Join-Path $Root ".env"
if (!(Test-Path $envFile)) {
    throw "Edge Media .env is missing. Run install.ps1 and configure the local API key first."
}
$mediaKeyLine = Get-Content $envFile | Where-Object {
    $_ -match '^\s*VERNATUN_EDGE_MEDIA_API_KEY\s*=\s*\S+'
} | Select-Object -First 1
if (!$mediaKeyLine) {
    throw "The local Edge Media API key is not configured; no firewall rule was created."
}

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 8093 -RemoteAddress $subnets -Profile Domain,Private | Out-Null

$lines = @(Get-Content $envFile)
foreach ($entry in @{
    "VERNATUN_EDGE_MEDIA_HOST" = "0.0.0.0"
    "VERNATUN_EDGE_MEDIA_ALLOW_DOCKER_BRIDGE" = "true"
}.GetEnumerator()) {
    $pattern = "^\s*" + [regex]::Escape($entry.Key) + "="
    $matching = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match $pattern) {
            $lines[$index] = "$($entry.Key)=$($entry.Value)"
            $matching = $true
        }
    }
    if (!$matching) { $lines += "$($entry.Key)=$($entry.Value)" }
}
Set-Content -Path $envFile -Value $lines -Encoding Ascii

Write-Host "Edge Media is now reachable only from the Edge Agent Docker subnet on Domain/Private firewall profiles." -ForegroundColor Green
Write-Host "Restart Edge Media to apply the binding. Port 8093 remains unpublished by Docker Compose."
Write-Host "Detected Docker subnets: $($subnets -join ', ')"
