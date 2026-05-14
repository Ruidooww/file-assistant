# File Assistant 继续工作交接摘要

## 2026-05-14 代码审查 Round 4 — 最终验证

审查范围：Round 3 修复验证 + 全量代码复验。

### Round 3 修复验证 ✅ 全部通过

`"approved"` 旧状态已在以下位置彻底清理：
- `db.js` normalizeTransfer 数据层规范化
- `server.js` 运行时状态判断（client receive、confirm delivery）
- `admin.js` / `client.js` Web 前端状态展示
- `MainForm.cs` Windows 客户端状态展示
- `api.test.js` 历史数据规范化测试 + 管理端放行测试改为 `"ready_to_deliver"`

### 新发现的建议项 🟢（低优先级）

1. **JsonStore mutate 与 SqliteStore mutate 行为不一致**（`db.js:554-570`）：JsonStore 原地修改 `this.data`，写入失败后内存状态已变但未持久化；SqliteStore 先 clone 再改。建议 JsonStore 也改为 clone-before-mutate 与 SQLite 保持一致。
2. **snapshot() 调用频率偏高**：客户端轮询每次触发 2 次 `snapshot()`（9 表 SELECT），后续客户端增多时可加 TTL 缓存。
3. **rowSignature 双重 JSON.stringify**：不影响正确性，极低优先级。

### 当前状态

- `npm test`：9 项全部通过。
- `dotnet build`：0 警告 0 错误。
- 待排期项与上轮一致：P1 JSON 同步写入、P2 路由拆分、P2 MainForm 拆分、P3 配置统一。

---

## 2026-05-14 审查修复 Round 3 transfer 状态清理已完成

已完成 P3 中 `"approved"` 旧状态的清理：

- `apps/server/db.js`
  - `normalizeTransfer` 会把历史数据里的 `status: "approved"` 规范化为 `status: "ready_to_deliver"`。
  - `deliveryStatus` 推导逻辑只按 `"ready_to_deliver"` / `"delivered"` 判断，不再把 `"approved"` 当运行时状态。

- `apps/server/server.js`
  - 客户端收文件、确认送达的运行时状态判断只接受 `"ready_to_deliver"`。
  - 管理端 PATCH 仍兼容旧请求值 `"approved"`，但会立即写成 `"ready_to_deliver"`。
  - 日志事件名 `transfer.approved` / `transfer.auto_approved` 保留，含义是“放行动作”，不是 transfer 状态。

- `apps/web/assets/admin.js`
  - 管理端“放行”按钮现在提交 `status: "ready_to_deliver"`。
  - 状态展示映射移除旧 `"approved"` 状态。

- `apps/web/assets/client.js`
  - 客户端接收按钮只按 `"ready_to_deliver"` 判断可接收。
  - 状态展示映射移除旧 `"approved"` 状态。

- `apps/windows-dotnet-client/MainForm.cs`
  - 收文件和待接收提醒只按 `"ready_to_deliver"` 判断。
  - 状态展示移除旧 `"approved"` 分支。

- `test/api.test.js`
  - 新增历史 `"approved"` 状态规范化测试。
  - 管理端放行测试改为提交 `"ready_to_deliver"`。

验证：

- `npm test` 通过，9 个测试全绿。
- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release` 通过，0 警告 0 错误。

仍建议后续排期：

- P1 剩余：JSON store 写入仍是同步全量 stringify。
- P2：`handleApi` 拆分、`MainForm.cs` 拆分。
- P3 剩余：配置项分散，后续统一到单一配置文件。

## 2026-05-14 审查修复 Round 2 SQLite 差异写入已完成

已完成 P1 中 SQLite 全量重写问题的主要修复：

- `apps/server/db.js`
  - 新增 `SQLITE_TABLE_SPECS`，集中定义各业务表的序列化和 `ON CONFLICT(id) DO UPDATE` 写入规则。
  - `SqliteStore.mutate(fn)` 现在会保留变更前快照，执行业务 mutation 后调用 `applyChanges(before, data)`。
  - `applyChanges` 只对发生变化的行执行单行 upsert/delete，不再每次 `DELETE FROM` 全表再重插全库。
  - `replaceAll` 仍保留给初始化和 JSON 迁移使用。
  - 新增 `pruneLogRows()`，差异写入后仍会裁剪 SQLite 日志表到最近 1000 条，避免旧数据残留。

- `test/api.test.js`
  - 新增 `sqlite mutate applies differential writes without replaceAll` 测试。
  - 测试会把 `store.replaceAll` 替换成抛错函数，确认普通 `mutate` 不再依赖全量重建。
  - 同时验证单行更新、删除和日志插入后 `snapshot()` 结果正确。

验证：

- `npm test` 通过，8 个测试全绿。

仍建议后续排期：

- P1 剩余：JSON store 写入仍是同步全量 stringify，可后续做异步/节流写入或继续只作为 fallback。
- P2：`handleApi` 拆分、`MainForm.cs` 拆分。
- P3：清理未使用的 `"approved"` 状态判断、统一配置。

## 2026-05-14 审查修复 Round 1 已完成

已完成本轮建议先修的高优先级项：

- `apps/server/db.js`
  - `JsonStore` 和 `SqliteStore` 增加 `consecutiveMutateWriteFailures`。
  - 真正写入失败时记录 `[FileAssistant] ... mutate write failed` 日志。
  - 成功写入后重置连续失败计数。
  - 避免把 `mutate(fn)` 内部正常抛出的 4xx 业务错误误记成存储故障。

- `apps/server/server.js`
  - `mergeTransferFile` 合并失败时等待 writer 关闭，再清理 `uploads/<transferId>` 输出目录。
  - 新增统一 `pipeFileToResponse`，用于普通传输文件、专属客户端安装包下载、静态资源响应。
  - 响应提前关闭时销毁读流；读流错误时记录日志并关闭响应，降低文件句柄泄漏风险。

- `test/api.test.js`
  - 新增 JSON store 写失败日志与队列恢复测试。
  - 新增合并失败清理半成品上传目录测试。

验证：

- `npm test` 通过，7 个测试全绿。

仍建议后续排期：

- P1：SQLite 定向写入，减少全量 `DELETE + INSERT`。
- P1：JSON 存储异步/节流写入或更细粒度持久化。
- P2：`handleApi` 拆分、`MainForm.cs` 拆分。
- P3：清理未使用的 `"approved"` 状态判断、统一配置。

## 2026-05-14 代码审查 — 总览与当前状态

审查范围：`apps/server/server.js`、`apps/server/db.js`、`apps/windows-dotnet-client/`、`test/api.test.js`。聚焦内网场景的**数据可靠性、性能、资源管理和可维护性**。

### 已修复（Round 1 + Round 2 + Round 3）

| # | 问题 | 修复方式 | 轮次 |
|---|------|----------|------|
| 1 | `mutate` 写入错误被静默吞没 | 加 `consecutiveMutateWriteFailures` 日志 + 连续失败计数 | R1 |
| 2 | SQLite 每次写入全量 DELETE+INSERT | 新增 `applyChanges` 差异 upsert/delete，`replaceAll` 仅保留给初始化和 JSON 迁移 | R2 |
| 3 | 文件合并失败不清理垃圾文件 | catch 中 `fs.rmSync(paths.fileDir, ...)` | R1 |
| 4 | 文件下载流无错误处理，客户端断开泄漏 fd | 抽取 `pipeFileToResponse`，统一处理 `res.on("close")` 销毁读流 | R1 |
| 8 | transfer 状态机 `"approved"` 死代码 | 历史数据规范化到 `"ready_to_deliver"`，运行时判断只使用 `"ready_to_deliver"` | R3 |

### 仍待排期

| # | 问题 | 位置 | 优先级 |
|---|------|------|--------|
| 5 | JSON store 写入仍是同步全量 `stringify` | `db.js:177-181` `JsonStore.write` | P1（仅旧 Node 降级 fallback，实际影响小） |
| 6 | `handleApi` 路由函数 1030 行 if-else | `server.js:597-1626` | P2 — 拆为 `routes/admin.js` + `routes/client.js` |
| 7 | `MainForm.cs` 1513 行单文件 | `MainForm.cs` | P2 — 拆为 partial class（UI / Transfers / Tray） |
| 9 | 配置项分散多层级，环境变量名新旧混用 | `server.js:580-594` | P3 — 后续统一到单一配置文件 |

验证基准：`npm test` 当前 9 项全部通过。

---

## 2026-05-14 管理端现场生成专属客户端安装包

### 当前目标

让客户服务器上的 Web 管理端可以现场生成单文件专属客户端安装包。员工拿到该 EXE 后正常双击安装，但不需要输入服务器地址，也不需要手动注册；安装完成后客户端自动读取内置配置并使用部署令牌注册。

### 已完成的修改

- 客户端 Inno 安装器支持读取自身 EXE 尾部的 `FA_CLIENT_BOOTSTRAP_V1_BEGIN/END` 配置块。
- 专属 EXE 内置 `serverUrl`、`deployToken`、`autoRegister` 后，安装器会跳过“服务端地址”配置页，并继续写入 `client-bootstrap.json`。
- 服务端新增 `POST /api/admin/client-packages`，自动创建批量部署令牌、复制通用客户端安装器模板、在 EXE 尾部追加专属配置。
- 服务端新增 `GET /api/admin/client-packages/:fileName/download`，管理员鉴权后下载生成的专属客户端安装包。
- 管理端新增“专属客户端安装包”面板，可填写服务端地址、用途名称、可安装设备数、有效天数、脱管策略，生成后直接下载。
- 服务端安装包现在会内置通用客户端安装器模板：`deploy/client-installer/FileAssistantClientSetup.exe`。
- 服务端构建脚本在缺少客户端安装器模板时会先自动构建客户端安装包。

### 改过哪些文件

- `apps/server/server.js`
- `apps/web/admin.html`
- `apps/web/assets/admin.js`
- `apps/web/assets/styles.css`
- `installer/client-inno/FileAssistantClient.iss`
- `installer/server-inno/FileAssistantServer.iss`
- `deploy/server/build-inno-server-installer.ps1`
- `test/api.test.js`

### 已验证

- `npm test`：5 项通过，新增“管理员生成专属客户端安装包”测试。
- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release`
- `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release`
- `dotnet build tools\server-service\FileAssistantServerService.csproj -c Release`
- `.\deploy\client\build-client-installer.ps1`
- `.\deploy\server\build-server-installer.ps1`
- 本机静默烟测：临时生成尾部带配置的专属客户端 EXE，使用 `/VERYSILENT /CURRENTUSER` 安装到临时目录，确认 `client-bootstrap.json` 写入正确的 `serverUrl`、`deployToken`、`autoRegister=true`，随后卸载清理。
- 本地 HTTP 烟测：`/admin` 能加载新增管理端资源，`POST /api/admin/client-packages` 可用真实客户端安装器模板生成专属 EXE 下载信息。

