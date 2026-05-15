# File Assistant

企业文件传输助手原型。当前版本用于先跑通业务闭环，后续可以逐步替换为生产级服务端、数据库和原生 Windows/macOS 客户端。

## 当前能力

- 管理控制台使用管理员账号密码登录；正式安装包首次打开管理端时创建第一个管理员。
- 数据保存到 SQLite：`data/file-assistant.sqlite`。
- 管理端支持组织架构：部门、人员、客户端绑定。
- 管理端支持发送规则：按发送部门和接收部门控制是否允许中转、是否需要中转确认、是否允许重要备份。
- 管理控制台生成安装码，支持一码一用/一码多用。
- 客户端通过安装码注册，记录显示名称、Mac、IP、平台。
- Windows 客户端支持服务台批量下发参数，首次启动可用部署令牌自动注册。
- Windows 客户端注册成功后会锁定服务地址、显示名、MAC、IP 和安装码，避免员工误改导致离线。
- Windows 客户端支持管理员维护模式，可清除本机注册凭证后重新注册。
- 管理端可停用客户端、设置脱管后是否允许继续使用。
- 可按 Mac、IP、平台、状态批量修改工具内显示名称。
- 客户端可指定组织人员发送文件，服务端会选择该人员绑定的活跃客户端接收。
- 发送者只能查看状态，不能取回自己上传的文件。
- 文件采用分块上传，支持同名同大小未完成任务断点续传。
- 默认上传完成后直接进入待接收；规则可按部门要求管理员中转确认。
- 管理员可按需查阅、下载服务端临时副本，并对需要确认的任务放行或驳回。
- 默认采用临时中转：接收端确认接收后，服务器自动清除文件。
- 支持重要备份：上传者可申请，管理员可标记/取消，接收后服务器保留备份。
- 管理员可手动清除服务器上的临时文件或备份文件。
- 接收者可接收发给自己的文件，不能查看其他人的文件。
- 未配置发送规则时默认允许互传并免中转确认；一旦启用规则，传输必须命中一条规则。
- 支持新增管理员账号，分配角色和权限。
- 记录安装码、注册、上传分片、上传完成、中转确认、文件访问、管理员登录等日志。

## 运行

建议使用 Node.js 24 或更高版本；最低需要 Node.js 22.5，以便使用内置 SQLite 存储。

默认地址：

- 首页：http://localhost:5177
- 管理控制台：http://localhost:5177/admin
- 客户端：http://localhost:5177/client

开发模式默认管理员账号：

```text
admin / admin123456
```

生产或演示时建议改掉：

```powershell
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD="your-strong-password"
node apps/server/server.js
```

为了兼容旧脚本，服务端仍支持 `ADMIN_TOKEN` / `X-Admin-Token` 方式；正式安装包默认不启用 Legacy 管理令牌，管理端页面使用账号密码登录。

## Windows 验证客户端

当前已经增加一个轻量 Windows 验证客户端，用来测试真实终端上的透明解密和落地加密行为。

说明文档见：`apps/windows-client/README.md`。

## Windows .NET 客户端

当前也新增了正式 Windows 客户端工程化起点，基于 `.NET 8 WinForms`：

说明文档见：`apps/windows-dotnet-client/README.md`。

自测会自动完成：生成安装码、注册两个客户端、创建部门和人员、绑定客户端、配置发送规则、按人员发送文件、管理员中转放行、发送者禁止取回、接收端接收确认、普通文件自动清除、重要备份保留、免确认自动流转、检查日志。

## 目录

```text
apps/server/        服务端 API 和数据库存储
apps/web/           管理端和客户端 Web UI
data/               SQLite 数据库、分片、上传文件
docs/               架构和路线文档
test/               接口闭环自测
```

## 操作手册

完整本地运行和 Windows 客户端测试步骤见：`docs/RUNBOOK.md`。

正式部署包说明见：`docs/DEPLOYMENT.md`。部署入口位于 `deploy/`，其中 `deploy/server/` 放服务端启动、停止、状态、备份和 Windows 服务安装脚本，`deploy/client/` 放 Windows 客户端下发包。

如需给客户交付免 Node 依赖的服务端安装器，运行：

```powershell
.\deploy\server\build-server-installer.ps1
```

生成结果位于：`deploy/server-installer/FileAssistantServerSetup.exe`。

该安装器由 Inno Setup 生成，支持双击打开标准安装向导，并会自动请求管理员权限；客户服务器不需要手动安装 Node.js。

## 当前限制

- 当前是单机原型，数据保存在 `data/file-assistant.sqlite`。
- 文件内容当前由服务端落盘保存，尚未实现生产级端到端加密。
- 客户端主流程暂不做预览、截屏、防复制等终端权限控制；这些能力优先交给现场已有加密软件。
- Mac/IP 在 Web 原型中由用户填写；原生客户端阶段应由系统 API 自动采集并签名上报。
