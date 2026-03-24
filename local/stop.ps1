#Requires -Version 5.1
<#
.SYNOPSIS
    Stops the ShyTalk local development environment (PowerShell equivalent of stop.sh).
.DESCRIPTION
    Stops the LiveKit Docker container, kills Firebase emulator processes,
    and kills the Express API process if running.
#>

$ErrorActionPreference = "SilentlyContinue"

$ScriptDir = $PSScriptRoot

# Stop LiveKit Docker container
docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null

# Query all processes once for efficiency
$allProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue

# Kill Firebase emulator processes (node processes running firebase emulators)
$allProcesses | Where-Object {
    $_.CommandLine -match "firebase.*emulators"
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Kill any Java processes spawned by Firebase emulators (jar name in command line)
$allProcesses | Where-Object {
    $_.Name -match "java" -and ($_.CommandLine -match "cloud-firestore-emulator|cloud-datastore-emulator|firebase")
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Kill Express API process if running
$allProcesses | Where-Object {
    $_.CommandLine -match "express-api[\\/]src[\\/]index\.js"
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Local environment stopped."
