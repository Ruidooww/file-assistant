# File Assistant 继续工作交接摘要

更新时间：2026-05-04

## 1. 当前目标

当前项目已经从“文件审批平台”收敛为“跨加密体系文件中转桥 + 轻量审计”。核心目标是先保证公司内部不同加密环境之间可以稳定、安全地传文件：

- 需要一台中转服务器，客户端 A 上传，客户端 B 接收。
- 普通文件默认临时中转，B 确认接收后服务器自动清除。
- 重要文件由发送方勾选“重要备份”，服务器才保留副本。
- 不重复建设现场加密软件已有的复杂审批、截屏、防复制、打印管控等能力。
- 管理端保留组织架构、客户端绑定、安装码/部署令牌、发送规则、可选中转确认、日志、备份和清除能力。
- 最新用户意图：准备复制一个完整项目副本，在新会话和新文件夹里制作正式部署包，避免污染当前开发测试项目。

## 2. 已完成的修改

- 服务端默认发送规则改为“允许中转 + 免中转确认 + 允许重要备份”。
- 新建发送规则时，“需要中转确认”默认不勾选。
- 管理端文案已从“审批/批准/拒绝/免审批”改为“中转确认/放行/驳回/免确认”。
- Web 客户端已去掉接收者预览、接收端截屏等控制项。
- Windows .NET 客户端已去掉“允许预览”上传项，上传时固定 `AllowPreview = false`。
- Windows .NET 客户端传输列表状态改为中文显示。
- Windows .NET 客户端发送区 UI 已多次调整：进度条独占一行，状态文字独占一行，进度条行高与输入框一致。
- Windows .NET 客户端注册成功后会锁定服务地址、显示名、MAC、IP、安装码，避免员工误改导致离线。
- Windows .NET 客户端支持批量部署启动参数：
  - `--server`
  - `--deploy-token`
  - `--install-code`
  - `--auto-register`
  - `--display-name`
  - `--receive-dir`
  - `--maintenance`
- Windows .NET 客户端支持维护模式：管理员用 `FileAssistantClient.exe --maintenance` 启动后，已注册客户端会显示“维护重置”，可清除本机注册凭证后重新注册。
- 服务端新增 `/api/client/auto-register` 自动注册接口；`/api/client/register` 也接受 `deployToken` 字段。
- 当前“部署令牌”暂时复用管理端生成的一码多用安装码。
- 管理端“生成安装码”区域已改为“安装码 / 部署令牌”。
- 管理端生成部署令牌后会直接展示服务台下发命令，并支持复制令牌、复制部署命令。
- 管理端日志显示增加中文动作名称。
- README、运行手册、架构文档、Windows 客户端说明已同步。
- `.gitignore` 已忽略本地 `.dotnet-home/` 验证目录。
- 已多次发布 Windows 客户端 exe，最新推荐使用 `deploy-maintenance` 目录版本。

## 3. 改过哪些文件

- `apps/server/server.js`
  - 默认隐式发送规则改成免中转确认。
  - 新建规则默认 `requireApproval` 只有显式传 `true` 才启用。
  - 创建传输任务时，仅命中规则显式要求确认才进入待确认。
  - 注册接口支持 `deployToken`。
  - 新增 `/api/client/auto-register`。

- `apps/server/db.js`
  - 传输规则默认不要求中转确认。
  - `transfers.approval_required` 默认值改为 `0`。
  - 旧数据缺少 `approvalRequired` 时按免确认归一化。

- `apps/web/admin.html`
  - 管理端指标、发送规则、文件中转区域、管理员角色文案改为中转确认口径。
  - 安装码区域改成“安装码 / 部署令牌”。
  - 增加部署服务地址输入框。
  - 增加“批量部署令牌”选项。

- `apps/web/assets/admin.js`
  - 状态、按钮、提示语从审批口径改成中转确认口径。
  - 新增日志动作中文显示。
  - 生成部署令牌后自动展示：
    `FileAssistantClient.exe --server ... --deploy-token ... --auto-register`
  - 支持复制令牌、复制部署命令。
  - 规则表单提交后默认不勾选“需要中转确认”。

- `apps/web/assets/styles.css`
  - 调整 `code-box` 间距，方便展示部署命令。

