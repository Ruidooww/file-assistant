# File Assistant 客户端安装包

本目录用于输出 Windows 客户端正式安装包：

```text
FileAssistantClientSetup.exe
```

构建命令：

```powershell
.\deploy\client\build-client-installer.ps1
```

安装包会内置自包含 `.NET 8` Windows 客户端，终端电脑不需要单独安装 .NET Desktop Runtime。

## 静默部署参数

```powershell
.\FileAssistantClientSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /SERVERURL="http://服务器IP:5177" /DEPLOYTOKEN="FA-XXXX-XXXX-XXXX-XXXX" /AUTOREGISTER=1
```

如果不希望终端电脑弹出管理员权限，也可以使用当前用户安装：

```powershell
.\FileAssistantClientSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /CURRENTUSER /SERVERURL="http://服务器IP:5177" /DEPLOYTOKEN="FA-XXXX-XXXX-XXXX-XXXX" /AUTOREGISTER=1
```

可选参数：

- `/SERVERURL=...`：服务端地址。
- `/DEPLOYTOKEN=...`：部署令牌，当前复用管理端生成的一码多用安装码；不会显示在安装界面。
- `/INSTALLCODE=...`：普通安装码；不会显示在安装界面。
- `/AUTOREGISTER=1`：首次启动自动注册；默认开启。传入部署令牌/安装码时使用令牌注册，未传令牌时会尝试服务端临时免码注册。
- `/DISPLAYNAME=...`：可选显示名，不传时客户端默认使用 `电脑名\用户名`。
- `/RECEIVEDIR=...`：可选默认接收目录，不传时客户端默认使用当前用户 `Downloads\FileAssistant`。

安装器会把这些参数写入安装目录下的 `client-bootstrap.json`。客户端首次启动时读取该文件，并在注册成功后把本机凭证保存到 `%APPDATA%\FileAssistant\client.json`。

双击安装时，界面只显示“服务端地址”。部署令牌、安装码、显示名称和接收目录适合由管理端生成的部署命令后台写入，避免普通员工看到或误填。

如果服务端管理端临时开启了“免码注册”，客户端安装时只填写服务端地址即可自动注册。免码注册默认关闭，建议只在批量部署窗口临时开启。

管理员安装时注册表写入 `HKLM`；`/CURRENTUSER` 安装时注册表和开机启动项写入 `HKCU`。
