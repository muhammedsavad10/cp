# ops/stop-all.ps1
# Stops all background server processes and tunnels.

$ErrorActionPreference = "Continue"

Write-Host "Stopping server and tunnel processes..." -ForegroundColor Yellow

# Kill node processes running server
$nodeProcs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server/index.js*" -or $_.CommandLine -like "*start.ps1*" }
foreach ($proc in $nodeProcs) {
    try {
        Stop-Process -Id $proc.ProcessId -Force
        Write-Host "Stopped process ID $($proc.ProcessId)" -ForegroundColor Green
    } catch {}
}

# Kill cloudflared if running
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force

# Kill tailscale if running background funnel
# (Note: tailscale funnel --bg runs in background, but we can stop funnel with tailscale funnel off)
try {
    & tailscale funnel off 2>$null
} catch {}

Write-Host "All hosting processes stopped successfully." -ForegroundColor Green
