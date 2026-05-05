[CmdletBinding()]
param(
  [string]$ServiceName = "FileAssistantServer",
  [int]$Port = 5177,
  [switch]$RemoveFirewallRule
)

$ErrorActionPreference = "Stop"

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

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  & sc.exe delete $ServiceName | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Wait-ServiceDeleted -Name $ServiceName -TimeoutSeconds 30 | Out-Null
  }
}

if ($RemoveFirewallRule) {
  $ruleName = "File Assistant Server $Port"
  & netsh.exe advfirewall firewall delete rule name="$ruleName" | Out-Null
}

Write-Host "Service removed: $ServiceName"
