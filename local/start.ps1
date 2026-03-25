#Requires -Version 5.1
<#
.SYNOPSIS
    Starts the ShyTalk local development environment (PowerShell equivalent of start.sh).
.DESCRIPTION
    Full 10-step flow: Docker containers, Firebase Emulators, seed data,
    Express API, Android APK build, device install, ready message.
    Press Ctrl+C to shut down everything gracefully.
#>

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

# Verify prerequisites
$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npxCmd) {
    Write-Host "ERROR: npx not found. Install Node.js and ensure it is on your PATH." -ForegroundColor Red
    exit 1
}

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Host "ERROR: docker not found. Install Docker Desktop and ensure it is on your PATH." -ForegroundColor Red
    exit 1
}

$emulatorProcess = $null
$apiProcess = $null

# =============================================================================
# Step 1: Docker Compose up (LiveKit + MinIO + Mailpit)
# =============================================================================
Write-Host "==> Step 1/8: Starting Docker containers (LiveKit, MinIO, Mailpit)..."
docker compose -f "$ScriptDir\docker-compose.yml" up -d

# =============================================================================
# Step 2: Start Firebase Emulators (background)
# =============================================================================
Write-Host "==> Step 2/8: Starting Firebase Emulators..."
$emulatorProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npx firebase emulators:start --project=demo-shytalk --import=local/firebase-emulator-data --export-on-exit=local/firebase-emulator-data" `
    -WorkingDirectory $ProjectRoot `
    -PassThru `
    -NoNewWindow

# =============================================================================
# Step 3: Wait for readiness (emulators + MinIO)
# =============================================================================
Write-Host "==> Step 3/8: Waiting for emulators and MinIO..."

Write-Host "  Waiting for Firebase Emulators (localhost:4000)..."
$maxAttempts = 120
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:4000" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { break }
    } catch {
        # Not ready yet
    }
    $attempt++
    Start-Sleep -Seconds 1
}
if ($attempt -ge $maxAttempts) {
    Write-Host "ERROR: Emulators did not start within $maxAttempts seconds." -ForegroundColor Red
    if ($emulatorProcess -and -not $emulatorProcess.HasExited) {
        Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    }
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null
    exit 1
}
Write-Host "  Firebase Emulators ready."

Write-Host "  Waiting for MinIO (localhost:9002)..."
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:9002/minio/health/live" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { break }
    } catch {
        # Not ready yet
    }
    $attempt++
    Start-Sleep -Seconds 1
}
if ($attempt -ge $maxAttempts) {
    Write-Host "ERROR: MinIO did not start within $maxAttempts seconds." -ForegroundColor Red
    if ($emulatorProcess -and -not $emulatorProcess.HasExited) {
        Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    }
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null
    exit 1
}
Write-Host "  MinIO ready."

# =============================================================================
# Step 4: Seed data (Firestore + MinIO bucket)
# =============================================================================
Write-Host "==> Step 4/8: Seeding data..."
$expressDir = Join-Path $ProjectRoot "express-api"
Push-Location $expressDir
try {
    $env:NODE_PATH = ".\node_modules"
    node ..\local\seed.js
    $env:NODE_PATH = $null
} finally {
    Pop-Location
}