- `apps/web/client.html`
  - 删除客户端上传时的预览/截屏勾选项。
  - 删除 Web 客户端预览面板。
  - 文件中转说明改为“发送方只能查看状态；发给你的文件放行后可接收”。

- `apps/web/assets/client.js`
  - 删除 Web 客户端预览按钮和预览逻辑。
  - 上传控制固定为接收端可接收、不可预览。
  - 上传完成提示改为“等待接收方接收或中转确认”。

- `apps/windows-dotnet-client/MainForm.cs`
  - 删除“允许预览”复选框。
  - 上传请求固定 `AllowPreview = false`。
  - 传输列表状态改为中文显示。
  - 调整发送区 UI。
  - 注册后锁定关键连接配置。
  - 首次启动可根据部署参数自动注册。
  - 维护模式下可清除本机注册凭证并重新注册。

- `apps/windows-dotnet-client/ClientBootstrapOptions.cs`
  - 新增启动参数和环境变量解析。
  - 支持服务端地址、部署令牌、普通安装码、自动注册、维护模式、显示名、接收目录。

- `apps/windows-dotnet-client/FileAssistantApiClient.cs`
  - 新增自动注册 API 调用。

- `apps/windows-dotnet-client/Models.cs`
  - 注册请求新增 `DeployToken` 字段。

- `test/api.test.js`
  - 新增默认免确认中转测试。
  - 覆盖 `/api/client/auto-register` + `deployToken` 自动注册。
  - 原有需要中转确认的端到端流程继续保留。

- 文档：
  - `README.md`
  - `docs/RUNBOOK.md`
  - `docs/ARCHITECTURE.md`
  - `apps/windows-dotnet-client/README.md`
  - `apps/windows-client/README.md`
  - `HANDOFF.md`

- `.gitignore`
  - 忽略 `.dotnet-home/`。

## 4. 还没完成什么

- 还没有把服务端打包为独立 `.exe`；当前正式部署方式是 Node.js + PowerShell 脚本，Windows Service 方案使用 NSSM。
- 还没有管理端单独的“部署任务/部署令牌”页面，目前部署令牌复用一码多用安装码。
- 还没有组织架构表格导入，用户暂时决定先不做。
- 自动注册后还不能自动按人员表绑定，需要后续配合域账号/电脑名/MAC 自动匹配。
- 管理端文件查阅/下载能力还没有做成开关。
- 与现场加密软件白名单、透明解密、落地加密还未联调。
- macOS 客户端尚未开始。
- 生产级端到端加密、大文件并发分片、Hash 校验、失败重试还未实现。
- 当前正式部署仍建议先用 SQLite，后续并发/规模变大后再考虑 PostgreSQL 或 SQL Server。

## 5. 关键实现思路

- 当前架构是“客户端 -> 中转服务器 -> 接收客户端”。
- 服务端使用 Node.js 内置 HTTP API，默认数据保存到 SQLite：`data/file-assistant.sqlite`。
- 正式部署当前不需要手动安装数据库；服务端启动时会自动创建 `data` 目录和 SQLite 数据库。
- `data` 目录是正式部署最重要的持久化目录，包含数据库、上传分片、临时文件、备份文件，必须备份。
- 普通文件接收完成后，服务端清除服务器副本。
- 重要备份文件接收完成后，服务端保留服务器副本。
- 没有任何发送规则时，默认允许互传并免中转确认。
- 有发送规则时，必须命中一条规则；规则可设置是否需要中转确认、是否允许重要备份。
- 发送方不能下载自己上传的文件，只能查看状态。
- 接收方只能接收发给自己的文件。
- 客户端注册成功后锁定关键配置，避免员工误改。
- 批量部署第一阶段复用“一码多用安装码”作为部署令牌，下发命令示例：
  `FileAssistantClient.exe --server http://服务器IP:5177 --deploy-token FA-XXXX-XXXX-XXXX-XXXX --auto-register`
- 如需重新注册客户端，由管理员使用：
  `FileAssistantClient.exe --maintenance`
  然后点击“维护重置”。
