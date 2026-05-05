# File Assistant 正式部署包

本目录是正式部署入口，分为服务端部署脚本和 Windows 客户端下发包。

```text
deploy/
  server-installer/ 服务端正式安装器，内置 Node 运行时和服务包装器
  server/   服务端启动、停止、状态、备份和 NSSM 服务安装脚本
  client/   Windows 客户端下发包和批量注册命令示例
  logs/     脚本启动或 Windows 服务运行日志
  run/      脚本启动时保存的 PID 文件
```

完整步骤见：`docs/DEPLOYMENT.md`。
