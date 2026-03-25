#Requires -Version 5.1
<#
.SYNOPSIS
    Runs ShyTalk linters (ktlint + ESLint).
.DESCRIPTION
    No local environment needed. Runs ktlintCheck via Gradle and ESLint on the
    Express API, then shows a combined pass/fail summary.
#>

$ErrorActionPreference = "Continue"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

$KtlintPass = $false
$EslintPass = $false

Write-Host "========================================================"
Write-Host "  ShyTalk Linters"
Write-Host "========================================================"
Write-Host ""

# ---- ktlint ----
Write-Host "==> Running ktlintCheck..."
cmd.exe /c "gradlew.bat ktlintCheck"
if ($LASTEXITCODE -eq 0) {
    $KtlintPass = $true
    Write-Host "  ktlint: PASSED" -ForegroundColor Green
} else {
    Write-Host "  ktlint: FAILED" -ForegroundColor Red
}

Write-Host ""

# ---- ESLint ----
Write-Host "==> Running ESLint on Express API..."
$expressDir = Join-Path $ProjectRoot "express-api"
Push-Location $expressDir
try {
    npx eslint src/
    if ($LASTEXITCODE -eq 0) {
        $EslintPass = $true
        Write-Host "  ESLint: PASSED" -ForegroundColor Green
    } else {
        Write-Host "  ESLint: FAILED" -ForegroundColor Red
    }
} finally {
    Pop-Location
}

# ---- Summary ----
Write-Host ""
Write-Host "========================================================"
Write-Host "  Lint Summary"
Write-Host "========================================================"
if ($KtlintPass) {
    Write-Host "  ktlint: PASSED" -ForegroundColor Green
} else {
    Write-Host "  ktlint: FAILED" -ForegroundColor Red
}
if ($EslintPass) {
    Write-Host "  ESLint: PASSED" -ForegroundColor Green
} else {
    Write-Host "  ESLint: FAILED" -ForegroundColor Red
}
Write-Host "========================================================"

if (-not $KtlintPass -or -not $EslintPass) {
    Write-Host ""
    Write-Host "Some linters FAILED." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All linters PASSED." -ForegroundColor Green
exit 0
