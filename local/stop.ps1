#Requires -Version 5.1
<#
.SYNOPSIS
    Stops the ShyTalk local development environment.
.DESCRIPTION
    Stops Docker containers, kills Firebase emulator processes, Java emulator
    processes, and the Express API. Uses both command-line matching and
    port-based detection to ensure no leaked processes.
#>

$ErrorActionPreference = "SilentlyContinue"

$ScriptDir = $PSScriptRoot

# Stop Docker containers (LiveKit, MinIO, Mailpit)
docker compose -f "$ScriptDir\docker-compose.yml" down 2>$null

# Query all processes once
$allProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue

# Kill Firebase emulator processes (node processes running firebase)
$allProcesses | Where-Object {
    $_.CommandLine -match "firebase.*emulators"
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Kill Java emulator processes
$allProcesses | Where-Object {
    $_.Name -match "java" -and ($_.CommandLine -match "cloud-firestore-emulator|cloud-datastore-emulator|firebase")
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Kill Express API process
$allProcesses | Where-Object {
    $_.CommandLine -match "express-api[\\/]src[\\/]index\.js|node src/index\.js"
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Fallback: kill any processes listening on our known ports
$knownPorts = @(3000, 4000, 8080, 9000, 9099)
foreach ($port in $knownPorts) {
    $output = netstat -ano 2>$null | Select-String ":${port}\s.*LISTENING"
    if ($output) {
        foreach ($line in $output) {
            $pid = ($line -split '\s+')[-1]
            if ($pid -and $pid -ne "0") {
                Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "Local environment stopped."
