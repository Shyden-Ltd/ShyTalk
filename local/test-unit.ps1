#Requires -Version 5.1
<#
.SYNOPSIS
    Runs ShyTalk unit tests (Kotlin + Express API).
.DESCRIPTION
    No local environment needed. Runs Gradle tests and Express API Jest tests,
    then shows a combined pass/fail summary.
#>

$ErrorActionPreference = "Continue"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

$KotlinPass = $false
$ExpressPass = $false

Write-Host "========================================================"
Write-Host "  ShyTalk Unit Tests"
Write-Host "========================================================"
Write-Host ""

# ---- Kotlin unit tests ----
Write-Host "==> Running Kotlin unit tests..."
cmd.exe /c "gradlew.bat test"
if ($LASTEXITCODE -eq 0) {
    $KotlinPass = $true
    Write-Host "  Kotlin tests: PASSED" -ForegroundColor Green
} else {
    Write-Host "  Kotlin tests: FAILED" -ForegroundColor Red
}

Write-Host ""

# ---- Express API tests ----
Write-Host "==> Running Express API tests..."
$expressDir = Join-Path $ProjectRoot "express-api"
Push-Location $expressDir
try {
    npm test
    if ($LASTEXITCODE -eq 0) {
        $ExpressPass = $true
        Write-Host "  Express API tests: PASSED" -ForegroundColor Green
    } else {
        Write-Host "  Express API tests: FAILED" -ForegroundColor Red
    }
} finally {
    Pop-Location
}

# ---- Summary ----
Write-Host ""
Write-Host "========================================================"
Write-Host "  Unit Test Summary"
Write-Host "========================================================"
if ($KotlinPass) {
    Write-Host "  Kotlin:      PASSED" -ForegroundColor Green
} else {
    Write-Host "  Kotlin:      FAILED" -ForegroundColor Red
}
if ($ExpressPass) {
    Write-Host "  Express API: PASSED" -ForegroundColor Green
} else {
    Write-Host "  Express API: FAILED" -ForegroundColor Red
}
Write-Host "========================================================"

if (-not $KotlinPass -or -not $ExpressPass) {
    Write-Host ""
    Write-Host "Some tests FAILED." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All unit tests PASSED." -ForegroundColor Green
exit 0
