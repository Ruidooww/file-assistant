[CmdletBinding()]
param(
  [string]$ServiceName = "FileAssistantServer",
  [Parameter(Mandatory = $true)][string]$BaseDir,
  [Parameter(Mandatory = $true)][string]$LogDir,
  [ValidateSet("auto", "demand")][string]$StartupType = "auto",
  [int]$Port = 5177,
  [switch]$StartService,
  [switch]$AddFirewallRule
)

$ErrorActionPreference = "Stop"

$baseDirFull = [System.IO.Path]::GetFullPath($BaseDir)
$logDirFull = [System.IO.Path]::GetFullPath($LogDir)
$installLog = Join-Path $logDirFull "install-service.log"
$serviceExe = Join-Path $baseDirFull "FileAssistantServerService.exe"
if (-not (Test-Path -LiteralPath $serviceExe)) {
  throw "Service wrapper was not found: $serviceExe"
}

New-Item -ItemType Directory -Force -Path $logDirFull | Out-Null

function Write-InstallLog {
  param([string]$Message)
  Add-Content -LiteralPath $installLog -Encoding UTF8 -Value "[$([DateTimeOffset]::Now.ToString('O'))] $Message"
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  Write-InstallLog ("RUN: {0} {1}" -f $FilePath, ($Arguments -join " "))
  $output = & $FilePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($output) {
    foreach ($line in $output) {
      Write-InstallLog ("OUT: {0}" -f $line)
    }
  }
  Write-InstallLog ("EXIT: {0}" -f $exitCode)
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $output
  }
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

function Wait-HttpHealth {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 45
  )

  $url = "http://127.0.0.1:$Port/api/health"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $health = Invoke-RestMethod -Uri $url -TimeoutSec 3
      if ($health.ok) {
        Write-InstallLog "Health check succeeded: $url"
        return $true
      }
      Write-InstallLog "Health endpoint responded but ok was not true: $url"
    } catch {
      Write-InstallLog "Health check pending: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  return $false
}

Write-InstallLog "Installing service '$ServiceName'. BaseDir='$baseDirFull'. LogDir='$logDirFull'. StartupType='$StartupType'. Port='$Port'."

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-InstallLog "Existing service found. Status=$($existing.Status). Removing it before reinstall."
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    if (-not (Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds 45)) {
      throw "Existing service $ServiceName did not stop cleanly before reinstall. See $installLog"
    }
  }
  $delete = Invoke-NativeCommand sc.exe delete $ServiceName
  if ($delete.ExitCode -ne 0) {
    throw "Failed to delete existing service $ServiceName. sc.exe exit code: $($delete.ExitCode). See $installLog"
  }
  if (-not (Wait-ServiceDeleted -Name $ServiceName -TimeoutSeconds 30)) {
    throw "Existing service $ServiceName is still pending deletion. Close Services/Task Manager windows or reboot, then run installer again. See $installLog"
  }
}

$binPath = "`"$serviceExe`" --service-name `"$ServiceName`" --base-dir `"$baseDirFull`" --log-dir `"$logDirFull`""
$windowsStartupType = if ($StartupType -eq "auto") { "Automatic" } else { "Manual" }
Write-InstallLog "RUN: New-Service -Name '$ServiceName' -BinaryPathName '$binPath' -StartupType '$windowsStartupType' -DisplayName 'File Assistant Server'"
try {
  New-Service `
    -Name $ServiceName `
    -BinaryPathName $binPath `
    -StartupType $windowsStartupType `
    -DisplayName "File Assistant Server" `
    -ErrorAction Stop | Out-Null
  Write-InstallLog "New-Service succeeded."
} catch {
  Write-InstallLog "ERROR: New-Service failed. $($_.Exception.Message)"
  throw "Failed to create service $ServiceName. $($_.Exception.Message). See $installLog"
}

$description = Invoke-NativeCommand sc.exe description $ServiceName "File Assistant internal file transfer bridge server"
if ($description.ExitCode -ne 0) {
  throw "Failed to set service description. sc.exe exit code: $($description.ExitCode). See $installLog"
}

if ($AddFirewallRule) {
  $ruleName = "File Assistant Server $Port"
  try {
    Invoke-NativeCommand netsh.exe advfirewall firewall delete rule "name=$ruleName" | Out-Null
    $firewall = Invoke-NativeCommand netsh.exe advfirewall firewall add rule "name=$ruleName" dir=in action=allow protocol=TCP "localport=$Port"
    if ($firewall.ExitCode -ne 0) {
      Write-Warning "Failed to add firewall rule for port $Port. netsh.exe exit code: $($firewall.ExitCode). See $installLog"
      Write-InstallLog "WARNING: Failed to add firewall rule for port $Port."
    }
  } catch {
    Write-Warning "Failed to add firewall rule for port $Port. $($_.Exception.Message)"
    Write-InstallLog "WARNING: Failed to add firewall rule for port $Port. $($_.Exception.Message)"
  }
}

if ($StartService) {
  try {
    Write-InstallLog "Starting service '$ServiceName'."
    Start-Service -Name $ServiceName -ErrorAction Stop
    Write-InstallLog "Service start requested successfully."
    if (-not (Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds 30)) {
      throw "Service did not reach Running status within 30 seconds."
    }
    if (-not (Wait-HttpHealth -Port $Port -TimeoutSeconds 45)) {
      throw "Service is running, but http://127.0.0.1:$Port/api/health did not respond within 45 seconds. Check service-wrapper.err.log and server.err.log in $logDirFull."
    }
  } catch {
    Write-InstallLog "ERROR: Service was installed but could not be started or did not pass health check. $($_.Exception.Message)"
    throw "Service was installed but could not be started or did not pass health check. $($_.Exception.Message). See $installLog"
  }
}

Write-InstallLog "Service installed: $ServiceName"
Write-Host "Service installed: $ServiceName"
