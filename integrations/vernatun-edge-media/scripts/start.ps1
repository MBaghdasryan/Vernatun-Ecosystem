$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (!(Test-Path $Py)) {
    throw "Python venv not found. Run scripts\install.ps1 first."
}

$PidFile = Join-Path $Root "data\edge-media.pid"
if (Test-Path $PidFile) {
    $OldPid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($OldPid) {
        $Existing = Get-Process -Id $OldPid -ErrorAction SilentlyContinue
        if ($Existing) {
            Write-Host "Vernatun Edge Media already running. PID=$OldPid"
            exit 0
        }
    }
}

$StdOut = Join-Path $Root "logs\edge-media.out.log"
$StdErr = Join-Path $Root "logs\edge-media.err.log"

$Process = Start-Process `
    -FilePath $Py `
    -ArgumentList "run.py" `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $StdOut `
    -RedirectStandardError $StdErr `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $PidFile -Value $Process.Id -Encoding ASCII

Write-Host "Vernatun Edge Media started. PID=$($Process.Id)" -ForegroundColor Green

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $Health = Invoke-RestMethod "http://127.0.0.1:8093/health" -TimeoutSec 2
        $Health | ConvertTo-Json -Depth 8
        exit 0
    } catch {}
}

throw "Edge Media did not become healthy. Check logs\edge-media.err.log"
