#Requires -Version 5.1
<#
.SYNOPSIS
    Runs ShyTalk Playwright web tests against the local environment.
.DESCRIPTION
    Checks local env is running, serves the admin panel, runs Playwright tests,
    and optionally opens the Allure report.
#>

$ErrorActionPreference = "Continue"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

$serveProcess = $null

Write-Host "========================================================"
Write-Host "  ShyTalk Playwright Web Tests"
Write-Host "========================================================"
Write-Host ""

# ---- Check local env is running ----
Write-Host "==> Checking local environment..."
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
} catch {
    Write-Host "ERROR: Local environment is not running." -ForegroundColor Red
    Write-Host "  Start it first: .\local\start.ps1"
    exit 1
}
Write-Host "  Local environment is running."

# ---- Start serve for admin panel ----
Write-Host "==> Starting admin panel server (port 8080)..."
$serveProcess = Start-Process -FilePath "npx" `
    -ArgumentList "serve", "public", "-l", "8080" `
    -WorkingDirectory $ProjectRoot `
    -PassThru `
    -NoNewWindow

Start-Sleep -Seconds 2

try {
    # ---- Run Playwright tests ----
    Write-Host "==> Running Playwright tests..."
    Write-Host ""

    $env:WEB_BASE_URL = "http://localhost:8080"
    $env:ALLURE_ENABLED = "true"
    $env:ALLURE_PROJECT = "local"

    npx playwright test
    $TestExit = $LASTEXITCODE
} finally {
    # ---- Kill serve ----
    if ($serveProcess -and -not $serveProcess.HasExited) {
        Stop-Process -Id $serveProcess.Id -Force -ErrorAction SilentlyContinue
    }

    # Clean up env vars
    Remove-Item Env:\WEB_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\ALLURE_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:\ALLURE_PROJECT -ErrorAction SilentlyContinue
}

# ---- Results ----
Write-Host ""
Write-Host "========================================================"
Write-Host "  Playwright Test Results"
Write-Host "========================================================"
if ($TestExit -eq 0) {
    Write-Host "  Status: PASSED" -ForegroundColor Green
} else {
    Write-Host "  Status: FAILED (exit code $TestExit)" -ForegroundColor Red
}
Write-Host "========================================================"

# ---- Allure report prompt ----
$allureDir = Join-Path $ProjectRoot "allure-results"
if ((Test-Path $allureDir) -and (Get-ChildItem $allureDir -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host ""
    $yn = Read-Host "View Allure report? (y/n)"
    if ($yn -eq "y" -or $yn -eq "Y") {
        npx allure serve allure-results
    }
}

exit $TestExit