### 最新安装包

- 服务端：`deploy/server-installer/FileAssistantServerSetup.exe`
  - 大小：`183,268,877 bytes`
  - 生成时间：`2026-05-14 13:37:54`
  - SHA256：`BC1DE58A5064B5D766252393690BE5A2E2313D01CC3478D6BF84E56B042490A7`
- 客户端：`deploy/client-installer/FileAssistantClientSetup.exe`
  - 大小：`66,604,071 bytes`
  - 生成时间：`2026-05-14 13:36:15`
  - SHA256：`36C45CCEEC3188879DAFBFE5DDBE64FF7AE2690F1AA698D290532C72A811E761`

### 仍需继续

- 在真实 Windows Server 2019 VM 安装最新服务端包，登录管理端生成专属客户端安装包并下载。
- 在干净 Windows 客户端 VM 双击专属 EXE，确认不出现服务端地址输入页，安装后自动注册到管理端。
- 代码签名暂未处理；当前“尾部追加配置”的方案会破坏既有签名，正式签名前需要改为生成后重新签名或切换 bootstrapper 方案。

## 2026-05-09 更换操作系统前总交接摘要

### 1. 当前目标

当前目标是把 `File Assistant` 做成可交付给客户的 Windows 正式部署版本：

- 服务端使用正式 Inno Setup 安装包交付，内置 Node.js 运行时，客户服务器不需要手动安装 Node。
- 服务端安装后注册为 Windows Service，后台长期运行；右下角托盘助手只负责本机管理入口。
- 管理端通过浏览器访问：`http://服务器IP:5177/admin`。
- 客户端使用正式 Inno Setup 安装包交付，内置自包含 .NET Windows 客户端，员工电脑不需要手动安装 .NET Runtime。
- 当前业务目标是先跑通“服务端 + 两台客户端 + 人员绑定 + 文件发送/接收 + 日志审计 + 普通文件自动清理 + 重要文件保留备份”的完整闭环。
- 后续升级策略倾向：常规功能升级用新版完整安装包覆盖安装；紧急小修可以做补丁升级包，但不建议让客户手动替换零散文件。

### 2. 已完成的修改

服务端安装包：

- 已从早期绿色/脚本部署，升级为正式 Inno Setup 安装包：`deploy/server-installer/FileAssistantServerSetup.exe`。
- 安装包内置：
  - Node.js：`runtime/node/node.exe`
  - 后端 Node 服务：`apps/server`
  - Web 管理端：`apps/web`
  - Windows Service 包装器：`FileAssistantServerService.exe`
  - 服务端右下角托盘：`FileAssistantServerTray.exe`
  - 运维脚本：`deploy/server/*.ps1`
- 安装器支持中文经典安装向导、许可协议、组件选择、安装目录、端口/IP 配置、附加任务、卸载入口。
- 安装时不再要求客户填写管理员账号、管理员密码、Windows 服务名、Legacy 管理令牌；初始管理员账号改为安装完成后首次进入 Web 管理端创建。
- 服务端地址支持自动补端口。填写 `192.168.157.138` 或 `http://192.168.157.138` 会自动写成 `http://192.168.157.138:5177`。
- 覆盖安装时会先停止旧服务、关闭托盘、清理旧 Node 进程，避免 `runtime\node\node.exe` 被占用导致错误代码 5。
- 服务安装从 `sc.exe create` 改为 PowerShell `New-Service -BinaryPathName`，修复 Windows Server 2019 干净虚拟机安装服务失败问题。
- 安装完成后可启动服务并访问 `/api/health` 做健康检查。
- 已有卸载器，卸载时会停止服务、移除服务、移除防火墙规则、清理安装目录运行配置；默认保留 `C:\ProgramData\FileAssistantServer` 下的数据、日志、备份。
- 新增管理员密码重置工具：开始菜单 `File Assistant Server -> 重置管理员密码`。
- 新增服务端/客户端统一图标，安装包 exe、客户端 exe、服务端托盘 exe、服务端服务 exe 均已接入图标。

服务端托盘：

- 托盘显示服务状态、访问地址、日志目录。
- 支持打开管理端、打开安装目录、打开日志目录、启动服务、停止服务、重启服务、退出托盘。
- 托盘读取 `deploy/server/config.ps1`，并对缺少端口的旧配置做兜底补端口。

管理端：

- 客户端绑定 UI 已从表格内下拉框改为弹窗绑定，避免表格挤压后按钮和选择框变成竖排。
- 客户端表格列宽、操作按钮、绑定人员列已调整，按钮不再按单个中文字符竖向换行。
- `/api/admin/clients` 和 `/api/client/me` 返回人员展示字段，客户端绑定后能显示人员姓名、工号、部门，而不是只显示内部 `emp_xxx`。
- 新增/修复免码注册能力，管理端开启免码注册后，客户端可只填服务端地址注册。

Windows 客户端：

- 已有正式 Inno Setup 安装包：`deploy/client-installer/FileAssistantClientSetup.exe`。
- 客户端安装包自包含 .NET 8 Windows 客户端。
- 支持安装参数：
  - `/SERVERURL=...`
  - `/DEPLOYTOKEN=...`
  - `/INSTALLCODE=...`
  - `/AUTOREGISTER=1`
  - `/DISPLAYNAME=...`
  - `/RECEIVEDIR=...`
