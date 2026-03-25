#Requires -Version 5.1
<#
.SYNOPSIS
    Runs ShyTalk Android E2E tests against the local environment.
.DESCRIPTION
    Checks local env is running, checks for a connected Android device,
    runs Gradle connected tests, and optionally opens the Allure report.
#>

$ErrorActionPreference = "Continue"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

Write-Host "========================================================"
Write-Host "  ShyTalk Android E2E Tests"
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

# ---- Check adb device ----
Write-Host "==> Checking for connected Android device..."
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adbCmd) {
    Write-Host "ERROR: adb not found on PATH." -ForegroundColor Red
    exit 1
}

$adbOutput = adb devices 2>$null
if (-not ($adbOutput -match "device$")) {
    Write-Host "ERROR: No Android device connected." -ForegroundColor Red
    Write-Host "  Connect a device or start an emulator, then try again."
    exit 1
}

$deviceLine = (adb devices -l 2>$null) -split "`n" | Where-Object { $_ -match "device " -and $_ -notmatch "List of" } | Select-Object -First 1
$DeviceName = "connected device"
if ($deviceLine -match "model:(\S+)") {
    $DeviceName = $Matches[1]
}
Write-Host "  Device found: $DeviceName"

# ---- Run E2E tests ----
Write-Host ""
Write-Host "==> Running Android E2E tests..."
Write-Host ""

cmd.exe /c "gradlew.bat connectedLocalDebugAndroidTest"
$TestExit = $LASTEXITCODE

# ---- Results ----
Write-Host ""
Write-Host "========================================================"
Write-Host "  Android E2E Test Results"
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
