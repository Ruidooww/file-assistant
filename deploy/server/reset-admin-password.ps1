[CmdletBinding()]
param(
  [string]$Username = "",
  [string]$BaseDir = "",
  [switch]$PasswordFromStdin
)

$ErrorActionPreference = "Stop"

function Resolve-FileAssistantPath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Value))
}

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)][securestring]$SecureValue)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $PasswordFromStdin -and -not (Test-IsAdministrator)) {
  $arguments = @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$PSCommandPath`""
  )
  if (-not [string]::IsNullOrWhiteSpace($Username)) {
    $arguments += "-Username"
    $arguments += "`"$Username`""
  }
  if (-not [string]::IsNullOrWhiteSpace($BaseDir)) {
    $arguments += "-BaseDir"
    $arguments += "`"$BaseDir`""
  }
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments | Out-Null
  exit 0
}

if ([string]::IsNullOrWhiteSpace($BaseDir)) {
  $BaseDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
} else {
  $BaseDir = [System.IO.Path]::GetFullPath($BaseDir)
}

$configPath = Join-Path $BaseDir "deploy\server\config.ps1"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Server config was not found: $configPath"
}

. $configPath
if (-not $FileAssistantConfig) {
  throw "Server config did not define `$FileAssistantConfig: $configPath"
}

$dataDir = Resolve-FileAssistantPath -BasePath $BaseDir -Value ([string]$FileAssistantConfig.DataDir)
$logDir = Resolve-FileAssistantPath -BasePath $BaseDir -Value ([string]$FileAssistantConfig.LogDir)
$serviceName = [string]$FileAssistantConfig.ServiceName
if ([string]::IsNullOrWhiteSpace($serviceName)) {
  $serviceName = "FileAssistantServer"
}
$nodePath = [string]$FileAssistantConfig.NodePath
if ([string]::IsNullOrWhiteSpace($nodePath)) {
  $nodePath = "node.exe"
} elseif ($nodePath -in @("node", "node.exe")) {
  $nodePath = "node.exe"
} elseif (-not [System.IO.Path]::IsPathRooted($nodePath)) {
  $nodePath = Resolve-FileAssistantPath -BasePath $BaseDir -Value $nodePath
}

if (-not (Get-Command $nodePath -ErrorAction SilentlyContinue)) {
  throw "Node runtime was not found: $nodePath"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$resetLog = Join-Path $logDir "reset-admin-password.log"

function Write-ResetLog {
  param([string]$Message)
  Add-Content -LiteralPath $resetLog -Encoding UTF8 -Value "[$([DateTimeOffset]::Now.ToString('O'))] $Message"
}

Write-Host "File Assistant Server administrator password reset"
Write-Host "BaseDir : $BaseDir"
Write-Host "DataDir : $dataDir"
Write-Host "Service : $serviceName"
Write-Host ""

$listScript = @'
const path = require("node:path");
const { createDefaultStore } = require(path.join(process.env.FA_BASE_DIR, "apps", "server", "db.js"));
const store = createDefaultStore(process.env.FA_DATA_DIR);
try {
  const data = store.snapshot();
  for (const user of data.adminUsers) {
    console.log(`${user.username}\t${user.displayName || ""}\t${user.role || ""}\t${user.status || ""}`);
  }
} finally {
  store.close();
}
'@

$listScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("fileassistant-list-admins-{0}.js" -f ([Guid]::NewGuid().ToString("N")))
Set-Content -LiteralPath $listScriptPath -Encoding UTF8 -Value $listScript
try {
  $env:FA_BASE_DIR = $BaseDir
  $env:FA_DATA_DIR = $dataDir
  $admins = & $nodePath $listScriptPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to list administrator accounts. See $resetLog"
  }
} finally {
  Remove-Item -LiteralPath $listScriptPath -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\FA_BASE_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\FA_DATA_DIR -ErrorAction SilentlyContinue
}

if (-not $admins) {
  throw "No administrator account exists yet. Open the web admin console and create the first administrator."
}

Write-Host "Existing administrator accounts:"
foreach ($line in $admins) {
  $parts = $line -split "`t"
  Write-Host ("  - {0}  ({1}, {2}, {3})" -f $parts[0], $parts[1], $parts[2], $parts[3])
}
Write-Host ""

if ([string]::IsNullOrWhiteSpace($Username)) {
  $Username = Read-Host "Username to reset"
}
$Username = $Username.Trim()
if ([string]::IsNullOrWhiteSpace($Username)) {
  throw "Username is required."
}

