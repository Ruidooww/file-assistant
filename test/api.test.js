const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

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
      body: JSON.stringify({ status: "approved" }),
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
      body: JSON.stringify({ status: "approved" }),
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