- 安装器会写入 `client-bootstrap.json`，客户端首次启动读取并自动注册。
- 客户端支持只填写服务端地址后，走 `/api/client/open-register` 免码注册。
- 客户端右下角托盘已完成：打开主界面、打开接收目录、打开日志目录、重新连接、退出客户端。
- 修复长时间不使用后客户端黑屏、托盘无法重新弹出主界面的问题。
- 修复传输列表区域鼠标一直转圈、感觉不能点击的问题。
- 修复绑定人员后客户端只显示内部人员 ID、不显示后台创建人员姓名的问题。

### 3. 改过哪些文件

服务端核心：

- `apps/server/server.js`
- `apps/server/db.js`
- `test/api.test.js`

Web 管理端：

- `apps/web/admin.html`
- `apps/web/assets/admin.js`
- `apps/web/assets/styles.css`

Windows 客户端：

- `apps/windows-dotnet-client/MainForm.cs`
- `apps/windows-dotnet-client/Models.cs`
- `apps/windows-dotnet-client/FileAssistantApiClient.cs`
- `apps/windows-dotnet-client/ClientConfig.cs`
- `apps/windows-dotnet-client/ClientBootstrapOptions.cs`
- `apps/windows-dotnet-client/FileAssistant.WinClient.csproj`
- `apps/windows-dotnet-client/README.md`

服务端托盘和服务：

- `tools/server-tray/Program.cs`
- `tools/server-tray/FileAssistantServerTray.csproj`
- `tools/server-service/FileAssistantServerService.csproj`

安装包和部署脚本：

- `installer/server-inno/FileAssistantServer.iss`
- `installer/client-inno/FileAssistantClient.iss`
- `installer/server-inno/languages/ChineseSimplified.isl`
- `deploy/server/build-server-installer.ps1`
- `deploy/server/build-inno-server-installer.ps1`
- `deploy/server/install-service-native.ps1`
- `deploy/server/uninstall-service-native.ps1`
- `deploy/server/reset-admin-password.ps1`
- `deploy/client/build-client-installer.ps1`
- `deploy/client/build-inno-client-installer.ps1`
- `deploy/client/README.md`
- `deploy/server-installer/README.md`
- `deploy/client-installer/README.md`

图标资源：

- `assets/icons/file-assistant-client.ico`
- `assets/icons/file-assistant-client-256.png`
- `assets/icons/file-assistant-server.ico`
- `assets/icons/file-assistant-server-256.png`
- `tools/generate-app-icons.ps1`

文档：

- `docs/DEPLOYMENT.md`
- `HANDOFF.md`
- `.gitignore`

### 4. 还没完成什么

必须继续验收：

- 在真实 Windows Server 2019 虚拟机里安装最新服务端安装包，完整验证：
  - 全新安装
  - 覆盖安装
  - 卸载
  - 服务自动启动
  - 托盘菜单
  - 管理端访问
  - 管理员密码重置
- 在两台真实 Windows 客户端虚拟机里安装客户端，完整验证：
  - 填服务端地址免码注册
  - 客户端托盘常驻
  - 关闭窗口后从托盘恢复
  - 长时间不使用后不黑屏
  - A 发文件给 B，B 接收成功
  - 普通文件接收后服务端清理
  - 重要备份文件接收后服务端保留

产品化还没完成：

- 代码签名未做。正式客户交付前，服务端安装包、客户端安装包、托盘/服务/客户端 exe 都建议签名。
- 图标目前是程序生成的正式感图标，但还不是公司品牌定制图标。
- 没有图形化的管理员密码重置工具，目前是 PowerShell 控制台向导。
- 没有管理端“客户端下载/部署命令/生成专属客户端安装包”入口。
- 没有完整日志中心优化、日志筛选、诊断包导出。
- 没有服务端备份/恢复的 Web 图形界面。
- 没有数据库迁移版本体系；后续新增字段或表时需要补迁移机制。
- 没有自动升级/补丁升级工具；目前推荐用新版完整安装包覆盖安装。
- 没有做 Windows 10、Windows 11、Windows Server 2016/2019/2022 全矩阵测试。
- 没有做大文件、多并发、断网恢复、磁盘空间不足、杀软/白名单等异常测试。

### 5. 关键实现思路

服务端运行方式：

- 后端仍是 Node.js 单体服务。
- 当前默认数据存储是 SQLite/本地数据目录模式，适合单台服务器交付。
- Windows Service 负责后台长期运行，不显示 UI。
- 服务端托盘是单独 WinForms 用户态程序，只在有人登录桌面时显示；即使没有桌面登录，Windows Service 仍会后台运行。
- 客户访问管理端使用浏览器，不需要额外服务端控制台。

安装和升级方式：

- 客户首次部署和常规升级都优先使用完整 Inno Setup 安装包。
- 覆盖安装时自动停服务、替换程序、保留数据、启动服务、健康检查。
- 不建议客户手动替换两个文件；如果后续需要轻量升级，也应该做成补丁升级包或升级工具，自动完成停服务、备份、替换、迁移、启动、回滚。
- 安装目录默认：`C:\Program Files\FileAssistantServer`。
- 数据目录默认：`C:\ProgramData\FileAssistantServer`。
- 卸载默认保留数据目录，避免误删客户数据。

客户端注册方式：

- 第一阶段先支持通用客户端安装包 + 填服务端地址 + 免码注册或安装码注册。
- 第二阶段可做“服务台生成专属客户端安装包”：服务端地址、部署令牌、代码签名、令牌过期和下载都自动化。
- 当前为了降低客户部署复杂度，客户端安装页已经尽量减少要填字段；后续还可以继续做发现服务或二维码/部署链接注册。

未来架构方向：

- 当前 Node.js + SQLite 适合单台服务器稳定交付。
- 如果未来要做大规模、多服务器、高可用，可以升级到：
  - Node.js 后端服务集群
  - PostgreSQL
  - 对象存储
  - Redis / 消息队列
  - 独立文件服务
  - 多台服务器 / 负载均衡
- 不需要因为未来可能用 PostgreSQL/对象存储/Redis 就现在改写语言；语言可继续 Node.js，后续真要重写核心后端再优先考虑 Go，复杂企业后台再考虑 Java。

换系统后恢复开发环境：

- 需要安装 Git、Node.js、.NET 8 SDK、Inno Setup 6。
- 如果用 `winget`，Inno Setup 可用：
  `winget install --id JRSoftware.InnoSetup -e -s winget -i`
- 进入项目目录后先运行：
  - `npm test`
  - `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
  - `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release --no-restore`
  - `dotnet build tools\server-service\FileAssistantServerService.csproj -c Release --no-restore`
- 重新生成服务端安装包：
  `.\deploy\server\build-server-installer.ps1`
- 重新生成客户端安装包：
  `.\deploy\client\build-client-installer.ps1`

### 6. 已运行/未运行的测试

最近已经运行并通过：

- `npm test`
  - 4 项通过：
    - 初始管理员创建
    - 默认发送规则免确认中转
    - 免码注册
    - 文件传输确认流程
- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
- `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release --no-restore`
- `dotnet build tools\server-service\FileAssistantServerService.csproj -c Release --no-restore`
- `.\deploy\server\build-server-installer.ps1`
- `.\deploy\client\build-client-installer.ps1`
- 服务端安装包静默烟测：
  - 安装到临时目录
  - 确认包含 `reset-admin-password.ps1`
  - 确认开始菜单生成“重置管理员密码.lnk”
  - 确认配置地址带 `:5177`
  - 卸载和清理通过
- 管理员密码重置脚本烟测：
  - 旧密码失效
  - 新密码生效
  - 旧 session 清除
  - 审计日志写入
- 服务端地址端口烟测：
  - `/SERVERHOST=http://192.168.157.138 /PORT=5177`
  - 生成配置中 `PublicServerUrl` 为 `http://192.168.157.138:5177`

最新安装包：

- 服务端：`deploy/server-installer/FileAssistantServerSetup.exe`
  - 大小：`117,511,330 bytes`
  - 生成时间：`2026/5/7 11:48:53`
  - SHA256：`A2E310F9D65B083FA453B3BBD7CBE165304B3D5B9DFD415BC9ACEFAC8E3C8DC8`
- 客户端：`deploy/client-installer/FileAssistantClientSetup.exe`
  - 大小：`66,784,532 bytes`
  - 生成时间：`2026/5/7 11:48:13`
  - SHA256：`C7DA4B15A0F472355D3A84B46B420726C2DECAA3ABA63571D22F71E6681221D6`

