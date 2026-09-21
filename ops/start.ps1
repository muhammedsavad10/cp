# ops/start.ps1
# Runs frontend build if needed and launches backend server loop in production mode.
# Restarts 3s after crash, appends logs to C:\payasam-data\logs\server-<mode>.log.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("test", "live")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"

# Ensure secrets directory and JWT secret exist
& "$PSScriptRoot\setup-secret.ps1"

$dataDir = "C:\payasam-data\$Mode"
$logsDir = "C:\payasam-data\logs"
$secretFile = "C:\payasam-data\secrets\jwt_secret.txt"
$logFile = Join-Path $logsDir "server-$Mode.log"

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

$jwtSecret = (Get-Content $secretFile -Raw).Trim()

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  STARTING SERVER IN MODE: $Mode" -ForegroundColor Cyan
Write-Host "  DATA_DIR: $dataDir" -ForegroundColor Cyan
Write-Host "  LOG_FILE: $logFile" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$repoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $repoRoot

$env:NODE_ENV = "production"
$env:PORT = "5000"
$env:DATA_DIR = $dataDir
$env:JWT_SECRET = $jwtSecret

$distFile = Join-Path $repoRoot "client\dist\index.html"
if (-not (Test-Path $distFile)) {
    Write-Host "Building production assets (npm run build)..." -ForegroundColor Yellow
    npm run build
} else {
    Write-Host "Production build assets already exist." -ForegroundColor Green
}

Write-Host "Starting production server loop on port 5000..." -ForegroundColor Green

while ($true) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    "[$timestamp] Starting node server/index.js (Mode: $Mode)" | Out-File -FilePath $logFile -Append -Encoding utf8
    
    try {
        node server/index.js >> $logFile 2>&1
    } catch {
        "[$timestamp] Server error: $_" | Out-File -FilePath $logFile -Append -Encoding utf8
    }

    $crashTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    "[$crashTime] Server exited. Restarting in 3 seconds..." | Out-File -FilePath $logFile -Append -Encoding utf8
    Write-Host "Server process exited. Restarting in 3 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
