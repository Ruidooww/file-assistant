# File Assistant 客户端下发包

本目录放正式下发给 Windows 终端的客户端程序。

## 目录选择

- `win-x64/`：轻量版，需要目标机器已安装 .NET 8 Desktop Runtime。
- `win-x64-self-contained/`：自包含版，不要求目标机器安装 .NET，体积更大。

优先使用轻量版；如果终端没有 .NET 8 Desktop Runtime，使用自包含版。

## 批量下发命令

管理端生成“一码多用”的批量部署令牌后，通过服务台或终端管理工具下发：

```powershell
.\FileAssistantClient.exe --server http://服务器IP:5177 --deploy-token FA-XXXX-XXXX-XXXX-XXXX --auto-register
```

如果需要指定员工侧接收目录：

```powershell
.\FileAssistantClient.exe --server http://服务器IP:5177 --deploy-token FA-XXXX-XXXX-XXXX-XXXX --auto-register --receive-dir "D:\FileAssistant\Received"
```

## 维护重置

客户端注册成功后会锁定服务地址、显示名、MAC、IP 和安装码。需要重新注册时，由管理员运行：

```powershell
.\FileAssistantClient.exe --maintenance
```

然后点击客户端里的“维护重置”。
