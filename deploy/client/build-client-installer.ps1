[CmdletBinding()]
param(
  [string]$InnoCompilerPath = "",
  [string]$Configuration = "Release",
  [string]$RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build-inno-client-installer.ps1") `
  -InnoCompilerPath $InnoCompilerPath `
  -Configuration $Configuration `
  -RuntimeIdentifier $RuntimeIdentifier
