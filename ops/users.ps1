# ops/users.ps1
# Creates or updates admin@pay.local and stall1@pay.local accounts for specified Mode.
# Passwords generated with crypto random and output to console ONLY.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("test", "live")]
    [string]$Mode,

    [switch]$Reset
)

$ErrorActionPreference = "Stop"

# Ensure secrets directory and JWT secret exist
& "$PSScriptRoot\setup-secret.ps1"

$dataDir = "C:\payasam-data\$Mode"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

# 1. Generate Admin Password (20 chars from A-HJ-NP-Za-km-z2-9, no look-alike characters)
$adminCharset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$adminPassChars = New-Object char[] 20
for ($i = 0; $i -lt 20; $i++) {
    $b = New-Object byte[] 1
    $rng.GetBytes($b)
    $adminPassChars[$i] = $adminCharset[$b[0] % $adminCharset.Length]
}
$adminPassword = -join $adminPassChars

# 2. Generate Stall Password (3 words from 64-word list + 2 digits, hyphen-separated)
$wordList = @(
    "apple", "mango", "berry", "lemon", "peach", "melon", "grape", "guava",
    "cream", "sweet", "fresh", "chill", "payasam", "butter", "fruit", "sugar",
    "coconut", "syrup", "glass", "spoon", "cold", "frozen", "taste", "aroma",
    "churn", "batch", "kettle", "basin", "dairy", "bowl", "pouch", "seller",
    "stall", "kiosk", "vendor", "counter", "market", "token", "receipt", "order",
    "dispatch", "stock", "daily", "closing", "worker", "admin", "morning", "night",
    "evening", "sunset", "summer", "breeze", "shadow", "fountain", "river", "ocean",
    "harbor", "island", "garden", "orchard", "forest", "valley", "meadow", "station"
)

$w1Idx = [byte](New-Object byte[] 1 | ForEach-Object { $rng.GetBytes($_); $_ }) % 64
$w2Idx = [byte](New-Object byte[] 1 | ForEach-Object { $rng.GetBytes($_); $_ }) % 64
$w3Idx = [byte](New-Object byte[] 1 | ForEach-Object { $rng.GetBytes($_); $_ }) % 64
$digits = ([byte](New-Object byte[] 1 | ForEach-Object { $rng.GetBytes($_); $_ }) % 90 + 10).ToString()

$stallPassword = "$($wordList[$w1Idx])-$($wordList[$w2Idx])-$($wordList[$w3Idx])-$digits"

$env:DATA_DIR = $dataDir
$env:NODE_ENV = "production"
$env:JWT_SECRET = Get-Content "C:\payasam-data\secrets\jwt_secret.txt" -Raw
$env:ADMIN_EMAIL = "admin@pay.local"
$env:ADMIN_PASSWORD = $adminPassword
$env:STALL_EMAIL = "stall1@pay.local"
$env:STALL_PASSWORD = $stallPassword

$repoRoot = Resolve-Path "$PSScriptRoot\.."
$resetArg = if ($Reset) { "--reset" } else { "" }

Write-Host "Creating users for Mode: $Mode in $dataDir..." -ForegroundColor Cyan
node "$PSScriptRoot\create-users.js" $resetArg

Write-Host "`n==================================================" -ForegroundColor Green
Write-Host "  USERS CREATED FOR MODE: $Mode" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "ADMIN EMAIL:    admin@pay.local" -ForegroundColor Yellow
Write-Host "ADMIN PASSWORD: $adminPassword" -ForegroundColor Yellow
Write-Host "--------------------------------------------------" -ForegroundColor Gray
Write-Host "STALL EMAIL:    stall1@pay.local" -ForegroundColor Yellow
Write-Host "STALL PASSWORD: $stallPassword" -ForegroundColor Yellow
Write-Host "==================================================`n" -ForegroundColor Green
