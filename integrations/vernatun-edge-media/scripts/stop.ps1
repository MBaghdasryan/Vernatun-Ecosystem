$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidFile = Join-Path $Root "data\edge-media.pid"

if (!(Test-Path $PidFile)) {
    Write-Host "No PID file. Edge Media may already be stopped."
    exit 0
}

$PidValue = Get-Content $PidFile -ErrorAction SilentlyContinue
if ($PidValue) {
    $Process = Get-Process -Id $PidValue -ErrorAction SilentlyContinue
    if ($Process) {
        Stop-Process -Id $PidValue -Force
        Write-Host "Stopped Vernatun Edge Media PID=$PidValue"
    }
}

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
