# Windows 验证客户端

这是文件助手的 Windows 原生验证客户端 MVP。

它先采用 PowerShell + WinForms 实现，不需要 Node.js，也不需要 .NET SDK 编译。目标是尽快验证真实终端环境里的两个关键问题：

- 客户端读取本地受控文件时，现场加密软件是否会按白名单策略透明解密。
- 客户端把接收文件写入目标目录后，现场加密软件是否会自动落地加密。

## 运行方式

先启动服务端：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
node apps/server/server.js
```

如果没有单独安装 Node.js，可以使用当前 Codex 环境自带的 Node：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant
& "C:\Users\Ruidoww\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" apps/server/server.js
```

然后启动 Windows 客户端：

```powershell
cd C:\Users\Ruidoww\OneDrive\桌面\新建文件夹\file-assistant\apps\windows-client
.\start-client.cmd
```

也可以直接右键或双击 `start-client.cmd`。

## 使用流程

1. 在管理端进入 `http://localhost:5177/admin`。
2. 生成安装码。
3. 打开 Windows 客户端。
4. 填写服务地址、安装码、显示名称。
5. 客户端会自动读取本机 MAC 和 IP，也可以手动改。
6. 点击“注册客户端”。
7. 回到管理端，把该客户端绑定到组织人员。
8. 在客户端点击“刷新”。
9. 选择接收人员和本地文件，点击“上传”。
10. 文件放行后，接收方客户端刷新并选择记录。
11. 选择落地目录，点击“接收选中文件”。

客户端只有在文件成功写入本地目录，并完成大小校验后，才会调用服务端确认接收接口。普通临时中转文件会在确认后由服务端自动清除。

## 配置保存位置

客户端凭证保存到：

```text
%APPDATA%\FileAssistant\client.json
```

如果需要重新注册，可以删除该文件，或用新的安装码注册覆盖当前凭证。

## 当前限制

- 这是验证客户端，不是最终安装包。
- 上传和下载暂时在 UI 线程中执行，大文件时界面会有短暂卡顿。
- 当前自动读取第一个可用网卡的 MAC/IP，后续正式版会做更完整的网卡选择和设备指纹。
- 还没有 Windows 服务、自启动、托盘、自动更新、签名安装包。
- Win7/8 的最终支持需要结合现场 .NET/PowerShell 版本再做兼容测试。
