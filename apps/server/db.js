const fs = require("node:fs");
const path = require("node:path");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  DatabaseSync = null;
}

function createDefaultSettings() {
  return {
    openRegistration: {
      enabled: false,
      expiresAt: null,
      maxUses: 50,
      usedCount: 0,
      defaultAllowWhenUnmanaged: true,
      updatedAt: null,
    },
  };
}

function createEmptyDatabase() {
  return {
    version: 3,
    settings: createDefaultSettings(),
    departments: [],
    employees: [],
    transferRules: [],
    installCodes: [],
    clients: [],
    transfers: [],
    logs: [],
    adminUsers: [],
    adminSessions: [],
  };
}

function normalizeDatabase(data) {
  const empty = createEmptyDatabase();
  const normalized = { ...empty, ...(data || {}) };
  for (const key of Object.keys(empty)) {
    if (Array.isArray(empty[key]) && !Array.isArray(normalized[key])) {
      normalized[key] = [];
    }
  }
  normalized.settings = normalizeSettings(normalized.settings);
  normalized.version = 3;
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function json(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function logMutateWriteFailure(storeName, consecutiveFailures, error) {
  console.error(`[FileAssistant] ${storeName} mutate write failed (${consecutiveFailures} consecutive).`, error);
}

function normalizeTransfer(item) {
  const transfer = { ...(item || {}) };
  const status = transfer.status === "approved" ? "ready_to_deliver" : (transfer.status || "uploading");
  const retainOnServer = Boolean(transfer.retainOnServer);
  const hasStoredFile = Boolean(transfer.filePath);
  let deliveryStatus = transfer.deliveryStatus;
  if (!deliveryStatus || (deliveryStatus === "not_ready" && (status === "ready_to_deliver" || status === "delivered"))) {
    deliveryStatus = transfer.deliveredAt ? "delivered" : (status === "ready_to_deliver" ? "waiting" : "not_ready");
  }
  let serverFileStatus = transfer.serverFileStatus;
  if (!serverFileStatus || (serverFileStatus === "uploading" && hasStoredFile && status !== "uploading" && status !== "assembling")) {
    serverFileStatus = transfer.purgedAt
      ? "purged"
      : (hasStoredFile ? (retainOnServer ? "retained" : "temporary") : (status === "uploading" || status === "assembling" ? "uploading" : "unavailable"));
  }

  return {
    ...transfer,
    status,
    senderEmployeeId: transfer.senderEmployeeId || null,
    senderEmployeeName: transfer.senderEmployeeName || "",
    receiverEmployeeId: transfer.receiverEmployeeId || null,
    receiverEmployeeName: transfer.receiverEmployeeName || "",
    transferRuleId: transfer.transferRuleId || null,
    transferRuleName: transfer.transferRuleName || "",
    approvalRequired: transfer.approvalRequired === true,
    backupAllowed: transfer.backupAllowed !== false,
    retainOnServer,
    deliveryStatus,
    serverFileStatus,
    deliveredAt: transfer.deliveredAt || null,
    purgedAt: transfer.purgedAt || null,
    purgeReason: transfer.purgeReason || "",
    uploadNote: transfer.uploadNote || "",
  };
}

function normalizeTransferRule(item) {
  const rule = { ...(item || {}) };
  return {
    ...rule,
    sourceDepartmentId: rule.sourceDepartmentId || null,
    targetDepartmentId: rule.targetDepartmentId || null,
    requireApproval: rule.requireApproval === true,
    allowBackup: rule.allowBackup !== false,
    status: rule.status || "active",
    createdAt: rule.createdAt || new Date().toISOString(),
    updatedAt: rule.updatedAt || rule.createdAt || new Date().toISOString(),
  };
}

function normalizeClient(item) {
  const client = { ...(item || {}) };
  return {
    ...client,
    employeeId: client.employeeId || null,
  };
}

function normalizeSettings(settings) {
  const defaults = createDefaultSettings();
  const value = { ...(settings || {}) };
  const openRegistration = { ...defaults.openRegistration, ...(value.openRegistration || {}) };
  return {
    ...defaults,
    ...value,
    openRegistration: {
      enabled: openRegistration.enabled === true,
      expiresAt: openRegistration.expiresAt || null,
      maxUses: Math.max(1, Number(openRegistration.maxUses || defaults.openRegistration.maxUses)),
      usedCount: Math.max(0, Number(openRegistration.usedCount || 0)),
      defaultAllowWhenUnmanaged: openRegistration.defaultAllowWhenUnmanaged !== false,
      updatedAt: openRegistration.updatedAt || null,
    },
  };
}

function normalizeOrg(data) {
  const normalized = normalizeTransfers(data);
  normalized.clients = normalized.clients.map(normalizeClient);
  normalized.transferRules = normalized.transferRules.map(normalizeTransferRule);
  return normalized;
}

function normalizeTransfers(data) {
  const normalized = normalizeDatabase(data);
  normalized.transfers = normalized.transfers.map(normalizeTransfer);
  return normalized;
}

function boolInt(value) {
  return value ? 1 : 0;
}

function rowSignature(params) {
  return JSON.stringify(params);
}

const SQLITE_TABLE_SPECS = [
  {
    key: "departments",
    table: "departments",
    upsertSql: `
      INSERT INTO departments (id, name, parent_id, status, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        parent_id = excluded.parent_id,
        status = excluded.status,
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    toParams: (item) => [
      item.id,
      item.name,
      item.parentId || null,
      item.status || "active",
      Number(item.sortOrder || 0),
      item.createdAt,
      item.updatedAt,
    ],
  },
  {
    key: "employees",
    table: "employees",
    upsertSql: `
      INSERT INTO employees (id, name, employee_no, department_id, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        employee_no = excluded.employee_no,
        department_id = excluded.department_id,
        title = excluded.title,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    toParams: (item) => [
      item.id,
      item.name,
      item.employeeNo || null,
      item.departmentId || null,
      item.title || null,
      item.status || "active",
      item.createdAt,
      item.updatedAt,
    ],
  },
  {
    key: "transferRules",
    table: "transfer_rules",
    normalize: normalizeTransferRule,
    upsertSql: `
      INSERT INTO transfer_rules (
        id, name, source_department_id, target_department_id, require_approval,
        allow_backup, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_department_id = excluded.source_department_id,
        target_department_id = excluded.target_department_id,
        require_approval = excluded.require_approval,
        allow_backup = excluded.allow_backup,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    toParams: (item) => [
      item.id,
      item.name,
      item.sourceDepartmentId || null,
      item.targetDepartmentId || null,
      boolInt(item.requireApproval),
      boolInt(item.allowBackup),
      item.status,
      item.createdAt,
      item.updatedAt,
    ],
  },
  {
    key: "installCodes",
    table: "install_codes",
    upsertSql: `
      INSERT INTO install_codes (
        id, label, code_hash, max_uses, used_count, status, expires_at,
        allowed_macs, allowed_ips, bind_to_first_mac, bind_to_first_ip,
        bound_mac, bound_ip, default_allow_when_unmanaged, created_at, client_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        code_hash = excluded.code_hash,
        max_uses = excluded.max_uses,
        used_count = excluded.used_count,
        status = excluded.status,
        expires_at = excluded.expires_at,
        allowed_macs = excluded.allowed_macs,
        allowed_ips = excluded.allowed_ips,
        bind_to_first_mac = excluded.bind_to_first_mac,
        bind_to_first_ip = excluded.bind_to_first_ip,
        bound_mac = excluded.bound_mac,
        bound_ip = excluded.bound_ip,
        default_allow_when_unmanaged = excluded.default_allow_when_unmanaged,
        created_at = excluded.created_at,
        client_ids = excluded.client_ids
    `,
    toParams: (item) => [
      item.id,
      item.label,
      item.codeHash,
      item.maxUses,
      item.usedCount,
      item.status,
      item.expiresAt || null,
      JSON.stringify(item.allowedMacs || []),
      JSON.stringify(item.allowedIps || []),
      boolInt(item.bindToFirstMac),
      boolInt(item.bindToFirstIp),
      item.boundMac || null,
      item.boundIp || null,
      boolInt(item.defaultAllowWhenUnmanaged),
      item.createdAt,
      JSON.stringify(item.clientIds || []),
    ],
  },
  {
    key: "clients",
    table: "clients",
    normalize: normalizeClient,
    upsertSql: `
      INSERT INTO clients (
        id, display_name, mac_address, ip_address, platform, install_code_id,
        secret_hash, status, managed, allow_when_unmanaged, must_match_mac,
        must_match_ip, employee_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        mac_address = excluded.mac_address,
        ip_address = excluded.ip_address,
        platform = excluded.platform,
        install_code_id = excluded.install_code_id,
        secret_hash = excluded.secret_hash,
        status = excluded.status,
        managed = excluded.managed,
        allow_when_unmanaged = excluded.allow_when_unmanaged,
        must_match_mac = excluded.must_match_mac,
        must_match_ip = excluded.must_match_ip,
        employee_id = excluded.employee_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    toParams: (item) => [
      item.id,
      item.displayName,
      item.macAddress || null,
      item.ipAddress || null,
      item.platform || null,
      item.installCodeId || null,
      item.secretHash,
      item.status,
      boolInt(item.managed),
      boolInt(item.allowWhenUnmanaged),
      boolInt(item.mustMatchMac),
      boolInt(item.mustMatchIp),
      item.employeeId || null,
      item.createdAt,
      item.updatedAt,
    ],
  },
  {
    key: "transfers",
    table: "transfers",
    normalize: normalizeTransfer,
    upsertSql: `
      INSERT INTO transfers (
        id, sender_id, sender_name, receiver_id, receiver_name, file_name, safe_name,
        mime_type, size, chunk_size, total_chunks, uploaded_chunks, progress, status,
        controls, file_path, chunks_dir, sha256, created_at, completed_at, approved_at,
        rejected_at, reject_reason, retain_on_server, delivery_status, server_file_status,
        delivered_at, purged_at, purge_reason, upload_note, sender_employee_id, sender_employee_name,
        receiver_employee_id, receiver_employee_name, transfer_rule_id, transfer_rule_name,
        approval_required, backup_allowed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sender_id = excluded.sender_id,
        sender_name = excluded.sender_name,
        receiver_id = excluded.receiver_id,
        receiver_name = excluded.receiver_name,
        file_name = excluded.file_name,
        safe_name = excluded.safe_name,
        mime_type = excluded.mime_type,
        size = excluded.size,
        chunk_size = excluded.chunk_size,
        total_chunks = excluded.total_chunks,
        uploaded_chunks = excluded.uploaded_chunks,
        progress = excluded.progress,
        status = excluded.status,
        controls = excluded.controls,
        file_path = excluded.file_path,
        chunks_dir = excluded.chunks_dir,
        sha256 = excluded.sha256,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at,
        approved_at = excluded.approved_at,
        rejected_at = excluded.rejected_at,
        reject_reason = excluded.reject_reason,
        retain_on_server = excluded.retain_on_server,
        delivery_status = excluded.delivery_status,
        server_file_status = excluded.server_file_status,
        delivered_at = excluded.delivered_at,
        purged_at = excluded.purged_at,
        purge_reason = excluded.purge_reason,
        upload_note = excluded.upload_note,
        sender_employee_id = excluded.sender_employee_id,
        sender_employee_name = excluded.sender_employee_name,
        receiver_employee_id = excluded.receiver_employee_id,
        receiver_employee_name = excluded.receiver_employee_name,
        transfer_rule_id = excluded.transfer_rule_id,
        transfer_rule_name = excluded.transfer_rule_name,
        approval_required = excluded.approval_required,
        backup_allowed = excluded.backup_allowed
    `,
    toParams: (item) => [
      item.id,
      item.senderId,
      item.senderName,
      item.receiverId,
      item.receiverName,
      item.fileName,
      item.safeName,
      item.mimeType,
      item.size,
      item.chunkSize,
      item.totalChunks,
      JSON.stringify(item.uploadedChunks || []),
      item.progress,
      item.status,
      JSON.stringify(item.controls || {}),
      item.filePath || null,
      item.chunksDir || null,
      item.sha256 || null,
      item.createdAt,
      item.completedAt || null,
      item.approvedAt || null,
      item.rejectedAt || null,
      item.rejectReason || "",
      boolInt(item.retainOnServer),
      item.deliveryStatus,
      item.serverFileStatus,
      item.deliveredAt || null,
      item.purgedAt || null,
      item.purgeReason || "",
      item.uploadNote || "",
      item.senderEmployeeId || null,
      item.senderEmployeeName || "",
      item.receiverEmployeeId || null,
      item.receiverEmployeeName || "",
      item.transferRuleId || null,
      item.transferRuleName || "",
      boolInt(item.approvalRequired),
      boolInt(item.backupAllowed),
    ],
  },
  {
    key: "logs",
    table: "logs",
    getItems: (data) => data.logs.slice(0, 1000),
    upsertSql: `
      INSERT INTO logs (id, at, actor_type, actor_id, action, details)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        at = excluded.at,
        actor_type = excluded.actor_type,
        actor_id = excluded.actor_id,
        action = excluded.action,
        details = excluded.details
    `,
    toParams: (item) => [
      item.id,
      item.at,
      item.actorType,
      item.actorId,
      item.action,
      JSON.stringify(item.details || {}),
    ],
  },
  {
    key: "adminUsers",
    table: "admin_users",
    upsertSql: `
      INSERT INTO admin_users (
        id, username, display_name, role, permissions, password_salt,
        password_hash, status, created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        permissions = excluded.permissions,
        password_salt = excluded.password_salt,
        password_hash = excluded.password_hash,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        last_login_at = excluded.last_login_at
    `,
    toParams: (item) => [
      item.id,
      item.username,
      item.displayName,
      item.role,
      JSON.stringify(item.permissions || []),
      item.passwordSalt,
      item.passwordHash,
      item.status,
      item.createdAt,
      item.updatedAt,
      item.lastLoginAt || null,
    ],
  },
  {
    key: "adminSessions",
    table: "admin_sessions",
    upsertSql: `
      INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        token_hash = excluded.token_hash,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        last_seen_at = excluded.last_seen_at
    `,
    toParams: (item) => [
      item.id,
      item.userId,
      item.tokenHash,
      item.createdAt,
      item.expiresAt,
      item.lastSeenAt,
    ],
  },
];

class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, "db.json");
    this.queue = Promise.resolve();
    this.consecutiveMutateWriteFailures = 0;
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.dbPath)) {
      const db = createEmptyDatabase();
      this.write(db);
      return db;
    }
    const raw = fs.readFileSync(this.dbPath, "utf8");
    if (!raw.trim()) {
      return createEmptyDatabase();
    }
    return normalizeOrg(JSON.parse(raw));
  }

  write(data) {
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalizeOrg(data), null, 2));
    fs.renameSync(tmpPath, this.dbPath);
  }

  snapshot() {
    return clone(normalizeOrg(this.data));
  }

  initialize(fn) {
    const result = fn(this.data);
    this.data = normalizeOrg(this.data);
    this.write(this.data);
    return result;
  }

  mutate(fn) {
    const task = this.queue.then(() => {
      const result = fn(this.data);
      const normalized = normalizeOrg(this.data);
      try {
        this.write(normalized);
      } catch (error) {
        this.consecutiveMutateWriteFailures += 1;
        logMutateWriteFailure("JsonStore", this.consecutiveMutateWriteFailures, error);
        throw error;
      }
      this.consecutiveMutateWriteFailures = 0;
      this.data = normalized;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  close() {}
}

class SqliteStore {
  constructor(dataDir, options = {}) {
    if (!DatabaseSync) {
      throw new Error("node:sqlite is not available in this Node.js runtime");
    }
    this.dataDir = dataDir;
    this.dbPath = options.dbPath || path.join(dataDir, "file-assistant.sqlite");
    this.queue = Promise.resolve();
    this.consecutiveMutateWriteFailures = 0;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
    this.migrateJsonIfNeeded();
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS install_codes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        max_uses INTEGER NOT NULL,
        used_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT,
        allowed_macs TEXT NOT NULL,
        allowed_ips TEXT NOT NULL,
        bind_to_first_mac INTEGER NOT NULL,
        bind_to_first_ip INTEGER NOT NULL,
        bound_mac TEXT,
        bound_ip TEXT,
        default_allow_when_unmanaged INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        client_ids TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        status TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        employee_no TEXT,
        department_id TEXT,
        title TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transfer_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_department_id TEXT,
        target_department_id TEXT,
        require_approval INTEGER NOT NULL DEFAULT 0,
        allow_backup INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        mac_address TEXT,
        ip_address TEXT,
        platform TEXT,
        install_code_id TEXT,
        secret_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        managed INTEGER NOT NULL,
        allow_when_unmanaged INTEGER NOT NULL,
        must_match_mac INTEGER NOT NULL,
        must_match_ip INTEGER NOT NULL,
        employee_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        receiver_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        safe_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        uploaded_chunks TEXT NOT NULL,
        progress INTEGER NOT NULL,
        status TEXT NOT NULL,
        controls TEXT NOT NULL,
        file_path TEXT,
        chunks_dir TEXT,
        sha256 TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        approved_at TEXT,
        rejected_at TEXT,
        reject_reason TEXT,
        retain_on_server INTEGER NOT NULL DEFAULT 0,
        delivery_status TEXT NOT NULL DEFAULT 'not_ready',
        server_file_status TEXT NOT NULL DEFAULT 'uploading',
        delivered_at TEXT,
        purged_at TEXT,
        purge_reason TEXT,
        upload_note TEXT,
        sender_employee_id TEXT,
        sender_employee_name TEXT,
        receiver_employee_id TEXT,
        receiver_employee_name TEXT,
        transfer_rule_id TEXT,
        transfer_rule_name TEXT,
        approval_required INTEGER NOT NULL DEFAULT 0,
        backup_allowed INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("transfers", "retain_on_server", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("transfers", "delivery_status", "TEXT NOT NULL DEFAULT 'not_ready'");
    this.ensureColumn("transfers", "server_file_status", "TEXT NOT NULL DEFAULT 'uploading'");
    this.ensureColumn("transfers", "delivered_at", "TEXT");
    this.ensureColumn("transfers", "purged_at", "TEXT");
    this.ensureColumn("transfers", "purge_reason", "TEXT");
    this.ensureColumn("transfers", "upload_note", "TEXT");
    this.ensureColumn("transfers", "sender_employee_id", "TEXT");
    this.ensureColumn("transfers", "sender_employee_name", "TEXT");
    this.ensureColumn("transfers", "receiver_employee_id", "TEXT");
    this.ensureColumn("transfers", "receiver_employee_name", "TEXT");
    this.ensureColumn("transfers", "transfer_rule_id", "TEXT");
    this.ensureColumn("transfers", "transfer_rule_name", "TEXT");
    this.ensureColumn("transfers", "approval_required", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("transfers", "backup_allowed", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("clients", "employee_id", "TEXT");
  }

  tableCount(tableName) {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
  }

  migrateJsonIfNeeded() {
    const initialized = this.db.prepare("SELECT value FROM meta WHERE key = 'initialized'").get();
    if (initialized) return;

    const jsonPath = path.join(this.dataDir, "db.json");
    let data = createEmptyDatabase();
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, "utf8");
      if (raw.trim()) {
        data = normalizeOrg(JSON.parse(raw));
      }
    }
    this.replaceAll(data);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('initialized', 'true')").run();
  }

  snapshot() {
    const departments = this.db.prepare("SELECT * FROM departments ORDER BY sort_order ASC, name ASC").all().map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      status: row.status,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const employees = this.db.prepare("SELECT * FROM employees ORDER BY name ASC").all().map((row) => ({
      id: row.id,
      name: row.name,
      employeeNo: row.employee_no || "",
      departmentId: row.department_id,
      title: row.title || "",
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const transferRules = this.db.prepare("SELECT * FROM transfer_rules ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      name: row.name,
      sourceDepartmentId: row.source_department_id,
      targetDepartmentId: row.target_department_id,
      requireApproval: Boolean(row.require_approval),
      allowBackup: Boolean(row.allow_backup),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })).map(normalizeTransferRule);

    const installCodes = this.db.prepare("SELECT * FROM install_codes ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      label: row.label,
      codeHash: row.code_hash,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      status: row.status,
      expiresAt: row.expires_at,
      allowedMacs: json(row.allowed_macs, []),
      allowedIps: json(row.allowed_ips, []),
      bindToFirstMac: Boolean(row.bind_to_first_mac),
      bindToFirstIp: Boolean(row.bind_to_first_ip),
      boundMac: row.bound_mac,
      boundIp: row.bound_ip,
      defaultAllowWhenUnmanaged: Boolean(row.default_allow_when_unmanaged),
      createdAt: row.created_at,
      clientIds: json(row.client_ids, []),
    }));

    const clients = this.db.prepare("SELECT * FROM clients ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      displayName: row.display_name,
      macAddress: row.mac_address,
      ipAddress: row.ip_address,
      platform: row.platform,
      installCodeId: row.install_code_id,
      secretHash: row.secret_hash,
      status: row.status,
      managed: Boolean(row.managed),
      allowWhenUnmanaged: Boolean(row.allow_when_unmanaged),
      mustMatchMac: Boolean(row.must_match_mac),
      mustMatchIp: Boolean(row.must_match_ip),
      employeeId: row.employee_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const transfers = this.db.prepare("SELECT * FROM transfers ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      receiverId: row.receiver_id,
      receiverName: row.receiver_name,
      fileName: row.file_name,
      safeName: row.safe_name,
      mimeType: row.mime_type,
      size: row.size,
      chunkSize: row.chunk_size,
      totalChunks: row.total_chunks,
      uploadedChunks: json(row.uploaded_chunks, []),
      progress: row.progress,
      status: row.status,
      controls: json(row.controls, {}),
      filePath: row.file_path,
      chunksDir: row.chunks_dir,
      sha256: row.sha256,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      approvedAt: row.approved_at,
      rejectedAt: row.rejected_at,
      rejectReason: row.reject_reason || "",
      senderEmployeeId: row.sender_employee_id,
      senderEmployeeName: row.sender_employee_name || "",
      receiverEmployeeId: row.receiver_employee_id,
      receiverEmployeeName: row.receiver_employee_name || "",
      transferRuleId: row.transfer_rule_id,
      transferRuleName: row.transfer_rule_name || "",
      approvalRequired: Boolean(row.approval_required),
      backupAllowed: Boolean(row.backup_allowed),
      retainOnServer: Boolean(row.retain_on_server),
      deliveryStatus: row.delivery_status,
      serverFileStatus: row.server_file_status,
      deliveredAt: row.delivered_at,
      purgedAt: row.purged_at,
      purgeReason: row.purge_reason || "",
      uploadNote: row.upload_note || "",
    })).map(normalizeTransfer);

    const logs = this.db.prepare("SELECT * FROM logs ORDER BY at DESC LIMIT 1000").all().map((row) => ({
      id: row.id,
      at: row.at,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      details: json(row.details, {}),
    }));

    const adminUsers = this.db.prepare("SELECT * FROM admin_users ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      permissions: json(row.permissions, []),
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
    }));

    const adminSessions = this.db.prepare("SELECT * FROM admin_sessions ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
    }));

    const settingsRow = this.db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
    const settings = json(settingsRow?.value, createDefaultSettings());

    return normalizeOrg({ settings, departments, employees, transferRules, installCodes, clients, transfers, logs, adminUsers, adminSessions });
  }

  syncTable(spec, beforeData, afterData) {
    const normalizeItem = spec.normalize || ((item) => item);
    const getItems = spec.getItems || ((data) => data[spec.key] || []);
    const beforeRows = new Map();
    const afterRows = new Map();

    for (const rawItem of getItems(beforeData)) {
      const item = normalizeItem(rawItem);
      beforeRows.set(item.id, rowSignature(spec.toParams(item)));
    }
    for (const rawItem of getItems(afterData)) {
      const item = normalizeItem(rawItem);
      afterRows.set(item.id, {
        signature: rowSignature(spec.toParams(item)),
        params: spec.toParams(item),
      });
    }

    const deleteStmt = this.db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`);
    for (const id of beforeRows.keys()) {
      if (!afterRows.has(id)) {
        deleteStmt.run(id);
      }
    }

    const upsertStmt = this.db.prepare(spec.upsertSql);
    for (const [id, row] of afterRows.entries()) {
      if (beforeRows.get(id) !== row.signature) {
        upsertStmt.run(...row.params);
      }
    }
  }

  pruneLogRows() {
    this.db.prepare(`
      DELETE FROM logs
      WHERE id NOT IN (
        SELECT id FROM logs ORDER BY at DESC LIMIT 1000
      )
    `).run();
  }

  applyChanges(beforeData, nextData) {
    const before = normalizeOrg(beforeData);
    const after = normalizeOrg(nextData);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const beforeSettings = JSON.stringify(before.settings);
      const afterSettings = JSON.stringify(after.settings);
      if (beforeSettings !== afterSettings) {
        this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('settings', ?)").run(afterSettings);
      }

      for (const spec of SQLITE_TABLE_SPECS) {
        this.syncTable(spec, before, after);
      }
      this.pruneLogRows();

      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')").run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceAll(data) {
    const normalized = normalizeOrg(data);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        DELETE FROM admin_sessions;
        DELETE FROM admin_users;
        DELETE FROM logs;
        DELETE FROM transfers;
        DELETE FROM transfer_rules;
        DELETE FROM clients;
        DELETE FROM employees;
        DELETE FROM departments;
        DELETE FROM install_codes;
      `);
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('settings', ?)").run(JSON.stringify(normalized.settings));

      const insertDepartment = this.db.prepare(`
        INSERT INTO departments (id, name, parent_id, status, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of normalized.departments) {
        insertDepartment.run(
          item.id,
          item.name,
          item.parentId || null,
          item.status || "active",
          Number(item.sortOrder || 0),
          item.createdAt,
          item.updatedAt,
        );
      }

      const insertEmployee = this.db.prepare(`
        INSERT INTO employees (id, name, employee_no, department_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of normalized.employees) {
        insertEmployee.run(
          item.id,
          item.name,
          item.employeeNo || null,
          item.departmentId || null,
          item.title || null,
          item.status || "active",
          item.createdAt,
          item.updatedAt,
        );
      }

      const insertTransferRule = this.db.prepare(`
        INSERT INTO transfer_rules (
          id, name, source_department_id, target_department_id, require_approval,
          allow_backup, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rawItem of normalized.transferRules) {
        const item = normalizeTransferRule(rawItem);
        insertTransferRule.run(
          item.id,
          item.name,
          item.sourceDepartmentId || null,
          item.targetDepartmentId || null,
          item.requireApproval ? 1 : 0,
          item.allowBackup ? 1 : 0,
          item.status,
          item.createdAt,
          item.updatedAt,
        );
      }

      const insertCode = this.db.prepare(`
        INSERT INTO install_codes (
          id, label, code_hash, max_uses, used_count, status, expires_at,
          allowed_macs, allowed_ips, bind_to_first_mac, bind_to_first_ip,
          bound_mac, bound_ip, default_allow_when_unmanaged, created_at, client_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of normalized.installCodes) {
        insertCode.run(
          item.id,
          item.label,
          item.codeHash,
          item.maxUses,
          item.usedCount,
          item.status,
          item.expiresAt || null,
          JSON.stringify(item.allowedMacs || []),
          JSON.stringify(item.allowedIps || []),
          item.bindToFirstMac ? 1 : 0,
          item.bindToFirstIp ? 1 : 0,
          item.boundMac || null,
          item.boundIp || null,
          item.defaultAllowWhenUnmanaged ? 1 : 0,
          item.createdAt,
          JSON.stringify(item.clientIds || []),
        );
      }

      const insertClient = this.db.prepare(`
        INSERT INTO clients (
          id, display_name, mac_address, ip_address, platform, install_code_id,
          secret_hash, status, managed, allow_when_unmanaged, must_match_mac,
          must_match_ip, employee_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rawItem of normalized.clients) {
        const item = normalizeClient(rawItem);
        insertClient.run(
          item.id,
          item.displayName,
          item.macAddress || null,
          item.ipAddress || null,
          item.platform || null,
          item.installCodeId || null,
          item.secretHash,
          item.status,
          item.managed ? 1 : 0,
          item.allowWhenUnmanaged ? 1 : 0,
          item.mustMatchMac ? 1 : 0,
          item.mustMatchIp ? 1 : 0,
          item.employeeId || null,
          item.createdAt,
          item.updatedAt,
        );
      }

      const insertTransfer = this.db.prepare(`
        INSERT INTO transfers (
          id, sender_id, sender_name, receiver_id, receiver_name, file_name, safe_name,
          mime_type, size, chunk_size, total_chunks, uploaded_chunks, progress, status,
          controls, file_path, chunks_dir, sha256, created_at, completed_at, approved_at,
          rejected_at, reject_reason, retain_on_server, delivery_status, server_file_status,
          delivered_at, purged_at, purge_reason, upload_note, sender_employee_id, sender_employee_name,
          receiver_employee_id, receiver_employee_name, transfer_rule_id, transfer_rule_name,
          approval_required, backup_allowed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rawItem of normalized.transfers) {
        const item = normalizeTransfer(rawItem);
        insertTransfer.run(
          item.id,
          item.senderId,
          item.senderName,
          item.receiverId,
          item.receiverName,
          item.fileName,
          item.safeName,
          item.mimeType,
          item.size,
          item.chunkSize,
          item.totalChunks,
          JSON.stringify(item.uploadedChunks || []),
          item.progress,
          item.status,
          JSON.stringify(item.controls || {}),
          item.filePath || null,
          item.chunksDir || null,
          item.sha256 || null,
          item.createdAt,
          item.completedAt || null,
          item.approvedAt || null,
          item.rejectedAt || null,
          item.rejectReason || "",
          item.retainOnServer ? 1 : 0,
          item.deliveryStatus,
          item.serverFileStatus,
          item.deliveredAt || null,
          item.purgedAt || null,
          item.purgeReason || "",
          item.uploadNote || "",
          item.senderEmployeeId || null,
          item.senderEmployeeName || "",
          item.receiverEmployeeId || null,
          item.receiverEmployeeName || "",
          item.transferRuleId || null,
          item.transferRuleName || "",
          item.approvalRequired ? 1 : 0,
          item.backupAllowed ? 1 : 0,
        );
      }

      const insertLog = this.db.prepare(`
        INSERT INTO logs (id, at, actor_type, actor_id, action, details)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of normalized.logs.slice(0, 1000)) {
        insertLog.run(
          item.id,
          item.at,
          item.actorType,
          item.actorId,
          item.action,
          JSON.stringify(item.details || {}),
        );
      }

      const insertAdminUser = this.db.prepare(`
        INSERT INTO admin_users (
          id, username, display_name, role, permissions, password_salt,
          password_hash, status, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of normalized.adminUsers) {
        insertAdminUser.run(
          item.id,
          item.username,
          item.displayName,
          item.role,
          JSON.stringify(item.permissions || []),
          item.passwordSalt,
          item.passwordHash,
          item.status,
          item.createdAt,
          item.updatedAt,
          item.lastLoginAt || null,
        );
      }

      const insertSession = this.db.prepare(`
        INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of normalized.adminSessions) {
        insertSession.run(
          item.id,
          item.userId,
          item.tokenHash,
          item.createdAt,
          item.expiresAt,
          item.lastSeenAt,
        );
      }

      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')").run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  initialize(fn) {
    const data = this.snapshot();
    const result = fn(data);
    this.replaceAll(data);
    return result;
  }

  mutate(fn) {
    const task = this.queue.then(() => {
      const before = this.snapshot();
      const data = clone(before);
      const result = fn(data);
      try {
        this.applyChanges(before, data);
      } catch (error) {
        this.consecutiveMutateWriteFailures += 1;
        logMutateWriteFailure("SqliteStore", this.consecutiveMutateWriteFailures, error);
        throw error;
      }
      this.consecutiveMutateWriteFailures = 0;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  close() {
    this.db.close();
  }
}

function createDefaultStore(dataDir, options = {}) {
  if (DatabaseSync && options.forceJson !== true) {
    return new SqliteStore(dataDir, options);
  }
  return new JsonStore(dataDir);
}

module.exports = {
  JsonStore,
  SqliteStore,
  createDefaultStore,
  createEmptyDatabase,
  normalizeDatabase,
  normalizeTransfer,
  normalizeOrg,
};
