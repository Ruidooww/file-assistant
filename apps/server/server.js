const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { once } = require("node:events");

const { createDefaultStore } = require("./db");

const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;
const JSON_LIMIT_BYTES = 1024 * 1024;
const CLIENT_BOOTSTRAP_BEGIN = "FA_CLIENT_BOOTSTRAP_V1_BEGIN";
const CLIENT_BOOTSTRAP_END = "FA_CLIENT_BOOTSTRAP_V1_END";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function createPasswordHash(password, salt = randomSecret(18)) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("base64url");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = createPasswordHash(password, salt);
  const left = Buffer.from(hash);
  const right = Buffer.from(String(expectedHash || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function generateInstallCode() {
  const raw = crypto.randomBytes(10).toString("hex").toUpperCase();
  return `FA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, {
    error: status === 500 ? "Internal server error" : error.message,
  });
  if (status === 500) {
    console.error(error);
  }
}

function logFileCleanupFailure(target, error) {
  console.error(`[FileAssistant] Failed to clean up ${target}.`, error);
}

async function removePathQuietly(target) {
  try {
    await fs.promises.rm(target, { recursive: true, force: true });
  } catch (error) {
    logFileCleanupFailure(target, error);
  }
}

async function destroyStreamAndWaitForClose(stream) {
  if (stream.closed) {
    return;
  }
  const closed = once(stream, "close").catch(() => {});
  stream.destroy();
  await closed;
}

function pipeFileToResponse(res, filePath) {
  const stream = fs.createReadStream(filePath);
  const onResponseClose = () => {
    if (!res.writableEnded && !stream.destroyed) {
      stream.destroy();
    }
  };
  const cleanup = () => {
    res.off("close", onResponseClose);
  };

  res.on("close", onResponseClose);
  stream.on("close", cleanup);
  stream.on("error", (error) => {
    cleanup();
    console.error(`[FileAssistant] Failed to stream ${filePath}.`, error);
    if (!res.headersSent) {
      sendError(res, error);
      return;
    }
    res.destroy(error);
  });
  stream.pipe(res);
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameText(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function allowByList(list, value) {
  if (!list || list.length === 0) return true;
  return list.some((item) => sameText(item, value));
}

function sanitizeFileName(fileName) {
  const base = path.basename(String(fileName || "file.bin"));
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 180) || "file.bin";
}

function sanitizePackageLabel(label) {
  return sanitizeFileName(String(label || "client").replace(/\s+/g, "-"))
    .replace(/\.exe$/i, "")
    .slice(0, 64) || "client";
}

function normalizeServerUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw httpError(400, "Server URL is required");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw httpError(400, "Server URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Server URL must start with http:// or https://");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function publicClient(client, data = null) {
  if (!client) return null;
  const { secretHash, ...rest } = client;
  if (!data || !client.employeeId) return rest;
  const employee = data.employees.find((item) => item.id === client.employeeId) || null;
  const department = employee?.departmentId
    ? data.departments.find((item) => item.id === employee.departmentId) || null
    : null;
  return {
    ...rest,
    employeeName: employee?.name || "",
    employeeNo: employee?.employeeNo || "",
    employeeTitle: employee?.title || "",
    departmentName: department?.name || "",
  };
}

function publicDepartment(department) {
  return department || null;
}

function publicEmployee(employee) {
  return employee || null;
}

function publicTransferRule(rule) {
  return rule || null;
}

function publicInstallCode(code) {
  const { codeHash, ...rest } = code;
  return rest;
}

function normalizeOpenRegistration(settings) {
  const open = settings?.openRegistration || {};
  return {
    enabled: open.enabled === true,
    expiresAt: open.expiresAt || null,
    maxUses: Math.max(1, Number(open.maxUses || 50)),
    usedCount: Math.max(0, Number(open.usedCount || 0)),
    defaultAllowWhenUnmanaged: open.defaultAllowWhenUnmanaged !== false,
    updatedAt: open.updatedAt || null,
  };
}

function isOpenRegistrationActive(open) {
  if (!open.enabled) return false;
  if (open.usedCount >= open.maxUses) return false;
  if (!open.expiresAt) return true;
  const expiresAt = Date.parse(open.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function publicOpenRegistration(settings) {
  const open = normalizeOpenRegistration(settings);
  return {
    ...open,
    active: isOpenRegistrationActive(open),
    remainingUses: Math.max(0, open.maxUses - open.usedCount),
  };
}

function createRegisteredClient(data, body, clientSecret, options = {}) {
  const macAddress = String(body.macAddress || "").trim();
  const ipAddress = String(body.ipAddress || "").trim();
  const client = {
    id: createId("client"),
    displayName: String(body.displayName || "Client"),
    macAddress,
    ipAddress,
    platform: String(body.platform || ""),
    installCodeId: options.installCodeId || null,
    secretHash: sha256(clientSecret),
    employeeId: null,
    status: "active",
    managed: true,
    allowWhenUnmanaged: options.allowWhenUnmanaged !== false,
    mustMatchMac: options.mustMatchMac ?? Boolean(macAddress),
    mustMatchIp: options.mustMatchIp ?? Boolean(ipAddress),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  data.clients.unshift(client);
  appendLog(data, "client", client.id, "client.registered", {
    installCodeId: client.installCodeId,
    registrationMode: options.registrationMode || "install-code",
    displayName: client.displayName,
    macAddress,
    ipAddress,
  });
  return publicClient(client);
}

function publicTransfer(transfer) {
  return {
    ...transfer,
    filePath: undefined,
    chunksDir: undefined,
  };
}

function publicAdminUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, ...rest } = user;
  return rest;
}

function appendLog(data, actorType, actorId, action, details = {}) {
  data.logs.unshift({
    id: createId("log"),
    at: nowIso(),
    actorType,
    actorId,
    action,
    details,
  });
  data.logs = data.logs.slice(0, 1000);
}

async function readJson(req, limit = JSON_LIMIT_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, "JSON body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw httpError(400, "Invalid JSON body");
  }
}

function hasPermission(admin, permission) {
  if (!permission) return true;
  if (!admin) return false;
  if (admin.authType === "legacy-token") return true;
  return admin.permissions?.includes("*") || admin.permissions?.includes(permission);
}

function permissionForAdminRoute(method, pathname) {
  if (pathname === "/api/admin/auth/me" || pathname === "/api/admin/auth/logout") return null;
  if (pathname === "/api/admin/summary") return "dashboard.view";
  if (pathname.startsWith("/api/admin/users")) return "admin.manage";
  if (pathname.startsWith("/api/admin/departments")) return "org.manage";
  if (pathname.startsWith("/api/admin/employees")) return "org.manage";
  if (pathname.startsWith("/api/admin/transfer-rules")) return "org.manage";
  if (pathname.startsWith("/api/admin/install-codes")) return "install_code.manage";
  if (pathname.startsWith("/api/admin/client-packages")) return "install_code.manage";
  if (pathname.startsWith("/api/admin/open-registration")) return "client.manage";
  if (pathname.startsWith("/api/admin/clients")) return "client.manage";
  if (pathname.startsWith("/api/admin/transfers")) return method === "GET" ? "transfer.view" : "transfer.review";
  if (pathname.startsWith("/api/admin/logs")) return "audit.view";
  return null;
}

function resolveAdmin(data, req, adminToken) {
  const legacyToken = req.headers["x-admin-token"];
  if (adminToken && legacyToken && legacyToken === adminToken) {
    return {
      id: "legacy-admin",
      username: "legacy-token",
      displayName: "Legacy Admin Token",
      role: "super_admin",
      permissions: ["*"],
      status: "active",
      authType: "legacy-token",
    };
  }

  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : req.headers["x-admin-session"];
  if (!token) throw httpError(401, "Admin session is missing");

  const tokenHash = sha256(token);
  const session = data.adminSessions.find((item) => item.tokenHash === tokenHash);
  if (!session) throw httpError(401, "Admin session is invalid");
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    throw httpError(401, "Admin session is expired");
  }
  const user = data.adminUsers.find((item) => item.id === session.userId);
  if (!user || user.status !== "active") {
    throw httpError(403, "Admin user is disabled");
  }
  return { ...publicAdminUser(user), sessionId: session.id, authType: "session" };
}

function requireAdmin(store, req, adminToken, permission) {
  const admin = resolveAdmin(store.snapshot(), req, adminToken);
  if (!hasPermission(admin, permission)) {
    throw httpError(403, "Admin permission denied");
  }
  return admin;
}

function resolveClient(data, req) {
  const clientId = req.headers["x-client-id"];
  const clientSecret = req.headers["x-client-secret"];
  if (!clientId || !clientSecret) {
    throw httpError(401, "Client credentials are missing");
  }
  const client = data.clients.find((item) => item.id === clientId);
  if (!client || client.secretHash !== sha256(clientSecret)) {
    throw httpError(401, "Client credentials are invalid");
  }
  if (client.status !== "active") {
    throw httpError(403, "Client is disabled");
  }
  if (!client.managed && !client.allowWhenUnmanaged) {
    throw httpError(403, "Client is unmanaged and blocked by policy");
  }
  const currentMac = req.headers["x-device-mac"] || client.macAddress;
  const currentIp = req.headers["x-device-ip"] || client.ipAddress;
  if (client.mustMatchMac && !sameText(currentMac, client.macAddress)) {
    throw httpError(403, "Client MAC does not match policy");
  }
  if (client.mustMatchIp && !sameText(currentIp, client.ipAddress)) {
    throw httpError(403, "Client IP does not match policy");
  }
  return client;
}

function getUploadPaths(dataDir, transferId, fileName) {
  return {
    chunksDir: path.join(dataDir, "chunks", transferId),
    fileDir: path.join(dataDir, "uploads", transferId),
    filePath: path.join(dataDir, "uploads", transferId, sanitizeFileName(fileName)),
  };
}

function resolveConfigPath(baseDir, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

function runtimeOption(options, optionName, envName, fallback) {
  if (Object.prototype.hasOwnProperty.call(options, optionName)) return options[optionName];
  if (Object.prototype.hasOwnProperty.call(process.env, envName)) return process.env[envName];
  return fallback;
}

function runtimeFlag(options, optionName, envName) {
  const value = Object.prototype.hasOwnProperty.call(options, optionName) ? options[optionName] : process.env[envName];
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function purgeTransferStorage(dataDir, transfer, reason) {
  const uploadsRoot = path.join(dataDir, "uploads");
  const chunksRoot = path.join(dataDir, "chunks");
  if (transfer.filePath) {
    const fileDir = path.dirname(transfer.filePath);
    if (isPathInside(uploadsRoot, fileDir)) {
      fs.rmSync(fileDir, { recursive: true, force: true });
    } else if (isPathInside(uploadsRoot, transfer.filePath)) {
      fs.rmSync(transfer.filePath, { force: true });
    }
  }
  if (transfer.chunksDir && isPathInside(chunksRoot, transfer.chunksDir)) {
    fs.rmSync(transfer.chunksDir, { recursive: true, force: true });
  }
  transfer.filePath = null;
  transfer.chunksDir = null;
  transfer.serverFileStatus = "purged";
  transfer.purgedAt = nowIso();
  transfer.purgeReason = reason;
}

function matchTransferRule(data, senderEmployee, receiverEmployee) {
  const activeRules = data.transferRules.filter((rule) => rule.status === "active");
  if (activeRules.length === 0) {
    return {
      id: null,
      name: "Default allow all",
      requireApproval: false,
      allowBackup: true,
      implicit: true,
    };
  }
  const senderDepartmentId = senderEmployee?.departmentId || null;
  const receiverDepartmentId = receiverEmployee?.departmentId || null;
  const matches = activeRules
    .filter((rule) => (
      (!rule.sourceDepartmentId || rule.sourceDepartmentId === senderDepartmentId)
      && (!rule.targetDepartmentId || rule.targetDepartmentId === receiverDepartmentId)
    ))
    .sort((left, right) => {
      const leftScore = (left.sourceDepartmentId ? 1 : 0) + (left.targetDepartmentId ? 1 : 0);
      const rightScore = (right.sourceDepartmentId ? 1 : 0) + (right.targetDepartmentId ? 1 : 0);
      return rightScore - leftScore;
    });
  return matches[0] || null;
}

async function mergeTransferFile(store, dataDir, transferId) {
  const snapshot = store.snapshot();
  const transfer = snapshot.transfers.find((item) => item.id === transferId);
  if (!transfer) return;

  const paths = getUploadPaths(dataDir, transfer.id, transfer.safeName);
  fs.mkdirSync(paths.fileDir, { recursive: true });
  const hash = crypto.createHash("sha256");
  const writer = fs.createWriteStream(paths.filePath);

  try {
    for (let index = 0; index < transfer.totalChunks; index += 1) {
      const chunkPath = path.join(paths.chunksDir, `${index}.part`);
      if (!fs.existsSync(chunkPath)) {
        throw httpError(409, `Missing chunk ${index}`);
      }
      const reader = fs.createReadStream(chunkPath);
      for await (const chunk of reader) {
        hash.update(chunk);
        if (!writer.write(chunk)) {
          await once(writer, "drain");
        }
      }
    }
    writer.end();
    await once(writer, "finish");
  } catch (error) {
    await destroyStreamAndWaitForClose(writer);
    await removePathQuietly(paths.fileDir);
    throw error;
  }

  fs.rmSync(paths.chunksDir, { recursive: true, force: true });
  await store.mutate((data) => {
    const current = data.transfers.find((item) => item.id === transferId);
    if (!current) return null;
    if (current.approvalRequired === false) {
      current.status = "ready_to_deliver";
      current.deliveryStatus = "waiting";
      current.approvedAt = nowIso();
    } else {
      current.status = "pending_approval";
      current.deliveryStatus = "not_ready";
    }
    current.filePath = paths.filePath;
    current.sha256 = hash.digest("hex");
    current.completedAt = nowIso();
    current.progress = 100;
    current.serverFileStatus = current.retainOnServer ? "retained" : "temporary";
    appendLog(data, "system", "server", "transfer.upload.completed", {
      transferId,
      fileName: current.fileName,
      senderId: current.senderId,
      receiverId: current.receiverId,
    });
    if (current.approvalRequired === false) {
      appendLog(data, "system", "server", "transfer.auto_approved", {
        transferId,
        transferRuleId: current.transferRuleId,
      });
    }
    return current;
  });
}

async function streamFile(res, transfer, disposition) {
  if (!transfer.filePath || !fs.existsSync(transfer.filePath)) {
    throw httpError(404, "File is not available");
  }
  const stat = fs.statSync(transfer.filePath);
  const encodedName = encodeURIComponent(transfer.fileName || "file.bin");
  res.writeHead(200, {
    "Content-Type": transfer.mimeType || "application/octet-stream",
    "Content-Length": stat.size,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-store",
  });
  pipeFileToResponse(res, transfer.filePath);
}

function streamDownloadPath(res, filePath, fileName) {
  if (!fs.existsSync(filePath)) {
    throw httpError(404, "File is not available");
  }
  const stat = fs.statSync(filePath);
  const encodedName = encodeURIComponent(fileName || path.basename(filePath));
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": stat.size,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-store",
  });
  pipeFileToResponse(res, filePath);
}

function appendClientBootstrapConfig(templatePath, outputPath, config) {
  if (!fs.existsSync(templatePath)) {
    throw httpError(500, `Client installer template was not found: ${templatePath}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const payload = JSON.stringify(config, null, 2);
  const block = [
    "",
    CLIENT_BOOTSTRAP_BEGIN,
    payload,
    CLIENT_BOOTSTRAP_END,
    "",
  ].join("\r\n");
  const template = fs.readFileSync(templatePath);
  fs.writeFileSync(outputPath, Buffer.concat([template, Buffer.from(block, "utf8")]));
}

function bootstrapAdminUsers(store, options = {}) {
  const username = options.adminUsername || "admin";
  const password = options.adminPassword || "admin123456";
  store.initialize((data) => {
    if (data.adminUsers.length > 0) return;
    const { salt, hash } = createPasswordHash(password);
    const admin = {
      id: createId("admin"),
      username,
      displayName: "System Administrator",
      role: "super_admin",
      permissions: ["*"],
      passwordSalt: salt,
      passwordHash: hash,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastLoginAt: null,
    };
    data.adminUsers.push(admin);
    appendLog(data, "system", "server", "admin_user.bootstrapped", {
      adminUserId: admin.id,
      username,
    });
  });
}

function createAdminSession(data, user) {
  const sessionToken = randomSecret(32);
  const now = nowIso();
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const session = {
    id: createId("session"),
    userId: user.id,
    tokenHash: sha256(sessionToken),
    createdAt: now,
    expiresAt: expires,
    lastSeenAt: now,
  };
  data.adminSessions.unshift(session);
  data.adminSessions = data.adminSessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now()).slice(0, 200);
  user.lastLoginAt = now;
  user.updatedAt = now;
  return { token: sessionToken, expiresAt: expires, user: publicAdminUser(user) };
}

function createAppServer(options = {}) {
  const defaultRootDir = path.resolve(__dirname, "..", "..");
  const rootDir = resolveConfigPath(process.cwd(), options.rootDir || process.env.FILE_ASSISTANT_ROOT_DIR || process.env.ROOT_DIR) || defaultRootDir;
  const dataDir = resolveConfigPath(rootDir, options.dataDir || process.env.FILE_ASSISTANT_DATA_DIR || process.env.DATA_DIR) || path.join(rootDir, "data");
  const publicDir = resolveConfigPath(rootDir, options.publicDir || process.env.FILE_ASSISTANT_PUBLIC_DIR || process.env.PUBLIC_DIR) || path.join(rootDir, "apps", "web");
  const clientInstallerTemplatePath = resolveConfigPath(rootDir, options.clientInstallerTemplatePath || process.env.FILE_ASSISTANT_CLIENT_INSTALLER_TEMPLATE)
    || path.join(rootDir, "deploy", "client-installer", "FileAssistantClientSetup.exe");
  const adminToken = runtimeOption(options, "adminToken", "ADMIN_TOKEN", "admin-change-me");
  const adminUsername = runtimeOption(options, "adminUsername", "ADMIN_USERNAME", "admin");
  const adminPassword = runtimeOption(options, "adminPassword", "ADMIN_PASSWORD", "admin123456");
  const initialAdminSetup = runtimeFlag(options, "initialAdminSetup", "FILE_ASSISTANT_INITIAL_ADMIN_SETUP");
  const chunkSize = Number(options.chunkSize || process.env.CHUNK_SIZE_BYTES || DEFAULT_CHUNK_SIZE);
  const store = options.store || createDefaultStore(dataDir, options.storeOptions || {});
  if (!initialAdminSetup) {
    bootstrapAdminUsers(store, { adminUsername, adminPassword });
  }

  async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, at: nowIso() });
    }

    let admin = null;
    if (req.method === "GET" && url.pathname === "/api/admin/setup/status") {
      const data = store.snapshot();
      return sendJson(res, 200, { required: data.adminUsers.length === 0 });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/setup") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const displayName = String(body.displayName || username || "System Administrator").trim();
      if (!username) throw httpError(400, "Admin username is required");
      if (password.length < 8) throw httpError(400, "Admin password must be at least 8 characters");
      const created = await store.mutate((data) => {
        if (data.adminUsers.length > 0) throw httpError(409, "Admin user already exists");
        const { salt, hash } = createPasswordHash(password);
        const user = {
          id: createId("admin"),
          username,
          displayName,
          role: "super_admin",
          permissions: ["*"],
          passwordSalt: salt,
          passwordHash: hash,
          status: "active",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          lastLoginAt: null,
        };
        data.adminUsers.push(user);
        appendLog(data, "system", "server", "admin_user.initialized", {
          adminUserId: user.id,
          username,
        });
        return createAdminSession(data, user);
      });
      return sendJson(res, 201, created);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/auth/login") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const created = await store.mutate((data) => {
        const user = data.adminUsers.find((item) => sameText(item.username, username));
        if (!user || user.status !== "active") throw httpError(401, "Admin username or password is invalid");
        if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
          throw httpError(401, "Admin username or password is invalid");
        }
        appendLog(data, "admin", user.id, "admin.login", { username: user.username });
        return createAdminSession(data, user);
      });
      return sendJson(res, 200, created);
    }

    if (url.pathname.startsWith("/api/admin/")) {
      const permission = permissionForAdminRoute(req.method, url.pathname);
      admin = requireAdmin(store, req, adminToken, permission);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/auth/me") {
      return sendJson(res, 200, { user: admin });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/auth/logout") {
      await store.mutate((data) => {
        if (admin.sessionId) {
          data.adminSessions = data.adminSessions.filter((item) => item.id !== admin.sessionId);
        }
        appendLog(data, "admin", admin.id, "admin.logout", { username: admin.username });
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/summary") {
      const data = store.snapshot();
      return sendJson(res, 200, {
        installCodes: data.installCodes.length,
        clients: data.clients.length,
        activeClients: data.clients.filter((client) => client.status === "active").length,
        departments: data.departments.length,
        employees: data.employees.length,
        activeRules: data.transferRules.filter((rule) => rule.status === "active").length,
        transfers: data.transfers.length,
        pendingTransfers: data.transfers.filter((transfer) => transfer.status === "pending_approval").length,
        waitingDelivery: data.transfers.filter((transfer) => transfer.deliveryStatus === "waiting").length,
        retainedFiles: data.transfers.filter((transfer) => transfer.serverFileStatus === "retained").length,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      const data = store.snapshot();
      return sendJson(res, 200, data.adminUsers.map(publicAdminUser));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!username) throw httpError(400, "Admin username is required");
      if (password.length < 8) throw httpError(400, "Admin password must be at least 8 characters");
      const created = await store.mutate((data) => {
        if (data.adminUsers.some((item) => sameText(item.username, username))) {
          throw httpError(409, "Admin username already exists");
        }
        const { salt, hash } = createPasswordHash(password);
        const user = {
          id: createId("admin"),
          username,
          displayName: String(body.displayName || username),
          role: String(body.role || "reviewer"),
          permissions: normalizeList(body.permissions).length ? normalizeList(body.permissions) : ["dashboard.view", "org.manage", "transfer.view", "transfer.review", "audit.view"],
          passwordSalt: salt,
          passwordHash: hash,
          status: String(body.status || "active"),
          createdAt: nowIso(),
          updatedAt: nowIso(),
          lastLoginAt: null,
        };
        data.adminUsers.unshift(user);
        appendLog(data, "admin", admin.id, "admin_user.created", {
          adminUserId: user.id,
          username: user.username,
        });
        return publicAdminUser(user);
      });
      return sendJson(res, 201, created);
    }

    const adminUserPatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserPatch && req.method === "PATCH") {
      const userId = adminUserPatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const user = data.adminUsers.find((item) => item.id === userId);
        if (!user) throw httpError(404, "Admin user not found");
        if (body.displayName !== undefined) user.displayName = String(body.displayName || user.username);
        if (body.role !== undefined) user.role = String(body.role || "reviewer");
        if (body.status !== undefined) user.status = String(body.status);
        if (body.permissions !== undefined) user.permissions = normalizeList(body.permissions);
        if (body.password) {
          if (String(body.password).length < 8) throw httpError(400, "Admin password must be at least 8 characters");
          const { salt, hash } = createPasswordHash(String(body.password));
          user.passwordSalt = salt;
          user.passwordHash = hash;
          data.adminSessions = data.adminSessions.filter((item) => item.userId !== user.id);
        }
        user.updatedAt = nowIso();
        appendLog(data, "admin", admin.id, "admin_user.updated", {
          adminUserId: user.id,
          username: user.username,
        });
        return publicAdminUser(user);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/departments") {
      const data = store.snapshot();
      return sendJson(res, 200, data.departments.map(publicDepartment));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/departments") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) throw httpError(400, "Department name is required");
      const created = await store.mutate((data) => {
        const department = {
          id: createId("dept"),
          name,
          parentId: body.parentId || null,
          status: String(body.status || "active"),
          sortOrder: Number(body.sortOrder || 0),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        data.departments.unshift(department);
        appendLog(data, "admin", admin.id, "department.created", {
          departmentId: department.id,
          name: department.name,
        });
        return publicDepartment(department);
      });
      return sendJson(res, 201, created);
    }

    const departmentPatch = url.pathname.match(/^\/api\/admin\/departments\/([^/]+)$/);
    if (departmentPatch && req.method === "PATCH") {
      const departmentId = departmentPatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const department = data.departments.find((item) => item.id === departmentId);
        if (!department) throw httpError(404, "Department not found");
        if (body.name !== undefined) department.name = String(body.name).trim() || department.name;
        if (body.parentId !== undefined) department.parentId = body.parentId || null;
        if (body.status !== undefined) department.status = String(body.status);
        if (body.sortOrder !== undefined) department.sortOrder = Number(body.sortOrder || 0);
        department.updatedAt = nowIso();
        appendLog(data, "admin", admin.id, "department.updated", { departmentId });
        return publicDepartment(department);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/employees") {
      const data = store.snapshot();
      return sendJson(res, 200, data.employees.map(publicEmployee));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/employees") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) throw httpError(400, "Employee name is required");
      const created = await store.mutate((data) => {
        const departmentId = body.departmentId || null;
        if (departmentId && !data.departments.some((item) => item.id === departmentId)) {
          throw httpError(404, "Department not found");
        }
        const employee = {
          id: createId("emp"),
          name,
          employeeNo: String(body.employeeNo || ""),
          departmentId,
          title: String(body.title || ""),
          status: String(body.status || "active"),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        data.employees.unshift(employee);
        appendLog(data, "admin", admin.id, "employee.created", {
          employeeId: employee.id,
          name: employee.name,
          departmentId,
        });
        return publicEmployee(employee);
      });
      return sendJson(res, 201, created);
    }

    const employeePatch = url.pathname.match(/^\/api\/admin\/employees\/([^/]+)$/);
    if (employeePatch && req.method === "PATCH") {
      const employeeId = employeePatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const employee = data.employees.find((item) => item.id === employeeId);
        if (!employee) throw httpError(404, "Employee not found");
        if (body.departmentId !== undefined && body.departmentId && !data.departments.some((item) => item.id === body.departmentId)) {
          throw httpError(404, "Department not found");
        }
        if (body.name !== undefined) employee.name = String(body.name).trim() || employee.name;
        if (body.employeeNo !== undefined) employee.employeeNo = String(body.employeeNo || "");
        if (body.departmentId !== undefined) employee.departmentId = body.departmentId || null;
        if (body.title !== undefined) employee.title = String(body.title || "");
        if (body.status !== undefined) employee.status = String(body.status);
        employee.updatedAt = nowIso();
        appendLog(data, "admin", admin.id, "employee.updated", { employeeId });
        return publicEmployee(employee);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/transfer-rules") {
      const data = store.snapshot();
      return sendJson(res, 200, data.transferRules.map(publicTransferRule));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/transfer-rules") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) throw httpError(400, "Rule name is required");
      const created = await store.mutate((data) => {
        const sourceDepartmentId = body.sourceDepartmentId || null;
        const targetDepartmentId = body.targetDepartmentId || null;
        for (const departmentId of [sourceDepartmentId, targetDepartmentId].filter(Boolean)) {
          if (!data.departments.some((item) => item.id === departmentId)) {
            throw httpError(404, "Department not found");
          }
        }
        const rule = {
          id: createId("rule"),
          name,
          sourceDepartmentId,
          targetDepartmentId,
          requireApproval: body.requireApproval === true,
          allowBackup: body.allowBackup !== false,
          status: String(body.status || "active"),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        data.transferRules.unshift(rule);
        appendLog(data, "admin", admin.id, "transfer_rule.created", {
          transferRuleId: rule.id,
          name: rule.name,
        });
        return publicTransferRule(rule);
      });
      return sendJson(res, 201, created);
    }

    const transferRulePatch = url.pathname.match(/^\/api\/admin\/transfer-rules\/([^/]+)$/);
    if (transferRulePatch && req.method === "PATCH") {
      const ruleId = transferRulePatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const rule = data.transferRules.find((item) => item.id === ruleId);
        if (!rule) throw httpError(404, "Transfer rule not found");
        const sourceDepartmentId = body.sourceDepartmentId === undefined ? rule.sourceDepartmentId : (body.sourceDepartmentId || null);
        const targetDepartmentId = body.targetDepartmentId === undefined ? rule.targetDepartmentId : (body.targetDepartmentId || null);
        for (const departmentId of [sourceDepartmentId, targetDepartmentId].filter(Boolean)) {
          if (!data.departments.some((item) => item.id === departmentId)) {
            throw httpError(404, "Department not found");
          }
        }
        if (body.name !== undefined) rule.name = String(body.name).trim() || rule.name;
        rule.sourceDepartmentId = sourceDepartmentId;
        rule.targetDepartmentId = targetDepartmentId;
        if (body.requireApproval !== undefined) rule.requireApproval = Boolean(body.requireApproval);
        if (body.allowBackup !== undefined) rule.allowBackup = Boolean(body.allowBackup);
        if (body.status !== undefined) rule.status = String(body.status);
        rule.updatedAt = nowIso();
        appendLog(data, "admin", admin.id, "transfer_rule.updated", {
          transferRuleId: rule.id,
          name: rule.name,
        });
        return publicTransferRule(rule);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/install-codes") {
      const data = store.snapshot();
      return sendJson(res, 200, data.installCodes.map(publicInstallCode));
    }

    if (req.method === "GET" && url.pathname === "/api/admin/open-registration") {
      const data = store.snapshot();
      return sendJson(res, 200, publicOpenRegistration(data.settings));
    }

    if (req.method === "PATCH" && url.pathname === "/api/admin/open-registration") {
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const current = normalizeOpenRegistration(data.settings);
        const wasEnabled = current.enabled;
        if ("enabled" in body) {
          current.enabled = Boolean(body.enabled);
        }
        if ("maxUses" in body) {
          current.maxUses = Math.max(1, Number(body.maxUses || 50));
        }
        if ("defaultAllowWhenUnmanaged" in body) {
          current.defaultAllowWhenUnmanaged = Boolean(body.defaultAllowWhenUnmanaged);
        }
        if (current.enabled) {
          const durationMinutes = Math.max(1, Number(body.durationMinutes || 60));
          current.expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
          if (!wasEnabled || body.resetUsedCount !== false) {
            current.usedCount = 0;
          }
        } else {
          current.expiresAt = null;
          current.usedCount = 0;
        }
        current.updatedAt = nowIso();
        data.settings = {
          ...(data.settings || {}),
          openRegistration: current,
        };
        appendLog(data, "admin", admin.id, "open_registration.updated", {
          enabled: current.enabled,
          expiresAt: current.expiresAt,
          maxUses: current.maxUses,
        });
        return publicOpenRegistration(data.settings);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/install-codes") {
      const body = await readJson(req);
      const plainCode = generateInstallCode();
      const created = await store.mutate((data) => {
        const code = {
          id: createId("code"),
          label: String(body.label || "Install code"),
          codeHash: sha256(plainCode),
          maxUses: Math.max(1, Number(body.maxUses || 1)),
          usedCount: 0,
          status: "active",
          expiresAt: body.expiresAt || null,
          allowedMacs: normalizeList(body.allowedMacs),
          allowedIps: normalizeList(body.allowedIps),
          bindToFirstMac: Boolean(body.bindToFirstMac),
          bindToFirstIp: Boolean(body.bindToFirstIp),
          boundMac: null,
          boundIp: null,
          defaultAllowWhenUnmanaged: body.defaultAllowWhenUnmanaged !== false,
          createdAt: nowIso(),
          clientIds: [],
        };
        data.installCodes.unshift(code);
        appendLog(data, "admin", admin.id, "install_code.created", {
          installCodeId: code.id,
          label: code.label,
          maxUses: code.maxUses,
        });
        return publicInstallCode(code);
      });
      return sendJson(res, 201, { ...created, code: plainCode });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/client-packages") {
      const body = await readJson(req);
      const serverUrl = normalizeServerUrl(body.serverUrl);
      const label = String(body.label || "专属客户端安装包").trim() || "专属客户端安装包";
      const maxUses = Math.max(1, Number.parseInt(body.maxUses, 10) || 100);
      const validDays = Math.max(1, Number.parseInt(body.validDays, 10) || 30);
      const defaultAllowWhenUnmanaged = body.defaultAllowWhenUnmanaged !== false;
      const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
      const plainCode = generateInstallCode();
      const codeId = createId("code");
      const packageId = createId("pkg");
      const fileName = `FileAssistantClientSetup-${sanitizePackageLabel(label)}-${packageId}.exe`;
      const packageDir = path.join(dataDir, "client-packages");
      const packagePath = path.join(packageDir, fileName);

      appendClientBootstrapConfig(clientInstallerTemplatePath, packagePath, {
        version: 1,
        serverUrl,
        deployToken: plainCode,
        autoRegister: true,
        generatedAt: nowIso(),
        label,
      });

      const created = await store.mutate((data) => {
        const code = {
          id: codeId,
          label,
          codeHash: sha256(plainCode),
          maxUses,
          usedCount: 0,
          status: "active",
          expiresAt,
          allowedMacs: [],
          allowedIps: [],
          bindToFirstMac: false,
          bindToFirstIp: false,
          boundMac: null,
          boundIp: null,
          defaultAllowWhenUnmanaged,
          createdAt: nowIso(),
          clientIds: [],
        };
        data.installCodes.unshift(code);
        appendLog(data, "admin", admin.id, "install_code.created", {
          installCodeId: code.id,
          label: code.label,
          maxUses: code.maxUses,
        });
        appendLog(data, "admin", admin.id, "client_package.created", {
          packageId,
          fileName,
          installCodeId: code.id,
          serverUrl,
          maxUses,
          expiresAt,
        });
        return publicInstallCode(code);
      });

      return sendJson(res, 201, {
        id: packageId,
        fileName,
        downloadUrl: `/api/admin/client-packages/${encodeURIComponent(fileName)}/download`,
        installCodeId: created.id,
        expiresAt,
        maxUses,
        serverUrl,
      });
    }

    const clientPackageDownload = url.pathname.match(/^\/api\/admin\/client-packages\/([^/]+)\/download$/);
    if (clientPackageDownload && req.method === "GET") {
      const decodedName = decodeURIComponent(clientPackageDownload[1]);
      if (decodedName !== path.basename(decodedName) || !decodedName.endsWith(".exe")) {
        throw httpError(400, "Package file name is invalid");
      }
      const packagePath = path.join(dataDir, "client-packages", decodedName);
      return streamDownloadPath(res, packagePath, decodedName);
    }

    const installPatch = url.pathname.match(/^\/api\/admin\/install-codes\/([^/]+)$/);
    if (installPatch && req.method === "PATCH") {
      const codeId = installPatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const code = data.installCodes.find((item) => item.id === codeId);
        if (!code) throw httpError(404, "Install code not found");
        if (body.status) code.status = String(body.status);
        if (body.maxUses) code.maxUses = Math.max(1, Number(body.maxUses));
        if ("defaultAllowWhenUnmanaged" in body) {
          code.defaultAllowWhenUnmanaged = Boolean(body.defaultAllowWhenUnmanaged);
        }
        appendLog(data, "admin", admin.id, "install_code.updated", { installCodeId: code.id });
        return publicInstallCode(code);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/clients") {
      const data = store.snapshot();
      return sendJson(res, 200, data.clients.map((client) => publicClient(client, data)));
    }

    const clientPatch = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)$/);
    if (clientPatch && req.method === "PATCH") {
      const clientId = clientPatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const client = data.clients.find((item) => item.id === clientId);
        if (!client) throw httpError(404, "Client not found");
        const fields = [
          "displayName",
          "status",
          "macAddress",
          "ipAddress",
          "platform",
        ];
        for (const field of fields) {
          if (field in body) client[field] = String(body[field]);
        }
        if ("employeeId" in body) {
          const employeeId = body.employeeId || null;
          if (employeeId && !data.employees.some((item) => item.id === employeeId && item.status === "active")) {
            throw httpError(404, "Active employee not found");
          }
          client.employeeId = employeeId;
        }
        for (const field of ["managed", "allowWhenUnmanaged", "mustMatchMac", "mustMatchIp"]) {
          if (field in body) client[field] = Boolean(body[field]);
        }
        client.updatedAt = nowIso();
        appendLog(data, "admin", admin.id, "client.updated", { clientId });
        return publicClient(client);
      });
      return sendJson(res, 200, updated);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/clients/bulk-rename") {
      const body = await readJson(req);
      const matchField = String(body.matchField || "");
      const matchValue = String(body.matchValue || "");
      const namePrefix = String(body.namePrefix || "User");
      const allowedFields = new Set(["macAddress", "ipAddress", "platform", "status"]);
      if (!allowedFields.has(matchField)) {
        throw httpError(400, "Unsupported match field");
      }
      const result = await store.mutate((data) => {
        let count = 0;
        for (const client of data.clients) {
          if (sameText(client[matchField], matchValue)) {
            count += 1;
            client.displayName = `${namePrefix}-${String(count).padStart(2, "0")}`;
            client.updatedAt = nowIso();
          }
        }
        appendLog(data, "admin", admin.id, "client.bulk_renamed", {
          matchField,
          matchValue,
          count,
        });
        return { count };
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/transfers") {
      const data = store.snapshot();
      return sendJson(res, 200, data.transfers.map(publicTransfer));
    }

    const transferPatch = url.pathname.match(/^\/api\/admin\/transfers\/([^/]+)$/);
    if (transferPatch && req.method === "PATCH") {
      const transferId = transferPatch[1];
      const body = await readJson(req);
      const updated = await store.mutate((data) => {
        const transfer = data.transfers.find((item) => item.id === transferId);
        if (!transfer) throw httpError(404, "Transfer not found");

        if (body.action === "purge") {
          if (transfer.serverFileStatus === "purged") return publicTransfer(transfer);
          purgeTransferStorage(dataDir, transfer, "manual");
          appendLog(data, "admin", admin.id, "transfer.file_purged", { transferId, reason: "manual" });
          return publicTransfer(transfer);
        }

        if ("retainOnServer" in body) {
          if (transfer.serverFileStatus === "purged" && Boolean(body.retainOnServer)) {
            throw httpError(409, "Purged file cannot be retained");
          }
          if (Boolean(body.retainOnServer) && transfer.backupAllowed === false) {
            throw httpError(403, "Important backup is not allowed by sending rule");
          }
          transfer.retainOnServer = Boolean(body.retainOnServer);
          if (transfer.filePath) {
            transfer.serverFileStatus = transfer.retainOnServer ? "retained" : "temporary";
          }
          appendLog(data, "admin", admin.id, "transfer.retention_updated", {
            transferId,
            retainOnServer: transfer.retainOnServer,
          });
        }

        if (!body.status) {
          return publicTransfer(transfer);
        }

        if (body.status === "approved" || body.status === "ready_to_deliver") {
          transfer.status = "ready_to_deliver";
          transfer.approvedAt = nowIso();
          transfer.rejectedAt = null;
          transfer.deliveryStatus = "waiting";
          transfer.approvalRequired = true;
          if (transfer.filePath) {
            transfer.serverFileStatus = transfer.retainOnServer ? "retained" : "temporary";
          }
          appendLog(data, "admin", admin.id, "transfer.approved", {
            transferId,
            retainOnServer: transfer.retainOnServer,
          });
        } else if (body.status === "rejected") {
          transfer.status = "rejected";
          transfer.rejectedAt = nowIso();
          transfer.rejectReason = String(body.reason || "");
          transfer.deliveryStatus = "not_ready";
          purgeTransferStorage(dataDir, transfer, "rejected");
          appendLog(data, "admin", admin.id, "transfer.rejected", { transferId });
        } else {
          throw httpError(400, "Unsupported transfer status");
        }
        return publicTransfer(transfer);
      });
      return sendJson(res, 200, updated);
    }

    const adminFile = url.pathname.match(/^\/api\/admin\/transfers\/([^/]+)\/file$/);
    if (adminFile && req.method === "GET") {
      const transferId = adminFile[1];
      const transfer = store.snapshot().transfers.find((item) => item.id === transferId);
      if (!transfer) throw httpError(404, "Transfer not found");
      const mode = url.searchParams.get("mode") === "download" ? "attachment" : "inline";
      return streamFile(res, transfer, mode);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/logs") {
      const data = store.snapshot();
      return sendJson(res, 200, data.logs.slice(0, 300));
    }

    if (req.method === "POST" && url.pathname === "/api/client/open-register") {
      const body = await readJson(req);
      const clientSecret = randomSecret();
      const registered = await store.mutate((data) => {
        const open = normalizeOpenRegistration(data.settings);
        if (!isOpenRegistrationActive(open)) {
          throw httpError(403, "Open registration is not enabled");
        }
        const registeredClient = createRegisteredClient(data, body, clientSecret, {
          installCodeId: null,
          allowWhenUnmanaged: open.defaultAllowWhenUnmanaged,
          registrationMode: "open-registration",
        });
        open.usedCount += 1;
        open.updatedAt = nowIso();
        data.settings = {
          ...(data.settings || {}),
          openRegistration: open,
        };
        return registeredClient;
      });
      return sendJson(res, 201, { client: registered, clientSecret });
    }

    if (req.method === "POST" && (url.pathname === "/api/client/register" || url.pathname === "/api/client/auto-register")) {
      const body = await readJson(req);
      const providedCode = String(body.installCode || body.deployToken || "");
      const registrationMode = body.deployToken || url.pathname === "/api/client/auto-register" ? "deploy-token" : "install-code";
      const clientSecret = randomSecret();
      const registered = await store.mutate((data) => {
        const code = data.installCodes.find((item) => item.codeHash === sha256(providedCode));
        if (!code) throw httpError(403, "Install code is invalid");
        if (code.status !== "active") throw httpError(403, "Install code is not active");
        if (code.expiresAt && new Date(code.expiresAt).getTime() < Date.now()) {
          throw httpError(403, "Install code is expired");
        }
        if (code.usedCount >= code.maxUses) {
          throw httpError(403, "Install code usage limit reached");
        }
        const macAddress = String(body.macAddress || "").trim();
        const ipAddress = String(body.ipAddress || "").trim();
        if (!allowByList(code.allowedMacs, macAddress)) {
          throw httpError(403, "MAC is not allowed by this install code");
        }
        if (!allowByList(code.allowedIps, ipAddress)) {
          throw httpError(403, "IP is not allowed by this install code");
        }
        if (code.bindToFirstMac) {
          if (!code.boundMac) code.boundMac = macAddress;
          if (!sameText(code.boundMac, macAddress)) throw httpError(403, "Install code is bound to another MAC");
        }
        if (code.bindToFirstIp) {
          if (!code.boundIp) code.boundIp = ipAddress;
          if (!sameText(code.boundIp, ipAddress)) throw httpError(403, "Install code is bound to another IP");
        }
        code.usedCount += 1;
        const client = createRegisteredClient(data, body, clientSecret, {
          installCodeId: code.id,
          allowWhenUnmanaged: code.defaultAllowWhenUnmanaged,
          registrationMode,
        });
        code.clientIds.push(client.id);
        appendLog(data, "client", client.id, "install_code.used", {
          installCodeId: code.id,
          registrationMode,
        });
        return client;
      });
      return sendJson(res, 201, { client: registered, clientSecret });
    }

    if (url.pathname.startsWith("/api/client/")) {
      const data = store.snapshot();
      resolveClient(data, req);
    }

    if (req.method === "GET" && url.pathname === "/api/client/me") {
      const data = store.snapshot();
      const client = resolveClient(data, req);
      return sendJson(res, 200, publicClient(client, data));
    }

    if (req.method === "GET" && url.pathname === "/api/client/clients") {
      const data = store.snapshot();
      const self = resolveClient(data, req);
      const clients = data.clients
        .filter((client) => client.id !== self.id && client.status === "active")
        .map(publicClient);
      return sendJson(res, 200, clients);
    }

    if (req.method === "GET" && url.pathname === "/api/client/recipients") {
      const data = store.snapshot();
      const self = resolveClient(data, req);
      const activeClientsByEmployee = new Map();
      for (const client of data.clients) {
        if (client.status !== "active" || !client.employeeId || client.id === self.id) continue;
        const list = activeClientsByEmployee.get(client.employeeId) || [];
        list.push(publicClient(client));
        activeClientsByEmployee.set(client.employeeId, list);
      }
      const recipients = data.employees
        .filter((employee) => employee.status === "active" && activeClientsByEmployee.has(employee.id))
        .map((employee) => {
          const department = data.departments.find((item) => item.id === employee.departmentId);
          return {
            ...publicEmployee(employee),
            departmentName: department?.name || "",
            clientCount: activeClientsByEmployee.get(employee.id).length,
          };
        });
      return sendJson(res, 200, recipients);
    }

    if (req.method === "GET" && url.pathname === "/api/client/transfers") {
      const data = store.snapshot();
      const self = resolveClient(data, req);
      const transfers = data.transfers
        .filter((transfer) => transfer.senderId === self.id || transfer.receiverId === self.id)
        .map(publicTransfer);
      return sendJson(res, 200, transfers);
    }

    if (req.method === "POST" && url.pathname === "/api/client/transfers/init") {
      const body = await readJson(req);
      const created = await store.mutate((data) => {
        const sender = resolveClient(data, req);
        const senderEmployee = data.employees.find((employee) => employee.id === sender.employeeId) || null;
        const receiverEmployeeId = body.receiverEmployeeId || null;
        const receiverEmployee = receiverEmployeeId
          ? data.employees.find((employee) => employee.id === receiverEmployeeId && employee.status === "active")
          : null;
        let receiver = null;
        if (receiverEmployee) {
          receiver = data.clients.find((client) => client.employeeId === receiverEmployee.id && client.status === "active" && client.id !== sender.id);
        } else if (body.receiverId) {
          receiver = data.clients.find((client) => client.id === body.receiverId);
        }
        if (!receiver || receiver.status !== "active") throw httpError(404, "Receiver not found");
        const resolvedReceiverEmployee = receiverEmployee || data.employees.find((employee) => employee.id === receiver.employeeId) || null;
        const transferRule = matchTransferRule(data, senderEmployee, resolvedReceiverEmployee);
        if (!transferRule) {
          throw httpError(403, "No active sending rule allows this transfer");
        }
        const retainOnServer = Boolean(body.retainOnServer);
        if (retainOnServer && transferRule.allowBackup === false) {
          throw httpError(403, "Important backup is not allowed by sending rule");
        }
        const size = Math.max(0, Number(body.size || 0));
        const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
        const fileName = sanitizeFileName(body.fileName || "file.bin");
        const transferId = createId("transfer");
        const paths = getUploadPaths(dataDir, transferId, fileName);
        fs.mkdirSync(paths.chunksDir, { recursive: true });
        const controls = {
          uploader: {
            allowStatusView: true,
          },
          receiver: {
            allowReceive: body.controls?.receiver?.allowReceive !== false,
            allowPreview: body.controls?.receiver?.allowPreview === true,
            allowScreenshot: body.controls?.receiver?.allowScreenshot !== false,
          },
        };
        const transfer = {
          id: transferId,
          senderId: sender.id,
          senderName: sender.displayName,
          senderEmployeeId: senderEmployee?.id || null,
          senderEmployeeName: senderEmployee?.name || "",
          receiverId: receiver.id,
          receiverName: receiver.displayName,
          receiverEmployeeId: resolvedReceiverEmployee?.id || null,
          receiverEmployeeName: resolvedReceiverEmployee?.name || "",
          fileName: String(body.fileName || fileName),
          safeName: fileName,
          mimeType: String(body.mimeType || "application/octet-stream"),
          size,
          chunkSize,
          totalChunks,
          uploadedChunks: [],
          progress: 0,
          status: "uploading",
          controls,
          retainOnServer,
          transferRuleId: transferRule.id || null,
          transferRuleName: transferRule.name || "",
          approvalRequired: transferRule.requireApproval === true,
          backupAllowed: transferRule.allowBackup !== false,
          deliveryStatus: "not_ready",
          serverFileStatus: "uploading",
          deliveredAt: null,
          purgedAt: null,
          purgeReason: "",
          uploadNote: String(body.uploadNote || ""),
          filePath: null,
          chunksDir: paths.chunksDir,
          sha256: null,
          createdAt: nowIso(),
          completedAt: null,
          approvedAt: null,
          rejectedAt: null,
          rejectReason: "",
        };
        data.transfers.unshift(transfer);
        appendLog(data, "client", sender.id, "transfer.created", {
          transferId,
          receiverId: receiver.id,
          receiverEmployeeId: transfer.receiverEmployeeId,
          fileName: transfer.fileName,
          size,
          retainOnServer: transfer.retainOnServer,
          transferRuleId: transfer.transferRuleId,
          approvalRequired: transfer.approvalRequired,
        });
        return publicTransfer(transfer);
      });
      return sendJson(res, 201, {
        transfer: created,
        chunkSize,
        missingChunks: Array.from({ length: created.totalChunks }, (_, index) => index),
      });
    }

    const transferStatus = url.pathname.match(/^\/api\/client\/transfers\/([^/]+)\/status$/);
    if (transferStatus && req.method === "GET") {
      const transferId = transferStatus[1];
      const data = store.snapshot();
      const self = resolveClient(data, req);
      const transfer = data.transfers.find((item) => item.id === transferId);
      if (!transfer) throw httpError(404, "Transfer not found");
      if (transfer.senderId !== self.id && transfer.receiverId !== self.id) {
        throw httpError(403, "Transfer is not visible to this client");
      }
      const uploaded = new Set(transfer.uploadedChunks);
      const missingChunks = [];
      for (let index = 0; index < transfer.totalChunks; index += 1) {
        if (!uploaded.has(index)) missingChunks.push(index);
      }
      return sendJson(res, 200, {
        transfer: publicTransfer(transfer),
        missingChunks,
      });
    }

    const uploadChunk = url.pathname.match(/^\/api\/client\/transfers\/([^/]+)\/chunks\/(\d+)$/);
    if (uploadChunk && req.method === "PUT") {
      const transferId = uploadChunk[1];
      const chunkIndex = Number(uploadChunk[2]);
      const initialData = store.snapshot();
      const self = resolveClient(initialData, req);
      const transfer = initialData.transfers.find((item) => item.id === transferId);
      if (!transfer) throw httpError(404, "Transfer not found");
      if (transfer.senderId !== self.id) throw httpError(403, "Only sender can upload chunks");
      if (transfer.status !== "uploading" && transfer.status !== "assembling") {
        throw httpError(409, "Transfer is not accepting chunks");
      }
      if (chunkIndex < 0 || chunkIndex >= transfer.totalChunks) {
        throw httpError(400, "Chunk index is out of range");
      }

      const paths = getUploadPaths(dataDir, transfer.id, transfer.safeName);
      fs.mkdirSync(paths.chunksDir, { recursive: true });
      const chunkPath = path.join(paths.chunksDir, `${chunkIndex}.part`);
      const writer = fs.createWriteStream(chunkPath);
      try {
        for await (const chunk of req) {
          if (!writer.write(chunk)) await once(writer, "drain");
        }
        writer.end();
        await once(writer, "finish");
      } catch (error) {
        writer.destroy();
        throw error;
      }

      const mergeNeeded = await store.mutate((data) => {
        const current = data.transfers.find((item) => item.id === transferId);
        if (!current) throw httpError(404, "Transfer not found");
        if (!current.uploadedChunks.includes(chunkIndex)) {
          current.uploadedChunks.push(chunkIndex);
          current.uploadedChunks.sort((a, b) => a - b);
        }
        current.progress = Math.round((current.uploadedChunks.length / current.totalChunks) * 100);
        appendLog(data, "client", self.id, "transfer.chunk_uploaded", {
          transferId,
          chunkIndex,
          progress: current.progress,
        });
        if (current.uploadedChunks.length === current.totalChunks && current.status === "uploading") {
          current.status = "assembling";
          return true;
        }
        return false;
      });

      if (mergeNeeded) {
        await mergeTransferFile(store, dataDir, transferId);
      }

      const updated = store.snapshot().transfers.find((item) => item.id === transferId);
      return sendJson(res, 200, { transfer: publicTransfer(updated) });
    }

    const clientFile = url.pathname.match(/^\/api\/client\/transfers\/([^/]+)\/file$/);
    if (clientFile && req.method === "GET") {
      const transferId = clientFile[1];
      const mode = url.searchParams.get("mode") === "preview" ? "preview" : "receive";
      const data = store.snapshot();
      const self = resolveClient(data, req);
      const transfer = data.transfers.find((item) => item.id === transferId);
      if (!transfer) throw httpError(404, "Transfer not found");
      if (transfer.status !== "ready_to_deliver") {
        throw httpError(403, "Transfer is not ready to receive");
      }
      if (transfer.receiverId !== self.id) {
        throw httpError(403, "Only receiver can receive this file");
      }
      if (transfer.serverFileStatus === "purged") {
        throw httpError(410, "Server copy has been purged");
      }
      const policy = transfer.controls.receiver || {};
      if (mode === "preview" && !policy.allowPreview) throw httpError(403, "Preview is blocked by policy");
      if (mode === "receive" && policy.allowReceive === false) throw httpError(403, "Receive is blocked by policy");
      await store.mutate((mutable) => {
        const current = mutable.transfers.find((item) => item.id === transferId);
        if (current && current.deliveryStatus === "waiting") {
          current.deliveryStatus = "receiving";
        }
        appendLog(mutable, "client", self.id, `transfer.file_${mode}`, { transferId });
      });
      return streamFile(res, transfer, mode === "receive" ? "attachment" : "inline");
    }

    const confirmDelivery = url.pathname.match(/^\/api\/client\/transfers\/([^/]+)\/confirm-delivery$/);
    if (confirmDelivery && req.method === "POST") {
      const transferId = confirmDelivery[1];
      const confirmed = await store.mutate((data) => {
        const self = resolveClient(data, req);
        const transfer = data.transfers.find((item) => item.id === transferId);
        if (!transfer) throw httpError(404, "Transfer not found");
        if (transfer.receiverId !== self.id) throw httpError(403, "Only receiver can confirm delivery");
        if (transfer.status !== "ready_to_deliver" && transfer.status !== "delivered") {
          throw httpError(409, "Transfer cannot be confirmed in current status");
        }
        transfer.status = "delivered";
        transfer.deliveryStatus = "delivered";
        transfer.deliveredAt = transfer.deliveredAt || nowIso();
        if (transfer.retainOnServer) {
          transfer.serverFileStatus = transfer.filePath ? "retained" : transfer.serverFileStatus;
        } else if (transfer.serverFileStatus !== "purged") {
          purgeTransferStorage(dataDir, transfer, "delivered");
        }
        appendLog(data, "client", self.id, "transfer.delivery_confirmed", {
          transferId,
          retainOnServer: transfer.retainOnServer,
          serverFileStatus: transfer.serverFileStatus,
        });
        return publicTransfer(transfer);
      });
      return sendJson(res, 200, confirmed);
    }

    throw httpError(404, "API route not found");
  }

  function serveStatic(req, res, url) {
    const routeMap = {
      "/": "index.html",
      "/admin": "admin.html",
      "/client": "client.html",
    };
    const relative = routeMap[url.pathname] || decodeURIComponent(url.pathname.replace(/^\//, ""));
    const target = path.normalize(path.join(publicDir, relative));
    if (!target.startsWith(publicDir)) {
      throw httpError(403, "Forbidden");
    }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      throw httpError(404, "Page not found");
    }
    const ext = path.extname(target).toLowerCase();
    const mime = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".ico": "image/x-icon",
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-store",
    });
    pipeFileToResponse(res, target);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    Promise.resolve()
      .then(() => {
        if (url.pathname.startsWith("/api/")) {
          return handleApi(req, res, url);
        }
        return serveStatic(req, res, url);
      })
      .catch((error) => {
        if (!res.headersSent) {
          sendError(res, error);
        } else {
          res.destroy(error);
        }
      });
  });

  server.on("close", () => {
    if (typeof store.close === "function") {
      store.close();
    }
  });

  server.store = store;
  server.options = { rootDir, dataDir, publicDir, clientInstallerTemplatePath, adminToken, adminUsername, adminPassword, initialAdminSetup, chunkSize };
  return server;
}

if (require.main === module) {
  const server = createAppServer();
  const port = Number(process.env.PORT || 5177);
  server.listen(port, () => {
    console.log(`File Assistant server running at http://localhost:${port}`);
    if (server.options.initialAdminSetup) {
      console.log(`Admin setup: open http://localhost:${port}/admin to create the first administrator.`);
    } else {
      console.log(`Admin login: ${server.options.adminUsername} / ${server.options.adminPassword}`);
    }
    if (server.options.adminToken) {
      console.log(`Legacy admin token: ${server.options.adminToken}`);
    }
  });
}

module.exports = {
  createAppServer,
  sha256,
  sanitizeFileName,
};