仍未运行或需继续运行：

- 在真实 Windows Server 2019 VM 上重新跑最新服务端安装包。
- 在真实 Windows 客户端 VM 上重新跑最新客户端安装包。
- 真实服务环境下点击“重置管理员密码”验收。
- 两台客户端互传完整验收。
- 覆盖安装已安装旧版本服务端的现场验收。
- 卸载后重装验收。
- 大文件、多并发、断网、重启、磁盘空间不足测试。
- 代码签名后 SmartScreen/杀软误报测试。

### 7. 下一步应该怎么做

换系统前建议先备份：

- 整个项目目录：`C:\Users\Ruidoww\OneDrive\桌面\新建文件夹 - 副本\file-assistant`
- 最新服务端安装包：`deploy/server-installer/FileAssistantServerSetup.exe`
- 最新客户端安装包：`deploy/client-installer/FileAssistantClientSetup.exe`
- 本文件：`HANDOFF.md`

换系统后第一步：

1. 安装 Git、Node.js、.NET 8 SDK、Inno Setup 6。
2. 打开项目目录 `file-assistant`。
3. 先跑 `npm test` 和三个 `dotnet build`，确认开发环境恢复。
4. 重新生成服务端/客户端安装包，确认 Inno Setup 可用。

恢复后最优先继续做：

1. 在 Windows Server 2019 VM 安装最新服务端安装包。
2. 创建管理员账号并登录管理端。
3. 测试“重置管理员密码”入口：重置后确认服务恢复、新密码能登录。
4. 在两台 Windows 客户端 VM 安装最新客户端安装包。
5. 管理端开启免码注册，客户端只填 `http://服务器IP:5177` 注册。
6. 管理端绑定两个客户端到人员。
7. A 客户端发送文件给 B，B 接收。
8. 验证普通文件接收后清理、重要备份文件保留。
9. 验证客户端托盘、服务端托盘、安装包图标是否显示正常。
10. 如果以上都通过，再开始做“管理端客户端部署入口”和“日志中心优化”。

## 2026-05-07 客户端与服务端图标统一

本轮处理客户端和服务端/服务台图标过于默认、观感不够正式的问题。

已完成修改：

- 新增统一图标资源目录：`assets/icons/`。
- 新增图标生成脚本：`tools/generate-app-icons.ps1`，可重新生成客户端/服务端 `.ico` 和 256px 预览图。
- 客户端图标：`assets/icons/file-assistant-client.ico`，风格为文件 + 发送箭头。
- 服务端图标：`assets/icons/file-assistant-server.ico`，风格为服务器节点。
- Windows 客户端 exe 已配置 `ApplicationIcon`，主窗口和右下角托盘使用客户端图标。
- 服务端托盘 exe 和服务 exe 已配置 `ApplicationIcon`，右下角服务端托盘使用服务端图标。
- 服务端和客户端 Inno Setup 安装包都已配置 `SetupIconFile`，安装包 exe 也会显示对应图标。

改过的文件：

- `assets/icons/file-assistant-client.ico`
- `assets/icons/file-assistant-client-256.png`
- `assets/icons/file-assistant-server.ico`
- `assets/icons/file-assistant-server-256.png`
- `tools/generate-app-icons.ps1`
- `apps/windows-dotnet-client/FileAssistant.WinClient.csproj`
- `apps/windows-dotnet-client/MainForm.cs`
- `tools/server-tray/FileAssistantServerTray.csproj`
- `tools/server-tray/Program.cs`
- `tools/server-service/FileAssistantServerService.csproj`
- `installer/client-inno/FileAssistantClient.iss`
- `installer/server-inno/FileAssistantServer.iss`
- `HANDOFF.md`

已验证：

- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
- `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release --no-restore`
- `dotnet build tools\server-service\FileAssistantServerService.csproj -c Release --no-restore`
- `npm test`
- `.\deploy\server\build-server-installer.ps1`
- `.\deploy\client\build-client-installer.ps1`

最新安装包：

- 服务端：`deploy/server-installer/FileAssistantServerSetup.exe`
  - 大小：`117,511,330 bytes`
  - 生成时间：`2026/5/7 11:48:53`
  - SHA256：`A2E310F9D65B083FA453B3BBD7CBE165304B3D5B9DFD415BC9ACEFAC8E3C8DC8`
- 客户端：`deploy/client-installer/FileAssistantClientSetup.exe`
  - 大小：`66,784,532 bytes`
  - 生成时间：`2026/5/7 11:48:13`
  - SHA256：`C7DA4B15A0F472355D3A84B46B420726C2DECAA3ABA63571D22F71E6681221D6`

## 2026-05-07 管理员密码重置工具交接

### 当前目标

解决“管理员账号忘记密码怎么办”的交付问题：客户现场不需要重装服务端、不需要手工改 SQLite 数据库，也不需要重新初始化数据；在服务器本机用一个受控的本地工具重置管理员密码。

### 已完成的修改

- 新增本地重置脚本：`deploy/server/reset-admin-password.ps1`。
- 服务端安装包已包含该脚本，并在开始菜单生成“重置管理员密码”入口。
- 重置工具会读取已安装目录下的 `deploy/server/config.ps1`，自动定位数据目录、日志目录、服务名和内置 Node 运行时。
- 工具会列出现有管理员账号；输入用户名、新密码并二次确认后，更新该管理员的密码哈希。
- 重置时会清除该管理员旧登录会话，避免旧浏览器会话继续保持登录。
- 如果 Windows Service 正在运行，工具会先停止服务，重置完成后再启动服务。
- 重置操作会写入审计日志 `admin_user.password_reset`，但不会记录明文密码。
- 中文安装环境下，开始菜单快捷方式显示为“重置管理员密码”。

### 改过哪些文件

- `deploy/server/reset-admin-password.ps1`
- `installer/server-inno/FileAssistantServer.iss`
- `HANDOFF.md`

### 还没完成什么

- 还需要在真实 Windows Server 虚拟机里点开始菜单的“重置管理员密码”，验证 UAC 提权、停止服务、重置密码、重启服务、重新登录管理端的完整流程。
- 还没有给该工具做更漂亮的图形化界面；当前是 PowerShell 控制台向导，适合运维/管理员使用。
- 还没有做代码签名；正式交付前服务端安装包和托盘/服务程序仍建议签名。

### 关键实现思路

- 不单独写一套数据库逻辑，而是在临时 Node 脚本里复用 `apps/server/db.js` 的 `createDefaultStore()`，这样 SQLite/JSON 存储路径都能跟主服务保持一致。
- 密码哈希逻辑保持和服务端一致：PBKDF2-SHA256，120000 次迭代，随机 salt。
- 通过环境变量把 `FA_BASE_DIR`、`FA_DATA_DIR`、`FA_RESET_USERNAME`、`FA_RESET_PASSWORD` 传给临时 Node 脚本，避免把新密码放到命令行参数里。
- 交互模式下自动检测管理员权限，不是管理员时会通过 UAC 重新启动自身。
- 自动化测试模式使用 `-PasswordFromStdin`，只从 stdin 读入两行密码，避免明文出现在命令行历史。

### 已运行/未运行的测试

已运行并通过：

- PowerShell 语法解析：`RESET_SCRIPT_PARSE_OK`
- 重置逻辑烟测：旧密码失效、新密码生效、旧 session 清除、审计日志写入
- 后端测试：`npm test`，4 项通过
- 服务端安装包构建：`.\deploy\server\build-server-installer.ps1`
- 安装包烟测：静默安装到临时目录，确认包含 `reset-admin-password.ps1`，开始菜单生成“重置管理员密码.lnk”，配置地址带 `:5177`，卸载和清理通过

最新服务端安装包：

- 路径：`deploy/server-installer/FileAssistantServerSetup.exe`
- 大小：`117,468,147 bytes`
- 生成时间：`2026/5/7 11:29:05`
- SHA256：`7B2A7C513B29958B8993E238DE9F002F933BC1445888A2D6C678CF84AF41BB09`

未运行：

- 真实已安装 Windows Service 环境下的开始菜单点击验收
- 真实客户机覆盖安装后的密码重置验收

