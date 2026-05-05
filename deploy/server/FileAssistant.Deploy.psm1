Set-StrictMode -Version 2.0

function Get-FileAssistantProjectRoot {
  $root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
  return $root.ProviderPath
}

function New-FileAssistantDefaultConfig {
  return @{
    Port = 5177
    AdminUsername = "admin"
    AdminPassword = "admin123456"
    AdminToken = "admin-change-me"
    InitialAdminSetup = $false
    DataDir = "data"
    BackupDir = "backups"
    LogDir = "deploy\logs"
    NodePath = ""
    ServiceName = "FileAssistantServer"
    PublicServerUrl = "http://SERVER-IP:5177"
    ChunkSizeBytes = 2097152
  }
}

function Import-FileAssistantConfig {
  $config = New-FileAssistantDefaultConfig
  $configPath = Join-Path $PSScriptRoot "config.ps1"

  if (Test-Path -LiteralPath $configPath) {
    $FileAssistantConfig = $null
    . $configPath
    if (-not ($FileAssistantConfig -is [hashtable])) {
      throw "config.ps1 must define `$FileAssistantConfig as a hashtable."
    }
    foreach ($key in $FileAssistantConfig.Keys) {
      $config[$key] = $FileAssistantConfig[$key]
    }
  }

  return [pscustomobject]@{
    Config = $config
    ConfigPath = $configPath
    HasConfigFile = (Test-Path -LiteralPath $configPath)
  }
}

function Resolve-FileAssistantConfigPath {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [AllowNull()][object]$Value,
    [AllowNull()][string]$Fallback
  )

  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) {
    $raw = $Fallback
  }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }
  if ([System.IO.Path]::IsPathRooted($raw)) {
    return [System.IO.Path]::GetFullPath($raw)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $raw))
}

function Resolve-FileAssistantNodePath {
  param(
    [AllowNull()][object]$ConfiguredNodePath
  )

  $raw = [string]$ConfiguredNodePath
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $expanded = [Environment]::ExpandEnvironmentVariables($raw)
    if (-not [System.IO.Path]::IsPathRooted($expanded)) {
      $expanded = Join-Path (Get-FileAssistantProjectRoot) $expanded
    }
    if (Test-Path -LiteralPath $expanded) {
      return (Resolve-Path -LiteralPath $expanded).ProviderPath
    }
    throw "Configured NodePath does not exist: $expanded"
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
  if (-not $node) {
    throw "Node.js was not found. Install Node.js 24 or set NodePath in deploy\server\config.ps1."
  }
  return $node.Source
}

function Get-FileAssistantDeploymentContext {
  $projectRoot = Get-FileAssistantProjectRoot
  $loaded = Import-FileAssistantConfig
  $config = $loaded.Config

  $dataDir = Resolve-FileAssistantConfigPath -ProjectRoot $projectRoot -Value $config.DataDir -Fallback "data"
  $backupDir = Resolve-FileAssistantConfigPath -ProjectRoot $projectRoot -Value $config.BackupDir -Fallback "backups"
  $logDir = Resolve-FileAssistantConfigPath -ProjectRoot $projectRoot -Value $config.LogDir -Fallback "deploy\logs"
  $runDir = Resolve-FileAssistantConfigPath -ProjectRoot $projectRoot -Value $config.RunDir -Fallback "deploy\run"
  $nodePath = Resolve-FileAssistantNodePath -ConfiguredNodePath $config.NodePath
  $serverScript = Join-Path $projectRoot "apps\server\server.js"

  return [pscustomobject]@{
    ProjectRoot = $projectRoot
    Config = $config
    ConfigPath = $loaded.ConfigPath
    HasConfigFile = $loaded.HasConfigFile
    DataDir = $dataDir
    BackupDir = $backupDir
    LogDir = $logDir
    RunDir = $runDir
    PidFile = (Join-Path $runDir "server.pid")
    NodePath = $nodePath
    ServerScript = $serverScript
  }
}

function Set-FileAssistantServerEnvironment {
  param(
    [Parameter(Mandatory = $true)]$Context
  )

  $initialAdminSetup = $false
  if ($Context.Config.InitialAdminSetup -is [bool]) {
    $initialAdminSetup = $Context.Config.InitialAdminSetup
  } else {
    $initialAdminSetup = ([string]$Context.Config.InitialAdminSetup) -match '^(1|true|yes|on)$'
  }

  $env:PORT = [string]$Context.Config.Port
  $env:ADMIN_USERNAME = [string]$Context.Config.AdminUsername
  $env:ADMIN_PASSWORD = [string]$Context.Config.AdminPassword
  $env:ADMIN_TOKEN = [string]$Context.Config.AdminToken
  $env:FILE_ASSISTANT_INITIAL_ADMIN_SETUP = if ($initialAdminSetup) { "1" } else { "0" }
  $env:DATA_DIR = [string]$Context.DataDir
  $env:FILE_ASSISTANT_DATA_DIR = [string]$Context.DataDir
  $env:FILE_ASSISTANT_ROOT_DIR = [string]$Context.ProjectRoot
  if ($Context.Config.ChunkSizeBytes) {
    $env:CHUNK_SIZE_BYTES = [string]$Context.Config.ChunkSizeBytes
  }
}

function Test-FileAssistantProcess {
  param(
    [Parameter(Mandatory = $true)][string]$PidFile
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    return $null
  }
  $rawPid = (Get-Content -Raw -LiteralPath $PidFile).Trim()
  if (-not ($rawPid -match '^\d+$')) {
    Remove-Item -LiteralPath $PidFile -Force
    return $null
  }
  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath $PidFile -Force
    return $null
  }
  return $process
}

Export-ModuleMember -Function `
  Get-FileAssistantDeploymentContext, `
  Set-FileAssistantServerEnvironment, `
  Test-FileAssistantProcess
