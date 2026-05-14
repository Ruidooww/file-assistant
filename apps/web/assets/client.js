const state = {
  credentials: JSON.parse(localStorage.getItem("fa_client_credentials") || "null"),
  me: null,
  recipients: [],
  transfers: [],
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
  }[status] || status;
  return `<span class="pill ${kind}">${escapeHtml(label)}</span>`;
}

function clientHeaders(extra = {}) {
  return {
    "X-Client-Id": state.credentials?.clientId || "",
    "X-Client-Secret": state.credentials?.clientSecret || "",
    "X-Device-Mac": state.credentials?.macAddress || "",
    "X-Device-Ip": state.credentials?.ipAddress || "",
    ...extra,
  };
}

async function api(path, options = {}) {
  const headers = options.body instanceof Blob
    ? clientHeaders(options.headers || {})
    : clientHeaders({ "Content-Type": "application/json", ...(options.headers || {}) });
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function saveCredentials(client, clientSecret, macAddress, ipAddress) {
  state.credentials = {
    clientId: client.id,
    clientSecret,
    macAddress,
    ipAddress,
  };
  localStorage.setItem("fa_client_credentials", JSON.stringify(state.credentials));
}

function showRegistered(visible) {
  $("registerPanel").hidden = visible;
  $("clientContent").hidden = !visible;
}

function setUploadProgress(percent, text) {
  $("uploadProgress").style.width = `${Math.max(0, Math.min(100, percent))}%`;
  $("uploadStatus").textContent = text || "";
}

function renderMe() {
  $("meLine").textContent = state.me
    ? `${state.me.displayName} / ${state.me.platform || "unknown"} / ${state.me.macAddress || "no-mac"} / ${state.me.ipAddress || "no-ip"}`
    : "";
}

function renderReceivers() {
  if (state.recipients.length === 0) {
    $("receiverId").innerHTML = `<option value="">暂无可接收人员，请管理员先绑定客户端</option>`;
    return;
  }
  $("receiverId").innerHTML = state.recipients
    .map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}${employee.departmentName ? ` - ${escapeHtml(employee.departmentName)}` : ""} (${employee.clientCount} 台设备)</option>`)
    .join("");
}

function roleFor(transfer) {
  if (!state.me) return "-";
  if (transfer.senderId === state.me.id) return "我发送";
  if (transfer.receiverId === state.me.id) return "发给我";
  return "-";
}

function serverStatusText(transfer) {
  const parts = [statusPill(transfer.serverFileStatus || "unavailable")];
  if (transfer.retainOnServer) parts.push(`<span class="pill ok">重要备份</span>`);
  return parts.join(" ");
}

function renderTransfers() {
  $("transfersBody").innerHTML = state.transfers
    .map((transfer) => {
      const isReceiver = transfer.receiverId === state.me?.id;
      const ready = transfer.status === "ready_to_deliver";
      const canReceive = isReceiver
        && ready
        && transfer.deliveryStatus !== "delivered"
        && transfer.serverFileStatus !== "purged"
        && transfer.controls?.receiver?.allowReceive !== false;
      const actions = isReceiver
        ? `<button ${canReceive ? "" : "disabled"} data-receive="${escapeHtml(transfer.id)}">接收文件</button>`
        : `<span class="muted">仅查看状态</span>`;
      return `<tr>
        <td>
          <strong>${escapeHtml(transfer.fileName)}</strong><br />
          <span class="muted">${Math.round((transfer.size || 0) / 1024)} KB, ${transfer.progress || 0}%</span>
        </td>
        <td>${roleFor(transfer)}<br /><span class="muted">${escapeHtml(transfer.senderEmployeeName || transfer.senderName)} -> ${escapeHtml(transfer.receiverEmployeeName || transfer.receiverName)}</span></td>
        <td>${statusPill(transfer.status)} ${statusPill(transfer.deliveryStatus)}</td>
        <td>${serverStatusText(transfer)}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    })
    .join("");
}

async function refreshAll() {
  if (!state.credentials) {
    showRegistered(false);
    return;
  }
  const [me, recipients, transfers] = await Promise.all([
    api("/api/client/me"),
    api("/api/client/recipients"),
    api("/api/client/transfers"),
  ]);
  state.me = me;
  state.recipients = recipients;
  state.transfers = transfers;
  showRegistered(true);
  renderMe();
  renderReceivers();
  renderTransfers();
}

