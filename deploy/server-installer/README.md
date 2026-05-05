# File Assistant 服务端安装器

本目录用于放置正式服务端安装器：

```text
FileAssistantServerSetup.exe
```

当前安装器由 Inno Setup 生成，双击后是标准 Windows 安装向导，包含语言选择、欢迎页、许可协议、安装目录、组件选择、服务端 IP/端口配置、任务选择页和卸载入口。

安装器内置：

- File Assistant 服务端代码
- Web 管理端静态文件
- Node.js 运行时 `node.exe`
- 自包含 Windows Service 包装器
- 右下角托盘助手
- 启动、停止、状态、备份脚本

## 生成安装器

在项目根目录运行：

```powershell
.\deploy\server\build-server-installer.ps1
```

这会调用 Inno Setup 编译脚本 `deploy/server/build-inno-server-installer.ps1`。

如果 Node 不在默认位置：

```powershell
.\deploy\server\build-server-installer.ps1 -NodeExePath "D:\node\node.exe"
```

## 安装示例

推荐直接双击：

```text
FileAssistantServerSetup.exe
```

安装器会自动请求管理员权限并打开标准 Inno 安装向导。
向导会先要求同意用户协议和隐私政策，然后选择安装目录、组件、服务器 IP/域名、服务端口和附加任务；首次管理员账号在安装完成后进入 Web 管理端时创建，Legacy 管理令牌默认禁用。

也可以用命令行静默安装。以管理员身份运行：

```powershell
.\FileAssistantServerSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ACCEPTAGREEMENTS=1 /LANG=chinesesimplified /DIR="C:\Program Files\FileAssistantServer" /SERVERHOST=服务器IP /PORT=5177 /MERGETASKS=autostart,startservice
```

安装后配置文件位于：

```text
C:\Program Files\FileAssistantServer\deploy\server\config.ps1
```

## 卸载

通过 Windows“设置 > 应用”或控制面板卸载。卸载时会停止并删除 Windows Service；默认保留 `C:\ProgramData\FileAssistantServer` 里的数据、日志和备份。
