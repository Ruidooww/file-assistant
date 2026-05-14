# File Assistant 当前备份交接文档

日期：2026-05-14
工作区：`C:\Users\Ruidoww\Documents\Codex\新建文件夹 - 副本\file-assistant`

## 使用说明

这是当前备份点的独立交接文档。后续如果要继续重构，可以先让 Codex 读取这个文件和 `HANDOFF.md`，再继续。

建议备份整个 `file-assistant` 目录。当前 git 工作区不是干净状态，包含多轮功能开发、安装包构建脚本、客户端改动和审查修复。不要随意 `git reset` 或回退文件。

## 当前状态

当前主线目标已经完成到：

- 服务端和客户端基本可构建。
- 管理端可以生成“专属客户端安装包”。
- 员工安装专属客户端 EXE 后，不需要输入服务器地址，也不需要手动注册。
- 服务端存储和文件流相关审查问题已经修了三轮。
- 现在适合先备份，再决定是否继续做 P2 结构性重构。

## 已完成功能

### 1. 管理端现场生成专属客户端安装包

已完成：

- 客户端 Inno 安装器支持读取自身 EXE 尾部配置块：
  - `FA_CLIENT_BOOTSTRAP_V1_BEGIN`
  - `FA_CLIENT_BOOTSTRAP_V1_END`
- 专属 EXE 内置：
  - `serverUrl`
  - `deployToken`
  - `autoRegister`
- 有内置 `serverUrl` 时跳过“服务端地址”配置页。
- 安装完成后继续写入 `client-bootstrap.json`。
- 客户端首次启动后使用内置部署令牌自动注册。
- 服务端新增：
  - `POST /api/admin/client-packages`
  - `GET /api/admin/client-packages/:fileName/download`
- 管理端新增“专属客户端安装包”面板。
- 服务端安装包会携带通用客户端安装器模板：
  - `deploy/client-installer/FileAssistantClientSetup.exe`
- 服务端构建脚本缺少客户端模板时会先构建客户端安装包。

相关文件：

- `apps/server/server.js`
- `apps/web/admin.html`
- `apps/web/assets/admin.js`
- `apps/web/assets/styles.css`
- `installer/client-inno/FileAssistantClient.iss`
- `installer/server-inno/FileAssistantServer.iss`
- `deploy/client/build-client-installer.ps1`
- `deploy/client/build-inno-client-installer.ps1`
- `deploy/server/build-inno-server-installer.ps1`
- `test/api.test.js`

### 2. 审查修复 Round 1

已完成：

- `apps/server/db.js`
  - `JsonStore` 和 `SqliteStore` 增加 `consecutiveMutateWriteFailures`。
  - 真正写入失败时记录日志。
  - 成功写入后重置连续失败计数。
  - 避免把正常 4xx 业务错误误记成存储故障。
- `apps/server/server.js`
  - `mergeTransferFile` 合并失败时等待 writer 关闭，并清理半成品输出目录。
  - 新增 `pipeFileToResponse`，统一处理下载流、专属安装包下载和静态文件响应。
  - 响应提前关闭时销毁读流，读流错误时记录日志并关闭响应。
- `test/api.test.js`
  - 新增 JSON store 写失败日志与队列恢复测试。
  - 新增合并失败清理半成品目录测试。

### 3. 审查修复 Round 2

已完成：

- `apps/server/db.js`
  - 新增 `SQLITE_TABLE_SPECS`。
  - `SqliteStore.mutate(fn)` 从全库 `DELETE + INSERT` 改为差异 `upsert/delete`。
  - `replaceAll()` 保留给初始化和 JSON 迁移。
  - 新增 `pruneLogRows()`，差异写入后裁剪 SQLite 日志到最近 1000 条。
- `test/api.test.js`
  - 新增 `sqlite mutate applies differential writes without replaceAll` 测试。

### 4. 审查修复 Round 3

已完成：

- 历史 `status: "approved"` 在 `normalizeTransfer` 中规范化为 `status: "ready_to_deliver"`。
- 客户端收文件、确认送达只按 `ready_to_deliver` 判断。
- 管理端“放行”按钮提交 `ready_to_deliver`。
- Web 客户端接收按钮只按 `ready_to_deliver` 判断。
- WinForms 客户端同步移除旧 `approved` 运行时状态判断。
- 服务端仍兼容旧 PATCH 请求值 `"approved"`，但会立即写成 `ready_to_deliver`。
- 日志名 `transfer.approved` / `transfer.auto_approved` 保留，因为它们表示“放行动作”，不是状态。

相关文件：

- `apps/server/db.js`
- `apps/server/server.js`
- `apps/web/assets/admin.js`
- `apps/web/assets/client.js`
- `apps/windows-dotnet-client/MainForm.cs`
- `test/api.test.js`
- `HANDOFF.md`

## 最近验证结果

最新验证：

- `npm test`
  - 当前 9 个测试全部通过。
- `dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release`
  - 通过，0 警告，0 错误。

此前已验证：

- `dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release`
- `dotnet build tools\server-service\FileAssistantServerService.csproj -c Release`
- `.\deploy\client\build-client-installer.ps1`
- `.\deploy\server\build-server-installer.ps1`
- 专属客户端安装器本地静默安装 smoke test。
- 管理端 API 生成专属安装包 smoke test。