- 正式部署副本已经清理开发产物：`data/`、`dist/`、`.dotnet-home/`、Windows 客户端 `bin/obj`、根目录运行日志均已移除。
- 正式部署入口在 `deploy/`：
  - `deploy/server-installer/`：服务端正式安装器，内置 Node 运行时和自包含 Windows Service 包装器。
  - `deploy/server/`：配置样例、启动、停止、状态、备份、NSSM 安装/卸载脚本。
  - `deploy/client/`：Windows 客户端下发包和批量部署命令示例。
  - `docs/DEPLOYMENT.md`：生产部署说明。

## 6. 已运行/未运行的测试

最近已运行并通过：

- `C:\Program Files\nodejs\node.exe --check apps/server/server.js`
- `C:\Program Files\nodejs\node.exe --check apps/web/assets/admin.js`
- `C:\Program Files\nodejs\node.exe --check apps/web/assets/client.js`
- PowerShell AST 解析检查 `deploy/**/*.ps1`、`deploy/**/*.psm1`
- `C:\Program Files\nodejs\node.exe --test test/api.test.js`
  - 2 个测试通过。
  - 覆盖默认免确认中转。
  - 覆盖 `/api/client/auto-register` + `deployToken` 自动注册。
  - 覆盖需要中转确认、放行、接收确认、普通文件清除、重要备份保留、日志。
- 部署脚本冒烟：
  - `deploy/server/start-server.ps1`
  - `deploy/server/status-server.ps1`
  - `deploy/server/stop-server.ps1`
  - 健康检查 `http://127.0.0.1:5177/api/health` 返回 OK。
  - 冒烟产生的 `data/`、`deploy/logs/*`、`deploy/run/*` 已清理。
- 服务端安装器已生成并验证：
  - `deploy/server-installer/FileAssistantServerSetup.exe`
  - 安装器内置 `runtime/node/node.exe`，客户服务器不需要手动安装 Node.js。
  - 安装器已改为 Inno Setup 标准安装向导，双击会显示语言选择、欢迎页、安装目录、服务配置、任务选择等标准页面，并自动请求管理员权限。
  - 已用 Inno 静默安装参数安装到临时目录，验证内置 Node 可启动服务端，健康检查 OK，卸载 OK。
  - `build-server-installer.ps1` 现在委托给 `build-inno-server-installer.ps1`，避免误生成旧 WinForms 自定义安装器。
- `dotnet build apps/windows-dotnet-client/FileAssistant.WinClient.csproj --no-restore`
  - 0 个警告，0 个错误。
- 已发布并拷贝到正式客户端下发包，最新推荐：
  - `deploy/client/win-x64/FileAssistantClient.exe`
  - `deploy/client/win-x64-self-contained/FileAssistantClient.exe`

未运行：

- 未重新用浏览器完整手工点一遍管理端和 Web 客户端。
- 未在三台虚拟机环境重新跑服务端 + 两客户端互传。
- 未测试服务台真实下发。
- 未与现场加密软件白名单环境联调。

## 7. 下一步应该怎么做

正式部署包已经在当前副本里制作完成。建议下一步按这个流程验收：

1. 在 Windows Server VM 上复制当前 `file-assistant` 目录。
2. 推荐直接用 `deploy/server-installer/FileAssistantServerSetup.exe` 安装服务端；这种方式已内置 Node.js，不需要客户手动安装 Node。
3. 如果不用安装器，再安装 Node.js 24 或更新版本，并复制编辑 `deploy/server/config.example.ps1` 为 `deploy/server/config.ps1`。
4. 用安装器启动 Windows Service，或用 `deploy/server/start-server.ps1` 脚本启动。
5. 浏览器访问 `http://服务器IP:5177/admin`。
6. 生成批量部署令牌。
7. 在两台客户端 VM 上使用 `deploy/client/` 下发包自动注册。
8. 管理端绑定人员。
9. A 发给 B，B 接收成功。
10. 普通文件接收后服务器自动清除。
11. 重要备份文件接收后服务器保留副本。

## 最新推荐客户端 exe

- 轻量版，需要目标机器安装 .NET 8 Desktop Runtime：
  `deploy/client/win-x64/FileAssistantClient.exe`

- 自包含版，不要求目标机器安装 .NET，体积更大：
  `deploy/client/win-x64-self-contained/FileAssistantClient.exe`
