$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> Vernatun Edge Media" -ForegroundColor Cyan

try {
    $Health = Invoke-RestMethod "http://127.0.0.1:8093/health" -TimeoutSec 3
    $Health | ConvertTo-Json -Depth 8
} catch {
    Write-Host "Edge Media health: UNREACHABLE" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$Headers = @{}
$EnvPath = Join-Path $Root ".env"
if (Test-Path $EnvPath) {
    $KeyLine = Get-Content $EnvPath | Where-Object {
        $_ -match "^\s*VERNATUN_EDGE_MEDIA_API_KEY\s*="
    } | Select-Object -First 1

    if ($KeyLine) {
        $Key = ($KeyLine -split "=", 2)[1].Trim().Trim('"').Trim("'")
        if ($Key) {
            $Headers["X-Vernatun-Edge-Key"] = $Key
        }
    }
}

try {
    Write-Host ""
    Write-Host "==> Cameras" -ForegroundColor Cyan
    $Cameras = Invoke-RestMethod `
      "http://127.0.0.1:8093/v1/cameras" `
      -Headers $Headers `
      -TimeoutSec 3
    $Cameras | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Unable to read camera status: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "==> Last stderr" -ForegroundColor Cyan
if (Test-Path "logs\edge-media.err.log") {
    Get-Content "logs\edge-media.err.log" -Tail 30
}
