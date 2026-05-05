[CmdletBinding()]
param(
  [string]$NodeExePath = "C:\Program Files\nodejs\node.exe",
  [string]$InnoCompilerPath = "",
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build-inno-server-installer.ps1") `
  -NodeExePath $NodeExePath `
  -InnoCompilerPath $InnoCompilerPath `
  -Configuration $Configuration
