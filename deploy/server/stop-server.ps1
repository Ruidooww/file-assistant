[CmdletBinding()]
param(
  [int]$TimeoutSeconds = 10
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "FileAssistant.Deploy.psm1") -Force

$context = Get-FileAssistantDeploymentContext
$running = Test-FileAssistantProcess -PidFile $context.PidFile
if (-not $running) {
  Write-Host "File Assistant server is not running."
  exit 0
}

Write-Host "Stopping File Assistant server. PID: $($running.Id)"
Stop-Process -Id $running.Id -ErrorAction Stop
try {
  Wait-Process -Id $running.Id -Timeout $TimeoutSeconds -ErrorAction Stop
} catch {
  $stillRunning = Get-Process -Id $running.Id -ErrorAction SilentlyContinue
  if ($stillRunning) {
    Write-Warning "Server did not stop within $TimeoutSeconds seconds. Forcing stop."
    Stop-Process -Id $running.Id -Force -ErrorAction Stop
  }
}

if (Test-Path -LiteralPath $context.PidFile) {
  Remove-Item -LiteralPath $context.PidFile -Force
}
Write-Host "File Assistant server stopped."
