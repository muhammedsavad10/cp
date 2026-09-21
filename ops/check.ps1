# ops/check.ps1
# Checks local and public /healthz endpoints.

$ErrorActionPreference = "Continue"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  HEALTH CHECK (LOCAL & PUBLIC)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Local Health Check
try {
    $localRes = Invoke-RestMethod -Uri "http://localhost:5000/healthz" -Method Get -TimeoutSec 5
    if ($localRes.status -eq "ok") {
        Write-Host "LOCAL /healthz:  PASS (http://localhost:5000/healthz)" -ForegroundColor Green
    } else {
        Write-Host "LOCAL /healthz:  FAIL (unexpected response)" -ForegroundColor Red
    }
} catch {
    Write-Host "LOCAL /healthz:  FAIL ($_.Exception.Message)" -ForegroundColor Red
}

# 2. Public Health Check
$urlFile = "C:\payasam-data\current-url.txt"
if (Test-Path $urlFile) {
    $publicUrl = (Get-Content $urlFile -Raw).Trim()
    if ($publicUrl) {
        try {
            $publicRes = Invoke-RestMethod -Uri "$publicUrl/healthz" -Method Get -TimeoutSec 10
            if ($publicRes.status -eq "ok") {
                Write-Host "PUBLIC /healthz: PASS ($publicUrl/healthz)" -ForegroundColor Green
            } else {
                Write-Host "PUBLIC /healthz: FAIL (unexpected response)" -ForegroundColor Red
            }
        } catch {
            Write-Host "PUBLIC /healthz: FAIL ($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "PUBLIC /healthz: SKIPPED ($urlFile is empty)" -ForegroundColor Yellow
    }
} else {
    Write-Host "PUBLIC /healthz: SKIPPED ($urlFile does not exist)" -ForegroundColor Yellow
}
