#Requires -Version 5.1
<#
.SYNOPSIS
    Starts the ShyTalk local development environment (PowerShell equivalent of start.sh).
.DESCRIPTION
    Starts LiveKit via Docker Compose, Firebase Emulators with import/export,
    seeds data on first run, and waits for Ctrl+C to shut down gracefully.
#>

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

# Resolve npx to its full path (.cmd file on Windows — Start-Process cannot run .cmd directly)
$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npxCmd) {
    Write-Host "ERROR: npx not found. Install Node.js and ensure it is on your PATH." -ForegroundColor Red
    exit 1
}

# --- Start LiveKit ---
Write-Host "Starting LiveKit..."
docker compose -f "$ScriptDir\docker-compose.yml" up -d

# --- Start Firebase Emulators ---
Write-Host "Starting Firebase Emulators..."
$emulatorProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npx firebase emulators:start --project=demo-shytalk --import=local/firebase-emulator-data --export-on-exit=local/firebase-emulator-data" `
    -WorkingDirectory $ProjectRoot `
    -PassThru `
    -NoNewWindow

# --- Wait for emulators to be ready ---
Write-Host "Waiting for emulators..."
$maxAttempts = 120
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:4000" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { break }
        $attempt++
        Start-Sleep -Seconds 1
    } catch {
        $attempt++
        Start-Sleep -Seconds 1
    }
}

if ($attempt -ge $maxAttempts) {
    Write-Host "ERROR: Emulators did not start within $maxAttempts seconds." -ForegroundColor Red
    if (-not $emulatorProcess.HasExited) {
        Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    }
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null
    exit 1
}

Write-Host "Emulators ready."

# --- Seed data on first run ---
$firestoreExportDir = Join-Path $ProjectRoot "local\firebase-emulator-data\firestore_export"
if (-not (Test-Path $firestoreExportDir)) {
    Write-Host "First run - seeding data..."
    Push-Location (Join-Path $ProjectRoot "express-api")
    try {
        node ..\local\seed.js
    } finally {
        Pop-Location
    }
}

# --- Display ready message ---
Write-Host ""
Write-Host "Local environment ready:"
Write-Host "  Firebase UI:  http://localhost:4000"
Write-Host "  Firestore:    localhost:8080"
Write-Host "  Auth:         localhost:9099"
Write-Host "  RTDB:         localhost:9000"
Write-Host "  LiveKit:      localhost:7880"
Write-Host ""
Write-Host "Start the API:  cd express-api && npm run local"
Write-Host "Build Android:  ./gradlew installLocalDebug"
Write-Host ""

# --- Wait for Ctrl+C and clean up ---
try {
    Write-Host "Press Ctrl+C to stop..." -ForegroundColor Cyan
    $emulatorProcess.WaitForExit()
} finally {
    Write-Host "Shutting down..."

    # Ctrl+C was sent to all console processes — the emulators are already
    # shutting down gracefully (exporting data, stopping each emulator).
    # Give them up to 30 seconds to finish before force-killing.
    if (-not $emulatorProcess.HasExited) {
        Write-Host "Waiting for emulators to finish graceful shutdown..."
        $exited = $emulatorProcess.WaitForExit(30000)
        if (-not $exited) {
            Write-Host "Grace period expired — force-killing remaining processes..." -ForegroundColor Yellow
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

    # Stop LiveKit Docker container
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null

    Write-Host "Local environment stopped."
}
