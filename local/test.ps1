#Requires -Version 5.1
<#
.SYNOPSIS
    Interactive test runner for ShyTalk local development.
.DESCRIPTION
    Presents a menu to choose which tests to run: unit, Playwright, E2E, lint,
    or all. For tests requiring the local environment, checks health first.
#>

$ErrorActionPreference = "Continue"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

function Test-LocalEnv {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return $true
    } catch {
        Write-Host ""
        Write-Host "ERROR: Local environment is not running." -ForegroundColor Red
        Write-Host ""
        $yn = Read-Host "Start it now? (y/n)"
        if ($yn -eq "y" -or $yn -eq "Y") {
            Write-Host "Run '.\local\start.ps1' in a separate terminal, then re-run this script."
        }
        return $false
    }
}

function Invoke-TestScript {
    param([string]$ScriptPath)
    & $ScriptPath
    return $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================================"
Write-Host "  ShyTalk Test Runner"
Write-Host "========================================================"
Write-Host ""
Write-Host "Which tests would you like to run?"
Write-Host ""
Write-Host "  [1] Unit tests (Kotlin + Express API)"
Write-Host "  [2] Playwright web tests"
Write-Host "  [3] Android E2E tests"
Write-Host "  [4] Linters (ktlint + ESLint)"
Write-Host "  [5] All tests + linters"
Write-Host "  [0] Cancel"
Write-Host ""
$choice = Read-Host "Choice"

$OverallExit = 0

switch ($choice) {
    "1" {
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-unit.ps1")
    }
    "2" {
        if (-not (Test-LocalEnv)) { exit 1 }
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-playwright.ps1")
    }
    "3" {
        if (-not (Test-LocalEnv)) { exit 1 }
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-e2e.ps1")
    }
    "4" {
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-lint.ps1")
    }
    "5" {
        if (-not (Test-LocalEnv)) { exit 1 }

        Write-Host ""
        Write-Host "==> Running all tests + linters..."
        Write-Host ""

        # 1. Lint
        Write-Host "--- [1/4] Linters ---"
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-lint.ps1")
        if ($OverallExit -ne 0) {
            Write-Host ""
            Write-Host "Linters failed. Stopping." -ForegroundColor Red
            Write-Host ""
            Write-Host "========================================================"
            Write-Host "  Overall: FAILED (linters)" -ForegroundColor Red
            Write-Host "========================================================"
            exit $OverallExit
        }

        Write-Host ""

        # 2. Unit tests
        Write-Host "--- [2/4] Unit Tests ---"
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-unit.ps1")
        if ($OverallExit -ne 0) {
            Write-Host ""
            Write-Host "Unit tests failed. Stopping." -ForegroundColor Red
            Write-Host ""
            Write-Host "========================================================"
            Write-Host "  Overall: FAILED (unit tests)" -ForegroundColor Red
            Write-Host "========================================================"
            exit $OverallExit
        }

        Write-Host ""

        # 3. Playwright
        Write-Host "--- [3/4] Playwright Web Tests ---"
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-playwright.ps1")
        if ($OverallExit -ne 0) {
            Write-Host ""
            Write-Host "Playwright tests failed. Stopping." -ForegroundColor Red
            Write-Host ""
            Write-Host "========================================================"
            Write-Host "  Overall: FAILED (Playwright)" -ForegroundColor Red
            Write-Host "========================================================"
            exit $OverallExit
        }

        Write-Host ""

        # 4. E2E
        Write-Host "--- [4/4] Android E2E Tests ---"
        $OverallExit = Invoke-TestScript (Join-Path $ScriptDir "test-e2e.ps1")
        if ($OverallExit -ne 0) {
            Write-Host ""
            Write-Host "E2E tests failed. Stopping." -ForegroundColor Red
            Write-Host ""
            Write-Host "========================================================"
            Write-Host "  Overall: FAILED (E2E)" -ForegroundColor Red
            Write-Host "========================================================"
            exit $OverallExit
        }

        Write-Host ""
        Write-Host "========================================================"
        Write-Host "  Overall: ALL PASSED" -ForegroundColor Green
        Write-Host "========================================================"
    }
    "0" {
        Write-Host "Cancelled."
        exit 0
    }
    default {
        Write-Host "Invalid choice: $choice" -ForegroundColor Red
        exit 1
    }
}

exit $OverallExit