### 下一步应该怎么做

建议下一步在 Windows Server 2019 虚拟机里安装最新 `FileAssistantServerSetup.exe`，创建管理员账号后退出登录，再通过开始菜单“File Assistant Server -> 重置管理员密码”重置密码。确认能用新密码进入 `http://服务器IP:5177/admin` 后，这个“忘记管理员密码”的交付闭环就算跑通。

## 2026-05-06 Windows 客户端传输列表等待光标修复

本轮处理 Windows 客户端鼠标移到“接收与状态”传输列表时一直转圈、感觉无法点击的问题。

原因判断：

- 客户端原来只在主窗体上设置 `UseWaitCursor = busy`。
- WinForms 的 `DataGridView` 等子控件在某些操作完成、窗口隐藏恢复、RDP/锁屏重绘后可能保留等待光标状态。
- 忙碌状态结束时没有递归清理所有子控件光标。

已完成修改：

- `apps/windows-dotnet-client/MainForm.cs`
  - `SetBusy()` 支持跨线程安全调用。
  - 忙碌状态统一设置 `Application.UseWaitCursor`。
  - 新增 `SetWaitCursorRecursive()`，忙碌结束时递归清理窗体及所有子控件的 `UseWaitCursor` 和 `Cursor`。
  - 忙碌结束时额外强制恢复 `_transferGrid` 的默认鼠标指针，避免传输列表区域残留转圈光标。

已验证：

- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
- `npm test`
- `.\deploy\client\build-client-installer.ps1`

最新客户端安装包：

- 路径：`deploy/client-installer/FileAssistantClientSetup.exe`
- 大小：`66,779,094 bytes`
- 生成时间：`2026/5/6 17:36:22`
- SHA256：`DC00FAFD87F06B8653CE6EF044177A02BF29D6C6CBDBE25138CF638F5AF68E23`

## 2026-05-06 Windows 客户端黑屏与托盘恢复修复

本轮处理 Windows 客户端长时间不使用后窗口黑屏、右下角托盘点击“打开主界面”无法弹出的问题。

已完成修改：

- `apps/windows-dotnet-client/MainForm.cs`
  - 最小化或点击关闭时统一调用 `HideToTray()`，明确设置 `ShowInTaskbar = false` 后隐藏到托盘。
  - 托盘菜单“打开主界面”调用更强的 `RestoreWindow()`。
  - 托盘图标左键单击也可直接打开主界面。
  - `RestoreWindow()` 现在支持跨线程安全调用，恢复时会：
    - 重新显示窗口；
    - 恢复最小化状态；
    - 使用 Win32 `ShowWindow(..., SW_RESTORE)`；
    - `BringToFront()`、`Activate()`、`Focus()`；
    - 使用 Win32 `SetForegroundWindow()` 尝试置前；
    - 调用 `RefreshWindowSurface()` 强制重绘窗口和控件，降低锁屏/RDP 重连后黑屏概率。

已验证：

- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
- `npm test`
- `.\deploy\client\build-client-installer.ps1`

最新客户端安装包：

- 路径：`deploy/client-installer/FileAssistantClientSetup.exe`
- 大小：`66,777,155 bytes`
- 生成时间：`2026/5/6 17:26:45`
- SHA256：`80E480A733B906C8149E20C9F52A49EC218FF82EF1B23EA35515BCDF06F5F390`

## 2026-05-06 Windows 客户端手动免码注册修复

本轮修复了管理端已经开启“免码注册”，但 Windows 客户端手动点击“注册”仍提示“请输入安装码”的问题。

原因：

- 服务端 `/api/client/open-register` 接口本身可用。
- 但 Windows 客户端之前只有在安装包自动启动且带 `AutoRegister` 配置时才会走免码注册接口。
- 用户手动打开客户端并点击“注册”时，客户端会先在本地检查安装码是否为空，安装码为空就直接弹错，没有请求服务端。

已完成修改：

- `apps/windows-dotnet-client/MainForm.cs`
  - “安装码”标签改为“安装码（可空）”。
  - 手动注册时，如果安装码为空，自动调用 `/api/client/open-register`。
  - 如果服务端免码注册未开启、过期或次数用完，提示“免码注册未开启、已过期或已达到最大注册数量。请在管理端重新开启免码注册，或填写安装码。”
  - 未注册状态文案改为提示可填写服务端地址后直接注册。

已验证：

- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
- `npm test`
- `.\deploy\client\build-client-installer.ps1`

最新客户端安装包：

- 路径：`deploy/client-installer/FileAssistantClientSetup.exe`
- 大小：`66,777,739 bytes`
- 生成时间：`2026/5/6 17:23:28`
- SHA256：`64C386C0FCF1D66B1E0CD1087787DF123EF292F5C84F16DBB9BC703FA120D1EE`

## 2026-05-06 服务端访问地址端口与客户端表格 UI 修复

本轮处理两个现场问题：

- 服务端安装时填写本机 IP 后，托盘显示 `http://192.168.157.138`，浏览器打开 `/admin` 失败。
  - 原因：服务默认端口是 `5177`，不带端口访问会走浏览器默认 80 端口，所以出现 `ERR_CONNECTION_REFUSED`。
  - `installer/server-inno/FileAssistantServer.iss` 已改为自动补端口。后续填写 `192.168.157.138` 或 `http://192.168.157.138`，都会写成 `http://192.168.157.138:5177`。
  - `tools/server-tray/Program.cs` 已增加兜底：读取旧配置时，如果 `PublicServerUrl` 没有端口，会根据配置里的 `Port` 自动补上。
- 管理端客户端表格按钮被挤成竖排。
  - `apps/web/assets/styles.css` 已调整客户端表格最小宽度、列宽、绑定人员列和操作列按钮布局。
  - 按钮文本增加 `white-space: nowrap`，不会再按单个中文字符竖向换行。

已验证：

- `node --check apps\web\assets\admin.js`
- `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release --no-restore`
- `npm test`
- `.\deploy\server\build-server-installer.ps1`
- 静默安装烟测：传入 `/SERVERHOST=http://192.168.157.138 /PORT=5177` 后，生成的 `config.ps1` 中 `PublicServerUrl` 为 `http://192.168.157.138:5177`。

最新服务端安装包：

- 路径：`deploy/server-installer/FileAssistantServerSetup.exe`
- 大小：`117,466,118 bytes`
- 生成时间：`2026/5/6 17:15:14`
- SHA256：`FA3F7A5646DE1C494E3808A70D7D833268D1F90F65AAC9C9745DD3CB97A98705`

## 2026-05-06 客户端绑定人员名称显示修复

本轮修复了 Windows 客户端绑定人员后只显示 `employeeId`（例如 `emp_xxx`），没有显示后台创建人员姓名的问题。原因是客户端原来只能从 `/api/client/me` 拿到内部人员 ID，无法拿到人员姓名、工号和部门。

已完成修改：

- `apps/server/server.js`
  - `publicClient(client, data)` 支持在返回客户端信息时补充 `employeeName`、`employeeNo`、`employeeTitle`、`departmentName`。
  - `/api/admin/clients` 和 `/api/client/me` 都改为返回带人员展示字段的客户端对象。
- `apps/windows-dotnet-client/Models.cs`
  - `ClientDto` 新增 `EmployeeName`、`EmployeeNo`、`EmployeeTitle`、`DepartmentName`。
- `apps/windows-dotnet-client/MainForm.cs`
  - 客户端状态栏从显示 `人员ID: emp_xxx` 改为优先显示 `绑定人员：姓名（工号） / 部门`。
  - 如果服务端还是旧版本没有返回姓名，才回退显示内部 ID。
- `test/api.test.js`
  - 增加 `/api/client/me` 绑定人员展示字段断言。

已验证：

