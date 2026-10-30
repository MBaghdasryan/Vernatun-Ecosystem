param(
    [string]$TaskName = "Vernatun Edge Media"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$StartScript = Join-Path $Root "scripts\start.ps1"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Force | Out-Null

Write-Host "Autostart task installed: $TaskName" -ForegroundColor Green
