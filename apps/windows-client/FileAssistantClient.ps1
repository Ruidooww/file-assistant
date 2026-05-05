param(
  [switch]$HeadlessCheck
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
} catch {
}

$script:AppName = "File Assistant Windows Client"
$script:ConfigDir = Join-Path $env:APPDATA "FileAssistant"
$script:ConfigPath = Join-Path $script:ConfigDir "client.json"
$script:HttpClient = New-Object System.Net.Http.HttpClient
$script:HttpClient.Timeout = [TimeSpan]::FromMinutes(60)
$script:Config = $null
$script:Me = $null
$script:Recipients = @()
$script:Transfers = @()

function Get-PrimaryMacAddress {
  try {
    $adapters = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" -ErrorAction Stop
    foreach ($adapter in $adapters) {
      if (-not [string]::IsNullOrWhiteSpace($adapter.MACAddress)) {
        return [string]$adapter.MACAddress
      }
    }
  } catch {
  }
  return ""
}

function Get-PrimaryIpAddress {
  try {
    $adapters = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" -ErrorAction Stop
    foreach ($adapter in $adapters) {
      foreach ($ip in @($adapter.IPAddress)) {
        if ($ip -match "^\d{1,3}(\.\d{1,3}){3}$" -and -not $ip.StartsWith("127.") -and -not $ip.StartsWith("169.254.")) {
          return [string]$ip
        }
      }
    }
  } catch {
  }
  return ""
}

function Get-PlatformText {
  try {
    $os = Get-WmiObject Win32_OperatingSystem -ErrorAction Stop
    return ("{0} {1} {2}" -f $os.Caption, $os.Version, $os.OSArchitecture).Trim()
  } catch {
    return ("Windows {0}" -f [Environment]::OSVersion.VersionString)
  }
}

function Get-DefaultReceiveDir {
  $downloads = Join-Path $env:USERPROFILE "Downloads"
  if (Test-Path -LiteralPath $downloads) {
    return (Join-Path $downloads "FileAssistant")
  }
  return (Join-Path $env:USERPROFILE "FileAssistantReceived")
}

function New-DefaultConfig {
  return [ordered]@{
    serverUrl = "http://localhost:5177"
    clientId = ""
    clientSecret = ""
    macAddress = Get-PrimaryMacAddress
    ipAddress = Get-PrimaryIpAddress
    displayName = ("{0}\{1}" -f $env:COMPUTERNAME, $env:USERNAME)
    receiveDir = Get-DefaultReceiveDir
  }
}

function Read-Config {
  $config = New-DefaultConfig
  if (Test-Path -LiteralPath $script:ConfigPath) {
    try {
      $saved = Get-Content -LiteralPath $script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($key in @("serverUrl", "clientId", "clientSecret", "macAddress", "ipAddress", "displayName", "receiveDir")) {
        $property = $saved.PSObject.Properties[$key]
        if ($property -and $null -ne $property.Value) {
          $config[$key] = [string]$property.Value
        }
      }
    } catch {
    }
  }
  return $config
}

function Save-Config {
  if (-not (Test-Path -LiteralPath $script:ConfigDir)) {
    New-Item -ItemType Directory -Path $script:ConfigDir -Force | Out-Null
  }
  $script:Config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
}

function Normalize-BaseUrl {
  param([string]$BaseUrl)
  $value = ($BaseUrl -as [string]).Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    return "http://localhost:5177"
  }
  return $value.TrimEnd("/")
}

function Join-FaUrl {
  param(
    [string]$BaseUrl,
    [string]$Path
  )
  $base = (Normalize-BaseUrl $BaseUrl)
  $relative = $Path.TrimStart("/")
  return "$base/$relative"
}

function Get-Prop {
  param(
    [object]$Object,
    [string]$Name,
    [object]$DefaultValue = $null
  )
  if ($null -eq $Object) {
    return $DefaultValue
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) {
    return $property.Value
  }
  return $DefaultValue
}

function Get-ClientHeaders {
  return @{
    "X-Client-Id" = [string]$script:Config["clientId"]
    "X-Client-Secret" = [string]$script:Config["clientSecret"]
    "X-Device-Mac" = [string]$script:Config["macAddress"]
    "X-Device-Ip" = [string]$script:Config["ipAddress"]
  }
}

function Get-ResponseError {
  param([System.Net.Http.HttpResponseMessage]$Response)
  $text = ""
  try {
    $text = $Response.Content.ReadAsStringAsync().Result
  } catch {
  }
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    try {
      $body = $text | ConvertFrom-Json
      $errorValue = Get-Prop $body "error" ""
      if (-not [string]::IsNullOrWhiteSpace($errorValue)) {
        return [string]$errorValue
      }
    } catch {
    }
  }
  return ("HTTP {0} {1}" -f ([int]$Response.StatusCode), $Response.ReasonPhrase)
}

