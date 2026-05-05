[CmdletBinding()]
param(
  [string]$NodeExePath = "C:\Program Files\nodejs\node.exe",
  [string]$InnoCompilerPath = "",
  [string]$Configuration = "Release"
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

$nodeExe = [Environment]::ExpandEnvironmentVariables($NodeExePath)
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node runtime was not found: $nodeExe"
}

$iscc = Resolve-InnoCompiler -ConfiguredPath $InnoCompilerPath
$serviceProject = Join-Path $root "tools\server-service\FileAssistantServerService.csproj"
$trayProject = Join-Path $root "tools\server-tray\FileAssistantServerTray.csproj"
$serviceOut = Join-Path $root "build\server-service"
$trayOut = Join-Path $root "build\server-tray"
$script = Join-Path $root "installer\server-inno\FileAssistantServer.iss"
$outputDir = Join-Path $root "deploy\server-installer"

Remove-Item -LiteralPath $serviceOut -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $trayOut -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $serviceOut, $trayOut, $outputDir | Out-Null
Get-ChildItem -LiteralPath $outputDir -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne "README.md" } |
  Remove-Item -Force

Write-Host "Publishing service wrapper..."
dotnet publish $serviceProject -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o $serviceOut

Write-Host "Publishing tray assistant..."
dotnet publish $trayProject -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o $trayOut

Write-Host "Compiling Inno Setup installer..."
& $iscc `
  "/DSourceRoot=$root" `
  "/DServiceBuildDir=$serviceOut" `
  "/DTrayBuildDir=$trayOut" `
  "/DNodeExePath=$nodeExe" `
  $script
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup compiler failed with exit code $LASTEXITCODE"
}

$setupExe = Join-Path $outputDir "FileAssistantServerSetup.exe"
if (-not (Test-Path -LiteralPath $setupExe)) {
  throw "Installer was not produced: $setupExe"
}

Write-Host "Installer ready: $setupExe"