注意：客户端和服务端安装包是在 Round 3 状态机清理之前生成的。交付前需要重新构建客户端安装包和服务端安装包。

## 当前安装包文件

这些是当前目录里已有的安装包文件，用于备份参考，但不建议作为最终交付包，除非重新构建验证。

服务端安装包：

- 路径：`deploy/server-installer/FileAssistantServerSetup.exe`
- 大小：`183,268,877 bytes`
- 生成时间：`2026-05-14 13:37:54`
- SHA256：`BC1DE58A5064B5D766252393690BE5A2E2313D01CC3478D6BF84E56B042490A7`

客户端安装包：

- 路径：`deploy/client-installer/FileAssistantClientSetup.exe`
- 大小：`66,604,071 bytes`
- 生成时间：`2026-05-14 13:36:15`
- SHA256：`36C45CCEEC3188879DAFBFE5DDBE64FF7AE2690F1AA698D290532C72A811E761`

## 当前工作区注意事项

当前存在大量未提交改动，包括但不限于：

- 服务端：
  - `apps/server/db.js`
  - `apps/server/server.js`
- 管理端/Web：
  - `apps/web/admin.html`
  - `apps/web/assets/admin.js`
  - `apps/web/assets/client.js`
  - `apps/web/assets/styles.css`
- Windows 客户端：
  - `apps/windows-dotnet-client/MainForm.cs`
  - `apps/windows-dotnet-client/ClientBootstrapOptions.cs`
  - `apps/windows-dotnet-client/ClientConfig.cs`
  - `apps/windows-dotnet-client/FileAssistantApiClient.cs`
  - `apps/windows-dotnet-client/Models.cs`
  - `apps/windows-dotnet-client/FileAssistant.WinClient.csproj`
- 安装器和部署脚本：
  - `installer/client-inno/`
  - `installer/server-inno/FileAssistantServer.iss`
  - `deploy/client/`
  - `deploy/server/`
- 测试：
  - `test/api.test.js`
- 交接：
  - `HANDOFF.md`
  - `HANDOFF-BACKUP-2026-05-14.md`

还有 `.vs/`、`assets/`、`deploy/client-installer/` 等未跟踪目录。备份时建议整目录复制，不要只复制 git 跟踪文件。

## 后续建议

### 先交付验证

下一次继续时，建议先不要直接做大重构。优先重新构建并验证安装包：

```powershell
npm test
dotnet build apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release
dotnet build tools\server-tray\FileAssistantServerTray.csproj -c Release
dotnet build tools\server-service\FileAssistantServerService.csproj -c Release
.\deploy\client\build-client-installer.ps1
.\deploy\server\build-server-installer.ps1
```

然后做完整安装验证：

- 干净机器安装服务端。
- 打开管理端。
- 生成专属客户端安装包。
- 干净客户端机器双击专属 EXE。
- 确认不需要输入服务器地址。
- 确认不需要手动注册。
- 确认客户端列表出现新设备。
- 做一次发送、接收、确认送达闭环。

### 后续重构

如果用户明确说“继续重构”，建议顺序：

1. 拆 `apps/server/server.js` 的 `handleApi`。
   - 建议拆成 `routes/admin.js`、`routes/client.js`、`routes/static.js` 或类似结构。
   - 先保持 API 行为完全不变。
   - 每拆一段跑一次 `npm test`。

2. 拆 `apps/windows-dotnet-client/MainForm.cs`。
   - 建议 partial class：
     - `MainForm.Transfers.cs`
     - `MainForm.Tray.cs`
     - `MainForm.Registration.cs`
     - `MainForm.Ui.cs`
   - 每拆一段跑一次客户端 Release build。

3. 配置统一。
   - 当前服务端配置和环境变量散落在 `server.js`。
   - 后续可以收敛到一个 `config.js`。

4. JSON store fallback 优化。
   - 当前默认优先 SQLite。
   - JSON store 仍是同步全量 stringify，但实际更多是旧 Node 降级 fallback。
   - 优先级低于安装验证和结构拆分。

## 风险和限制

- 专属客户端 EXE 通过尾部追加配置实现，会破坏已有代码签名。
- 当前 v1 不处理正式代码签名。
- 如果后续要正式签名，需要：
  - 生成专属包后重新签名，或
  - 改成签名 bootstrapper 方案。
- 专属 EXE 内包含明文部署令牌，需要依靠：
  - 最大安装次数
  - 有效期
  - 后台停用安装码
  控制风险。
- 浏览器截图级 UI 验证之前没有完成，原因是 Codex Browser 插件报过本地资源路径错误。

## 以后继续时给 Codex 的建议指令

可以直接说：

```text
读取 HANDOFF-BACKUP-2026-05-14.md 和 HANDOFF.md，先不要大改，先重新构建并验证安装包。
```

如果要继续重构，可以说：

```text
读取 HANDOFF-BACKUP-2026-05-14.md 和 HANDOFF.md，从 handleApi 拆分开始，保持 API 行为不变，每一步跑 npm test。
```
