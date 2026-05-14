const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { JsonStore, SqliteStore, normalizeTransfer } = require("../apps/server/db");
const { createAppServer } = require("../apps/server/server");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function jsonFetch(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body;
}

function clientHeaders(client, secret, device = {}) {
  return {
    "X-Client-Id": client.id,
    "X-Client-Secret": secret,
    "X-Device-Mac": device.macAddress || client.macAddress,
    "X-Device-Ip": device.ipAddress || client.ipAddress,
  };
}

test("json store logs mutate write failures and keeps the queue usable", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-json-store-"));
  const store = new JsonStore(dataDir);
  const originalWrite = store.write.bind(store);
  const originalConsoleError = console.error;
  const errors = [];
  let failWrites = true;
  console.error = (...args) => errors.push(args);
  store.write = (data) => {
    if (failWrites) {
      throw new Error("simulated disk write failure");
    }
    return originalWrite(data);
  };

  try {
    await assert.rejects(
      () => store.mutate((data) => {
        data.departments.push({
          id: "dept_failed",
          name: "Failed",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }),
      /simulated disk write failure/,
    );
    assert.equal(store.consecutiveMutateWriteFailures, 1);
    assert.match(String(errors[0]?.[0] || ""), /JsonStore mutate write failed \(1 consecutive\)/);

    failWrites = false;
    const result = await store.mutate((data) => {
      data.departments = [];
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(store.consecutiveMutateWriteFailures, 0);
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("sqlite mutate applies differential writes without replaceAll", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-sqlite-diff-"));
  let store;
  try {
    store = new SqliteStore(dataDir);
  } catch (error) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    t.skip("node:sqlite is not available in this Node.js runtime");
    return;
  }

  try {
    const createdAt = new Date().toISOString();
    store.initialize((data) => {
      data.departments.push({
        id: "dept_sqlite_diff",
        name: "Before",
        status: "active",
        sortOrder: 1,
        createdAt,
        updatedAt: createdAt,
      });
    });

    store.replaceAll = () => {
      throw new Error("replaceAll should not be called during mutate");
    };

    await store.mutate((data) => {
      data.departments[0].name = "After";
      data.logs.unshift({
        id: "log_sqlite_diff",
        at: new Date().toISOString(),
        actorType: "test",
        actorId: "sqlite",
        action: "sqlite.diff",
        details: { ok: true },
      });
    });

    let snapshot = store.snapshot();
    assert.equal(snapshot.departments.length, 1);
    assert.equal(snapshot.departments[0].name, "After");
    assert.equal(snapshot.logs[0].action, "sqlite.diff");

    await store.mutate((data) => {
      data.departments = [];
    });

    snapshot = store.snapshot();
    assert.equal(snapshot.departments.length, 0);
    assert.equal(snapshot.logs.length, 1);
  } finally {
    store?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("legacy approved transfer status normalizes to ready_to_deliver", () => {
  const normalized = normalizeTransfer({
    id: "transfer_legacy",
    status: "approved",
    deliveryStatus: "not_ready",
    retainOnServer: false,
    filePath: "C:/tmp/file.txt",
  });
  assert.equal(normalized.status, "ready_to_deliver");
  assert.equal(normalized.deliveryStatus, "waiting");
});

test("initial admin setup creates the first web admin", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-setup-"));
  const publicDir = path.resolve(__dirname, "..", "apps", "web");
  const server = createAppServer({
    dataDir,
    publicDir,
    initialAdminSetup: true,
    adminToken: "",
  });
  const baseUrl = await listen(server);

  try {
    const status = await jsonFetch(baseUrl, "/api/admin/setup/status");
    assert.equal(status.required, true);

    await assert.rejects(
      () => jsonFetch(baseUrl, "/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: "admin",
          password: "admin123456",
        }),
      }),
      /Admin username or password is invalid/,
    );

    const setup = await jsonFetch(baseUrl, "/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({
        username: "owner",
        displayName: "Owner",
        password: "strong-pass-123",
      }),
    });
    assert.equal(setup.user.username, "owner");
    assert.ok(setup.token);

    const afterSetup = await jsonFetch(baseUrl, "/api/admin/setup/status");
    assert.equal(afterSetup.required, false);

    const login = await jsonFetch(baseUrl, "/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "owner",
        password: "strong-pass-123",
      }),
    });
    assert.equal(login.user.username, "owner");
    assert.ok(login.token);
  } finally {
    await close(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("default sending rule relays without confirmation", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-default-"));
  const publicDir = path.resolve(__dirname, "..", "apps", "web");
  const server = createAppServer({
    dataDir,
    publicDir,
    adminToken: "test-admin",
    chunkSize: 4,
  });
  const baseUrl = await listen(server);

  try {
    const admin = { "X-Admin-Token": "test-admin" };
    const code = await jsonFetch(baseUrl, "/api/admin/install-codes", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ label: "Default relay code", maxUses: 2 }),
    });

    const aliceReg = await jsonFetch(baseUrl, "/api/client/register", {
      method: "POST",
      body: JSON.stringify({
        installCode: code.code,
        displayName: "Alice",
        macAddress: "AA-BB-CC-10-00-01",
        ipAddress: "10.1.0.11",
        platform: "Windows",
      }),
    });
    const bobReg = await jsonFetch(baseUrl, "/api/client/auto-register", {
      method: "POST",
      body: JSON.stringify({
        deployToken: code.code,
        displayName: "Bob",
        macAddress: "AA-BB-CC-10-00-02",
        ipAddress: "10.1.0.12",
        platform: "Windows",
      }),
    });

    const aliceHeaders = clientHeaders(aliceReg.client, aliceReg.clientSecret);
    const content = Buffer.from("plain relay");
    const init = await jsonFetch(baseUrl, "/api/client/transfers/init", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({
        receiverId: bobReg.client.id,
        fileName: "plain.txt",
        mimeType: "text/plain",
        size: content.length,
        retainOnServer: false,
        controls: {
          uploader: { allowStatusView: true },
          receiver: { allowReceive: true, allowPreview: false, allowScreenshot: true },
        },
      }),
    });
    assert.equal(init.transfer.approvalRequired, false);
    assert.equal(init.transfer.transferRuleId, null);

    for (const index of init.missingChunks) {
      const start = index * init.transfer.chunkSize;
      const end = Math.min(start + init.transfer.chunkSize, content.length);
      const res = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/chunks/${index}`, {
        method: "PUT",
        headers: {
          ...aliceHeaders,
          "Content-Type": "application/octet-stream",
        },
        body: content.subarray(start, end),
      });
      assert.equal(res.ok, true);
    }

    const status = await jsonFetch(baseUrl, `/api/client/transfers/${init.transfer.id}/status`, {
      headers: aliceHeaders,
    });
    assert.equal(status.transfer.status, "ready_to_deliver");
    assert.equal(status.transfer.deliveryStatus, "waiting");
    assert.equal(status.transfer.serverFileStatus, "temporary");
  } finally {
    await close(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("failed merge cleans the partial upload output directory", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-merge-cleanup-"));
  const publicDir = path.resolve(__dirname, "..", "apps", "web");
  const server = createAppServer({
    dataDir,
    publicDir,
    adminToken: "test-admin",
    chunkSize: 4,
  });
  const baseUrl = await listen(server);

  try {
    const admin = { "X-Admin-Token": "test-admin" };
    const code = await jsonFetch(baseUrl, "/api/admin/install-codes", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ label: "Merge cleanup code", maxUses: 2 }),
    });
    const aliceReg = await jsonFetch(baseUrl, "/api/client/register", {
      method: "POST",
      body: JSON.stringify({
        installCode: code.code,
        displayName: "Alice Cleanup",
        macAddress: "AA-BB-CC-11-00-01",
        ipAddress: "10.1.1.11",
        platform: "Windows",
      }),
    });
    const bobReg = await jsonFetch(baseUrl, "/api/client/auto-register", {
      method: "POST",
      body: JSON.stringify({
        deployToken: code.code,
        displayName: "Bob Cleanup",
        macAddress: "AA-BB-CC-11-00-02",
        ipAddress: "10.1.1.12",
        platform: "Windows",
      }),
    });

    const aliceHeaders = clientHeaders(aliceReg.client, aliceReg.clientSecret);
    const content = Buffer.from("merge cleanup content");
    const init = await jsonFetch(baseUrl, "/api/client/transfers/init", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({
        receiverId: bobReg.client.id,
        fileName: "cleanup.txt",
        mimeType: "text/plain",
        size: content.length,
        retainOnServer: false,
        controls: {
          uploader: { allowStatusView: true },
          receiver: { allowReceive: true, allowPreview: false, allowScreenshot: true },
        },
      }),
    });

    const firstChunk = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/chunks/0`, {
      method: "PUT",
      headers: {
        ...aliceHeaders,
        "Content-Type": "application/octet-stream",
      },
      body: content.subarray(0, init.transfer.chunkSize),
    });
    assert.equal(firstChunk.ok, true);
    fs.rmSync(path.join(dataDir, "chunks", init.transfer.id, "0.part"), { force: true });

    let failedMergeResponse = null;
    for (const index of init.missingChunks.slice(1)) {
      const start = index * init.transfer.chunkSize;
      const end = Math.min(start + init.transfer.chunkSize, content.length);
      failedMergeResponse = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/chunks/${index}`, {
        method: "PUT",
        headers: {
          ...aliceHeaders,
          "Content-Type": "application/octet-stream",
        },
        body: content.subarray(start, end),
      });
    }

    assert.equal(failedMergeResponse.status, 409);
    assert.equal(fs.existsSync(path.join(dataDir, "uploads", init.transfer.id)), false);
  } finally {
    await close(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("open registration can temporarily register clients without a code", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-open-reg-"));
  const publicDir = path.resolve(__dirname, "..", "apps", "web");
  const server = createAppServer({
    dataDir,
    publicDir,
    adminToken: "test-admin",
  });
  const baseUrl = await listen(server);

  try {
    const admin = { "X-Admin-Token": "test-admin" };
    const closed = await jsonFetch(baseUrl, "/api/admin/open-registration", {
      headers: admin,
    });
    assert.equal(closed.active, false);

    await assert.rejects(
      () => jsonFetch(baseUrl, "/api/client/open-register", {
        method: "POST",
        body: JSON.stringify({
          displayName: "No Code Client",
          macAddress: "AA-BB-CC-20-00-01",
          ipAddress: "10.2.0.11",
          platform: "Windows",
        }),
      }),
      /Open registration is not enabled/,
    );

    const opened = await jsonFetch(baseUrl, "/api/admin/open-registration", {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({
        enabled: true,
        durationMinutes: 60,
        maxUses: 1,
      }),
    });
    assert.equal(opened.active, true);
    assert.equal(opened.remainingUses, 1);

    const registered = await jsonFetch(baseUrl, "/api/client/open-register", {
      method: "POST",
      body: JSON.stringify({
        displayName: "No Code Client",
        macAddress: "AA-BB-CC-20-00-01",
        ipAddress: "10.2.0.11",
        platform: "Windows",
      }),
    });
    assert.equal(registered.client.displayName, "No Code Client");
    assert.equal(registered.client.installCodeId, null);
    assert.equal(registered.client.employeeId, null);
    assert.ok(registered.clientSecret);

    const exhausted = await jsonFetch(baseUrl, "/api/admin/open-registration", {
      headers: admin,
    });
    assert.equal(exhausted.active, false);
    assert.equal(exhausted.usedCount, 1);
    assert.equal(exhausted.remainingUses, 0);

    await assert.rejects(
      () => jsonFetch(baseUrl, "/api/client/open-register", {
        method: "POST",
        body: JSON.stringify({
          displayName: "Second Client",
          macAddress: "AA-BB-CC-20-00-02",
          ipAddress: "10.2.0.12",
          platform: "Windows",
        }),
      }),
      /Open registration is not enabled/,
    );
  } finally {
    await close(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("admin can generate a dedicated client installer package", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-package-data-"));
  const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-package-template-"));
  const templatePath = path.join(templateDir, "FileAssistantClientSetup.exe");
  fs.writeFileSync(templatePath, Buffer.from("FAKE-INSTALLER-TEMPLATE"));
  const publicDir = path.resolve(__dirname, "..", "apps", "web");
  const server = createAppServer({
    dataDir,
    publicDir,
    adminToken: "test-admin",
    clientInstallerTemplatePath: templatePath,
  });
  const baseUrl = await listen(server);

  try {
    const admin = { "X-Admin-Token": "test-admin" };
    const created = await jsonFetch(baseUrl, "/api/admin/client-packages", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        serverUrl: baseUrl,
        label: "QA deployment",
        maxUses: 1,
        validDays: 1,
        defaultAllowWhenUnmanaged: false,
      }),
    });
    assert.equal(created.serverUrl, baseUrl);
    assert.equal(created.maxUses, 1);
    assert.match(created.fileName, /^FileAssistantClientSetup-/);
    assert.match(created.downloadUrl, /^\/api\/admin\/client-packages\//);
    assert.ok(created.installCodeId);
    assert.ok(created.expiresAt);

    const unauthenticatedDownload = await fetch(`${baseUrl}${created.downloadUrl}`);
    assert.equal(unauthenticatedDownload.status, 401);

    const download = await fetch(`${baseUrl}${created.downloadUrl}`, { headers: admin });
    assert.equal(download.ok, true);
    assert.match(download.headers.get("content-disposition") || "", /attachment/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, "FAKE-INSTALLER-TEMPLATE".length).toString("utf8"), "FAKE-INSTALLER-TEMPLATE");

    const text = bytes.toString("utf8");
    const begin = text.lastIndexOf("FA_CLIENT_BOOTSTRAP_V1_BEGIN");
    const end = text.lastIndexOf("FA_CLIENT_BOOTSTRAP_V1_END");
    assert.ok(begin > 0);
    assert.ok(end > begin);
    const config = JSON.parse(text.slice(begin + "FA_CLIENT_BOOTSTRAP_V1_BEGIN".length, end).trim());
    assert.equal(config.serverUrl, baseUrl);
    assert.match(config.deployToken, /^FA-/);
    assert.equal(config.autoRegister, true);

    const registered = await jsonFetch(baseUrl, "/api/client/auto-register", {
      method: "POST",
      body: JSON.stringify({
        deployToken: config.deployToken,
        displayName: "Packaged Client",
        macAddress: "AA-BB-CC-30-00-01",
        ipAddress: "10.3.0.11",
        platform: "Windows",
      }),
    });
    assert.equal(registered.client.installCodeId, created.installCodeId);
    assert.equal(registered.client.allowWhenUnmanaged, false);

    await assert.rejects(
      () => jsonFetch(baseUrl, "/api/client/auto-register", {
        method: "POST",
        body: JSON.stringify({
          deployToken: config.deployToken,
          displayName: "Second Packaged Client",
          macAddress: "AA-BB-CC-30-00-02",
          ipAddress: "10.3.0.12",
          platform: "Windows",
        }),
      }),
      /Install code usage limit reached/,
    );
  } finally {
    await close(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(templateDir, { recursive: true, force: true });
  }
});

test("file transfer confirmation flow works end to end", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-assistant-test-"));
  const publicDir = path.resolve(__dirname, "..", "apps", "web");
  const server = createAppServer({
    dataDir,
    publicDir,
    adminToken: "test-admin",
    chunkSize: 5,
  });
  const baseUrl = await listen(server);

  try {
    const admin = { "X-Admin-Token": "test-admin" };
    const login = await jsonFetch(baseUrl, "/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "admin123456",
      }),
    });
    assert.equal(login.user.username, "admin");
    assert.ok(login.token);

    const sessionAdmin = { Authorization: `Bearer ${login.token}` };
    const users = await jsonFetch(baseUrl, "/api/admin/users", {
      headers: sessionAdmin,
    });
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "super_admin");

    const code = await jsonFetch(baseUrl, "/api/admin/install-codes", {
      method: "POST",
      headers: sessionAdmin,
      body: JSON.stringify({
        label: "QA code",
        maxUses: 2,
      }),
    });
    assert.match(code.code, /^FA-/);

    const aliceReg = await jsonFetch(baseUrl, "/api/client/register", {
      method: "POST",
      body: JSON.stringify({
        installCode: code.code,
        displayName: "Alice",
        macAddress: "AA-BB-CC-00-00-01",
        ipAddress: "10.0.0.11",
        platform: "Windows",
      }),
    });
    const bobReg = await jsonFetch(baseUrl, "/api/client/register", {
      method: "POST",
      body: JSON.stringify({
        installCode: code.code,
        displayName: "Bob",
        macAddress: "AA-BB-CC-00-00-02",
        ipAddress: "10.0.0.12",
        platform: "macOS",
      }),
    });

    const aliceHeaders = clientHeaders(aliceReg.client, aliceReg.clientSecret);
    const bobHeaders = clientHeaders(bobReg.client, bobReg.clientSecret);
    const department = await jsonFetch(baseUrl, "/api/admin/departments", {
      method: "POST",
      headers: sessionAdmin,
      body: JSON.stringify({ name: "Engineering" }),
    });
    const aliceEmployee = await jsonFetch(baseUrl, "/api/admin/employees", {
      method: "POST",
      headers: sessionAdmin,
      body: JSON.stringify({ name: "Alice Employee", employeeNo: "E001", departmentId: department.id }),
    });
    const bobEmployee = await jsonFetch(baseUrl, "/api/admin/employees", {
      method: "POST",
      headers: sessionAdmin,
      body: JSON.stringify({ name: "Bob Employee", employeeNo: "E002", departmentId: department.id }),
    });
    await jsonFetch(baseUrl, `/api/admin/clients/${aliceReg.client.id}`, {
      method: "PATCH",
      headers: sessionAdmin,
      body: JSON.stringify({ employeeId: aliceEmployee.id }),
    });
    await jsonFetch(baseUrl, `/api/admin/clients/${bobReg.client.id}`, {
      method: "PATCH",
      headers: sessionAdmin,
      body: JSON.stringify({ employeeId: bobEmployee.id }),
    });
    const aliceMe = await jsonFetch(baseUrl, "/api/client/me", {
      headers: aliceHeaders,
    });
    assert.equal(aliceMe.employeeId, aliceEmployee.id);
    assert.equal(aliceMe.employeeName, "Alice Employee");
    assert.equal(aliceMe.employeeNo, "E001");
    assert.equal(aliceMe.departmentName, "Engineering");
    const approvalRule = await jsonFetch(baseUrl, "/api/admin/transfer-rules", {
      method: "POST",
      headers: sessionAdmin,
      body: JSON.stringify({
        name: "Engineering approval rule",
        sourceDepartmentId: department.id,
        targetDepartmentId: department.id,
        requireApproval: true,
        allowBackup: true,
      }),
    });
    const visibleClients = await jsonFetch(baseUrl, "/api/client/clients", {
      headers: aliceHeaders,
    });
    assert.equal(visibleClients.length, 1);
    assert.equal(visibleClients[0].displayName, "Bob");
    const recipients = await jsonFetch(baseUrl, "/api/client/recipients", {
      headers: aliceHeaders,
    });
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].name, "Bob Employee");

    const content = Buffer.from("hello secure transfer");
    const init = await jsonFetch(baseUrl, "/api/client/transfers/init", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({
        receiverEmployeeId: bobEmployee.id,
        fileName: "hello.txt",
        mimeType: "text/plain",
        size: content.length,
        retainOnServer: false,
        uploadNote: "ordinary relay",
        controls: {
          uploader: { allowStatusView: true },
          receiver: { allowReceive: true, allowPreview: true, allowScreenshot: false },
        },
      }),
    });
    assert.equal(init.transfer.totalChunks, Math.ceil(content.length / 5));
    assert.equal(init.transfer.transferRuleId, approvalRule.id);
    assert.equal(init.transfer.approvalRequired, true);
    assert.deepEqual(init.missingChunks, [0, 1, 2, 3, 4]);

    for (const index of init.missingChunks) {
      const start = index * init.transfer.chunkSize;
      const end = Math.min(start + init.transfer.chunkSize, content.length);
      const res = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/chunks/${index}`, {
        method: "PUT",
        headers: {
          ...aliceHeaders,
          "Content-Type": "application/octet-stream",
        },
        body: content.subarray(start, end),
      });
      assert.equal(res.ok, true);
    }

    const transfers = await jsonFetch(baseUrl, "/api/admin/transfers", {
      headers: admin,
    });
    assert.equal(transfers[0].status, "pending_approval");
    assert.equal(transfers[0].progress, 100);

    const approved = await jsonFetch(baseUrl, `/api/admin/transfers/${init.transfer.id}`, {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({ status: "ready_to_deliver" }),
    });
    assert.equal(approved.status, "ready_to_deliver");
    assert.equal(approved.deliveryStatus, "waiting");
    assert.equal(approved.serverFileStatus, "temporary");

    const senderFileRes = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/file?mode=receive`, {
      headers: aliceHeaders,
    });
    assert.equal(senderFileRes.status, 403);

    const fileRes = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/file?mode=receive`, {
      headers: bobHeaders,
    });
    assert.equal(fileRes.ok, true);
    assert.equal(await fileRes.text(), content.toString("utf8"));

    const delivered = await jsonFetch(baseUrl, `/api/client/transfers/${init.transfer.id}/confirm-delivery`, {
      method: "POST",
      headers: bobHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.deliveryStatus, "delivered");
    assert.equal(delivered.serverFileStatus, "purged");
    assert.equal(delivered.purgeReason, "delivered");

    const purgedFileRes = await fetch(`${baseUrl}/api/client/transfers/${init.transfer.id}/file?mode=receive`, {
      headers: bobHeaders,
    });
    assert.equal(purgedFileRes.status, 403);

    const backupContent = Buffer.from("important backup transfer");
    const backupInit = await jsonFetch(baseUrl, "/api/client/transfers/init", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({
        receiverEmployeeId: bobEmployee.id,
        fileName: "important.txt",
        mimeType: "text/plain",
        size: backupContent.length,
        retainOnServer: true,
        uploadNote: "keep backup",
        controls: {
          uploader: { allowStatusView: true },
          receiver: { allowReceive: true, allowPreview: false, allowScreenshot: false },
        },
      }),
    });
    for (const index of backupInit.missingChunks) {
      const start = index * backupInit.transfer.chunkSize;
      const end = Math.min(start + backupInit.transfer.chunkSize, backupContent.length);
      const res = await fetch(`${baseUrl}/api/client/transfers/${backupInit.transfer.id}/chunks/${index}`, {
        method: "PUT",
        headers: {
          ...aliceHeaders,
          "Content-Type": "application/octet-stream",
        },
        body: backupContent.subarray(start, end),
      });
      assert.equal(res.ok, true);
    }
    const backupApproved = await jsonFetch(baseUrl, `/api/admin/transfers/${backupInit.transfer.id}`, {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({ status: "ready_to_deliver" }),
    });
    assert.equal(backupApproved.retainOnServer, true);
    assert.equal(backupApproved.serverFileStatus, "retained");
    const backupReceive = await fetch(`${baseUrl}/api/client/transfers/${backupInit.transfer.id}/file?mode=receive`, {
      headers: bobHeaders,
    });
    assert.equal(backupReceive.ok, true);
    assert.equal(await backupReceive.text(), backupContent.toString("utf8"));
    const backupDelivered = await jsonFetch(baseUrl, `/api/client/transfers/${backupInit.transfer.id}/confirm-delivery`, {
      method: "POST",
      headers: bobHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(backupDelivered.status, "delivered");
    assert.equal(backupDelivered.serverFileStatus, "retained");
    const adminBackupFile = await fetch(`${baseUrl}/api/admin/transfers/${backupInit.transfer.id}/file?mode=download`, {
      headers: admin,
    });
    assert.equal(adminBackupFile.ok, true);
    assert.equal(await adminBackupFile.text(), backupContent.toString("utf8"));

    const relaxedRule = await jsonFetch(baseUrl, `/api/admin/transfer-rules/${approvalRule.id}`, {
      method: "PATCH",
      headers: sessionAdmin,
      body: JSON.stringify({
        requireApproval: false,
        allowBackup: false,
      }),
    });
    assert.equal(relaxedRule.requireApproval, false);
    assert.equal(relaxedRule.allowBackup, false);

    await assert.rejects(
      () => jsonFetch(baseUrl, "/api/client/transfers/init", {
        method: "POST",
        headers: aliceHeaders,
        body: JSON.stringify({
          receiverEmployeeId: bobEmployee.id,
          fileName: "blocked-backup.txt",
          mimeType: "text/plain",
          size: 3,
          retainOnServer: true,
          controls: {
            uploader: { allowStatusView: true },
            receiver: { allowReceive: true, allowPreview: false, allowScreenshot: false },
          },
        }),
      }),
      /Important backup is not allowed/,
    );

    const autoContent = Buffer.from("auto approved");
    const autoInit = await jsonFetch(baseUrl, "/api/client/transfers/init", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({
        receiverEmployeeId: bobEmployee.id,
        fileName: "auto.txt",
        mimeType: "text/plain",
        size: autoContent.length,
        retainOnServer: false,
        controls: {
          uploader: { allowStatusView: true },
          receiver: { allowReceive: true, allowPreview: false, allowScreenshot: false },
        },
      }),
    });
    assert.equal(autoInit.transfer.approvalRequired, false);
    for (const index of autoInit.missingChunks) {
      const start = index * autoInit.transfer.chunkSize;
      const end = Math.min(start + autoInit.transfer.chunkSize, autoContent.length);
      const res = await fetch(`${baseUrl}/api/client/transfers/${autoInit.transfer.id}/chunks/${index}`, {
        method: "PUT",
        headers: {
          ...aliceHeaders,
          "Content-Type": "application/octet-stream",
        },
        body: autoContent.subarray(start, end),
      });
      assert.equal(res.ok, true);
    }
    const autoStatus = await jsonFetch(baseUrl, `/api/client/transfers/${autoInit.transfer.id}/status`, {
      headers: aliceHeaders,
    });
    assert.equal(autoStatus.transfer.status, "ready_to_deliver");
    assert.equal(autoStatus.transfer.deliveryStatus, "waiting");

    const logs = await jsonFetch(baseUrl, "/api/admin/logs", {
      headers: admin,
    });
    assert.ok(logs.some((log) => log.action === "transfer.approved"));
    assert.ok(logs.some((log) => log.action === "transfer.upload.completed"));
    assert.ok(logs.some((log) => log.action === "transfer.delivery_confirmed"));
    assert.ok(logs.some((log) => log.action === "transfer.auto_approved"));
  } finally {
    await close(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
