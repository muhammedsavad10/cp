# ops/setup-secret.ps1
# Generates a 96-hex-char crypto-random JWT secret outside repo if it does not exist.
# Never prints or logs the secret.

$secretsDir = "C:\payasam-data\secrets"
$secretFile = Join-Path $secretsDir "jwt_secret.txt"

if (-not (Test-Path $secretsDir)) {
    New-Item -ItemType Directory -Path $secretsDir -Force | Out-Null
}

if (-not (Test-Path $secretFile)) {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $hexSecret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    [System.IO.File]::WriteAllText($secretFile, $hexSecret.Trim())
    Write-Host "JWT secret generated successfully at $secretFile" -ForegroundColor Green
} else {
    Write-Host "JWT secret already exists at $secretFile" -ForegroundColor Yellow
}