function Add-RequestHeaders {
  param(
    [System.Net.Http.HttpRequestMessage]$Request,
    [hashtable]$Headers
  )
  foreach ($key in $Headers.Keys) {
    [void]$Request.Headers.TryAddWithoutValidation($key, [string]$Headers[$key])
  }
}

function Invoke-FaJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )
  $uri = Join-FaUrl $script:Config["serverUrl"] $Path
  $httpMethod = New-Object System.Net.Http.HttpMethod -ArgumentList $Method
  $request = New-Object System.Net.Http.HttpRequestMessage -ArgumentList $httpMethod, $uri
  Add-RequestHeaders $request $Headers
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 12 -Compress
    $request.Content = New-Object System.Net.Http.StringContent -ArgumentList @($json, [System.Text.Encoding]::UTF8, "application/json")
  }
  $response = $null
  try {
    $response = $script:HttpClient.SendAsync($request).Result
    if (-not $response.IsSuccessStatusCode) {
      throw (Get-ResponseError $response)
    }
    $text = $response.Content.ReadAsStringAsync().Result
    if ([string]::IsNullOrWhiteSpace($text)) {
      return $null
    }
    return ($text | ConvertFrom-Json)
  } finally {
    if ($response) {
      $response.Dispose()
    }
    $request.Dispose()
  }
}

function Invoke-FaBinaryJson {
  param(
    [string]$Method,
    [string]$Path,
    [byte[]]$Bytes,
    [hashtable]$Headers = @{}
  )
  $uri = Join-FaUrl $script:Config["serverUrl"] $Path
  $httpMethod = New-Object System.Net.Http.HttpMethod -ArgumentList $Method
  $request = New-Object System.Net.Http.HttpRequestMessage -ArgumentList $httpMethod, $uri
  Add-RequestHeaders $request $Headers
  $content = New-Object System.Net.Http.ByteArrayContent -ArgumentList (, $Bytes)
  $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue -ArgumentList "application/octet-stream"
  $request.Content = $content
  $response = $null
  try {
    $response = $script:HttpClient.SendAsync($request).Result
    if (-not $response.IsSuccessStatusCode) {
      throw (Get-ResponseError $response)
    }
    $text = $response.Content.ReadAsStringAsync().Result
    if ([string]::IsNullOrWhiteSpace($text)) {
      return $null
    }
    return ($text | ConvertFrom-Json)
  } finally {
    if ($response) {
      $response.Dispose()
    }
    $request.Dispose()
  }
}

function Invoke-FaDownload {
  param(
    [string]$Path,
    [string]$Destination,
    [hashtable]$Headers = @{}
  )
  $uri = Join-FaUrl $script:Config["serverUrl"] $Path
  $httpMethod = New-Object System.Net.Http.HttpMethod -ArgumentList "GET"
  $request = New-Object System.Net.Http.HttpRequestMessage -ArgumentList $httpMethod, $uri
  Add-RequestHeaders $request $Headers
  $response = $null
  $inputStream = $null
  $outputStream = $null
  try {
    $response = $script:HttpClient.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
    if (-not $response.IsSuccessStatusCode) {
      throw (Get-ResponseError $response)
    }
    $inputStream = $response.Content.ReadAsStreamAsync().Result
    $outputStream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $inputStream.CopyTo($outputStream)
  } finally {
    if ($outputStream) {
      $outputStream.Dispose()
    }
    if ($inputStream) {
      $inputStream.Dispose()
    }
    if ($response) {
      $response.Dispose()
    }
    $request.Dispose()
  }
}

function Format-Bytes {
  param([int64]$Bytes)
  if ($Bytes -ge 1073741824) {
    return ("{0:N2} GB" -f ($Bytes / 1073741824))
  }
  if ($Bytes -ge 1048576) {
    return ("{0:N2} MB" -f ($Bytes / 1048576))
  }
  if ($Bytes -ge 1024) {
    return ("{0:N1} KB" -f ($Bytes / 1024))
  }
  return ("{0} B" -f $Bytes)
}

function Get-SafeFileName {
  param([string]$Name)
  $value = [string]$Name
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = "received-file"
  }
  $invalid = [Regex]::Escape((-join [System.IO.Path]::GetInvalidFileNameChars()))
  $safe = [Regex]::Replace($value, "[$invalid]", "_")
  if ([string]::IsNullOrWhiteSpace($safe)) {
    return "received-file"
  }
  return $safe
}

