$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Headers = @{}
if (Test-Path ".env") {
    $KeyLine = Get-Content ".env" | Where-Object {
        $_ -match "^\s*VERNATUN_EDGE_MEDIA_API_KEY\s*="
    } | Select-Object -First 1

    if ($KeyLine) {
        $Key = ($KeyLine -split "=", 2)[1].Trim().Trim('"').Trim("'")
        if ($Key) {
            $Headers["X-Vernatun-Edge-Key"] = $Key
        }
    }
}

Write-Host "==> Health"
$Health = Invoke-RestMethod "http://127.0.0.1:8093/health"
$Health | ConvertTo-Json -Depth 8

Write-Host ""
Write-Host "==> Camera"
$Camera = Invoke-RestMethod `
    "http://127.0.0.1:8093/v1/cameras/Laptop-Camera-01" `
    -Headers $Headers

$Camera | ConvertTo-Json -Depth 8

if (-not $Camera.online) {
    throw "Camera is not online."
}

if (-not $Camera.videoAvailable) {
    throw "Camera video is not available."
}

Write-Host ""
Write-Host "==> Snapshot"
$Snapshot = Join-Path $Root "data\snapshots\Laptop-Camera-01-test.jpg"

Invoke-WebRequest `
    "http://127.0.0.1:8093/v1/cameras/Laptop-Camera-01/snapshot" `
    -Method POST `
    -Headers $Headers `
    -OutFile $Snapshot

if (!(Test-Path $Snapshot)) {
    throw "Snapshot file was not created."
}

$Size = (Get-Item $Snapshot).Length
if ($Size -lt 1000) {
    throw "Snapshot looks too small: $Size bytes"
}

Write-Host "Snapshot PASS: $Snapshot ($Size bytes)" -ForegroundColor Green

Write-Host ""
Write-Host "============================================================"
Write-Host "Vernatun Edge Media v1 local test PASSED" -ForegroundColor Green
Write-Host "Camera capture : PASS"
Write-Host "Snapshot       : PASS"
Write-Host "MQTT telemetry : enabled by config"
Write-Host "WebRTC publish : requires Cloud WHIP session"
Write-Host "============================================================"
