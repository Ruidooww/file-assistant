const state = {
  session: JSON.parse(localStorage.getItem("fa_admin_session") || "null"),
  summary: null,
  departments: [],
  employees: [],
  transferRules: [],
  installCodes: [],
  clients: [],
  transfers: [],
  logs: [],
  users: [],
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusPill(status) {
  const kind = {
    active: "ok",
    approved: "ok",
    ready_to_deliver: "ok",
    delivered: "ok",
    retained: "ok",
    pending_approval: "warn",
    uploading: "warn",
    assembling: "warn",
    receiving: "warn",
    temporary: "warn",
    disabled: "danger",
    rejected: "danger",
    purged: "danger",
  }[status] || "";
  const label = {
    approved: "已放行",
    ready_to_deliver: "等待接收",
    pending_approval: "等待中转确认",
    uploading: "上传中",
    assembling: "合并中",
    delivered: "已接收",
    receiving: "接收中",
    retained: "已备份",
    temporary: "临时中转",
    purged: "已清除",
    rejected: "已驳回",
    active: "启用",
    disabled: "停用",
  }[status] || status;
  return `<span class="pill ${kind}">${escapeHtml(label)}</span>`;
}

function adminHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.session?.token || ""}`,
    ...extra,
  };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: adminHeaders(options.headers || {}),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function showApp(visible) {
  $("setupPanel").hidden = true;
  $("loginPanel").hidden = visible;
  $("dashboard").hidden = !visible;
  $("adminContent").hidden = !visible;
  $("orgPanel").hidden = !visible;
  $("rulesPanel").hidden = !visible;
  $("transfersPanel").hidden = !visible;
  $("usersPanel").hidden = !visible;
  $("logsPanel").hidden = !visible;
  $("logoutBtn").disabled = !visible;
}

function showSetup() {
  $("setupPanel").hidden = false;
  $("loginPanel").hidden = true;
  $("dashboard").hidden = true;
  $("adminContent").hidden = true;
  $("orgPanel").hidden = true;
  $("rulesPanel").hidden = true;
  $("transfersPanel").hidden = true;
  $("usersPanel").hidden = true;
  $("logsPanel").hidden = true;
  $("logoutBtn").disabled = true;
}

function renderSummary() {
  $("metricCodes").textContent = state.summary?.installCodes ?? 0;
  $("metricClients").textContent = state.summary?.activeClients ?? 0;
  $("metricEmployees").textContent = state.summary?.employees ?? 0;
  $("metricPending").textContent = state.summary?.pendingTransfers ?? 0;
  $("metricWaiting").textContent = state.summary?.waitingDelivery ?? 0;
  $("metricRetained").textContent = state.summary?.retainedFiles ?? 0;
}

function getDeploymentServerUrl() {
  return $("deploymentServerUrl").value.trim() || window.location.origin;
}

function buildDeploymentCommand(code) {
  return `FileAssistantClient.exe --server ${getDeploymentServerUrl()} --deploy-token ${code} --auto-register`;
}

function renderInstallCodes() {
  $("codesBody").innerHTML = state.installCodes
    .map((code) => {
      const bind = [
        code.bindToFirstMac ? `Mac: ${escapeHtml(code.boundMac || "待绑定")}` : "",
        code.bindToFirstIp ? `IP: ${escapeHtml(code.boundIp || "待绑定")}` : "",
      ].filter(Boolean).join("<br />") || "-";
      const nextStatus = code.status === "active" ? "disabled" : "active";
      return `<tr>
        <td>
          <strong>${escapeHtml(code.label)}</strong><br />
          <span class="muted">${escapeHtml(code.id)}</span><br />
          <span class="pill ${code.maxUses > 1 ? "ok" : ""}">${code.maxUses > 1 ? "可批量部署" : "单机注册"}</span>
        </td>
        <td>${statusPill(code.status)}</td>
        <td>${code.usedCount} / ${code.maxUses}</td>
        <td>${bind}</td>
        <td><button data-code-status="${escapeHtml(code.id)}" data-status="${nextStatus}">${nextStatus === "active" ? "启用" : "停用"}</button></td>
      </tr>`;
    })
    .join("");
}

function renderClients() {
  const employeeOptions = [
    `<option value="">未绑定</option>`,
    ...state.employees
      .filter((employee) => employee.status === "active")
      .map((employee) => {
        const department = state.departments.find((item) => item.id === employee.departmentId);
        const label = `${employee.name}${department ? ` / ${department.name}` : ""}`;
        return `<option value="${escapeHtml(employee.id)}">${escapeHtml(label)}</option>`;
      }),
  ].join("");
  $("clientsBody").innerHTML = state.clients
    .map((client) => {
      const managed = client.managed ? "受管" : "脱管";
      const allowed = client.allowWhenUnmanaged ? "脱管可用" : "脱管禁用";
      const nextStatus = client.status === "active" ? "disabled" : "active";
      const nextManaged = client.managed ? false : true;
      return `<tr>
        <td>
          <strong>${escapeHtml(client.displayName)}</strong><br />
          <span class="muted">${escapeHtml(client.id)}</span>
        </td>
        <td>${escapeHtml(client.platform || "-")}</td>
        <td>
          <select data-client-employee-select="${escapeHtml(client.id)}">${employeeOptions}</select>
          <button data-client-employee="${escapeHtml(client.id)}">绑定</button>
        </td>
        <td>${escapeHtml(client.macAddress || "-")}<br />${escapeHtml(client.ipAddress || "-")}</td>
        <td>${statusPill(client.status)} <span class="pill">${managed}</span> <span class="pill">${allowed}</span></td>
        <td class="actions">
          <button data-client-status="${escapeHtml(client.id)}" data-status="${nextStatus}">${nextStatus === "active" ? "启用" : "停用"}</button>
          <button data-client-managed="${escapeHtml(client.id)}" data-managed="${nextManaged}">${nextManaged ? "纳管" : "脱管"}</button>
          <button data-client-policy="${escapeHtml(client.id)}" data-allow="${!client.allowWhenUnmanaged}">${client.allowWhenUnmanaged ? "脱管禁用" : "脱管可用"}</button>
        </td>
      </tr>`;
    })
    .join("");
  for (const client of state.clients) {
    const select = document.querySelector(`[data-client-employee-select="${CSS.escape(client.id)}"]`);
    if (select) select.value = client.employeeId || "";
  }
}

function renderDepartments() {
  const departmentOptions = [
    `<option value="">未分配</option>`,
    ...state.departments
      .filter((department) => department.status === "active")
      .map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`),
  ].join("");
  $("employeeDepartment").innerHTML = departmentOptions;
  const anyDepartmentOptions = [
    `<option value="">任意部门</option>`,
    ...state.departments
      .filter((department) => department.status === "active")
      .map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`),
  ].join("");
  $("ruleSourceDepartment").innerHTML = anyDepartmentOptions;
  $("ruleTargetDepartment").innerHTML = anyDepartmentOptions;
  $("departmentsBody").innerHTML = state.departments
    .map((department) => {
      const nextStatus = department.status === "active" ? "disabled" : "active";
      return `<tr>
        <td><strong>${escapeHtml(department.name)}</strong></td>
        <td>${statusPill(department.status)}</td>
        <td><button data-department="${escapeHtml(department.id)}" data-status="${nextStatus}">${nextStatus === "active" ? "启用" : "停用"}</button></td>
      </tr>`;
    })
    .join("");
}

function departmentName(id) {
  if (!id) return "任意部门";
  return state.departments.find((department) => department.id === id)?.name || "-";
}

function renderTransferRules() {
  $("rulesBody").innerHTML = state.transferRules
    .map((rule) => {
      const nextStatus = rule.status === "active" ? "disabled" : "active";
      return `<tr>
        <td><strong>${escapeHtml(rule.name)}</strong></td>
        <td>${escapeHtml(departmentName(rule.sourceDepartmentId))}</td>
        <td>${escapeHtml(departmentName(rule.targetDepartmentId))}</td>
        <td>
          <span class="pill ${rule.requireApproval ? "warn" : "ok"}">${rule.requireApproval ? "需要确认" : "免确认"}</span>
          <span class="pill ${rule.allowBackup ? "ok" : "danger"}">${rule.allowBackup ? "允许备份" : "禁止备份"}</span>
        </td>
        <td>${statusPill(rule.status)}</td>
        <td class="actions">
          <button data-rule="${escapeHtml(rule.id)}" data-status="${nextStatus}">${nextStatus === "active" ? "启用" : "停用"}</button>
          <button data-rule-approval="${escapeHtml(rule.id)}" data-value="${!rule.requireApproval}">${rule.requireApproval ? "设为免确认" : "设为需确认"}</button>
          <button data-rule-backup="${escapeHtml(rule.id)}" data-value="${!rule.allowBackup}">${rule.allowBackup ? "禁止备份" : "允许备份"}</button>
        </td>
      </tr>`;
    })
    .join("");
}

function renderEmployees() {
  $("employeesBody").innerHTML = state.employees
    .map((employee) => {
      const department = state.departments.find((item) => item.id === employee.departmentId);
      const nextStatus = employee.status === "active" ? "disabled" : "active";
      return `<tr>
        <td>
          <strong>${escapeHtml(employee.name)}</strong><br />
          <span class="muted">${escapeHtml(employee.employeeNo || "-")} ${escapeHtml(employee.title || "")}</span>
        </td>
        <td>${escapeHtml(department?.name || "-")}</td>
        <td>${statusPill(employee.status)}</td>
        <td><button data-employee="${escapeHtml(employee.id)}" data-status="${nextStatus}">${nextStatus === "active" ? "启用" : "停用"}</button></td>
      </tr>`;
    })
    .join("");
}

function renderTransfers() {
  $("transfersBody").innerHTML = state.transfers
    .map((transfer) => {
      const canReview = transfer.status === "pending_approval";
      const hasServerFile = transfer.serverFileStatus !== "purged" && transfer.serverFileStatus !== "unavailable";
      const retainAction = transfer.retainOnServer
        ? `<button data-retain="${escapeHtml(transfer.id)}" data-retain-value="false">取消备份</button>`
        : `<button ${hasServerFile ? "" : "disabled"} data-retain="${escapeHtml(transfer.id)}" data-retain-value="true">标记备份</button>`;
      return `<tr>
        <td>
          <strong>${escapeHtml(transfer.fileName)}</strong><br />
          <span class="muted">${Math.round((transfer.size || 0) / 1024)} KB, ${transfer.progress || 0}%</span>
        </td>
        <td>
          ${escapeHtml(transfer.senderEmployeeName || transfer.senderName)}<br />
          ${escapeHtml(transfer.receiverEmployeeName || transfer.receiverName)}
          <br /><span class="muted">${escapeHtml(transfer.senderName)} -> ${escapeHtml(transfer.receiverName)}</span>
          <br /><span class="pill">${escapeHtml(transfer.transferRuleName || "默认规则")}</span>
        </td>
        <td>${statusPill(transfer.status)} ${statusPill(transfer.deliveryStatus)}</td>
        <td>${statusPill(transfer.serverFileStatus)} ${transfer.retainOnServer ? '<span class="pill ok">重要备份</span>' : ""}</td>
        <td>${escapeHtml(transfer.uploadNote || "-")}</td>
        <td class="actions">
          <button ${hasServerFile ? "" : "disabled"} data-admin-file="${escapeHtml(transfer.id)}" data-mode="preview">预览</button>
          <button ${hasServerFile ? "" : "disabled"} data-admin-file="${escapeHtml(transfer.id)}" data-mode="download">下载</button>
          ${retainAction}
          <button ${hasServerFile ? "" : "disabled"} class="danger" data-purge="${escapeHtml(transfer.id)}">清除</button>
          <button ${canReview ? "" : "disabled"} data-transfer="${escapeHtml(transfer.id)}" data-status="approved">放行</button>
          <button ${canReview ? "" : "disabled"} class="danger" data-transfer="${escapeHtml(transfer.id)}" data-status="rejected">驳回</button>
        </td>
      </tr>`;
    })
    .join("");
}

function renderUsers() {
  $("usersBody").innerHTML = state.users
    .map((user) => {
      const nextStatus = user.status === "active" ? "disabled" : "active";
      const permissions = (user.permissions || []).join(", ");
      return `<tr>
        <td>
          <strong>${escapeHtml(user.username)}</strong><br />
          <span class="muted">${escapeHtml(user.displayName || user.id)}</span>
        </td>
        <td>${escapeHtml(user.role)}</td>
        <td>${statusPill(user.status)}</td>
        <td>${escapeHtml(permissions)}</td>
        <td><button data-admin-user="${escapeHtml(user.id)}" data-status="${nextStatus}">${nextStatus === "active" ? "启用" : "停用"}</button></td>
      </tr>`;
    })
    .join("");
}

function actionLabel(action) {
  return {
    "transfer.approved": "中转放行",
    "transfer.auto_approved": "免确认自动放行",
    "transfer.rejected": "中转驳回",
    "transfer.upload.completed": "上传完成",
    "transfer.created": "创建中转任务",
    "transfer.chunk_uploaded": "上传分片",
    "transfer.file_receive": "接收端取件",
    "transfer.file_preview": "管理端查阅",
    "transfer.delivery_confirmed": "接收确认",
    "transfer.retention_updated": "备份状态更新",
    "transfer.purged": "服务器文件清除",
    "client.registered": "客户端注册",
    "admin.login": "管理员登录",
    "admin.logout": "管理员退出",
  }[action] || action;
}

function renderLogs() {
  $("logsBody").innerHTML = state.logs
    .map((log) => `<tr>
      <td>${escapeHtml(new Date(log.at).toLocaleString())}</td>
      <td>${escapeHtml(log.actorType)} / ${escapeHtml(log.actorId)}</td>
      <td>${escapeHtml(actionLabel(log.action))}</td>
      <td><code>${escapeHtml(JSON.stringify(log.details))}</code></td>
    </tr>`)
    .join("");
}

async function refreshAll() {
  if (!state.session?.token) {
    showApp(false);
    return;
  }
  const [summary, departments, employees, transferRules, installCodes, clients, transfers, logs, users] = await Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/departments"),
    api("/api/admin/employees"),
    api("/api/admin/transfer-rules"),
    api("/api/admin/install-codes"),
    api("/api/admin/clients"),
    api("/api/admin/transfers"),
    api("/api/admin/logs"),
    api("/api/admin/users").catch(() => []),
  ]);
  state.summary = summary;
  state.departments = departments;
  state.employees = employees;
  state.transferRules = transferRules;
  state.installCodes = installCodes;
  state.clients = clients;
  state.transfers = transfers;
  state.logs = logs;
  state.users = users;
  showApp(true);
  renderSummary();
  renderDepartments();
  renderTransferRules();
  renderEmployees();
  renderInstallCodes();
  renderClients();
  renderTransfers();
  renderUsers();
  renderLogs();
}

async function login(event) {
  event.preventDefault();
  const res = await fetch("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: $("adminUsername").value.trim(),
      password: $("adminPassword").value,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "登录失败");
  state.session = {
    token: payload.token,
    expiresAt: payload.expiresAt,
    user: payload.user,
  };
  localStorage.setItem("fa_admin_session", JSON.stringify(state.session));
  await refreshAll();
}

async function setupInitialAdmin(event) {
  event.preventDefault();
  const password = $("setupPassword").value;
  const confirm = $("setupPasswordConfirm").value;
  if (password !== confirm) {
    throw new Error("两次输入的密码不一致");
  }
  const res = await fetch("/api/admin/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: $("setupUsername").value.trim(),
      displayName: $("setupDisplayName").value.trim(),
      password,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "初始化管理员失败");
  state.session = {
    token: payload.token,
    expiresAt: payload.expiresAt,
    user: payload.user,
  };
  localStorage.setItem("fa_admin_session", JSON.stringify(state.session));
  await refreshAll();
}

async function logout() {
  if (state.session?.token) {
    await api("/api/admin/auth/logout", { method: "POST" }).catch(() => {});
  }
  state.session = null;
  localStorage.removeItem("fa_admin_session");
  showApp(false);
}

async function createInstallCode(event) {
  event.preventDefault();
  const deploymentMode = $("deploymentMode").checked || Number($("maxUses").value || 1) > 1;
  const payload = {
    label: $("codeLabel").value.trim() || (deploymentMode ? "批量部署令牌" : "安装码"),
    maxUses: Number($("maxUses").value || 1),
    allowedMacs: $("allowedMacs").value,
    allowedIps: $("allowedIps").value,
    bindToFirstMac: $("bindMac").checked,
    bindToFirstIp: $("bindIp").checked,
    defaultAllowWhenUnmanaged: $("allowUnmanaged").checked,
  };
  const created = await api("/api/admin/install-codes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const command = buildDeploymentCommand(created.code);
  $("newCode").hidden = false;
  $("newCode").innerHTML = `
    <strong>${deploymentMode ? "部署令牌" : "安装码"}只显示这一次：</strong>
    <div class="code-box">${escapeHtml(created.code)}</div>
    <div class="actions" style="margin-top: 8px">
      <button type="button" data-copy="${escapeHtml(created.code)}">复制令牌</button>
    </div>
    <p class="muted" style="margin-top: 10px">服务台下发命令：</p>
    <div class="code-box">${escapeHtml(command)}</div>
    <div class="actions" style="margin-top: 8px">
      <button type="button" data-copy="${escapeHtml(command)}">复制部署命令</button>
    </div>`;
  await refreshAll();
}

function applyDeploymentModeDefaults() {
  if (!$("deploymentMode").checked) {
    return;
  }

  if (Number($("maxUses").value || 1) <= 1) {
    $("maxUses").value = 100;
  }

  if (!$("codeLabel").value.trim() || $("codeLabel").value === "Default install code") {
    $("codeLabel").value = "批量部署令牌";
  }
}

async function createDepartment(event) {
  event.preventDefault();
  await api("/api/admin/departments", {
    method: "POST",
    body: JSON.stringify({
      name: $("departmentName").value.trim(),
    }),
  });
  $("departmentForm").reset();
  await refreshAll();
}

async function createEmployee(event) {
  event.preventDefault();
  await api("/api/admin/employees", {
    method: "POST",
    body: JSON.stringify({
      name: $("employeeName").value.trim(),
      employeeNo: $("employeeNo").value.trim(),
      departmentId: $("employeeDepartment").value,
      title: $("employeeTitle").value.trim(),
    }),
  });
  $("employeeForm").reset();
  await refreshAll();
}

async function createTransferRule(event) {
  event.preventDefault();
  await api("/api/admin/transfer-rules", {
    method: "POST",
    body: JSON.stringify({
      name: $("ruleName").value.trim(),
      sourceDepartmentId: $("ruleSourceDepartment").value || null,
      targetDepartmentId: $("ruleTargetDepartment").value || null,
      requireApproval: $("ruleRequireApproval").checked,
      allowBackup: $("ruleAllowBackup").checked,
    }),
  });
  $("ruleForm").reset();
  $("ruleRequireApproval").checked = false;
  $("ruleAllowBackup").checked = true;
  await refreshAll();
}

async function bulkRename(event) {
  event.preventDefault();
  const result = await api("/api/admin/clients/bulk-rename", {
    method: "POST",
    body: JSON.stringify({
      matchField: $("matchField").value,
      matchValue: $("matchValue").value,
      namePrefix: $("namePrefix").value,
    }),
  });
  alert(`已修改 ${result.count} 个客户端名称`);
  await refreshAll();
}

async function createAdminUser(event) {
  event.preventDefault();
  await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: $("newUsername").value.trim(),
      displayName: $("newDisplayName").value.trim(),
      password: $("newPassword").value,
      role: $("newRole").value,
      permissions: $("newPermissions").value,
    }),
  });
  $("userForm").reset();
  $("newPermissions").value = "dashboard.view\norg.manage\ntransfer.view\ntransfer.review\naudit.view";
  await refreshAll();
}

async function patchDepartment(id, payload) {
  await api(`/api/admin/departments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
}

