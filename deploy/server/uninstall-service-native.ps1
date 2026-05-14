[CmdletBinding()]
param(
  [string]$ServiceName = "FileAssistantServer",
  [int]$Port = 5177,
  [string]$BaseDir = "",
  [switch]$RemoveFirewallRule
)

$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:ProgramData "FileAssistantServer\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$uninstallLog = Join-Path $logDir "uninstall-service.log"

function Write-UninstallLog {
  param([string]$Message)
  Add-Content -LiteralPath $uninstallLog -Encoding UTF8 -Value "[$([DateTimeOffset]::Now.ToString('O'))] $Message"
}

function Wait-ServiceDeleted {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Wait-ServiceStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Status,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
      return $false
    }
    if ([string]$service.Status -eq $Status) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Stop-ProcessByPath {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $name = [System.IO.Path]::GetFileName($fullPath)
  $processes = Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    if ([string]::Equals([string]$process.ExecutablePath, $fullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-UninstallLog "Terminating leftover process $($process.ProcessId): $($process.ExecutablePath)"
      Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null
    }
  }
}

function Stop-TrayInBaseDir {
  param([string]$Dir)

  if ([string]::IsNullOrWhiteSpace($Dir)) {
    return
  }

  $baseDirFull = [System.IO.Path]::GetFullPath($Dir).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $processes = Get-CimInstance Win32_Process -Filter "Name='FileAssistantServerTray.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    $path = [string]$process.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($path) -or $path.StartsWith($baseDirFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-UninstallLog "Terminating tray process $($process.ProcessId): $path"
      Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null
    }
  }
}

Write-UninstallLog "Removing service '$ServiceName'. BaseDir='$BaseDir'. Port='$Port'."

Stop-TrayInBaseDir -Dir $BaseDir

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-UninstallLog "Existing service found. Status=$($existing.Status)."
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    if (-not (Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds 45)) {
      throw "Service $ServiceName did not stop cleanly before uninstall. See $uninstallLog"
    }
  }
  & sc.exe delete $ServiceName | Out-Null
  Write-UninstallLog "sc.exe delete exit code: $LASTEXITCODE"
  if ($LASTEXITCODE -eq 0) {
    if (-not (Wait-ServiceDeleted -Name $ServiceName -TimeoutSeconds 45)) {
      throw "Service $ServiceName is still pending deletion. Close Services/Task Manager windows or reboot, then uninstall again. See $uninstallLog"
    }
  } else {
    throw "Failed to delete service $ServiceName. sc.exe exit code: $LASTEXITCODE. See $uninstallLog"
  }
}

if (-not [string]::IsNullOrWhiteSpace($BaseDir)) {
  Stop-ProcessByPath (Join-Path $BaseDir "runtime\node\node.exe")
  Stop-ProcessByPath (Join-Path $BaseDir "FileAssistantServerService.exe")
}

if ($RemoveFirewallRule) {
  $ruleName = "File Assistant Server $Port"
  & netsh.exe advfirewall firewall delete rule name="$ruleName" | Out-Null
  Write-UninstallLog "Firewall delete exit code: $LASTEXITCODE"
}

Write-UninstallLog "Service removed: $ServiceName"
Write-Host "Service removed: $ServiceName"
