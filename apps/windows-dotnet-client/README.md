# Windows .NET Client

这是文件助手的正式 Windows 客户端工程化起点，基于 `.NET 8 WinForms`。

它和 `apps/windows-client` 里的 PowerShell 验证版可以同时保留：

- `apps/windows-client`：无需编译，适合快速验证现场加密软件白名单、透明解密、落地加密。
- `apps/windows-dotnet-client`：正式客户端路线，后续适合做安装包、托盘、自动更新、签名和更完整的设备管控。

## 当前能力

- 配置服务端地址。
- 使用安装码注册客户端。
- 支持通过命令行或环境变量传入服务地址和部署令牌，首次启动自动注册。
- 支持读取安装器写入的 `client-bootstrap.json`，用于正式安装后的首次自动注册。
- 注册成功后锁定服务地址、显示名、MAC、IP 和安装码，避免普通员工误改。
- 自动读取本机 MAC、IP、系统信息。
- 保存客户端凭证到 `%APPDATA%\FileAssistant\client.json`。
- 客户端日志落盘到 `%APPDATA%\FileAssistant\logs\client.log`。
- 刷新当前客户端状态、接收人员和传输列表。
- 每 10 秒自动刷新一次。
- 右下角托盘常驻，支持查看连接状态、服务地址、接收目录、打开主界面、打开接收目录、打开日志目录、重新连接和退出客户端。
- 关闭窗口时默认隐藏到托盘，避免员工误关后台接收。
- 发现新的“发给我且可接收”的文件时，会弹出系统托盘提示，并把窗口恢复到前台。
- 选择组织人员发送文件。
- 按服务端返回的分片大小上传文件。
- 支持重要备份申请；客户端主流程不再暴露预览、截屏等终端权限开关。
- 选择本地落地目录接收文件。
- 文件写入成功并完成大小校验后，才调用确认接收接口。

## 接收提醒

客户端启动后会自动轮询服务端，不需要接收方手动点击“刷新”才知道有新文件。

提醒触发条件：

- 文件是发给当前客户端的。
- 文件已经放行或免确认进入等待接收。
- 文件还没有被接收。
- 服务器文件还没有被清除。

第一次启动时会先建立当前列表基线，不会把历史待接收文件全部弹一遍。之后新出现的待接收文件会触发托盘气泡提示和本地日志。

## 运行

先启动服务端：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
node apps/server/server.js
```

再启动客户端：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\apps\windows-dotnet-client
dotnet run
```

也可以双击：

```text
apps/windows-dotnet-client/start-client.cmd
```

## 批量静默注册

管理端先生成一个一码多用的安装码，例如最多 100 次使用。服务台下发客户端时，可以把这个码当作部署令牌传给客户端：

```powershell
FileAssistantClient.exe --server http://服务器IP:5177 --deploy-token FA-XXXX-XXXX-XXXX-XXXX --auto-register
```

客户端第一次启动时会自动读取电脑名、当前用户、MAC、IP 和系统版本，并向服务端注册。注册成功后，关键连接信息会锁定，员工不能在界面里随便修改。

也可以用环境变量下发：

```powershell
$env:FA_SERVER_URL="http://服务器IP:5177"
$env:FA_DEPLOY_TOKEN="FA-XXXX-XXXX-XXXX-XXXX"
$env:FA_AUTO_REGISTER="1"
FileAssistantClient.exe
```

可用参数：

- `--server` 或 `FA_SERVER_URL`：服务端地址。
- `--deploy-token` 或 `FA_DEPLOY_TOKEN`：部署令牌，当前复用管理端生成的一码多用安装码。
- `--install-code` 或 `FA_INSTALL_CODE`：普通安装码。
- `--auto-register` 或 `FA_AUTO_REGISTER=1`：首次启动自动注册。
- `--display-name` 或 `FA_DISPLAY_NAME`：可选显示名，不传时默认 `电脑名\用户名`。
- `--receive-dir` 或 `FA_RECEIVE_DIR`：可选默认接收目录。
- `--maintenance` 或 `FA_MAINTENANCE_MODE=1`：维护模式，已注册客户端会显示“维护重置”按钮。

## 维护重置

注册成功后，普通员工不能修改服务地址、显示名、MAC、IP 和安装码。如果需要重新注册或切换服务器地址，由管理员用维护模式启动：

```powershell
FileAssistantClient.exe --maintenance
```

维护模式下，已注册客户端会显示“维护重置”按钮。点击后会清除本机注册凭证并解除配置锁定，随后可以重新输入安装码，或者再次用部署令牌自动注册。

## 构建

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
dotnet build apps/windows-dotnet-client/FileAssistant.WinClient.csproj
```

## 发布 exe

轻量版，要求目标机器已安装 .NET 8 Desktop Runtime：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
dotnet publish apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release -r win-x64 --self-contained false -o dist\windows-client-win-x64
```

输出：

```text
dist\windows-client-win-x64\FileAssistantClient.exe
```

单文件自包含版，不要求目标机器安装 .NET 运行时，但体积更大：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
dotnet publish apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o dist\windows-client-win-x64-self-contained
```

输出：

```text
dist\windows-client-win-x64-self-contained\FileAssistantClient.exe
```

也可以运行：

```text
apps\windows-dotnet-client\publish-win-x64.cmd
```

## 正式安装包

构建自包含客户端安装包：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹 - 副本\file-assistant
.\deploy\client\build-client-installer.ps1
```

输出：

```text
deploy\client-installer\FileAssistantClientSetup.exe
```

静默安装示例：

```powershell
.\FileAssistantClientSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /SERVERURL="http://服务器IP:5177" /DEPLOYTOKEN="FA-XXXX-XXXX-XXXX-XXXX" /AUTOREGISTER=1 /RECEIVEDIR="D:\FileAssistant\Received"
```

安装器会把服务地址、部署令牌、安装码、自动注册、显示名、接收目录写入安装目录下的 `client-bootstrap.json`。客户端首次启动时读取该文件；注册成功后，用户级凭证保存到 `%APPDATA%\FileAssistant\client.json`。

## 白名单建议

现场加密软件白名单建议先添加：

```text
C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\dist\windows-client-win-x64\FileAssistantClient.exe
```

如果目标机器没有 .NET 8 Desktop Runtime，则添加自包含版：

```text
C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\dist\windows-client-win-x64-self-contained\FileAssistantClient.exe
```

如果白名单按文件 Hash 管控，每次重新发布 exe 后都需要重新更新白名单。正式分发前建议增加代码签名和固定安装目录。

## 后续方向

- 增加断点续传发现和继续上传。
- 增加代码签名。
- 增加设备指纹、网卡选择和更细的目录策略。
- 根据现场要求评估 Win7/8 legacy 客户端路线。
