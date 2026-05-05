[CmdletBinding()]
param(
  [string]$NssmPath = "",
  [string]$ServiceName = ""
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

if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
  Write-Host "Service does not exist: $ServiceName"
  exit 0
}

try {
  & $nssm stop $ServiceName
} catch {
  Write-Warning "NSSM stop failed or service was already stopped: $($_.Exception.Message)"
}
& $nssm remove $ServiceName confirm
Write-Host "Service removed: $ServiceName"
