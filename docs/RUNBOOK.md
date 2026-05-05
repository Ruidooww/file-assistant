# 运行与测试手册

本文档记录当前原型的本地运行、管理端配置、Windows 客户端测试步骤。

## 1. 启动服务端

打开 PowerShell：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
node apps/server/server.js
```

如果当前 Codex 环境里的 `node` 被系统限制，可以使用完整路径：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
& "C:\Program Files\nodejs\node.exe" apps/server/server.js
```

看到类似下面的信息就说明服务端已启动：

```text
File Assistant server running at http://localhost:5177
```

服务端窗口不要关闭。

## 2. 打开管理端

浏览器访问：

```text
http://localhost:5177/admin
```

默认账号：

```text
admin
admin123456
```

## 3. 生成安装码

在管理端执行：

1. 登录管理控制台。
2. 找到安装码区域。
3. 生成一个安装码。
4. 可以按需要设置一码一用或一码多用。

## 4. 启动 Windows .NET 客户端

打开 PowerShell：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\apps\windows-dotnet-client
dotnet run
```

也可以双击：

```text
C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\apps\windows-dotnet-client\start-client.cmd
```

## 4.1 发布 Windows 客户端 exe

如果现场加密软件白名单需要 `.exe`，可以发布 Release 版客户端。

轻量版，要求目标机器已安装 .NET 8 Desktop Runtime：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
dotnet publish apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release -r win-x64 --self-contained false -o dist\windows-client-win-x64
```

白名单路径：

```text
C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\dist\windows-client-win-x64\FileAssistantClient.exe
```

自包含单文件版，不要求目标机器安装 .NET 运行时，但体积更大：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
dotnet publish apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o dist\windows-client-win-x64-self-contained
```

白名单路径：

```text
C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\dist\windows-client-win-x64-self-contained\FileAssistantClient.exe
```

也可以运行一键发布脚本：

```text
C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\apps\windows-dotnet-client\publish-win-x64.cmd
```

如果加密软件按文件 Hash 加白名单，每次重新发布 exe 后都要重新添加或更新白名单。正式分发前建议增加代码签名和固定安装目录。

## 5. 注册客户端

在 Windows 客户端里：

1. 服务地址填写 `http://localhost:5177`。
2. 填写管理端生成的安装码。
3. 显示名称可以保留默认值，也可以改成易识别名称。
4. MAC 和 IP 会自动读取，也可以手动确认。
5. 点击“注册”。

注册成功后，客户端凭证会保存到：

```text
%APPDATA%\FileAssistant\client.json
```

注册成功后，Windows .NET 客户端会自动锁定服务地址、显示名称、MAC、IP 和安装码输入框。普通员工不能再随意修改这些关键连接信息；需要重新注册或变更服务器地址时，应由管理员下发维护操作。

## 5.1 服务台批量下发注册

如果有 100 台终端，不建议一台一台手动输入安装码。当前版本已经支持基础批量注册：

1. 管理端生成一个一码多用安装码，例如最大使用次数设置为 100。
2. 通过加密软件服务台或其他终端管理工具下发新版 `FileAssistantClient.exe`。
3. 下发启动命令时带上服务端地址和部署令牌：

```powershell
FileAssistantClient.exe --server http://服务器IP:5177 --deploy-token FA-XXXX-XXXX-XXXX-XXXX --auto-register
```

客户端首次启动会自动读取本机信息并注册。注册成功后，管理员在管理端把新注册的客户端绑定到对应人员即可。

管理端生成部署令牌后会直接显示服务台下发命令，可以复制后放进服务台任务里。令牌只显示一次；如果忘记复制，需要重新生成一个新的部署令牌。

如果服务台更适合下发环境变量，也可以这样：

```powershell
$env:FA_SERVER_URL="http://服务器IP:5177"
$env:FA_DEPLOY_TOKEN="FA-XXXX-XXXX-XXXX-XXXX"
$env:FA_AUTO_REGISTER="1"
FileAssistantClient.exe
```

## 5.2 客户端维护重置

注册成功后，Windows .NET 客户端会锁定关键配置。普通员工不能修改服务地址、显示名、MAC、IP 和安装码。

需要重新注册或切换服务器地址时，由管理员用维护模式启动客户端：

```powershell
FileAssistantClient.exe --maintenance
```

维护模式只在已注册客户端上显示“维护重置”按钮。点击后会清除本机注册凭证并解除锁定，然后可以重新注册。

## 6. 绑定组织人员

回到管理端：

1. 创建部门。
2. 创建人员。
3. 在客户端列表里找到刚注册的客户端。
4. 把客户端绑定到对应人员。

如果要测试 A 发给 B，至少需要两个客户端，或者在两台机器上分别注册两个客户端并绑定到不同人员。

## 7. 客户端刷新

回到 Windows 客户端：

1. 点击“刷新”。
2. 如果绑定成功，接收人员下拉框会出现可发送对象。
3. 传输列表会显示和当前客户端相关的发送/接收记录。

Windows .NET 客户端现在也会每 10 秒自动刷新一次。接收方不需要一直手动刷新；当新文件已经放行或免确认进入待接收状态时，客户端会弹出系统托盘提示，并把窗口恢复到前台。

## 8. 发送文件

在发送方 Windows 客户端：

1. 选择接收人员。
2. 选择本地文件。
3. 按需要勾选“重要备份”。
4. 点击“上传”。

上传完成后，如果当前规则需要中转确认，管理端需要放行；如果规则免确认，文件会直接进入等待接收。

## 9. 管理端中转确认

在管理端：

1. 找到待确认文件。
2. 可以查看文件信息。
3. 点击放行。

放行后，接收方客户端刷新即可看到待接收文件。

如果接收方使用的是新版 Windows .NET 客户端，通常不需要手动刷新；客户端会在下一次自动刷新时提示新文件。

## 10. 接收文件

在接收方 Windows 客户端：

1. 点击“刷新”。
2. 选中发给我的文件。
3. 选择落地目录。
4. 点击“接收选中”。

客户端只有在文件成功写入落地目录，并完成大小校验后，才会调用服务端确认接收接口。

普通临时文件确认接收后，服务端会自动清除服务器文件；重要备份文件会保留。

## 11. 当前已确认状态

截至当前测试：

- 服务端 `http://localhost:5177` 可以正常访问。
- 管理端 `http://localhost:5177/admin` 可以登录。
- Windows .NET 客户端可以启动。
- Windows .NET 客户端可以连接服务端。
- 用户已手工测试基础流程可用。

## 12. 常见问题

### 客户端提示未注册

先在管理端生成安装码，然后在客户端填写安装码并点击注册。

### 客户端接收人员为空

通常是客户端还没有绑定组织人员。回到管理端，把客户端绑定到人员后，再点击客户端“刷新”。

### 服务端打不开

检查服务端 PowerShell 窗口是否还开着。如果窗口关了，重新执行：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
node apps/server/server.js
```

### PowerShell 里 npm 报执行策略错误

可以使用：

```powershell
npm.cmd -v
```

或者执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

然后重新打开 PowerShell。
