$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"
$AgentKey = $null

if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^VERNATUN_AGENT_LOCAL_KEY=(.+)$') {
            $AgentKey = $Matches[1].Trim()
        }
    }
}

Write-Host "`n==> Docker" -ForegroundColor Cyan
docker ps --filter "name=vernatun-cloud-edge-agent"

Write-Host "`n==> Agent health" -ForegroundColor Cyan
Invoke-RestMethod -Uri "http://localhost:8092/health" -Method Get | ConvertTo-Json -Depth 20

Write-Host "`n==> Last logs" -ForegroundColor Cyan
docker logs --tail=80 vernatun-cloud-edge-agent