- `node --check apps\server\server.js`
- `npm test`
- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release --no-restore`
- `.\deploy\server\build-server-installer.ps1`
- `.\deploy\client\build-client-installer.ps1`

最新安装包：

- 服务端：`deploy/server-installer/FileAssistantServerSetup.exe`
  - 大小：`117,468,360 bytes`
  - 生成时间：`2026/5/6 16:37:06`
  - SHA256：`7112207365CC687955355F2128DE9DB82464FEEAEF4924FBF45812578BFEE262`
- 客户端：`deploy/client-installer/FileAssistantClientSetup.exe`
  - 大小：`66,774,078 bytes`
  - 生成时间：`2026/5/6 16:36:27`
  - SHA256：`0F011F8ED4B7882E45BC68CA4DA62E219966F3A458E212949E664D6B36E7F376`

注意：这个修复需要服务端和客户端都更新。只更新服务端，旧客户端仍会显示 `人员ID: emp_xxx`；只更新客户端，旧服务端没有返回姓名时也只能回退显示内部 ID。

更新时间：2026-05-05

项目目录：

`C:\Users\Ruidoww\OneDrive\桌面\新建文件夹 - 副本\file-assistant`

当前目录外层 `C:\Users\Ruidoww\OneDrive\桌面\新建文件夹 - 副本` 不是 Git 仓库；实际项目在 `file-assistant` 子目录里。

## 2026-05-06 管理端客户端绑定 UI 修复

本轮修复了管理端“客户端”列表里绑定人员控件被表格列宽挤坏、看起来无法绑定的问题：

- `apps/web/admin.html`
  - 客户端表格增加专用 `clients-table` 样式类。
  - 新增“绑定客户端人员”弹窗。
  - 弹窗包含客户端名称、人员下拉框、解除绑定、取消、保存绑定。
  - 没有可绑定的启用人员时，会提示先在“人员”区域新增并启用人员。

- `apps/web/assets/admin.js`
  - 客户端列表不再直接在表格里放人员下拉框。
  - 绑定列只显示当前绑定状态和“绑定人员/更换人员”按钮。
  - 点击后打开弹窗选择人员，再调用 `PATCH /api/admin/clients/:id` 写入 `employeeId`。
  - 支持弹窗解除绑定。

- `apps/web/assets/styles.css`
  - 为客户端表格增加固定列布局，避免操作列被横向滚动遮住。
  - 为绑定弹窗增加遮罩、弹窗、操作按钮样式。

已重新生成服务端安装包：

- 路径：`deploy/server-installer/FileAssistantServerSetup.exe`
- 大小：`117,468,268 bytes`
- 生成时间：`2026/5/6 16:31:42`
- SHA256：`1BBEA04A274A4B08E13A9EDC83F2B27CB52B265F75FA1C86FB729E0115B6A98B`

已运行验证：

- `node --check apps/web/assets/admin.js`
- `npm test`
- 重新构建服务端安装包：`.\deploy\server\build-server-installer.ps1`
- 安装包无服务静默烟测，确认新的 `admin.html`、`admin.js`、`styles.css` 已被打进安装包。

## 2026-05-06 服务端安装器修复更新

本轮修复了服务端正式安装包的三个现场问题：

- 覆盖安装时报 `runtime\node\node.exe` DeleteFile 失败、错误代码 5。
  - 原因是旧 Windows Service 仍在运行，旧服务里的 Node 进程占用了安装目录中的 `node.exe`。
  - 已在 Inno Setup 的 `PrepareToInstall` 阶段加入升级准备脚本，复制文件前会先停止旧服务、关闭右下角托盘助手，并清理安装目录内残留的服务包装器/Node 进程。
  - 日志写入：`C:\ProgramData\FileAssistantServer\logs\upgrade-prepare.log`。

- 安装完成后 Web 管理端打不开时缺少明确诊断。
  - 已在 `deploy/server/install-service-native.ps1` 中加入服务启动后的本机健康检查。
  - 如果勾选“安装完成后立即启动服务”，安装脚本会等待 Windows Service 进入 Running，并访问 `http://127.0.0.1:端口/api/health`。
  - 健康检查失败会让安装器报错，并提示查看 `install-service.log`、`service-wrapper.err.log`、`server.err.log`，不再静默装完。

- 卸载器入口不够明显。
  - Inno 本身会生成 `unins000.exe`。
  - 现在开始菜单和安装目录里都会有“卸载 File Assistant Server”快捷方式。
  - 卸载脚本会先停止服务、关闭托盘、清理残留安装目录进程，再删除服务和防火墙规则。
  - 卸载时会删除安装目录里运行时生成的 `deploy\server\config.ps1`，但默认仍保留 `C:\ProgramData\FileAssistantServer` 里的数据、日志、备份。

改动文件：

- `installer/server-inno/FileAssistantServer.iss`
- `deploy/server/install-service-native.ps1`
- `deploy/server/uninstall-service-native.ps1`
- `HANDOFF.md`

已重新生成服务端安装包：

- 路径：`deploy/server-installer/FileAssistantServerSetup.exe`
- 大小：`117,467,462 bytes`
- 生成时间：`2026/5/6 15:58:02`
- SHA256：`230DD83F6429B43646B2D9828E68284B7196BEEEA14FA049F000F4BC03FD3DDA`

已运行验证：

- PowerShell 语法检查通过：
  - `deploy/server/install-service-native.ps1`
  - `deploy/server/uninstall-service-native.ps1`
- `.\deploy\server\build-server-installer.ps1` 编译通过。
- 静默安装/卸载烟测通过：
  - `/NOSERVICE=1`
  - `/CURRENTUSER`
  - 验证解包、`config.ps1` 写入、安装目录卸载快捷方式、卸载清理。

仍需在真实 Windows Server 虚拟机上验证：

- 已安装旧版并正在运行服务时，直接双击新版安装包做覆盖安装。
- 勾选“安装完成后立即启动服务”，确认安装结束后可打开 `http://服务器IP:5177/admin`。
- 从开始菜单或安装目录执行“卸载 File Assistant Server”，确认服务、托盘、自启动、防火墙规则被移除。

## 1. 当前目标

当前目标已经从“先做服务端正式部署包”推进到“服务端基本可交付，客户端正式安装包和托盘常驻已完成初版，下一步做客户端安装包烟测和管理端部署入口”。

服务端当前目标：

- 生成正式 Inno Setup 安装包。
- 安装包内置 Node.js 运行时，客户服务器不需要手动安装 Node。
- 安装后注册 Windows Service，后台长期运行。
- Web 管理端用于服务端管理。
- 右下角托盘助手用于本机快速查看服务状态、访问地址、日志目录和启停服务。

下一阶段目标：

- 烟测 Windows 客户端正式安装包 `FileAssistantClientSetup.exe`。
- 验证服务端地址、部署令牌、自动注册、默认接收目录等安装参数。
- 验证客户端右下角常驻，便于员工接收文件和查看连接状态。
- 管理端增加客户端部署命令/下载入口。
- 完成“服务端安装包 + 客户端安装包 + 自动注册 + 双客户端收发”的完整交付闭环。

## 2. 已完成的修改

服务端安装包：

- 已使用 Inno Setup 生成正式服务端安装包。
- 安装包路径：`deploy/server-installer/FileAssistantServerSetup.exe`
- 安装包内置：
  - Node.js 运行时：`runtime/node/node.exe`
  - Node.js 后端服务：`apps/server`
  - Web 管理端：`apps/web`
  - Windows Service 包装器：`FileAssistantServerService.exe`
  - 右下角托盘助手：`FileAssistantServerTray.exe`
  - 部署、状态、备份、服务安装脚本：`deploy/server/*.ps1`

安装流程：

- Inno Setup 经典安装向导已启用。
- 支持语言选择、欢迎页、许可协议页、组件选择页、安装目录页、服务端配置页、附加任务页、安装页、完成页。
- 服务端配置页保留：
  - HTTP 端口
  - 服务器 IP 或域名
- 管理员账号、管理员密码、Legacy 管理令牌、Windows 服务名称不再暴露给用户填写。
- 初始管理员账号改为安装完成后首次进入 Web 管理端创建。
- Legacy 管理令牌默认禁用。
- 防火墙规则不再显示给用户选择，安装时后台默认尝试添加。
- 添加防火墙失败不会阻断安装，只写日志。

Windows Service：

- 修复了 Windows Server 2019 干净虚拟机上服务安装失败的问题。
- 原因是 `sc.exe create` 对复杂 `binPath` 参数解析不稳定，曾返回 `EXIT: 1639`。
- 已改用 PowerShell `New-Service -BinaryPathName` 创建服务。
- 服务安装日志写入：
  `C:\ProgramData\FileAssistantServer\logs\install-service.log`