function Get-UniquePath {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $Path
  }
  $directory = [System.IO.Path]::GetDirectoryName($Path)
  $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
  $extension = [System.IO.Path]::GetExtension($Path)
  for ($index = 1; $index -lt 10000; $index += 1) {
    $candidate = Join-Path $directory ("{0} ({1}){2}" -f $name, $index, $extension)
    if (-not (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  throw "Unable to generate a unique save path"
}

function Test-HasCredential {
  return (
    -not [string]::IsNullOrWhiteSpace([string]$script:Config["clientId"]) -and
    -not [string]::IsNullOrWhiteSpace([string]$script:Config["clientSecret"])
  )
}

$script:Config = Read-Config

if ($HeadlessCheck) {
  Write-Host "File Assistant Windows client script loaded."
  Write-Host ("Config path: {0}" -f $script:ConfigPath)
  Write-Host ("Default server: {0}" -f $script:Config["serverUrl"])
  return
}

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$form = New-Object System.Windows.Forms.Form
$form.Text = "File Assistant Windows Validation Client"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(1040, 760)
$form.MinimumSize = New-Object System.Drawing.Size(980, 700)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$connectionGroup = New-Object System.Windows.Forms.GroupBox
$connectionGroup.Text = "Connection and Registration"
$connectionGroup.Location = New-Object System.Drawing.Point(12, 10)
$connectionGroup.Size = New-Object System.Drawing.Size(998, 150)
$form.Controls.Add($connectionGroup)

$lblServer = New-Object System.Windows.Forms.Label
$lblServer.Text = "Server URL"
$lblServer.Location = New-Object System.Drawing.Point(16, 31)
$lblServer.Size = New-Object System.Drawing.Size(78, 22)
$connectionGroup.Controls.Add($lblServer)

$txtServer = New-Object System.Windows.Forms.TextBox
$txtServer.Location = New-Object System.Drawing.Point(100, 28)
$txtServer.Size = New-Object System.Drawing.Size(260, 24)
$txtServer.Text = [string]$script:Config["serverUrl"]
$connectionGroup.Controls.Add($txtServer)

$lblInstallCode = New-Object System.Windows.Forms.Label
$lblInstallCode.Text = "Install Code"
$lblInstallCode.Location = New-Object System.Drawing.Point(380, 31)
$lblInstallCode.Size = New-Object System.Drawing.Size(70, 22)
$connectionGroup.Controls.Add($lblInstallCode)

$txtInstallCode = New-Object System.Windows.Forms.TextBox
$txtInstallCode.Location = New-Object System.Drawing.Point(455, 28)
$txtInstallCode.Size = New-Object System.Drawing.Size(180, 24)
$connectionGroup.Controls.Add($txtInstallCode)

$lblDisplayName = New-Object System.Windows.Forms.Label
$lblDisplayName.Text = "Display Name"
$lblDisplayName.Location = New-Object System.Drawing.Point(650, 31)
$lblDisplayName.Size = New-Object System.Drawing.Size(75, 22)
$connectionGroup.Controls.Add($lblDisplayName)

$txtDisplayName = New-Object System.Windows.Forms.TextBox
$txtDisplayName.Location = New-Object System.Drawing.Point(730, 28)
$txtDisplayName.Size = New-Object System.Drawing.Size(240, 24)
$txtDisplayName.Text = [string]$script:Config["displayName"]
$connectionGroup.Controls.Add($txtDisplayName)

$lblMac = New-Object System.Windows.Forms.Label
$lblMac.Text = "MAC"
$lblMac.Location = New-Object System.Drawing.Point(16, 66)
$lblMac.Size = New-Object System.Drawing.Size(78, 22)
$connectionGroup.Controls.Add($lblMac)

$txtMac = New-Object System.Windows.Forms.TextBox
$txtMac.Location = New-Object System.Drawing.Point(100, 63)
$txtMac.Size = New-Object System.Drawing.Size(260, 24)
$txtMac.Text = [string]$script:Config["macAddress"]
$connectionGroup.Controls.Add($txtMac)

$lblIp = New-Object System.Windows.Forms.Label
$lblIp.Text = "IP"
$lblIp.Location = New-Object System.Drawing.Point(380, 66)
$lblIp.Size = New-Object System.Drawing.Size(70, 22)
$connectionGroup.Controls.Add($lblIp)

$txtIp = New-Object System.Windows.Forms.TextBox
$txtIp.Location = New-Object System.Drawing.Point(455, 63)
$txtIp.Size = New-Object System.Drawing.Size(180, 24)
$txtIp.Text = [string]$script:Config["ipAddress"]
$connectionGroup.Controls.Add($txtIp)

$btnRegister = New-Object System.Windows.Forms.Button
$btnRegister.Text = "Register"
$btnRegister.Location = New-Object System.Drawing.Point(650, 61)
$btnRegister.Size = New-Object System.Drawing.Size(100, 28)
$connectionGroup.Controls.Add($btnRegister)

$btnDetectDevice = New-Object System.Windows.Forms.Button
$btnDetectDevice.Text = "Detect"
$btnDetectDevice.Location = New-Object System.Drawing.Point(760, 61)
$btnDetectDevice.Size = New-Object System.Drawing.Size(96, 28)
$connectionGroup.Controls.Add($btnDetectDevice)

$btnSaveSettings = New-Object System.Windows.Forms.Button
$btnSaveSettings.Text = "Save/Test"
$btnSaveSettings.Location = New-Object System.Drawing.Point(866, 61)
$btnSaveSettings.Size = New-Object System.Drawing.Size(104, 28)
$connectionGroup.Controls.Add($btnSaveSettings)

$lblMe = New-Object System.Windows.Forms.Label
$lblMe.Text = "Not connected. After registration, bind this client to an employee in the admin console."
$lblMe.Location = New-Object System.Drawing.Point(16, 108)
$lblMe.Size = New-Object System.Drawing.Size(954, 24)
$connectionGroup.Controls.Add($lblMe)

$uploadGroup = New-Object System.Windows.Forms.GroupBox
$uploadGroup.Text = "Send File"
$uploadGroup.Location = New-Object System.Drawing.Point(12, 170)
$uploadGroup.Size = New-Object System.Drawing.Size(998, 170)
$form.Controls.Add($uploadGroup)

$lblReceiver = New-Object System.Windows.Forms.Label
$lblReceiver.Text = "Recipient"
$lblReceiver.Location = New-Object System.Drawing.Point(16, 31)
$lblReceiver.Size = New-Object System.Drawing.Size(78, 22)
$uploadGroup.Controls.Add($lblReceiver)

$comboReceiver = New-Object System.Windows.Forms.ComboBox
$comboReceiver.DropDownStyle = "DropDownList"
$comboReceiver.DisplayMember = "Label"
$comboReceiver.Location = New-Object System.Drawing.Point(100, 28)
$comboReceiver.Size = New-Object System.Drawing.Size(360, 24)
$uploadGroup.Controls.Add($comboReceiver)

$chkBackup = New-Object System.Windows.Forms.CheckBox
$chkBackup.Text = "Important backup"
$chkBackup.Location = New-Object System.Drawing.Point(480, 29)
$chkBackup.Size = New-Object System.Drawing.Size(200, 22)
$uploadGroup.Controls.Add($chkBackup)

$chkAllowPreview = New-Object System.Windows.Forms.CheckBox
$chkAllowPreview.Text = "Allow preview"
$chkAllowPreview.Location = New-Object System.Drawing.Point(700, 29)
$chkAllowPreview.Size = New-Object System.Drawing.Size(130, 22)
$uploadGroup.Controls.Add($chkAllowPreview)

$lblFile = New-Object System.Windows.Forms.Label
$lblFile.Text = "Local File"
$lblFile.Location = New-Object System.Drawing.Point(16, 66)
$lblFile.Size = New-Object System.Drawing.Size(78, 22)
$uploadGroup.Controls.Add($lblFile)

$txtFile = New-Object System.Windows.Forms.TextBox
$txtFile.Location = New-Object System.Drawing.Point(100, 63)
$txtFile.Size = New-Object System.Drawing.Size(650, 24)
$uploadGroup.Controls.Add($txtFile)

$btnBrowseFile = New-Object System.Windows.Forms.Button
$btnBrowseFile.Text = "Browse"
$btnBrowseFile.Location = New-Object System.Drawing.Point(760, 61)
$btnBrowseFile.Size = New-Object System.Drawing.Size(72, 28)
$uploadGroup.Controls.Add($btnBrowseFile)

$btnUpload = New-Object System.Windows.Forms.Button
$btnUpload.Text = "Upload"
$btnUpload.Location = New-Object System.Drawing.Point(850, 61)
$btnUpload.Size = New-Object System.Drawing.Size(120, 28)
$uploadGroup.Controls.Add($btnUpload)

$lblNote = New-Object System.Windows.Forms.Label
$lblNote.Text = "Note"
$lblNote.Location = New-Object System.Drawing.Point(16, 101)
$lblNote.Size = New-Object System.Drawing.Size(78, 22)
$uploadGroup.Controls.Add($lblNote)

$txtUploadNote = New-Object System.Windows.Forms.TextBox
$txtUploadNote.Location = New-Object System.Drawing.Point(100, 98)
$txtUploadNote.Size = New-Object System.Drawing.Size(650, 24)
$uploadGroup.Controls.Add($txtUploadNote)

$progressUpload = New-Object System.Windows.Forms.ProgressBar
$progressUpload.Location = New-Object System.Drawing.Point(100, 132)
$progressUpload.Size = New-Object System.Drawing.Size(650, 20)
$progressUpload.Minimum = 0
$progressUpload.Maximum = 100
$uploadGroup.Controls.Add($progressUpload)

$lblProgress = New-Object System.Windows.Forms.Label
$lblProgress.Text = "Idle"
$lblProgress.Location = New-Object System.Drawing.Point(760, 131)
$lblProgress.Size = New-Object System.Drawing.Size(210, 24)
$uploadGroup.Controls.Add($lblProgress)

$receiveGroup = New-Object System.Windows.Forms.GroupBox
$receiveGroup.Text = "Receive and Status"
$receiveGroup.Location = New-Object System.Drawing.Point(12, 350)
$receiveGroup.Size = New-Object System.Drawing.Size(998, 355)
$form.Controls.Add($receiveGroup)

$lblReceiveDir = New-Object System.Windows.Forms.Label
$lblReceiveDir.Text = "Save Dir"
$lblReceiveDir.Location = New-Object System.Drawing.Point(16, 31)
$lblReceiveDir.Size = New-Object System.Drawing.Size(78, 22)
$receiveGroup.Controls.Add($lblReceiveDir)

$txtReceiveDir = New-Object System.Windows.Forms.TextBox
$txtReceiveDir.Location = New-Object System.Drawing.Point(100, 28)
$txtReceiveDir.Size = New-Object System.Drawing.Size(650, 24)
$txtReceiveDir.Text = [string]$script:Config["receiveDir"]
$receiveGroup.Controls.Add($txtReceiveDir)

$btnBrowseDir = New-Object System.Windows.Forms.Button
$btnBrowseDir.Text = "Browse"
$btnBrowseDir.Location = New-Object System.Drawing.Point(760, 26)
$btnBrowseDir.Size = New-Object System.Drawing.Size(72, 28)
$receiveGroup.Controls.Add($btnBrowseDir)

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = "Refresh"
$btnRefresh.Location = New-Object System.Drawing.Point(842, 26)
$btnRefresh.Size = New-Object System.Drawing.Size(60, 28)
$receiveGroup.Controls.Add($btnRefresh)

$btnReceive = New-Object System.Windows.Forms.Button
$btnReceive.Text = "Receive"
$btnReceive.Location = New-Object System.Drawing.Point(910, 26)
$btnReceive.Size = New-Object System.Drawing.Size(70, 28)
$receiveGroup.Controls.Add($btnReceive)

$listTransfers = New-Object System.Windows.Forms.ListView
$listTransfers.Location = New-Object System.Drawing.Point(16, 64)
$listTransfers.Size = New-Object System.Drawing.Size(964, 220)
$listTransfers.View = "Details"
$listTransfers.FullRowSelect = $true
$listTransfers.GridLines = $true
[void]$listTransfers.Columns.Add("Role", 80)
[void]$listTransfers.Columns.Add("File", 230)
[void]$listTransfers.Columns.Add("Peer", 170)
[void]$listTransfers.Columns.Add("Status", 110)
[void]$listTransfers.Columns.Add("Delivery", 100)
[void]$listTransfers.Columns.Add("Server File", 110)
[void]$listTransfers.Columns.Add("Size", 90)
[void]$listTransfers.Columns.Add("Backup", 70)
$receiveGroup.Controls.Add($listTransfers)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(16, 296)
$txtLog.Size = New-Object System.Drawing.Size(964, 42)
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$receiveGroup.Controls.Add($txtLog)

function Write-UiLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  if ([string]::IsNullOrWhiteSpace($txtLog.Text)) {
    $txtLog.Text = $line
  } else {
    $txtLog.AppendText([Environment]::NewLine + $line)
  }
}

function Set-ProgressText {
  param(
    [int]$Percent,
    [string]$Text
  )
  if ($Percent -lt 0) {
    $Percent = 0
  }
  if ($Percent -gt 100) {
    $Percent = 100
  }
  $progressUpload.Value = $Percent
  $lblProgress.Text = $Text
  [System.Windows.Forms.Application]::DoEvents()
}

function Show-Error {
  param([string]$Message)
  Write-UiLog ("Error: {0}" -f $Message)
  [System.Windows.Forms.MessageBox]::Show($Message, "Operation failed", "OK", "Error") | Out-Null
}

function Invoke-UiAction {
  param([scriptblock]$Action)
  try {
    & $Action
  } catch {
    Show-Error $_.Exception.Message
  }
}

function Sync-ConfigFromFields {
  $script:Config["serverUrl"] = Normalize-BaseUrl $txtServer.Text
  $script:Config["displayName"] = $txtDisplayName.Text.Trim()
  $script:Config["macAddress"] = $txtMac.Text.Trim()
  $script:Config["ipAddress"] = $txtIp.Text.Trim()
  $script:Config["receiveDir"] = $txtReceiveDir.Text.Trim()
  $txtServer.Text = [string]$script:Config["serverUrl"]
}

function Render-Me {
  if ($null -eq $script:Me) {
    if (Test-HasCredential) {
      $lblMe.Text = "Client credentials are saved. Connection has not been checked."
    } else {
      $lblMe.Text = "Not registered. Generate an install code in the admin console first."
    }
    return
  }
  $status = Get-Prop $script:Me "status" "-"
  $employeeId = Get-Prop $script:Me "employeeId" ""
  $employeeText = "No employee binding"
  if (-not [string]::IsNullOrWhiteSpace([string]$employeeId)) {
    $employeeText = "Employee ID: $employeeId"
  }
  $lblMe.Text = ("Client: {0} / {1} / {2} / MAC {3} / IP {4}" -f (Get-Prop $script:Me "displayName" ""), $status, $employeeText, (Get-Prop $script:Me "macAddress" ""), (Get-Prop $script:Me "ipAddress" ""))
}

function Render-Recipients {
  $comboReceiver.Items.Clear()
  foreach ($recipient in @($script:Recipients)) {
    $name = Get-Prop $recipient "name" ""
    $departmentName = Get-Prop $recipient "departmentName" ""
    $clientCount = Get-Prop $recipient "clientCount" 0
    if ([string]::IsNullOrWhiteSpace([string]$departmentName)) {
      $label = ("{0} ({1} device)" -f $name, $clientCount)
    } else {
      $label = ("{0} - {1} ({2} device)" -f $name, $departmentName, $clientCount)
    }
    $item = [pscustomobject]@{
      Label = $label
      Id = Get-Prop $recipient "id" ""
    }
    [void]$comboReceiver.Items.Add($item)
  }
  if ($comboReceiver.Items.Count -gt 0) {
    $comboReceiver.SelectedIndex = 0
  }
}

function Render-Transfers {
  $listTransfers.Items.Clear()
  $clientId = [string]$script:Config["clientId"]
  foreach ($transfer in @($script:Transfers)) {
    $senderId = Get-Prop $transfer "senderId" ""
    $receiverId = Get-Prop $transfer "receiverId" ""
    $role = "-"
    $peer = ""
    if ($senderId -eq $clientId) {
      $role = "Sent"
      $peer = Get-Prop $transfer "receiverEmployeeName" (Get-Prop $transfer "receiverName" "")
    } elseif ($receiverId -eq $clientId) {
      $role = "Inbox"
      $peer = Get-Prop $transfer "senderEmployeeName" (Get-Prop $transfer "senderName" "")
    }
    $fileName = Get-Prop $transfer "fileName" ""
    $status = Get-Prop $transfer "status" ""
    $deliveryStatus = Get-Prop $transfer "deliveryStatus" ""
    $serverFileStatus = Get-Prop $transfer "serverFileStatus" ""
    $sizeText = Format-Bytes ([int64](Get-Prop $transfer "size" 0))
    $backupText = "No"
    if ([bool](Get-Prop $transfer "retainOnServer" $false)) {
      $backupText = "Yes"
    }
    $item = New-Object System.Windows.Forms.ListViewItem($role)
    [void]$item.SubItems.Add($fileName)
    [void]$item.SubItems.Add($peer)
    [void]$item.SubItems.Add($status)
    [void]$item.SubItems.Add($deliveryStatus)
    [void]$item.SubItems.Add($serverFileStatus)
    [void]$item.SubItems.Add($sizeText)
    [void]$item.SubItems.Add($backupText)
    $item.Tag = $transfer
    [void]$listTransfers.Items.Add($item)
  }
}

function Refresh-FaData {
  Sync-ConfigFromFields
  if (-not (Test-HasCredential)) {
    Render-Me
    return
  }
  Save-Config
  $headers = Get-ClientHeaders
  $script:Me = Invoke-FaJson "GET" "/api/client/me" $null $headers
  $recipients = Invoke-FaJson "GET" "/api/client/recipients" $null $headers
  $transfers = Invoke-FaJson "GET" "/api/client/transfers" $null $headers
  $script:Recipients = @($recipients)
  $script:Transfers = @($transfers)
  Render-Me
  Render-Recipients
  Render-Transfers
  Write-UiLog "Refreshed client status, recipients, and transfers."
}

function Register-FaClient {
  Sync-ConfigFromFields
  if ([string]::IsNullOrWhiteSpace($txtInstallCode.Text)) {
    throw "Enter the install code"
  }
  if ([string]::IsNullOrWhiteSpace([string]$script:Config["displayName"])) {
    throw "Enter the display name"
  }
  $body = @{
    installCode = $txtInstallCode.Text.Trim()
    displayName = [string]$script:Config["displayName"]
    macAddress = [string]$script:Config["macAddress"]
    ipAddress = [string]$script:Config["ipAddress"]
    platform = Get-PlatformText
  }
  $result = Invoke-FaJson "POST" "/api/client/register" $body @{}
  $client = Get-Prop $result "client" $null
  if ($null -eq $client) {
    throw "Registration response does not include client information"
  }
  $script:Config["clientId"] = [string](Get-Prop $client "id" "")
  $script:Config["clientSecret"] = [string](Get-Prop $result "clientSecret" "")
  $script:Config["macAddress"] = [string](Get-Prop $client "macAddress" $script:Config["macAddress"])
  $script:Config["ipAddress"] = [string](Get-Prop $client "ipAddress" $script:Config["ipAddress"])
  $txtMac.Text = [string]$script:Config["macAddress"]
  $txtIp.Text = [string]$script:Config["ipAddress"]
  Save-Config
  Write-UiLog "Registration succeeded. Credentials saved. Bind this client to an employee in admin, then refresh."
  Refresh-FaData
}

function Save-And-TestSettings {
  Sync-ConfigFromFields
  Save-Config
  $health = Invoke-FaJson "GET" "/api/health" $null @{}
  $time = Get-Prop $health "at" ""
  Write-UiLog ("Server connection OK: {0}" -f $time)
  if (Test-HasCredential) {
    Refresh-FaData
  }
}

function Detect-Device {
  $txtMac.Text = Get-PrimaryMacAddress
  $txtIp.Text = Get-PrimaryIpAddress
  Sync-ConfigFromFields
  Save-Config
  Write-UiLog "Device MAC and IP were detected again."
}

function Browse-LocalFile {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Select file to send"
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  if ($dialog.ShowDialog($form) -eq "OK") {
    $txtFile.Text = $dialog.FileName
  }
  $dialog.Dispose()
}

function Browse-ReceiveDirectory {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Select the local receive directory"
  if (-not [string]::IsNullOrWhiteSpace($txtReceiveDir.Text) -and (Test-Path -LiteralPath $txtReceiveDir.Text)) {
    $dialog.SelectedPath = $txtReceiveDir.Text
  }
  if ($dialog.ShowDialog($form) -eq "OK") {
    $txtReceiveDir.Text = $dialog.SelectedPath
    Sync-ConfigFromFields
    Save-Config
  }
  $dialog.Dispose()
}

function Upload-SelectedFile {
  Sync-ConfigFromFields
  if (-not (Test-HasCredential)) {
    throw "Register the client first"
  }
  if ($comboReceiver.SelectedItem -eq $null) {
    throw "Select a recipient"
  }
  $filePath = $txtFile.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($filePath) -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
    throw "Select a valid local file"
  }
  $file = Get-Item -LiteralPath $filePath
  $receiverEmployeeId = [string]$comboReceiver.SelectedItem.Id
  $headers = Get-ClientHeaders
  $body = @{
    receiverEmployeeId = $receiverEmployeeId
    fileName = $file.Name
    mimeType = "application/octet-stream"
    size = [int64]$file.Length
    retainOnServer = [bool]$chkBackup.Checked
    uploadNote = $txtUploadNote.Text.Trim()
    controls = @{
      uploader = @{
        allowStatusView = $true
      }
      receiver = @{
        allowReceive = $true
        allowPreview = [bool]$chkAllowPreview.Checked
        allowScreenshot = $true
      }
    }
  }
  Set-ProgressText 0 "Initializing"
  $created = Invoke-FaJson "POST" "/api/client/transfers/init" $body $headers
  $transfer = Get-Prop $created "transfer" $null
  if ($null -eq $transfer) {
    throw "Server did not return a transfer task"
  }
  $transferId = [string](Get-Prop $transfer "id" "")
  $chunkSize = [int](Get-Prop $transfer "chunkSize" (Get-Prop $created "chunkSize" 1048576))
  $totalChunks = [int](Get-Prop $transfer "totalChunks" 1)
  $missingChunks = @((Get-Prop $created "missingChunks" @()))
  if ($chunkSize -le 0) {
    throw "Server returned an invalid chunk size"
  }

  $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    $position = 0
    foreach ($chunkIndexValue in $missingChunks) {
      $chunkIndex = [int]$chunkIndexValue
      $offset = [int64]$chunkIndex * [int64]$chunkSize
      [void]$stream.Seek($offset, [System.IO.SeekOrigin]::Begin)
      $bufferLength = $chunkSize
      $remaining = $file.Length - $offset
      if ($remaining -lt $bufferLength) {
        $bufferLength = [int][Math]::Max(0, $remaining)
      }
      $buffer = New-Object byte[] $bufferLength
      $read = 0
      while ($read -lt $bufferLength) {
        $count = $stream.Read($buffer, $read, $bufferLength - $read)
        if ($count -le 0) {
          break
        }
        $read += $count
      }
      if ($read -ne $bufferLength) {
        $actual = New-Object byte[] $read
        if ($read -gt 0) {
          [Array]::Copy($buffer, $actual, $read)
        }
        $buffer = $actual
      }
      $percent = [int][Math]::Round((($position + 1) / [Math]::Max(1, $missingChunks.Count)) * 100)
      Set-ProgressText $percent ("Uploading chunk {0}/{1}" -f ($chunkIndex + 1), $totalChunks)
      [void](Invoke-FaBinaryJson "PUT" ("/api/client/transfers/{0}/chunks/{1}" -f $transferId, $chunkIndex) $buffer $headers)
      $position += 1
    }
  } finally {
    $stream.Dispose()
  }
  Set-ProgressText 100 "Upload complete"
  Write-UiLog ("Upload complete: {0}" -f $file.Name)
  Refresh-FaData
}

