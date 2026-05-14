#define AppName "File Assistant Client"
#define AppPublisher "File Assistant"
#define AppVersion "0.1.0"

#ifndef SourceRoot
  #define SourceRoot "..\.."
#endif

#ifndef ClientBuildDir
  #define ClientBuildDir "..\..\build\client-win-x64"
#endif

[Setup]
AppId={{2C59A9F4-4023-4F3E-9CC1-777897802A1B}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\FileAssistantClient
DefaultGroupName=File Assistant Client
DisableProgramGroupPage=no
OutputDir={#SourceRoot}\deploy\client-installer
OutputBaseFilename=FileAssistantClientSetup
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
UninstallDisplayIcon={app}\FileAssistantClient.exe
SetupIconFile={#SourceRoot}\assets\icons\file-assistant-client.ico
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=File Assistant Client Setup
VersionInfoProductName={#AppName}
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "..\server-inno\languages\ChineseSimplified.isl"

[Tasks]
Name: "autostart"; Description: "{cm:TaskAutoStart}"; Flags: checkedonce
Name: "desktopicon"; Description: "{cm:TaskDesktopIcon}"; Flags: unchecked

[Files]
Source: "{#ClientBuildDir}\FileAssistantClient.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\apps\windows-dotnet-client\README.md"; DestDir: "{app}\docs"; Flags: ignoreversion

[Icons]
Name: "{group}\{cm:ShortcutClient}"; Filename: "{app}\FileAssistantClient.exe"
Name: "{group}\{cm:ShortcutUninstall}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{cm:ShortcutClient}"; Filename: "{app}\FileAssistantClient.exe"; Check: ShouldCreateDesktopIcon

[Registry]
Root: HKA; Subkey: "Software\FileAssistantClient"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\FileAssistantClient"; ValueType: string; ValueName: "ServerUrl"; ValueData: "{code:GetServerUrl}"
Root: HKA; Subkey: "Software\FileAssistantClient"; ValueType: string; ValueName: "ReceiveDir"; ValueData: "{code:GetReceiveDir}"
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FileAssistantClient"; ValueData: """{app}\FileAssistantClient.exe"""; Flags: uninsdeletevalue; Check: ShouldAutoStart

[Run]
Filename: "{app}\FileAssistantClient.exe"; Description: "{cm:RunClient}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
Type: files; Name: "{app}\client-bootstrap.json"

[CustomMessages]
english.ConfigCaption=Client deployment
english.ConfigDescription=Set the server address.
english.ConfigSubCaption=Tokens, display name, and receive directory can be supplied by the deployment command line.
english.ConfigServerUrl=Server URL:
english.InvalidServerUrl=Please enter the server URL. It must start with http:// or https://.
english.TaskAutoStart=Start File Assistant Client when Windows starts
english.TaskDesktopIcon=Create a desktop shortcut
english.ShortcutClient=File Assistant Client
english.ShortcutUninstall=Uninstall File Assistant Client
english.RunClient=Start File Assistant Client

chinesesimplified.ConfigCaption=客户端部署配置
chinesesimplified.ConfigDescription=设置服务端地址。
chinesesimplified.ConfigSubCaption=部署令牌、显示名称和接收目录可由部署命令后台写入。
chinesesimplified.ConfigServerUrl=服务端地址：
chinesesimplified.InvalidServerUrl=请填写服务端地址，并且必须以 http:// 或 https:// 开头。
chinesesimplified.TaskAutoStart=开机自动启动客户端
chinesesimplified.TaskDesktopIcon=创建桌面快捷方式
chinesesimplified.ShortcutClient=File Assistant 客户端
chinesesimplified.ShortcutUninstall=卸载 File Assistant 客户端
chinesesimplified.RunClient=启动 File Assistant 客户端

[Code]
var
  ConfigPage: TInputQueryWizardPage;
  EmbeddedServerUrl: string;
  EmbeddedDeployToken: string;
  EmbeddedAutoRegister: Boolean;

function LastPos(Needle: string; Haystack: string): Integer;
var
  Current: Integer;
  Offset: Integer;
  Tail: string;
begin
  Result := 0;
  Offset := 1;
  Tail := Haystack;
  while True do
  begin
    Current := Pos(Needle, Tail);
    if Current = 0 then
      Break;
    Result := Offset + Current - 1;
    Offset := Result + Length(Needle);
    Tail := Copy(Haystack, Offset, Length(Haystack) - Offset + 1);
  end;
end;

function JsonStringValue(Json: string; Key: string): string;
var
  Pattern: string;
  Tail: string;
  KeyPos: Integer;
  ColonPos: Integer;
  StartPos: Integer;
  I: Integer;
  Ch: string;
  Escaped: Boolean;
begin
  Result := '';
  Pattern := '"' + Key + '"';
  KeyPos := Pos(Pattern, Json);
  if KeyPos = 0 then
    Exit;
  Tail := Copy(Json, KeyPos + Length(Pattern), Length(Json));
  ColonPos := Pos(':', Tail);
  if ColonPos = 0 then
    Exit;
  Tail := Copy(Tail, ColonPos + 1, Length(Tail));
  StartPos := Pos('"', Tail);
  if StartPos = 0 then
    Exit;

  Escaped := False;
  I := StartPos + 1;
  while I <= Length(Tail) do
  begin
    Ch := Copy(Tail, I, 1);
    if Escaped then
    begin
      if Ch = '"' then
        Result := Result + '"'
      else if Ch = '\' then
        Result := Result + '\'
      else if Ch = 'n' then
        Result := Result + #10
      else if Ch = 'r' then
        Result := Result + #13
      else if Ch = 't' then
        Result := Result + #9
      else
        Result := Result + Ch;
      Escaped := False;
    end
    else if Ch = '\' then
      Escaped := True
    else if Ch = '"' then
      Exit
    else
      Result := Result + Ch;
    I := I + 1;
  end;
end;

function JsonBoolValue(Json: string; Key: string; DefaultValue: Boolean): Boolean;
var
  Pattern: string;
  Tail: string;
  KeyPos: Integer;
  ColonPos: Integer;
  Value: string;
begin
  Result := DefaultValue;
  Pattern := '"' + Key + '"';
  KeyPos := Pos(Pattern, Json);
  if KeyPos = 0 then
    Exit;
  Tail := Copy(Json, KeyPos + Length(Pattern), Length(Json));
  ColonPos := Pos(':', Tail);
  if ColonPos = 0 then
    Exit;
  Value := LowerCase(Trim(Copy(Tail, ColonPos + 1, 5)));
  if Pos('true', Value) = 1 then
    Result := True
  else if Pos('false', Value) = 1 then
    Result := False;
end;

procedure LoadEmbeddedBootstrapConfig;
var
  Raw: AnsiString;
  SourceText: string;
  ConfigText: string;
  BeginMarker: string;
  EndMarker: string;
  BeginPos: Integer;
  EndPos: Integer;
  ConfigStart: Integer;
begin
  EmbeddedServerUrl := '';
  EmbeddedDeployToken := '';
  EmbeddedAutoRegister := False;
  BeginMarker := 'FA_CLIENT_BOOTSTRAP_V1_BEGIN';
  EndMarker := 'FA_CLIENT_BOOTSTRAP_V1_END';

  if not LoadStringFromFile(ExpandConstant('{srcexe}'), Raw) then
    Exit;
  SourceText := Raw;
  BeginPos := LastPos(BeginMarker, SourceText);
  EndPos := LastPos(EndMarker, SourceText);
  if (BeginPos = 0) or (EndPos = 0) then
    Exit;

  ConfigStart := BeginPos + Length(BeginMarker);
  if EndPos <= ConfigStart then
    Exit;

  ConfigText := Trim(Copy(SourceText, ConfigStart, EndPos - ConfigStart));
  EmbeddedServerUrl := Trim(JsonStringValue(ConfigText, 'serverUrl'));
  EmbeddedDeployToken := Trim(JsonStringValue(ConfigText, 'deployToken'));
  EmbeddedAutoRegister := JsonBoolValue(ConfigText, 'autoRegister', EmbeddedServerUrl <> '');
end;

function HasHttpScheme(Value: string): Boolean;
var
  LowerValue: string;
begin
  LowerValue := LowerCase(Value);
  Result := (Pos('http://', LowerValue) = 1) or (Pos('https://', LowerValue) = 1);
end;

function IsTruthy(Value: string): Boolean;
var
  LowerValue: string;
begin
  LowerValue := LowerCase(Trim(Value));
  Result := (LowerValue = '1') or (LowerValue = 'true') or (LowerValue = 'yes') or (LowerValue = 'y');
end;

function BoolJson(Value: Boolean): string;
begin
  if Value then
    Result := 'true'
  else
    Result := 'false';
end;

function JsonEscape(Value: string): string;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  Result := Value;
end;

function GetServerUrl(Param: string): string;
begin
  Result := Trim(ConfigPage.Values[0]);
end;

function GetDeployToken(Param: string): string;
begin
  Result := Trim(ExpandConstant('{param:DEPLOYTOKEN|}'));
  if Result = '' then
    Result := EmbeddedDeployToken;
end;

function GetInstallCode(Param: string): string;
begin
  Result := Trim(ExpandConstant('{param:INSTALLCODE|}'));
end;

function GetDisplayName(Param: string): string;
begin
  Result := Trim(ExpandConstant('{param:DISPLAYNAME|}'));
end;

function GetReceiveDir(Param: string): string;
begin
  Result := Trim(ExpandConstant('{param:RECEIVEDIR|}'));
end;

function ShouldAutoStart(): Boolean;
begin
  Result := WizardIsTaskSelected('autostart');
end;

function ShouldCreateDesktopIcon(): Boolean;
begin
  Result := WizardIsTaskSelected('desktopicon');
end;

function ShouldAutoRegister(): Boolean;
var
  ParamValue: string;
begin
  ParamValue := ExpandConstant('{param:AUTOREGISTER|}');
  if ParamValue <> '' then
    Result := IsTruthy(ParamValue)
  else if EmbeddedServerUrl <> '' then
    Result := EmbeddedAutoRegister
  else
    Result := True;
end;

function IsServerUrlValid(): Boolean;
var
  ServerUrl: string;
begin
  ServerUrl := GetServerUrl('');
  Result := (ServerUrl <> '') and HasHttpScheme(ServerUrl);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = ConfigPage.ID then
  begin
    if not IsServerUrlValid() then
    begin
      MsgBox(ExpandConstant('{cm:InvalidServerUrl}'), mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsServerUrlValid() then
    Result := ExpandConstant('{cm:InvalidServerUrl}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (ConfigPage <> nil) and (PageID = ConfigPage.ID) and (GetServerUrl('') <> '') then
    Result := True;
end;

procedure InitializeWizard;
var
  ParamServerUrl: string;
begin
  LoadEmbeddedBootstrapConfig();

  ConfigPage := CreateInputQueryPage(
    wpSelectDir,
    ExpandConstant('{cm:ConfigCaption}'),
    ExpandConstant('{cm:ConfigDescription}'),
    ExpandConstant('{cm:ConfigSubCaption}'));

  ConfigPage.Add(ExpandConstant('{cm:ConfigServerUrl}'), False);

  ParamServerUrl := ExpandConstant('{param:SERVERURL|}');
  if Trim(ParamServerUrl) <> '' then
    ConfigPage.Values[0] := ParamServerUrl
  else
    ConfigPage.Values[0] := EmbeddedServerUrl;
end;

procedure SaveBootstrapConfig;
var
  Content: string;
  Path: string;
begin
  Content :=
    '{' + #13#10 +
    '  "serverUrl": "' + JsonEscape(GetServerUrl('')) + '",' + #13#10 +
    '  "deployToken": "' + JsonEscape(GetDeployToken('')) + '",' + #13#10 +
    '  "installCode": "' + JsonEscape(GetInstallCode('')) + '",' + #13#10 +
    '  "displayName": "' + JsonEscape(GetDisplayName('')) + '",' + #13#10 +
    '  "receiveDir": "' + JsonEscape(GetReceiveDir('')) + '",' + #13#10 +
    '  "autoRegister": ' + BoolJson(ShouldAutoRegister()) + ',' + #13#10 +
    '  "maintenanceMode": false' + #13#10 +
    '}' + #13#10;

  Path := ExpandConstant('{app}\client-bootstrap.json');
  SaveStringToFile(Path, Content, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    SaveBootstrapConfig();
end;