- 旧服务删除后会等待服务真正消失，避免“等待删除”状态影响重装。
- 服务启动失败、防火墙添加失败会记录警告，尽量给出清晰错误信息。

右下角托盘助手：

- 新增 `FileAssistantServerTray.exe`。
- 安装后写入 HKLM Run，用户登录桌面后自动常驻右下角。
- 托盘右键菜单包含：
  - 服务状态
  - 访问地址：`http://IP:端口`
  - 日志目录：`C:\ProgramData\FileAssistantServer\logs`
  - 打开管理端
  - 打开安装目录
  - 启动服务
  - 停止服务
  - 重启服务
  - 退出托盘
- 点击“访问地址”会打开 Web 管理端。
- 点击“日志目录”会直接打开日志文件夹。
- 双击托盘图标会打开 Web 管理端。
- 启动、停止、重启服务会触发 UAC，因为控制 Windows Service 需要管理员权限。
- “退出托盘”只关闭右下角图标，不停止后台 Windows Service。
- 无人登录 Windows 桌面时托盘不显示，但 Windows Service 仍继续后台运行。

客户端安装包和常驻：

- 新增正式客户端安装包：
  `deploy/client-installer/FileAssistantClientSetup.exe`
- 安装包内置自包含 .NET 8 客户端，终端电脑不需要手动安装 .NET Desktop Runtime。
- 支持安装参数：
  - `/SERVERURL=...`
  - `/DEPLOYTOKEN=...`
  - `/INSTALLCODE=...`
  - `/AUTOREGISTER=1`
  - `/DISPLAYNAME=...`
  - `/RECEIVEDIR=...`
- 安装器会把参数写入安装目录 `client-bootstrap.json`，客户端首次启动时读取并自动注册。
- 客户端托盘菜单包含：
  - 连接状态
  - 服务端地址
  - 接收目录
  - 打开主界面
  - 打开接收目录
  - 打开日志目录
  - 重新连接
  - 退出客户端
- 关闭客户端窗口默认隐藏到托盘，不直接退出。
- 本地日志写入 `%APPDATA%\FileAssistant\logs\client.log`。

架构判断：

- 当前后端是 Node.js 单体服务。
- 当前数据库默认 SQLite。
- 当前阶段继续使用 Node.js 最稳，重点先跑通交付闭环。
- 未来如重写核心后端，优先考虑 Go；如果变成复杂企业后台和重审批、重报表、重组织集成，再考虑 Java；Python 不建议作为主服务端。
- 未来大规模方案可升级为：
  - 后端服务集群
  - PostgreSQL
  - 对象存储
  - Redis / 消息队列
  - 独立文件服务
  - 多服务器 / 负载均衡

## 3. 改过哪些文件

服务端安装包和 Inno Setup：

- `installer/server-inno/FileAssistantServer.iss`
  - 加入正式安装向导流程。
  - 加入许可协议页。
  - 加入组件选择页。
  - 服务端配置页只保留端口和服务器 IP/域名。
  - 隐藏管理员账号、密码、Legacy 管理令牌、服务名称。
  - 防火墙任务从 UI 中移除，改为后台默认执行。
  - 加入 `FileAssistantServerTray.exe` 文件打包。
  - 加入 HKLM Run 注册表项，让托盘助手用户登录后自动启动。
  - 完成页加入“启动右下角托盘助手”。

- `installer/server-inno/languages/ChineseSimplified.isl`
  - 用于 Inno Setup 中文安装向导语言。

构建脚本：

- `deploy/server/build-server-installer.ps1`
  - 委托调用 Inno Setup 构建脚本，避免继续使用旧的 WinForms 自定义安装器。

- `deploy/server/build-inno-server-installer.ps1`
  - 发布服务包装器。
  - 发布托盘助手。
  - 调用 ISCC 编译 Inno Setup 安装包。
  - 将 `ServiceBuildDir`、`TrayBuildDir`、`NodeExePath` 传入 Inno。

Windows Service 安装和卸载：

- `deploy/server/install-service-native.ps1`
  - 使用 `New-Service` 替代 `sc.exe create`。
  - 增加安装服务日志。
  - 增加旧服务删除等待。
  - 防火墙添加和启动服务改为更稳的日志化处理。

- `deploy/server/uninstall-service-native.ps1`
  - 删除服务后等待服务真正消失。
  - 卸载时移除防火墙规则。

托盘助手：

- `tools/server-tray/FileAssistantServerTray.csproj`
  - 新增 .NET 8 WinForms 托盘助手项目。

- `tools/server-tray/Program.cs`
  - 新增 NotifyIcon 托盘程序。
  - 读取安装目录中的 `deploy/server/config.ps1`。
  - 读取服务名称、访问地址、日志目录。
  - 显示服务状态。
  - 显示 IP/域名 + 端口。
  - 点击访问地址打开管理端。
  - 点击日志目录打开日志目录。
  - 支持启动、停止、重启服务。
  - 支持退出托盘。

客户端安装包和托盘常驻：

- `apps/windows-dotnet-client/ClientBootstrapOptions.cs`
  - 新增读取安装目录 `client-bootstrap.json`。
  - 启动配置优先级为：安装器 bootstrap 文件 < 环境变量 < 命令行参数。
  - 支持安装器写入服务端地址、部署令牌、安装码、显示名称、接收目录、自动注册。

- `apps/windows-dotnet-client/ClientConfig.cs`
  - 新增客户端日志目录：
    `%APPDATA%\FileAssistant\logs`
  - 新增日志文件：
    `%APPDATA%\FileAssistant\logs\client.log`

- `apps/windows-dotnet-client/MainForm.cs`
  - 托盘图标升级为右键菜单常驻入口。
  - 托盘菜单显示连接状态、服务端地址、接收目录。
  - 托盘菜单支持打开主界面、打开接收目录、打开日志目录、重新连接、退出客户端。
  - 用户点击窗口关闭时默认隐藏到托盘，不直接退出客户端。
  - 本地日志同时写入 UI 日志框和 `%APPDATA%\FileAssistant\logs\client.log`。

- `installer/client-inno/FileAssistantClient.iss`
  - 新增客户端 Inno Setup 安装器。
  - 输出 `deploy/client-installer/FileAssistantClientSetup.exe`。
  - 安装包内置自包含 .NET 8 Windows 客户端。
  - 支持交互式填写服务端地址、部署令牌、安装码、显示名称、接收目录。
  - 支持静默参数：
    `/SERVERURL=...`
    `/DEPLOYTOKEN=...`
    `/INSTALLCODE=...`
    `/AUTOREGISTER=1`
    `/DISPLAYNAME=...`
    `/RECEIVEDIR=...`
  - 安装时写入 `client-bootstrap.json`，供客户端首次启动自动注册。
  - 支持开机自启动、桌面快捷方式、安装后启动客户端。

- `deploy/client/build-inno-client-installer.ps1`
  - 发布自包含客户端 exe。
  - 调用 ISCC 编译客户端 Inno Setup 安装包。

- `deploy/client/build-client-installer.ps1`
  - 客户端安装包构建入口，委托调用 Inno 构建脚本。

- `deploy/client-installer/README.md`
  - 新增客户端正式安装包说明和静默部署参数说明。

文档：

- `deploy/server-installer/README.md`
  - 更新服务端正式安装包说明。
  - 说明内置 Node、Windows Service、右下角托盘助手。

- `docs/DEPLOYMENT.md`
  - 更新正式部署说明。
  - 说明托盘助手只在用户登录桌面后显示，Windows Service 会独立后台运行。

- `HANDOFF.md`
  - 本文件，已更新为当前交接摘要。

旧有核心业务文件仍是：

- `apps/server/server.js`
- `apps/server/db.js`
- `apps/web/admin.html`
- `apps/web/assets/admin.js`
- `apps/web/client.html`
- `apps/web/assets/client.js`
- `apps/windows-dotnet-client/*`

## 4. 还没完成什么

服务端方面：

