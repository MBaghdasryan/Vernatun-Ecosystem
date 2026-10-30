param(
    [string]$Python = "py"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "==> Vernatun Edge Media v1 install" -ForegroundColor Cyan
Write-Host "Root: $Root"

Set-Location $Root

if (!(Test-Path ".venv")) {
    Write-Host "==> Creating Python virtual environment"
    & $Python -m venv .venv
}

$Py = Join-Path $Root ".venv\Scripts\python.exe"
$Pip = Join-Path $Root ".venv\Scripts\pip.exe"

Write-Host "==> Upgrading pip"
& $Py -m pip install --upgrade pip

Write-Host "==> Installing dependencies"
& $Pip install -r requirements.txt

if (!(Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example"
}

# Best-effort import of the existing local Edge API key.
$SecurityEnv = "C:\Vernatun-Edge-Lab\security-command-v1\.env"
if (Test-Path $SecurityEnv) {
    $Candidates = @(
        "VERNATUN_EDGE_API_KEY",
        "VERNATUN_EDGE_KEY",
        "EDGE_API_KEY",
        "API_KEY"
    )

    $FoundKey = $null
    foreach ($Name in $Candidates) {
        $Line = Get-Content $SecurityEnv | Where-Object {
            $_ -match ("^\s*" + [regex]::Escape($Name) + "\s*=")
        } | Select-Object -First 1

        if ($Line) {
            $FoundKey = ($Line -split "=", 2)[1].Trim().Trim('"').Trim("'")
            break
        }
    }

    if ($FoundKey) {
        $EnvPath = Join-Path $Root ".env"
        $Current = Get-Content $EnvPath -Raw
        if ($Current -match "(?m)^VERNATUN_EDGE_MEDIA_API_KEY=") {
            $Current = [regex]::Replace(
                $Current,
                "(?m)^VERNATUN_EDGE_MEDIA_API_KEY=.*$",
                "VERNATUN_EDGE_MEDIA_API_KEY=$FoundKey"
            )
        } else {
            $Current += "`r`nVERNATUN_EDGE_MEDIA_API_KEY=$FoundKey`r`n"
        }
        Set-Content -Path $EnvPath -Value $Current -Encoding UTF8
        Write-Host "Imported local Edge API key into Edge Media .env" -ForegroundColor Green
    }
}

$EnvPath = Join-Path $Root ".env"
$MediaKeyLine = Get-Content $EnvPath | Where-Object {
    $_ -match "^\s*VERNATUN_EDGE_MEDIA_API_KEY\s*=\s*\S+"
} | Select-Object -First 1
if (!$MediaKeyLine) {
    Write-Warning "The required local API key is not configured. Set VERNATUN_EDGE_MEDIA_API_KEY in .env and configure the same key in the Edge Agent before starting a stream."
}

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
New-Item -ItemType Directory -Force -Path "data\snapshots" | Out-Null

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "IMPORTANT: Stop the old laptop_camera.py before starting Edge Media."
Write-Host "The physical webcam should have only one capture owner."
Write-Host ""
Write-Host "Next:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1"