async function patchEmployee(id, payload) {
  await api(`/api/admin/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
}

async function patchTransferRule(id, payload) {
  await api(`/api/admin/transfer-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
}

async function patchInstallCode(id, payload) {
  await api(`/api/admin/install-codes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
}

async function patchClient(id, payload) {
  await api(`/api/admin/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
}

async function patchAdminUser(id, payload) {
  await api(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
}

async function patchTransfer(id, status) {
  const reason = status === "rejected" ? prompt("驳回原因，可留空") || "" : "";
  await api(`/api/admin/transfers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason }),
  });
  await refreshAll();
}

async function setRetention(id, retainOnServer) {
  await api(`/api/admin/transfers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ retainOnServer }),
  });
  await refreshAll();
}

async function purgeTransfer(id) {
  if (!confirm("确认清除服务器上的该文件？")) return;
  await api(`/api/admin/transfers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "purge" }),
  });
  await refreshAll();
}

async function openAdminFile(id, mode) {
  const transfer = state.transfers.find((item) => item.id === id);
  const res = await fetch(`/api/admin/transfers/${id}/file?mode=${mode}`, {
    headers: { Authorization: `Bearer ${state.session?.token || ""}` },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "无法打开文件");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (mode === "download") {
    const a = document.createElement("a");
    a.href = url;
    a.download = transfer?.fileName || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function wireEvents() {
  $("deploymentServerUrl").placeholder = window.location.origin;
  $("deploymentMode").addEventListener("change", applyDeploymentModeDefaults);
  $("setupForm").addEventListener("submit", (event) => setupInitialAdmin(event).catch((error) => alert(error.message)));
  $("loginForm").addEventListener("submit", (event) => login(event).catch((error) => alert(error.message)));
  $("logoutBtn").addEventListener("click", () => logout().catch((error) => alert(error.message)));
  $("refreshBtn").addEventListener("click", () => refreshAll().catch((error) => {
    alert(error.message);
    showApp(false);
  }));
  $("departmentForm").addEventListener("submit", (event) => createDepartment(event).catch((error) => alert(error.message)));
  $("employeeForm").addEventListener("submit", (event) => createEmployee(event).catch((error) => alert(error.message)));
  $("ruleForm").addEventListener("submit", (event) => createTransferRule(event).catch((error) => alert(error.message)));
  $("codeForm").addEventListener("submit", (event) => createInstallCode(event).catch((error) => alert(error.message)));
  $("renameForm").addEventListener("submit", (event) => bulkRename(event).catch((error) => alert(error.message)));
  $("userForm").addEventListener("submit", (event) => createAdminUser(event).catch((error) => alert(error.message)));
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.copy) {
      navigator.clipboard?.writeText(target.dataset.copy)
        .then(() => alert("已复制"))
        .catch(() => prompt("复制下面的内容", target.dataset.copy));
    }
    if (target.dataset.codeStatus) {
      patchInstallCode(target.dataset.codeStatus, { status: target.dataset.status }).catch((error) => alert(error.message));
    }
    if (target.dataset.clientStatus) {
      patchClient(target.dataset.clientStatus, { status: target.dataset.status }).catch((error) => alert(error.message));
    }
    if (target.dataset.clientManaged) {
      patchClient(target.dataset.clientManaged, { managed: target.dataset.managed === "true" }).catch((error) => alert(error.message));
    }
    if (target.dataset.clientPolicy) {
      patchClient(target.dataset.clientPolicy, { allowWhenUnmanaged: target.dataset.allow === "true" }).catch((error) => alert(error.message));
    }
    if (target.dataset.clientEmployee) {
      const select = document.querySelector(`[data-client-employee-select="${CSS.escape(target.dataset.clientEmployee)}"]`);
      patchClient(target.dataset.clientEmployee, { employeeId: select?.value || null }).catch((error) => alert(error.message));
    }
    if (target.dataset.department) {
      patchDepartment(target.dataset.department, { status: target.dataset.status }).catch((error) => alert(error.message));
    }
    if (target.dataset.employee) {
      patchEmployee(target.dataset.employee, { status: target.dataset.status }).catch((error) => alert(error.message));
    }
    if (target.dataset.rule) {
      patchTransferRule(target.dataset.rule, { status: target.dataset.status }).catch((error) => alert(error.message));
    }
    if (target.dataset.ruleApproval) {
      patchTransferRule(target.dataset.ruleApproval, { requireApproval: target.dataset.value === "true" }).catch((error) => alert(error.message));
    }
    if (target.dataset.ruleBackup) {
      patchTransferRule(target.dataset.ruleBackup, { allowBackup: target.dataset.value === "true" }).catch((error) => alert(error.message));
    }
    if (target.dataset.transfer) {
      patchTransfer(target.dataset.transfer, target.dataset.status).catch((error) => alert(error.message));
    }
    if (target.dataset.adminFile) {
      openAdminFile(target.dataset.adminFile, target.dataset.mode).catch((error) => alert(error.message));
    }
    if (target.dataset.adminUser) {
      patchAdminUser(target.dataset.adminUser, { status: target.dataset.status }).catch((error) => alert(error.message));
    }
    if (target.dataset.retain) {
      setRetention(target.dataset.retain, target.dataset.retainValue === "true").catch((error) => alert(error.message));
    }
    if (target.dataset.purge) {
      purgeTransfer(target.dataset.purge).catch((error) => alert(error.message));
    }
  });
}

async function boot() {
  const res = await fetch("/api/admin/setup/status");
  if (res.ok) {
    const setup = await res.json();
    if (setup.required) {
      localStorage.removeItem("fa_admin_session");
      state.session = null;
      showSetup();
      return;
    }
  }

  showApp(false);
  if (state.session?.token) {
    refreshAll().catch(() => {
      localStorage.removeItem("fa_admin_session");
      state.session = null;
      showApp(false);
    });
  }
}

wireEvents();
boot().catch((error) => {
  console.error(error);
  showApp(false);
});