function Receive-SelectedTransfer {
  Sync-ConfigFromFields
  if (-not (Test-HasCredential)) {
    throw "Register the client first"
  }
  if ($listTransfers.SelectedItems.Count -eq 0) {
    throw "Select one inbox transfer"
  }
  $transfer = $listTransfers.SelectedItems[0].Tag
  $clientId = [string]$script:Config["clientId"]
  if ([string](Get-Prop $transfer "receiverId" "") -ne $clientId) {
    throw "Only files sent to this client can be received"
  }
  $status = [string](Get-Prop $transfer "status" "")
  if ($status -ne "approved" -and $status -ne "ready_to_deliver") {
    throw "This file is not ready to receive"
  }
  if ([string](Get-Prop $transfer "serverFileStatus" "") -eq "purged") {
    throw "The server copy has been purged"
  }
  $receiveDir = [string]$script:Config["receiveDir"]
  if ([string]::IsNullOrWhiteSpace($receiveDir)) {
    $receiveDir = Get-DefaultReceiveDir
    $script:Config["receiveDir"] = $receiveDir
    $txtReceiveDir.Text = $receiveDir
  }
  if (-not (Test-Path -LiteralPath $receiveDir)) {
    New-Item -ItemType Directory -Path $receiveDir -Force | Out-Null
  }
  $fileName = Get-SafeFileName ([string](Get-Prop $transfer "fileName" "received-file"))
  $target = Get-UniquePath (Join-Path $receiveDir $fileName)
  $temp = "$target.fa-download"
  if (Test-Path -LiteralPath $temp) {
    Remove-Item -LiteralPath $temp -Force
  }
  $transferId = [string](Get-Prop $transfer "id" "")
  Write-UiLog ("Receiving: {0}" -f $fileName)
  Invoke-FaDownload ("/api/client/transfers/{0}/file?mode=receive" -f $transferId) $temp (Get-ClientHeaders)
  Move-Item -LiteralPath $temp -Destination $target -Force
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "File write failed. Delivery was not confirmed to the server"
  }
  $expectedSize = [int64](Get-Prop $transfer "size" -1)
  $actualSize = (Get-Item -LiteralPath $target).Length
  if ($expectedSize -ge 0 -and $actualSize -ne $expectedSize) {
    throw ("File size check failed. Expected {0}, actual {1}. Delivery was not confirmed to the server" -f $expectedSize, $actualSize)
  }
  [void](Invoke-FaJson "POST" ("/api/client/transfers/{0}/confirm-delivery" -f $transferId) @{ localPath = $target } (Get-ClientHeaders))
  Write-UiLog ("Receive complete and confirmed: {0}" -f $target)
  Refresh-FaData
}

$btnRegister.Add_Click({ Invoke-UiAction { Register-FaClient } })
$btnDetectDevice.Add_Click({ Invoke-UiAction { Detect-Device } })
$btnSaveSettings.Add_Click({ Invoke-UiAction { Save-And-TestSettings } })
$btnBrowseFile.Add_Click({ Invoke-UiAction { Browse-LocalFile } })
$btnBrowseDir.Add_Click({ Invoke-UiAction { Browse-ReceiveDirectory } })
$btnRefresh.Add_Click({ Invoke-UiAction { Refresh-FaData } })
$btnUpload.Add_Click({ Invoke-UiAction { Upload-SelectedFile } })
$btnReceive.Add_Click({ Invoke-UiAction { Receive-SelectedTransfer } })

Render-Me
if (Test-HasCredential) {
  Invoke-UiAction { Refresh-FaData }
}

[void][System.Windows.Forms.Application]::Run($form)
