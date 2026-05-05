param(
  [string]$ServerUrl = "http://服务器IP:5177",
  [string]$DeployToken = "FA-XXXX-XXXX-XXXX-XXXX",
  [string]$ReceiveDir = ""
)

$ErrorActionPreference = "Stop"
$clientExe = Join-Path $PSScriptRoot "win-x64\FileAssistantClient.exe"
if (-not (Test-Path -LiteralPath $clientExe)) {
  $clientExe = Join-Path $PSScriptRoot "win-x64-self-contained\FileAssistantClient.exe"
}
if (-not (Test-Path -LiteralPath $clientExe)) {
  throw "FileAssistantClient.exe was not found in deploy\client."
}

$arguments = @("--server", $ServerUrl, "--deploy-token", $DeployToken, "--auto-register")
if (-not [string]::IsNullOrWhiteSpace($ReceiveDir)) {
  $arguments += @("--receive-dir", $ReceiveDir)
}

& $clientExe @arguments
