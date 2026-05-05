[CmdletBinding()]
param(
  [string]$NssmPath = "",
  [string]$ServiceName = "",
  [switch]$StartAfterInstall
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "FileAssistant.Deploy.psm1") -Force

function Resolve-NssmExe {
  param([string]$PathFromParameter)
  if (-not [string]::IsNullOrWhiteSpace($PathFromParameter)) {
    if (-not (Test-Path -LiteralPath $PathFromParameter)) {
      throw "NSSM was not found: $PathFromParameter"
    }
    return (Resolve-Path -LiteralPath $PathFromParameter).ProviderPath
  }
  $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  throw "nssm.exe was not found. Install NSSM or pass -NssmPath C:\path\to\nssm.exe."
}

$context = Get-FileAssistantDeploymentContext
$nssm = Resolve-NssmExe -PathFromParameter $NssmPath
if ([string]::IsNullOrWhiteSpace($ServiceName)) {
  $ServiceName = [string]$context.Config.ServiceName
}
if ([string]::IsNullOrWhiteSpace($ServiceName)) {
  $ServiceName = "FileAssistantServer"
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  throw "Service already exists: $ServiceName"
}

New-Item -ItemType Directory -Force -Path $context.DataDir, $context.LogDir | Out-Null
$outLog = Join-Path $context.LogDir "service.out.log"
$errLog = Join-Path $context.LogDir "service.err.log"

& $nssm install $ServiceName $context.NodePath $context.ServerScript
& $nssm set $ServiceName AppDirectory $context.ProjectRoot
& $nssm set $ServiceName DisplayName "File Assistant Server"
& $nssm set $ServiceName Description "File Assistant internal transfer bridge server"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout $outLog
& $nssm set $ServiceName AppStderr $errLog
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateOnline 1
& $nssm set $ServiceName AppStopMethodConsole 15000

$envLines = @(
  "PORT=$($context.Config.Port)",
  "ADMIN_USERNAME=$($context.Config.AdminUsername)",
  "ADMIN_PASSWORD=$($context.Config.AdminPassword)",
  "ADMIN_TOKEN=$($context.Config.AdminToken)",
  "DATA_DIR=$($context.DataDir)",
  "FILE_ASSISTANT_DATA_DIR=$($context.DataDir)",
  "FILE_ASSISTANT_ROOT_DIR=$($context.ProjectRoot)",
  "CHUNK_SIZE_BYTES=$($context.Config.ChunkSizeBytes)"
)
& $nssm set $ServiceName AppEnvironmentExtra $envLines

Write-Host "Service installed: $ServiceName"
Write-Host "Logs: $outLog"
if ($StartAfterInstall) {
  Start-Service -Name $ServiceName
  Write-Host "Service started."
}
