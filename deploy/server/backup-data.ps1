[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "FileAssistant.Deploy.psm1") -Force

$context = Get-FileAssistantDeploymentContext
if (-not (Test-Path -LiteralPath $context.DataDir)) {
  throw "Data directory does not exist: $($context.DataDir)"
}

New-Item -ItemType Directory -Force -Path $context.BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destination = Join-Path $context.BackupDir "file-assistant-data-$stamp.zip"
$items = Get-ChildItem -LiteralPath $context.DataDir -Force
if (-not $items) {
  Write-Warning "Data directory is empty. No backup archive was created."
  exit 0
}

Compress-Archive -LiteralPath $items.FullName -DestinationPath $destination -Force
Write-Host "Backup created: $destination"
Write-Host "For the most consistent SQLite backup, stop the service before running this script."
