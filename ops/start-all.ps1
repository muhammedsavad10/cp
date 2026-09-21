# ops/start-all.ps1
# Starts server and tunnel in background for specified Mode.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("test", "live")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"

Write-Host "Starting all services for Mode: $Mode..." -ForegroundColor Cyan

# Stop existing running instances first
& "$PSScriptRoot\stop-all.ps1"

# Launch start.ps1 in a background PowerShell process (-NoExit keeps loop running)
$startScript = "$PSScriptRoot\start.ps1"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$startScript`"", "-Mode", "$Mode" -WindowStyle Hidden

# Cloudflare fallback notice: If Tailscale is unavailable, cloudflared can be launched manually via:
# C:\payasam-data\bin\cloudflared.exe tunnel --url http://127.0.0.1:5000 --logfile C:\payasam-data\logs\tunnel.log

Write-Host "Waiting for server (npm run build & node startup)..." -ForegroundColor Yellow
$up = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:5000/healthz" -Method Get -TimeoutSec 2
        if ($res.status -eq "ok") {
            $up = $true
            break
        }
    } catch {}
}

if (-not $up) {
    Write-Host "WARNING: Server did not start within 30 seconds." -ForegroundColor Red
} else {
    Write-Host "Server is UP and responding on port 5000." -ForegroundColor Green
}

# Run check
& "$PSScriptRoot\check.ps1"

