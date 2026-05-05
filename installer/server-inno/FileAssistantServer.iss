#define AppName "File Assistant Server"
#define AppPublisher "File Assistant"
#define AppVersion "0.1.0"

#ifndef SourceRoot
  #define SourceRoot "..\.."
#endif

#ifndef ServiceBuildDir
  #define ServiceBuildDir "..\..\build\server-service"
#endif

#ifndef TrayBuildDir
  #define TrayBuildDir "..\..\build\server-tray"
#endif

#ifndef NodeExePath
  #define NodeExePath "C:\Program Files\nodejs\node.exe"
#endif

[Setup]
AppId={{41D63C30-7748-4AB0-8621-7E5D5A42FE91}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\FileAssistantServer
DefaultGroupName=File Assistant Server
DisableProgramGroupPage=no
OutputDir={#SourceRoot}\deploy\server-installer
OutputBaseFilename=FileAssistantServerSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=classic
DisableWelcomePage=no
DisableReadyPage=no
DisableFinishedPage=no
ShowLanguageDialog=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\FileAssistantServerService.exe
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=File Assistant Server Setup
VersionInfoProductName={#AppName}
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Types]
Name: "full"; Description: "{cm:TypeFull}"
Name: "custom"; Description: "{cm:TypeCustom}"; Flags: iscustom

[Components]
Name: "server"; Description: "{cm:ComponentServer}"; Types: full custom; Flags: fixed
Name: "web"; Description: "{cm:ComponentWeb}"; Types: full custom; Flags: fixed
Name: "ops"; Description: "{cm:ComponentOps}"; Types: full custom
Name: "shortcuts"; Description: "{cm:ComponentShortcuts}"; Types: full custom

[Tasks]
Name: "autostart"; Description: "{cm:TaskAutoStart}"; Flags: checkedonce
Name: "startservice"; Description: "{cm:TaskStartService}"; Flags: checkedonce

[Files]
Source: "{#ServiceBuildDir}\FileAssistantServerService.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: server
Source: "{#TrayBuildDir}\FileAssistantServerTray.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: server
Source: "{#NodeExePath}"; DestDir: "{app}\runtime\node"; DestName: "node.exe"; Flags: ignoreversion; Components: server
Source: "{#SourceRoot}\apps\server\*"; DestDir: "{app}\apps\server"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: server
Source: "{#SourceRoot}\apps\web\*"; DestDir: "{app}\apps\web"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: web
Source: "{#SourceRoot}\deploy\server\FileAssistant.Deploy.psm1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: server
Source: "{#SourceRoot}\deploy\server\start-server.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: server
Source: "{#SourceRoot}\deploy\server\stop-server.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: ops
Source: "{#SourceRoot}\deploy\server\status-server.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: ops
Source: "{#SourceRoot}\deploy\server\backup-data.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: ops
Source: "{#SourceRoot}\deploy\server\install-service-native.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: server
Source: "{#SourceRoot}\deploy\server\uninstall-service-native.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: server
Source: "{#SourceRoot}\deploy\server\config.example.ps1"; DestDir: "{app}\deploy\server"; Flags: ignoreversion; Components: server
Source: "{#SourceRoot}\docs\DEPLOYMENT.md"; DestDir: "{app}\docs"; Flags: ignoreversion; Components: ops
Source: "{#SourceRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion; Components: ops
Source: "{#SourceRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion; Components: server

[Dirs]
Name: "{code:GetDataRoot}"; Permissions: users-readexec
Name: "{code:GetDataRoot}\data"
Name: "{code:GetDataRoot}\logs"
Name: "{code:GetDataRoot}\backups"
Name: "{code:GetDataRoot}\run"

[Icons]
Name: "{group}\{cm:ShortcutAdmin}"; Filename: "{code:GetAdminUrl}"; Check: ShouldCreateShortcuts
Name: "{group}\{cm:ShortcutStatus}"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\server\status-server.ps1"""; WorkingDir: "{app}"; Check: ShouldCreateOpsShortcuts
Name: "{group}\{cm:ShortcutBackup}"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\server\backup-data.ps1"""; WorkingDir: "{app}"; Check: ShouldCreateOpsShortcuts
Name: "{group}\{cm:ShortcutDocs}"; Filename: "{app}\docs\DEPLOYMENT.md"; Check: ShouldCreateOpsShortcuts
Name: "{group}\{cm:ShortcutUninstall}"; Filename: "{uninstallexe}"; Check: ShouldCreateShortcuts

[Registry]
Root: HKLM; Subkey: "Software\FileAssistantServer"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey; Check: ShouldInstallService
Root: HKLM; Subkey: "Software\FileAssistantServer"; ValueType: string; ValueName: "ServiceName"; ValueData: "{code:GetServiceName}"; Check: ShouldInstallService
Root: HKLM; Subkey: "Software\FileAssistantServer"; ValueType: string; ValueName: "Port"; ValueData: "{code:GetPort}"; Check: ShouldInstallService
Root: HKLM; Subkey: "Software\FileAssistantServer"; ValueType: string; ValueName: "PublicServerUrl"; ValueData: "{code:GetPublicUrl}"; Check: ShouldInstallService
Root: HKLM; Subkey: "Software\FileAssistantServer"; ValueType: string; ValueName: "DataRoot"; ValueData: "{code:GetDataRoot}"; Check: ShouldInstallService
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FileAssistantServerTray"; ValueData: """{app}\FileAssistantServerTray.exe"""; Flags: uninsdeletevalue; Check: ShouldInstallService

[Run]
Filename: "{app}\FileAssistantServerTray.exe"; Description: "{cm:RunTray}"; Flags: nowait postinstall skipifsilent runasoriginaluser; Check: ShouldInstallService

[CustomMessages]
english.TypeFull=Full installation
english.TypeCustom=Custom installation
english.ComponentServer=File Assistant Server core (required)
english.ComponentWeb=Web admin console (required)
english.ComponentOps=Operations scripts and deployment guide
english.ComponentShortcuts=Start Menu shortcuts
english.AgreementCaption=License Agreement
english.AgreementDescription=Please read the following important information before continuing.
english.AgreementUserConsent=I accept the User Agreement
english.AgreementPrivacyConsent=I accept the Privacy Policy
english.AgreementRequired=You must accept the User Agreement and Privacy Policy to continue.
english.ConfigCaption=Server configuration
english.ConfigDescription=Choose the server IP/domain and HTTP port.
english.ConfigSubCaption=The administrator account is created in the web console after installation.
english.ConfigPort=HTTP port:
english.ConfigServerHost=Server IP or domain:
english.TaskAutoStart=Start Windows service automatically on boot
english.TaskStartService=Start service after installation
english.ShortcutAdmin=Open Admin Console
english.ShortcutStatus=Check Server Status
english.ShortcutBackup=Backup Data
english.ShortcutDocs=Deployment Guide
english.ShortcutUninstall=Uninstall File Assistant Server
english.RunTray=Start tray assistant
english.InvalidPort=Port must be between 1 and 65535.
english.InvalidPassword=Admin password must be at least 8 characters.
english.InvalidPublicUrl=Server address must start with http:// or https:// when a URL is provided.
english.InstallingService=Installing Windows service...
english.RemovingService=Removing Windows service...
english.ServiceInstallFailed=Windows service could not be installed. Please close Windows Services/Task Manager windows, reboot if an old service is pending deletion, then run the installer again. Details: 

chinesesimplified.ConfigCaption=服务端配置
chinesesimplified.ConfigDescription=选择服务端 IP/域名和 HTTP 端口。
chinesesimplified.ConfigSubCaption=管理员账号会在安装完成后进入网页控制台时创建。
chinesesimplified.ConfigPort=HTTP 端口：
chinesesimplified.ConfigServerHost=服务器 IP 或域名：
chinesesimplified.TaskAutoStart=开机自动启动服务
chinesesimplified.TaskStartService=安装完成后立即启动服务
chinesesimplified.ShortcutAdmin=打开管理端
chinesesimplified.ShortcutStatus=检查服务状态
chinesesimplified.ShortcutBackup=备份数据
chinesesimplified.ShortcutDocs=部署说明
chinesesimplified.ShortcutUninstall=卸载 File Assistant Server
chinesesimplified.RunTray=启动右下角托盘助手
chinesesimplified.InvalidPort=端口必须在 1 到 65535 之间。
chinesesimplified.InvalidPassword=管理员密码至少需要 8 位。
chinesesimplified.InvalidPublicUrl=填写完整地址时必须以 http:// 或 https:// 开头。
chinesesimplified.InstallingService=正在安装 Windows 服务...
chinesesimplified.RemovingService=正在删除 Windows 服务...
chinesesimplified.ServiceInstallFailed=Windows 服务安装失败。请关闭“服务”管理器/任务管理器窗口；如果旧服务正在等待删除，请重启电脑后重新运行安装程序。详细日志：
chinesesimplified.TypeFull=完整安装
chinesesimplified.TypeCustom=自定义安装
chinesesimplified.ComponentServer=File Assistant 服务端核心（必选）
chinesesimplified.ComponentWeb=Web 管理控制台（必选）
chinesesimplified.ComponentOps=运维脚本和部署文档
chinesesimplified.ComponentShortcuts=开始菜单快捷方式
chinesesimplified.AgreementCaption=许可协议
chinesesimplified.AgreementDescription=请在继续之前阅读以下重要信息。
chinesesimplified.AgreementUserConsent=我同意用户协议
chinesesimplified.AgreementPrivacyConsent=我同意隐私政策
chinesesimplified.AgreementRequired=必须同意用户协议和隐私政策后才能继续安装。

[Code]
var
  AgreementPage: TWizardPage;
  AgreementMemo: TNewMemo;
  AgreementCheckBox: TNewCheckBox;
  PrivacyCheckBox: TNewCheckBox;
  ConfigPage: TInputQueryWizardPage;

function ShouldInstallService(): Boolean;
begin
  Result := ExpandConstant('{param:NOSERVICE|0}') <> '1';
end;

function DataRoot(): string;
var
  ParamDataRoot: string;
begin
  ParamDataRoot := ExpandConstant('{param:DATAROOT|}');
  if ParamDataRoot <> '' then
    Result := ParamDataRoot
  else
    Result := ExpandConstant('{commonappdata}\FileAssistantServer');
end;

function GetDataRoot(Param: string): string;
begin
  Result := DataRoot();
end;

function PsEscape(Value: string): string;
begin
  StringChangeEx(Value, '`', '``', True);
  StringChangeEx(Value, '"', '`"', True);
  Result := Value;
end;

function GetPort(Param: string): string;
begin
  Result := ConfigPage.Values[0];
end;

function GetServerHost(Param: string): string;
begin
  Result := Trim(ConfigPage.Values[1]);
end;

function HasHttpScheme(Value: string): Boolean;
var
  LowerValue: string;
begin
  LowerValue := LowerCase(Value);
  Result := (Pos('http://', LowerValue) = 1) or (Pos('https://', LowerValue) = 1);
end;

function GetPublicUrl(Param: string): string;
var
  Value: string;
  Host: string;
begin
  Value := Trim(ExpandConstant('{param:PUBLICURL|}'));
  if Value <> '' then
    Result := Value
  else begin
    Host := GetServerHost('');
    if Host = '' then
      Host := 'localhost';
    if HasHttpScheme(Host) then
      Result := Host
    else if Pos(':', Host) > 0 then
      Result := 'http://' + Host
    else
      Result := 'http://' + Host + ':' + GetPort('');
  end;
end;

function GetAdminPassword(Param: string): string;
begin
  Result := ExpandConstant('{param:ADMINPASSWORD|}');
end;

function GetAdminUser(Param: string): string;
begin
  if GetAdminPassword('') <> '' then
    Result := ExpandConstant('{param:ADMINUSER|admin}')
  else
    Result := '';
end;

function GetAdminToken(Param: string): string;
begin
  Result := ExpandConstant('{param:ADMINTOKEN|}');
end;

function GetServiceName(Param: string): string;
begin
  Result := ExpandConstant('{param:SERVICENAME|FileAssistantServer}');
end;

function UseInitialAdminSetup(): Boolean;
begin
  Result := GetAdminPassword('') = '';
end;

function PsBool(Value: Boolean): string;
begin
  if Value then
    Result := '$true'
  else
    Result := '$false';
end;

function GetAgreementText(): string;
begin
  if ActiveLanguage = 'chinesesimplified' then begin
    Result :=
      '用户协议摘要' + #13#10 +
      '1. 本软件用于企业内部文件中转、客户端注册、传输确认、审计记录和相关管理工作。' + #13#10 +
      '2. 用户应在合法授权范围内安装和使用本软件，并自行维护服务器、账号、密码和部署令牌安全。' + #13#10 +
      '3. 用户不得对软件进行未授权复制、分发、破解、反向工程、规避授权或用于违法违规用途。' + #13#10 +
      '4. 用户应结合现场制度配置传输规则、备份策略、日志保留和访问权限，并对重要数据自行做好备份。' + #13#10 +
      '5. 软件升级、维护、技术支持和责任边界以双方签署的正式合同或服务条款为准。' + #13#10 + #13#10 +
      '隐私政策摘要' + #13#10 +
      '1. 本软件会在客户服务器本地保存管理账号、会话信息、客户端名称、MAC、IP、平台、安装码、传输记录和审计日志。' + #13#10 +
      '2. 文件内容会按传输规则暂存于客户服务器；普通中转文件可在接收确认后清除，重要备份文件会按管理员配置保留。' + #13#10 +
      '3. 本软件不会默认向外部厂商服务器上传客户业务文件或管理数据；现场如接入第三方系统，应以实际配置为准。' + #13#10 +
      '4. 管理员可通过系统功能配置客户端、组织人员、传输规则、备份和清理策略。' + #13#10 +
      '5. 正式交付时，用户协议和隐私政策可替换为贵司法务确认后的完整版本。';
  end else begin
    Result :=
      'User Agreement Summary' + #13#10 +
      '1. This software is intended for internal file relay, client registration, transfer review, audit logging, and administration.' + #13#10 +
      '2. The user must install and use the software only within authorized and lawful environments, and must protect servers, accounts, passwords, and deployment tokens.' + #13#10 +
      '3. Unauthorized copying, redistribution, cracking, reverse engineering, license bypass, or unlawful use is prohibited.' + #13#10 +
      '4. The user should configure transfer rules, retention, backup, logs, and permissions according to local policy and keep independent backups for important data.' + #13#10 +
      '5. Updates, maintenance, support, and liability are governed by the applicable contract or service terms.' + #13#10 + #13#10 +
      'Privacy Policy Summary' + #13#10 +
      '1. The software stores admin accounts, sessions, client names, MAC addresses, IP addresses, platforms, install codes, transfer records, and audit logs on the customer server.' + #13#10 +
      '2. File content may be temporarily stored on the customer server according to transfer rules. Ordinary relay files may be removed after delivery confirmation, while retained files follow administrator configuration.' + #13#10 +
      '3. The software does not upload customer business files or management data to an external vendor server by default. Third-party integrations depend on actual configuration.' + #13#10 +
      '4. Administrators can configure clients, organization records, transfer rules, backup, and cleanup policies.' + #13#10 +
      '5. For formal delivery, replace this summary with the complete legal terms approved by your company.';
  end;
end;

function ShouldCreateShortcuts(): Boolean;
begin
  Result := WizardIsComponentSelected('shortcuts');
end;

function ShouldCreateOpsShortcuts(): Boolean;
begin
  Result := WizardIsComponentSelected('shortcuts') and WizardIsComponentSelected('ops');
end;

function AgreementsAccepted(): Boolean;
begin
  Result := AgreementCheckBox.Checked and PrivacyCheckBox.Checked;
  if ExpandConstant('{param:ACCEPTAGREEMENTS|0}') = '1' then
    Result := True;
end;

function GetAdminUrl(Param: string): string;
begin
  Result := GetPublicUrl('');
  if Copy(Result, Length(Result), 1) = '/' then
    Delete(Result, Length(Result), 1);
  Result := Result + '/admin';
end;

procedure InitializeWizard();
begin
  AgreementPage := CreateCustomPage(
    wpWelcome,
    CustomMessage('AgreementCaption'),
    CustomMessage('AgreementDescription'));

  AgreementMemo := TNewMemo.Create(AgreementPage);
  AgreementMemo.Parent := AgreementPage.Surface;
  AgreementMemo.Left := 0;
  AgreementMemo.Top := 0;
  AgreementMemo.Width := AgreementPage.SurfaceWidth;
  AgreementMemo.Height := ScaleY(230);
  AgreementMemo.ReadOnly := True;
  AgreementMemo.ScrollBars := ssVertical;
  AgreementMemo.Text := GetAgreementText();

  AgreementCheckBox := TNewCheckBox.Create(AgreementPage);
  AgreementCheckBox.Parent := AgreementPage.Surface;
  AgreementCheckBox.Left := 0;
  AgreementCheckBox.Top := AgreementMemo.Top + AgreementMemo.Height + ScaleY(10);
  AgreementCheckBox.Width := AgreementPage.SurfaceWidth;
  AgreementCheckBox.Caption := CustomMessage('AgreementUserConsent');
  AgreementCheckBox.Checked := ExpandConstant('{param:ACCEPTAGREEMENTS|0}') = '1';

  PrivacyCheckBox := TNewCheckBox.Create(AgreementPage);
  PrivacyCheckBox.Parent := AgreementPage.Surface;
  PrivacyCheckBox.Left := 0;
  PrivacyCheckBox.Top := AgreementCheckBox.Top + ScaleY(24);
  PrivacyCheckBox.Width := AgreementPage.SurfaceWidth;
  PrivacyCheckBox.Caption := CustomMessage('AgreementPrivacyConsent');
  PrivacyCheckBox.Checked := ExpandConstant('{param:ACCEPTAGREEMENTS|0}') = '1';

  ConfigPage := CreateInputQueryPage(
    wpSelectComponents,
    CustomMessage('ConfigCaption'),
    CustomMessage('ConfigDescription'),
    CustomMessage('ConfigSubCaption'));
  ConfigPage.Add(CustomMessage('ConfigPort'), False);
  ConfigPage.Add(CustomMessage('ConfigServerHost'), False);

  ConfigPage.Values[0] := ExpandConstant('{param:PORT|5177}');
  ConfigPage.Values[1] := ExpandConstant('{param:SERVERHOST|}');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
  Url: string;
  Host: string;
begin
  Result := True;
  if CurPageID = AgreementPage.ID then begin
    if not AgreementsAccepted() then begin
      if WizardSilent then
        RaiseException(CustomMessage('AgreementRequired'))
      else
        MsgBox(CustomMessage('AgreementRequired'), mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;

  if CurPageID = ConfigPage.ID then begin
    Port := StrToIntDef(GetPort(''), 0);
    if (Port < 1) or (Port > 65535) then begin
      MsgBox(CustomMessage('InvalidPort'), mbError, MB_OK);
      Result := False;
      Exit;
    end;

    if (GetAdminPassword('') <> '') and (Length(GetAdminPassword('')) < 8) then begin
      MsgBox(CustomMessage('InvalidPassword'), mbError, MB_OK);
      Result := False;
      Exit;
    end;

    Url := LowerCase(Trim(ExpandConstant('{param:PUBLICURL|}')));
    Host := LowerCase(GetServerHost(''));
    if (
      ((Url <> '') and (not HasHttpScheme(Url))) or
      ((Host <> '') and (Pos('://', Host) > 0) and (not HasHttpScheme(Host)))
    ) then begin
      MsgBox(CustomMessage('InvalidPublicUrl'), mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure SaveServerConfig();
var
  ConfigPath: string;
  Content: string;
begin
  ConfigPath := ExpandConstant('{app}\deploy\server\config.ps1');
  Content :=
    '$FileAssistantConfig = @{' + #13#10 +
    '  Port = ' + GetPort('') + #13#10 +
    '  AdminUsername = "' + PsEscape(GetAdminUser('')) + '"' + #13#10 +
    '  AdminPassword = "' + PsEscape(GetAdminPassword('')) + '"' + #13#10 +
    '  AdminToken = "' + PsEscape(GetAdminToken('')) + '"' + #13#10 +
    '  InitialAdminSetup = ' + PsBool(UseInitialAdminSetup()) + #13#10 +
    '  DataDir = "' + PsEscape(DataRoot() + '\data') + '"' + #13#10 +
    '  BackupDir = "' + PsEscape(DataRoot() + '\backups') + '"' + #13#10 +
    '  LogDir = "' + PsEscape(DataRoot() + '\logs') + '"' + #13#10 +
    '  RunDir = "' + PsEscape(DataRoot() + '\run') + '"' + #13#10 +
    '  NodePath = "runtime\node\node.exe"' + #13#10 +
    '  ServiceName = "' + PsEscape(GetServiceName('')) + '"' + #13#10 +
    '  PublicServerUrl = "' + PsEscape(GetPublicUrl('')) + '"' + #13#10 +
    '  ChunkSizeBytes = 2097152' + #13#10 +
    '}' + #13#10;
  SaveStringToFile(ConfigPath, Content, False);
end;

function RunPowerShell(ScriptPath: string; ExtraParams: string): Boolean;
var
  ResultCode: Integer;
  Params: string;
begin
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '" ' + ExtraParams;
  Result := Exec('powershell.exe', Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Result and (ResultCode <> 0) then
    Result := False;
end;

procedure InstallNativeService();
var
  ScriptPath: string;
  Params: string;
  StartupType: string;
begin
  if not ShouldInstallService() then
    Exit;

  WizardForm.StatusLabel.Caption := CustomMessage('InstallingService');
  ScriptPath := ExpandConstant('{app}\deploy\server\install-service-native.ps1');
  if WizardIsTaskSelected('autostart') then
    StartupType := 'auto'
  else
    StartupType := 'demand';
  Params :=
    '-ServiceName "' + GetServiceName('') + '" ' +
    '-BaseDir "' + ExpandConstant('{app}') + '" ' +
    '-LogDir "' + DataRoot() + '\logs" ' +
    '-StartupType "' + StartupType + '" ' +
    '-Port ' + GetPort('');
  if WizardIsTaskSelected('startservice') then
    Params := Params + ' -StartService';
  Params := Params + ' -AddFirewallRule';

  if not RunPowerShell(ScriptPath, Params) then
    RaiseException(CustomMessage('ServiceInstallFailed') + DataRoot() + '\logs\install-service.log');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    SaveServerConfig();
    InstallNativeService();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ServiceName: string;
  Port: string;
  ScriptPath: string;
  Params: string;
begin
  if CurUninstallStep = usUninstall then begin
    if not RegQueryStringValue(HKLM, 'Software\FileAssistantServer', 'ServiceName', ServiceName) then
      ServiceName := 'FileAssistantServer';
    if not RegQueryStringValue(HKLM, 'Software\FileAssistantServer', 'Port', Port) then
      Port := '5177';
    ScriptPath := ExpandConstant('{app}\deploy\server\uninstall-service-native.ps1');
    Params := '-ServiceName "' + ServiceName + '" -Port ' + Port + ' -RemoveFirewallRule';
    RunPowerShell(ScriptPath, Params);
  end;
end;