# =============================================================================
# Step 5: Start Express API (background)
# =============================================================================
Write-Host "==> Step 5/8: Starting Express API..."
$env:NODE_ENV = "local"
$apiProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd /d $expressDir && node src/index.js" `
    -PassThru `
    -NoNewWindow

# =============================================================================
# Step 6: Wait for API ready
# =============================================================================
Write-Host "==> Step 6/8: Waiting for Express API (localhost:3000)..."
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { break }
    } catch {
        # Not ready yet
    }
    $attempt++
    Start-Sleep -Seconds 1
}
if ($attempt -ge $maxAttempts) {
    Write-Host "ERROR: Express API did not start within $maxAttempts seconds." -ForegroundColor Red
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $emulatorProcess.HasExited) {
        Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    }
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null
    exit 1
}
Write-Host "  Express API ready."

# =============================================================================
# Step 7: Build Android APK
# =============================================================================
$ApkPath = "app\build\outputs\apk\local\debug\app-local-debug.apk"
Write-Host "==> Step 7/8: Building Android APK..."
& "$ProjectRoot\gradlew.bat" assembleLocalDebug

# =============================================================================
# Step 8: Install on device if connected
# =============================================================================
Write-Host "==> Step 8/8: Checking for connected device..."
$DeviceName = "No device connected"
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if ($adbCmd) {
    $adbOutput = adb devices 2>$null
    if ($adbOutput -match "device$") {
        $deviceLine = (adb devices -l 2>$null) -split "`n" | Where-Object { $_ -match "device " -and $_ -notmatch "List of" } | Select-Object -First 1
        if ($deviceLine -match "model:(\S+)") {
            $DeviceName = $Matches[1]
        } else {
            $DeviceName = "connected device"
        }
        Write-Host "  Installing on $DeviceName..."
        $fullApkPath = Join-Path $ProjectRoot $ApkPath
        try {
            adb install -r $fullApkPath 2>$null
            Write-Host "  Installed."
        } catch {
            Write-Host "  Install failed -- APK path shown below."
        }
    } else {
        Write-Host "  No device connected -- skipping install."
    }
} else {
    Write-Host "  adb not found -- skipping install."
}

# =============================================================================
# Ready message
# =============================================================================
Write-Host ""
Write-Host "========================================================"
Write-Host "  Local environment ready (fully offline):"
Write-Host "========================================================"
Write-Host ""
Write-Host "  Services:"
Write-Host "    Firebase UI:    http://localhost:4000"
Write-Host "    Express API:    http://localhost:3000"
Write-Host "    Mailpit UI:     http://localhost:8025"
Write-Host "    MinIO Console:  http://localhost:9001"
Write-Host "    LiveKit:        localhost:7880"
Write-Host ""
Write-Host "  Credentials:"
Write-Host "    Test admin:     claude-test@shytalk.dev / localdev123"
Write-Host "    Test user:      user@test.com / localdev123"
Write-Host "    MinIO:          minioadmin / minioadmin"
Write-Host ""
Write-Host "  Android:"
Write-Host "    APK path:       $ApkPath"
Write-Host "    Installed on:   $DeviceName"
Write-Host ""
Write-Host "  iOS: Supported but not covered here -- development focuses on Android."
Write-Host ""
Write-Host "  Run tests:        .\local\test.ps1"
Write-Host "  View Allure:      npx allure serve allure-results"
Write-Host ""

# =============================================================================
# Wait for Ctrl+C and clean up
# =============================================================================
try {
    Write-Host "Press Ctrl+C to stop..." -ForegroundColor Cyan
    $emulatorProcess.WaitForExit()
} finally {
    Write-Host ""
    Write-Host "Shutting down..."

    # Clean up NODE_ENV so it doesn't leak into the caller's shell
    Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue

    # 1. Stop Express API
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Write-Host "Stopping Express API..."
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }

    # 2. Stop Firebase Emulators (graceful -- wait for data export)
    if ($emulatorProcess -and -not $emulatorProcess.HasExited) {
        Write-Host "Waiting for emulators to finish graceful shutdown..."
        $exited = $emulatorProcess.WaitForExit(30000)
        if (-not $exited) {
            Write-Host "Grace period expired -- force-killing remaining processes..." -ForegroundColor Yellow
            # Kill child processes (Java emulators spawned by npx/firebase)
            Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.CommandLine -match "firebase.*emulators|cloud-firestore-emulator|cloud-datastore-emulator"
            } | ForEach-Object {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
            Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Name -match "java" -and $_.CommandLine -match "firebase"
            } | ForEach-Object {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
            Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
        }
    }

    # 3. Stop Docker containers
    Write-Host "Stopping Docker containers..."
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null

    Write-Host "Local environment stopped."
}