if ($PasswordFromStdin) {
  $newPassword = [Console]::In.ReadLine()
  $confirmPassword = [Console]::In.ReadLine()
  if ($null -eq $newPassword -or $null -eq $confirmPassword) {
    throw "PasswordFromStdin requires two input lines: new password and confirmation."
  }
} else {
  $newPasswordSecure = Read-Host "New password" -AsSecureString
  $confirmPasswordSecure = Read-Host "Confirm new password" -AsSecureString
  $newPassword = Convert-SecureStringToPlainText -SecureValue $newPasswordSecure
  $confirmPassword = Convert-SecureStringToPlainText -SecureValue $confirmPasswordSecure
}

try {
  if ($newPassword.Length -lt 8) {
    throw "New password must be at least 8 characters."
  }
  if ($newPassword -ne $confirmPassword) {
    throw "Passwords do not match."
  }

  $serviceWasRunning = $false
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($service -and $service.Status -eq "Running") {
    Write-Host "Stopping service '$serviceName' before resetting the password..."
    Write-ResetLog "Stopping service '$serviceName' before password reset."
    $serviceWasRunning = $true
    Stop-Service -Name $serviceName -Force -ErrorAction Stop
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(45))
  }

  $resetScript = @'
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { createDefaultStore } = require(path.join(process.env.FA_BASE_DIR, "apps", "server", "db.js"));

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function createPasswordHash(password, salt = randomSecret(18)) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("base64url");
  return { salt, hash };
}

function appendLog(data, actorType, actorId, action, details = {}) {
  data.logs.unshift({
    id: createId("log"),
    at: nowIso(),
    actorType,
    actorId,
    action,
    details,
  });
  data.logs = data.logs.slice(0, 1000);
}

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw);
}

(async () => {
  const input = await readStdin();
  const username = String(input.username || "").trim();
  const password = String(input.password || "");
  if (!username) throw new Error("Username is required.");
  if (password.length < 8) throw new Error("New password must be at least 8 characters.");

  const store = createDefaultStore(process.env.FA_DATA_DIR);
  try {
    let resetUser = null;
    await store.mutate((data) => {
      const user = data.adminUsers.find((item) => String(item.username || "").toLowerCase() === username.toLowerCase());
      if (!user) throw new Error(`Administrator account was not found: ${username}`);
      const { salt, hash } = createPasswordHash(password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      user.updatedAt = nowIso();
      data.adminSessions = data.adminSessions.filter((session) => session.userId !== user.id);
      appendLog(data, "system", "local-reset", "admin_user.password_reset", {
        adminUserId: user.id,
        username: user.username,
        resetBy: process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME || ""}` : (process.env.USERNAME || "local"),
        sessionInvalidated: true,
      });
      resetUser = { id: user.id, username: user.username };
    });
    console.log(JSON.stringify({ ok: true, user: resetUser }));
  } finally {
    store.close();
  }
})().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
'@

  $resetScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("fileassistant-reset-admin-{0}.js" -f ([Guid]::NewGuid().ToString("N")))
  Set-Content -LiteralPath $resetScriptPath -Encoding UTF8 -Value $resetScript
  try {
    $env:FA_BASE_DIR = $BaseDir
    $env:FA_DATA_DIR = $dataDir
    $payload = @{ username = $Username; password = $newPassword } | ConvertTo-Json -Compress
    $output = $payload | & $nodePath $resetScriptPath 2>&1
    if ($LASTEXITCODE -ne 0) {
      $message = ($output | Out-String).Trim()
      Write-ResetLog "ERROR: Password reset failed for '$Username'. $message"
      throw "Password reset failed. $message"
    }
  } finally {
    Remove-Item -LiteralPath $resetScriptPath -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\FA_BASE_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\FA_DATA_DIR -ErrorAction SilentlyContinue
  }

  Write-ResetLog "Password reset succeeded for '$Username'. Old admin sessions were invalidated."
  Write-Host ""
  Write-Host "Password reset succeeded for '$Username'."
  Write-Host "Old login sessions for this administrator have been invalidated."
  Write-Host "Audit log was written to the File Assistant database."
  Write-Host "Script log: $resetLog"
} finally {
  if ($serviceWasRunning) {
    try {
      Write-Host "Starting service '$serviceName'..."
      Start-Service -Name $serviceName -ErrorAction Stop
      Write-ResetLog "Service '$serviceName' restarted after password reset."
    } catch {
      Write-Warning "Password reset finished, but service '$serviceName' could not be restarted. $($_.Exception.Message)"
      Write-ResetLog "WARNING: Service '$serviceName' could not be restarted. $($_.Exception.Message)"
    }
  }
  if ($null -ne $newPassword) {
    $newPassword = $null
  }
  if ($null -ne $confirmPassword) {
    $confirmPassword = $null
  }
}
