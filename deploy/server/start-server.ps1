[CmdletBinding()]
param(
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "FileAssistant.Deploy.psm1") -Force

$context = Get-FileAssistantDeploymentContext
New-Item -ItemType Directory -Force -Path $context.DataDir, $context.LogDir, $context.RunDir | Out-Null
Set-FileAssistantServerEnvironment -Context $context

if (-not $context.HasConfigFile) {
  Write-Warning "deploy\server\config.ps1 was not found. Defaults are being used. Copy config.example.ps1 to config.ps1 before production use."
}

$running = Test-FileAssistantProcess -PidFile $context.PidFile
if ($running) {
  Write-Host "File Assistant server is already running. PID: $($running.Id)"
  exit 0
}

Write-Host "Project root: $($context.ProjectRoot)"
Write-Host "Data dir:     $($context.DataDir)"
Write-Host "Server URL:   http://localhost:$($context.Config.Port)"

if ($Foreground) {
  Write-Host "Starting in foreground. Press Ctrl+C to stop."
  & $context.NodePath $context.ServerScript
  exit $LASTEXITCODE
}

$outLog = Join-Path $context.LogDir "server.out.log"
$errLog = Join-Path $context.LogDir "server.err.log"
$arguments = ('"{0}"' -f $context.ServerScript)
$process = Start-Process `
  -FilePath $context.NodePath `
  -ArgumentList $arguments `
  -WorkingDirectory $context.ProjectRoot `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden

Set-Content -LiteralPath $context.PidFile -Value ([string]$process.Id) -Encoding ASCII
Write-Host "File Assistant server started. PID: $($process.Id)"
Write-Host "Logs: $outLog"