async function registerClient(event) {
  event.preventDefault();
  const macAddress = $("macAddress").value.trim();
  const ipAddress = $("ipAddress").value.trim();
  const payload = {
    installCode: $("installCode").value.trim(),
    displayName: $("displayName").value.trim(),
    macAddress,
    ipAddress,
    platform: `${navigator.platform || "browser"} ${navigator.userAgentData?.platform || ""}`.trim(),
  };
  const res = await fetch("/api/client/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "注册失败");
  }
  const registered = await res.json();
  saveCredentials(registered.client, registered.clientSecret, macAddress, ipAddress);
  await refreshAll();
}

function buildControls() {
  return {
    uploader: {
      allowStatusView: true,
    },
    receiver: {
      allowReceive: true,
      allowPreview: false,
      allowScreenshot: true,
    },
  };
}

async function findResumableTransfer(file, receiverEmployeeId) {
  const match = state.transfers.find((transfer) => (
    transfer.senderId === state.me?.id
    && transfer.receiverEmployeeId === receiverEmployeeId
    && transfer.fileName === file.name
    && transfer.size === file.size
    && (transfer.status === "uploading" || transfer.status === "assembling")
  ));
  if (!match) return null;
  const useExisting = confirm("发现同名同大小的未完成传输，是否继续断点续传？");
  if (!useExisting) return null;
  return api(`/api/client/transfers/${match.id}/status`);
}

async function initTransfer(file, receiverEmployeeId) {
  const existing = await findResumableTransfer(file, receiverEmployeeId);
  if (existing) return existing;
  return api("/api/client/transfers/init", {
    method: "POST",
    body: JSON.stringify({
      receiverEmployeeId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      retainOnServer: $("retainOnServer").checked,
      uploadNote: $("uploadNote").value.trim(),
      controls: buildControls(),
    }),
  });
}

async function uploadFile(event) {
  event.preventDefault();
  const file = $("fileInput").files[0];
  const receiverEmployeeId = $("receiverId").value;
  if (!file) throw new Error("请选择文件");
  if (!receiverEmployeeId) throw new Error("请选择接收人员");

  setUploadProgress(0, "准备上传...");
  const { transfer, missingChunks } = await initTransfer(file, receiverEmployeeId);
  const chunkSize = transfer.chunkSize;
  const missing = [...missingChunks];
  const total = transfer.totalChunks;
  const uploadedBefore = total - missing.length;

  for (let position = 0; position < missing.length; position += 1) {
    const index = missing[position];
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const done = uploadedBefore + position;
    setUploadProgress(Math.round((done / total) * 100), `上传分片 ${index + 1} / ${total}`);
    await api(`/api/client/transfers/${transfer.id}/chunks/${index}`, {
      method: "PUT",
      body: chunk,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
  }

  setUploadProgress(100, "上传完成，等待接收方接收或中转确认");
  await refreshAll();
}

async function fetchTransferBlob(transferId, mode) {
  const res = await fetch(`/api/client/transfers/${transferId}/file?mode=${mode}`, {
    headers: clientHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "无法打开文件");
  }
  return res.blob();
}

async function receiveTransfer(transferId) {
  const transfer = state.transfers.find((item) => item.id === transferId);
  const blob = await fetchTransferBlob(transferId, "receive");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = transfer?.fileName || "received-file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  await api(`/api/client/transfers/${transferId}/confirm-delivery`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  await refreshAll();
}

function logout() {
  localStorage.removeItem("fa_client_credentials");
  state.credentials = null;
  state.me = null;
  state.recipients = [];
  state.transfers = [];
  showRegistered(false);
}

function wireEvents() {
  $("registerForm").addEventListener("submit", (event) => registerClient(event).catch((error) => alert(error.message)));
  $("uploadForm").addEventListener("submit", (event) => uploadFile(event).catch((error) => {
    setUploadProgress(0, error.message);
    alert(error.message);
  }));
  $("refreshBtn").addEventListener("click", () => refreshAll().catch((error) => alert(error.message)));
  $("logoutBtn").addEventListener("click", logout);
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.receive) {
      receiveTransfer(target.dataset.receive).catch((error) => alert(error.message));
    }
  });
}

wireEvents();
refreshAll().catch(() => showRegistered(false));
