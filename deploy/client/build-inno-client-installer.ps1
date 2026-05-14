[CmdletBinding()]
param(
  [string]$InnoCompilerPath = "",
  [string]$Configuration = "Release",
  [string]$RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).ProviderPath

function Resolve-InnoCompiler {
  param([string]$ConfiguredPath)
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    if (-not (Test-Path -LiteralPath $ConfiguredPath)) {
      throw "Inno Setup compiler was not found: $ConfiguredPath"
    }
    return (Resolve-Path -LiteralPath $ConfiguredPath).ProviderPath
  }

  $cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).ProviderPath
    }
  }

  throw "Inno Setup compiler ISCC.exe was not found."
}

$iscc = Resolve-InnoCompiler -ConfiguredPath $InnoCompilerPath
$clientProject = Join-Path $root "apps\windows-dotnet-client\FileAssistant.WinClient.csproj"
$clientOut = Join-Path $root "build\client-$RuntimeIdentifier"
$script = Join-Path $root "installer\client-inno\FileAssistantClient.iss"
$outputDir = Join-Path $root "deploy\client-installer"

Remove-Item -LiteralPath $clientOut -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $clientOut, $outputDir | Out-Null
Get-ChildItem -LiteralPath $outputDir -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne "README.md" } |
  Remove-Item -Force

Write-Host "Publishing Windows client..."
dotnet publish $clientProject `
  -c $Configuration `
  -r $RuntimeIdentifier `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -o $clientOut

Write-Host "Compiling Inno Setup client installer..."
& $iscc `
  "/DSourceRoot=$root" `
  "/DClientBuildDir=$clientOut" `
  $script
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup compiler failed with exit code $LASTEXITCODE"
}

$setupExe = Join-Path $outputDir "FileAssistantClientSetup.exe"
if (-not (Test-Path -LiteralPath $setupExe)) {
  throw "Installer was not produced: $setupExe"
}

Write-Host "Client installer ready: $setupExe"