- 还没有替换托盘助手的正式产品图标，目前使用默认应用图标。
- 还没有做正式代码签名。
- 许可协议和隐私政策目前是安装包内的基础版本，后续正式商用前应替换为公司法务确认文本。
- 还没有在多台真实 Windows 环境完整回归，包括 Windows 10、Windows 11、Windows Server 2016/2019/2022。
- 还没有进行长时间稳定性压测、大文件并发压测、断点/失败恢复压测。
- 还没有做 PostgreSQL、对象存储、Redis、消息队列等集群化升级。

客户端方面：

- 客户端正式 Inno Setup 安装包已完成初版，但还没做真实终端安装烟测。
- 客户端右下角常驻托盘已完成初版，但还没在真实 Windows 客户端 VM 上截图验收。
- 客户端安装参数已接入安装包并写入 `client-bootstrap.json`，但还没跑完整静默安装 + 首次启动自动注册验收。
- 还没有做“服务端管理端生成客户端部署命令/下载入口”。
- 还没有做“服务台一键生成专属客户端安装包”的第二阶段能力。
- 还没有做客户端诊断日志导出包；当前已有 `%APPDATA%\FileAssistant\logs\client.log` 本地日志。
- 还没有做两台客户端虚拟机的正式端到端验收。

第二阶段专属客户端安装包能力尚未开始：

- 服务台生成部署令牌。
- 服务台生成客户端安装命令。
- 服务台打包专属 `FileAssistantClientSetup.exe`。
- 自动写入服务器地址和部署令牌。
- 自动代码签名。
- 保存安装包并提供下载。
- 令牌有效期、安装次数、撤销机制。

## 5. 关键实现思路

服务端运行方式：

- 后端仍是 Node.js HTTP API 服务。
- Windows Service 不直接显示 UI。
- Windows Service 负责后台长期运行服务端。
- 右下角托盘助手是单独的 WinForms 用户态程序。
- 托盘助手通过读取 `deploy/server/config.ps1` 获取服务端访问地址、服务名称和日志目录。
- 托盘助手通过 `sc.exe query` 查询服务状态。
- 托盘助手通过提权 PowerShell 执行 `Start-Service`、`Stop-Service`、`Restart-Service`。

安装包思路：

- 服务端正式安装包使用 Inno Setup。
- 安装包内置 Node.js，所以客户服务器不需要手动安装 Node。
- 安装时写入 `deploy/server/config.ps1`。
- 默认数据目录是：
  `C:\ProgramData\FileAssistantServer`
- 默认安装目录是：
  `C:\Program Files\FileAssistantServer`
- 安装包支持静默参数：
  - `/ACCEPTAGREEMENTS=1`
  - `/SERVERHOST=...`
  - `/PORT=...`
  - `/DIR=...`
  - `/DATAROOT=...`
  - `/NOSERVICE=1`

管理端思路：

- 服务端安装完成后，管理员通过浏览器访问：
  `http://服务器IP:5177/admin`
- 首次进入 Web 管理端时创建第一个管理员账号。
- 客户端部署令牌后续应由管理端生成。

客户端下一步思路：

- 第一阶段不要让客户服务器现场编译客户端 exe。
- 先做通用客户端安装包，支持安装参数和自动注册。
- 管理端生成部署令牌和部署命令。
- 客户管理员用部署命令批量安装客户端。
- 第二阶段再做服务台一键生成专属客户端安装包。

语言路线：

- 当前继续 Node.js，先完成产品闭环。
- 未来核心后端如果重写，优先 Go。
- 如果客户需求偏复杂企业后台，可考虑 Java。
- Python 只建议用于运维脚本、迁移、报表、批处理或 AI/文档插件，不建议做主服务端。

## 6. 已运行/未运行的测试

已运行并通过：

- 重新构建正式服务端安装包：
  `.\deploy\server\build-server-installer.ps1`

- Inno Setup 编译成功，输出：
  `deploy/server-installer/FileAssistantServerSetup.exe`

- 安装包烟测通过：
  - 使用静默安装安装到临时目录。
  - 使用 `/NOSERVICE=1` 避免本机注册真实服务。
  - 检查安装目录包含：
    - `FileAssistantServerTray.exe`
    - `FileAssistantServerService.exe`
    - `runtime/node/node.exe`
    - `deploy/server/config.ps1`
    - `apps/server/server.js`
  - 检查配置写入端口和访问地址。
  - 使用内置 Node 执行 `server.js` 语法检查。
  - 使用内置 Node 启动服务端。
  - 请求 `/api/health` 返回 OK。
  - 静默卸载并清理临时目录。

- 最近一次烟测端口：
  `5204`

- 最近一次烟测输出：
  `Smoke health OK on port 5204`
  `Installer smoke test passed.`

- 后端 API 测试通过：
  `npm test`

- 最近一次测试结果：
  - `initial admin setup creates the first web admin`
  - `default sending rule relays without confirmation`
  - `file transfer confirmation flow works end to end`
  - 共 3 项，全部通过。

- 托盘助手 Release 构建通过：
  `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release --no-restore`
  - 0 个警告
  - 0 个错误

- Windows .NET 客户端构建通过：
  `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj`
  - 0 个警告
  - 0 个错误

- 客户端正式安装包构建通过：
  `.\deploy\client\build-client-installer.ps1`
  - 自包含客户端发布成功。
  - Inno Setup 6.7.1 编译成功。
  - 输出 `deploy/client-installer/FileAssistantClientSetup.exe`。

最新正式安装包信息：

- 路径：
  `C:\Users\Ruidoww\OneDrive\桌面\新建文件夹 - 副本\file-assistant\deploy\server-installer\FileAssistantServerSetup.exe`
- 大小：
  约 `112.02 MB`
- 生成时间：
  `2026/5/5 13:16:40`
- SHA256：
  `290C038C2FF4508DC0F09CA845ECA6024AA65118C89874ECE2E8183380B50475`

最新客户端安装包信息：

- 路径：
  `C:\Users\Ruidoww\OneDrive\桌面\新建文件夹 - 副本\file-assistant\deploy\client-installer\FileAssistantClientSetup.exe`
- 大小：
  `66,773,451 bytes`，约 `63.68 MiB`
- 生成时间：
  `2026/5/5 19:44:11`
- SHA256：
  `A17669E23063107E79408D62DB2672F733DBDA48A4124823200F150805A5205A`

未运行或仍需运行：

- 未在真实客户服务器完整手动点击安装向导做最终验收。
- 未在 Windows 10、Windows 11、Windows Server 2016/2019/2022 全矩阵安装验证。
- 未验证真实 Windows Service 场景中的托盘菜单显示效果截图。
- 未在真实客户端 VM 上完整点击客户端安装向导。
- 未跑客户端安装包静默安装 + `client-bootstrap.json` + 首次启动自动注册烟测。
- 未做两台 Windows 客户端虚拟机互传完整验收。
- 未做大文件、多并发、断网、重启、磁盘空间不足等异常测试。
- 未做正式代码签名后的 SmartScreen/杀软误报验证。

## 7. 下一步应该怎么做

客户端正式安装包和托盘常驻已经完成初版。下一步建议先做客户端安装包烟测，再补管理端部署入口。

推荐顺序：

1. 做客户端安装包烟测
   - 使用 `deploy/client-installer/FileAssistantClientSetup.exe` 静默安装到临时目录。
   - 传入 `/SERVERURL=...`、`/DEPLOYTOKEN=...`、`/AUTOREGISTER=1`、`/RECEIVEDIR=...`。
   - 检查安装目录生成 `client-bootstrap.json`。
   - 首次启动客户端，确认自动注册、托盘常驻、关闭隐藏到托盘、日志目录可打开。
   - 静默卸载并确认清理安装目录和自启动项。

2. 管理端增加客户端部署入口
   - 生成部署令牌。
   - 显示服务端地址。
   - 显示客户端安装包下载位置。
   - 一键复制部署命令。

3. 做完整验收
   - 服务端 VM 1 台。
   - 客户端 VM 2 台。
   - A 上传，B 接收。
   - 普通文件接收后服务端清除。
   - 重要备份文件接收后服务端保留。
   - 重启服务器后服务自动恢复。
   - 客户端重启后自动连接。

当前最合适的下一步任务：

对 `FileAssistantClientSetup.exe` 做静默安装烟测，并验证 `client-bootstrap.json`、首次启动自动注册和右下角托盘菜单。
