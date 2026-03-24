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

# --- Start LiveKit ---
Write-Host "Starting LiveKit..."
docker compose -f "$ScriptDir\docker-compose.yml" up -d

# --- Start Firebase Emulators ---
Write-Host "Starting Firebase Emulators..."
$emulatorArgs = @(
    "firebase", "emulators:start",
    "--project=demo-shytalk",
    "--import=local/firebase-emulator-data",
    "--export-on-exit=local/firebase-emulator-data"
)

$emulatorProcess = Start-Process -FilePath "npx" `
    -ArgumentList $emulatorArgs `
    -WorkingDirectory $ProjectRoot `
    -PassThru `
    -NoNewWindow

# --- Wait for emulators to be ready ---
Write-Host "Waiting for emulators..."
$maxAttempts = 120
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:4000" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        break
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
    Push-Location $ProjectRoot
    try {
        node local/seed.js
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
    # Register Ctrl+C handler
    [Console]::TreatControlCAsInput = $false
    $null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
        # Cleanup on PowerShell exit
    }

    Write-Host "Press Ctrl+C to stop..." -ForegroundColor Cyan
    # Wait for the emulator process to exit (or Ctrl+C)
    $emulatorProcess.WaitForExit()
} finally {
    Write-Host "Shutting down..."

    # Stop Firebase emulator process
    if (-not $emulatorProcess.HasExited) {
        Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
    }
    # Also kill any child processes (java spawned by Firebase emulators)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match "firebase" -and $_.Name -match "java"
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    # Kill any remaining Firebase emulator node processes
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match "firebase.*emulators"
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

    # Stop LiveKit Docker container
    docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null

    Write-Host "Local environment stopped."
}
