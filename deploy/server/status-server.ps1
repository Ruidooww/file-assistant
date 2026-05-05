[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "FileAssistant.Deploy.psm1") -Force

$context = Get-FileAssistantDeploymentContext
$running = Test-FileAssistantProcess -PidFile $context.PidFile
if ($running) {
  Write-Host "Process: running, PID $($running.Id)"
} else {
  Write-Host "Process: not running from deploy pid file"
}

$url = "http://127.0.0.1:$($context.Config.Port)/api/health"
try {
  $health = Invoke-RestMethod -Uri $url -TimeoutSec 5
  if ($health.ok) {
    Write-Host "Health:  ok ($url)"
    Write-Host "Time:    $($health.at)"
  } else {
    Write-Warning "Health endpoint responded, but ok was not true."
  }
} catch {
  Write-Warning "Health check failed: $($_.Exception.Message)"
}

Write-Host "Admin:   http://localhost:$($context.Config.Port)/admin"
Write-Host "Data:    $($context.DataDir)"
Write-Host "Logs:    $($context.LogDir)"
