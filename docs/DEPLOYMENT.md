# 正式部署说明

本文档用于把当前 File Assistant 副本部署到一台 Windows Server，并下发 Windows 客户端。

## 1. 部署方式选择

正式交付推荐使用服务端安装器：

```text
deploy/server-installer/FileAssistantServerSetup.exe
```

安装器由 Inno Setup 生成，内置 Node.js 运行时和 Windows Service 包装器，客户服务器不需要手动安装 Node，也不需要 NSSM。

如果暂时不用安装器，也可以继续使用 `deploy/server/start-server.ps1` 脚本方式部署；脚本方式需要服务器已有 Node.js。

## 2. 部署前检查

- 建议使用 Windows Server 2019 或更新版本。
- 使用安装器部署时，不需要客户手动安装 Node.js。
- 使用脚本方式部署时，安装 Node.js 24 或更新版本，确保 `node.exe` 在 `PATH` 中。
- 使用安装器部署时，不需要 NSSM。
- 使用脚本方式安装为 Windows 服务时，可准备 `nssm.exe`。
- 使用安装器部署时会自动添加服务端口的 Windows 防火墙入站规则；脚本方式部署时需自行确认防火墙放行，默认端口 `5177`。
- 使用安装器部署时，首次管理员在 Web 管理端创建；Legacy 管理令牌默认禁用。

## 3. 安装器方式部署

推荐直接双击：

```text
deploy/server-installer/FileAssistantServerSetup.exe
```

安装器会自动请求管理员权限，然后打开标准安装向导。向导包含许可协议、组件选择、安装目录、服务器 IP/域名、服务端口和附加任务；管理员账号在安装完成后进入 Web 管理端时创建。

Inno 静默安装示例：

```powershell
.\deploy\server-installer\FileAssistantServerSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ACCEPTAGREEMENTS=1 /LANG=chinesesimplified /DIR="C:\Program Files\FileAssistantServer" /SERVERHOST=服务器IP /PORT=5177 /MERGETASKS=autostart,startservice
```

如果不传 `/ADMINPASSWORD`，安装器会启用首次初始化流程，首次访问 `http://服务器IP:5177/admin` 时创建第一个管理员。`/SERVERHOST` 可填 IP 或域名；`/ADMINTOKEN` 可选，不传则禁用 Legacy 管理令牌。

安装后主要目录：

```text
C:\Program Files\FileAssistantServer\
  FileAssistantServerService.exe
  FileAssistantServerTray.exe
  runtime\node\node.exe
  apps\server\
  apps\web\
  deploy\server\

C:\ProgramData\FileAssistantServer\
  data\
  logs\
  backups\
  run\
```

卸载请使用 Windows“设置 > 应用”或控制面板。卸载时会停止并删除 Windows Service；默认保留 `C:\ProgramData\FileAssistantServer` 中的数据、日志和备份。

安装器会注册右下角托盘助手，用户登录桌面后可从托盘打开管理端、查看服务状态、启动/停止/重启服务、打开日志目录。无人登录时托盘不会显示，但 Windows Service 会继续后台运行。

## 4. 脚本方式服务端配置

复制配置样例：

```powershell
Copy-Item .\deploy\server\config.example.ps1 .\deploy\server\config.ps1
```

编辑 `deploy/server/config.ps1`，按部署方式选择：

- 推荐设置 `InitialAdminSetup = $true`，首次访问管理端时创建第一个管理员。
- 如需脚本预置管理员，可设置 `AdminUsername` 和 `AdminPassword`，并保持 `InitialAdminSetup = $false`。
- `AdminToken` 是旧脚本使用的 Legacy 管理令牌；留空表示禁用。
- 必要时修改 `Port`、`DataDir`、`BackupDir`、`NodePath`。

注意：`AdminUsername` 和 `AdminPassword` 只在数据库里还没有管理员账号，且未启用 `InitialAdminSetup` 时用于初始化。数据库创建后再改配置文件，不会自动重置已有管理员密码。

## 5. 脚本方式启动

在项目根目录运行：

```powershell
.\deploy\server\start-server.ps1
```

查看状态：

```powershell
.\deploy\server\status-server.ps1
```

停止服务端：

```powershell
.\deploy\server\stop-server.ps1
```

调试时可前台启动：

```powershell
.\deploy\server\start-server.ps1 -Foreground
```

默认访问地址：

```text
http://服务器IP:5177/admin
```

## 6. 脚本方式安装为 Windows 服务

以管理员身份打开 PowerShell，先确认 `config.ps1` 已经配置好，然后运行：

```powershell
.\deploy\server\install-service-nssm.ps1 -NssmPath C:\tools\nssm\nssm.exe -StartAfterInstall
```

如果 `nssm.exe` 已在 `PATH` 中，可以省略 `-NssmPath`。

卸载服务：

```powershell
.\deploy\server\uninstall-service-nssm.ps1 -NssmPath C:\tools\nssm\nssm.exe
```

## 7. 数据目录和备份

`DataDir` 是正式部署最重要的持久化目录。安装器方式默认使用：

```text
C:\ProgramData\FileAssistantServer\data
```

脚本方式默认是项目根目录下的 `data/`。数据目录包含：

- `file-assistant.sqlite`
- SQLite WAL/SHM 文件
- 上传分片
- 临时中转文件
- 重要备份文件

手动创建备份：

```powershell
.\deploy\server\backup-data.ps1
```

为了获得最一致的 SQLite 备份，建议先停止服务端，再执行备份脚本。备份默认保存到 `backups/`。

## 8. 客户端下发

客户端下发包位于：

```text
deploy/client/
```

目录说明：

- `deploy/client/win-x64/`：轻量版，需要终端安装 .NET 8 Desktop Runtime。
- `deploy/client/win-x64-self-contained/`：自包含版，不需要终端安装 .NET。

管理端生成批量部署令牌后，下发命令：

```powershell
FileAssistantClient.exe --server http://服务器IP:5177 --deploy-token FA-XXXX-XXXX-XXXX-XXXX --auto-register
```

需要重新注册时，由管理员运行维护模式：

```powershell
FileAssistantClient.exe --maintenance
```

## 9. 首次验收流程

1. 在 Windows Server 上启动服务端。
2. 浏览器访问 `http://服务器IP:5177/admin`。
3. 首次进入时创建第一个管理员；之后使用该账号登录。
4. 创建部门和人员。
5. 生成一码多用的批量部署令牌。
6. 在两台客户端机器上用部署命令自动注册。
7. 在管理端把两个客户端绑定到对应人员。
8. 客户端 A 发送普通文件给客户端 B。
9. B 接收后确认服务器普通文件已自动清除。
10. A 再发送“重要备份”文件给 B。
11. B 接收后确认服务器保留重要备份副本。

## 10. 当前生产边界

- 当前仍是单机部署，数据库使用 SQLite。
- 服务端会落盘保存中转文件，尚未实现生产级端到端加密。
- 普通文件接收完成后清除服务器副本，重要备份文件保留。
- 管理端文件查阅/下载能力目前还不是独立开关。
- 与现场加密软件白名单、透明解密、落地加密仍需在现场联调。
