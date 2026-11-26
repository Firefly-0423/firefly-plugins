import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createTestHost, manifestErrors, readManifest } from "./plugin-fixture.mjs";

const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const PLUGIN_ID = "dev.firefly.drawai";

async function makeTempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const owned = await realpath(dir);
  const parent = await realpath(os.tmpdir());
  t.after(async () => {
    if (path.dirname(owned) !== parent || await realpath(dir) !== owned) throw new Error("Unsafe cleanup");
    await rm(owned, { recursive: true, force: true });
  });
  return owned;
}

test("drawai manifest matches 1.2.0 schema with workspace.read, ui.windows, and window declaration", () => {
  const manifest = readManifest(PLUGIN_ID);
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, PLUGIN_ID);
  assert.equal(manifest.sdk, "^1.2.0");
  assert.equal(manifest.native, false);
  assert.deepEqual(manifest.permissions, ["workspace.read", "ui.windows"]);
  assert.deepEqual(manifest.tools, [
    { name: "read", title: "读取 DrawAI 图", risk: ["fs-read"], modes: ["work", "code"] },
    { name: "apply", title: "修改 DrawAI 图", risk: ["fs-write"], modes: ["work", "code"] },
  ]);
  assert.equal(manifest.ui?.windows?.[0]?.id, "canvas");
});

test("Firefly receives the concrete operation schema via tools.register", async t => {
  const { createPlugin } = require("../plugins/dev.firefly.drawai/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeTempDir(t, "drawai-schema-");
  const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host.activate(createPlugin());
  t.after(() => host.deactivate("disabled"));

  const applyReg = host.calls.find((call) => call.method === "tools.register" && call.params.name === "apply");
  assert.ok(applyReg);
  const item = applyReg.params.parameters.properties.ops.items;
  assert.ok(item.properties, "operation fields are missing from the Firefly contract");
  assert.equal(item.properties.op.enum.includes("addNode"), true);
  assert.deepEqual(item.required, ["op"]);
  for (const name of ["label", "id", "from", "to", "x", "y", "w", "h", "shape", "layer"]) {
    assert.ok(item.properties[name], name);
  }
  const validate = new Ajv({ strict: false }).compile(applyReg.params.parameters);
  assert.equal(validate({ path: "flow.drawio", create: true, ops: [{ op: "addNode", id: "a", label: "开始", shape: "rounded", x: 10, y: 20 }] }), true);
  assert.equal(validate({ path: "flow.drawio", ops: [{ op: "traceImage" }] }), false);
  assert.equal(validate({ path: "flow.drawio", ops: [{ label: "missing op" }] }), false);
});

test("reads/applies workspace .drawio files and enforces workspace, permission, mode, and approval boundaries", async t => {
  const { createPlugin } = require("../plugins/dev.firefly.drawai/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeTempDir(t, "drawai-data-");
  const workspaceDir = await makeTempDir(t, "drawai-ws-");
  const targetFile = path.join(workspaceDir, "flow.drawio");

  // 1. No workspace bound -> not_executed, no file written
  const noWsHost = createTestHost({ manifest, mode: "work", level: "full", dataDir, workspace: null });
  await noWsHost.activate(createPlugin());
  const noWsRes = await noWsHost.callTool("apply", {
    path: "flow.drawio",
    create: true,
    ops: [{ op: "addNode", id: "n1", label: "A" }],
  });
  assert.equal(noWsRes.status, "not_executed");
  assert.match(noWsRes.reason, /E_WORKSPACE/);
  assert.equal(existsSync(targetFile), false);
  await noWsHost.deactivate("disabled");

  // 2. read-only level denies fs-write apply; per-action rejection denies apply; chat mode blocks both
  const host = createTestHost({
    manifest,
    mode: "work",
    level: "read-only",
    dataDir,
    workspace: { sessionId: "s1", mode: "work", root: workspaceDir, name: "ws" },
    approvalDecision: "reject",
  });
  await host.activate(createPlugin());
  t.after(() => host.deactivate("disabled"));

  const readOnlyBlocked = await host.callTool("apply", {
    path: "flow.drawio",
    create: true,
    ops: [{ op: "addNode", id: "n1", label: "A" }],
  });
  assert.equal(readOnlyBlocked.status, "not_executed");
  assert.match(readOnlyBlocked.reason, /ERR_PERMISSION/);
  assert.equal(existsSync(targetFile), false);

  host.setLevel("per-action");
  const rejected = await host.callTool("apply", {
    path: "flow.drawio",
    create: true,
    ops: [{ op: "addNode", id: "n1", label: "A" }],
  });
  assert.equal(rejected.status, "not_executed");
  assert.match(rejected.reason, /ERR_REJECTED/);
  assert.equal(existsSync(targetFile), false);

  host.setLevel("full");
  host.setMode("chat");
  const chatBlocked = await host.callTool("read", { path: "flow.drawio" });
  assert.equal(chatBlocked.status, "not_executed");

  // 3. Revoked workspace.read -> not_executed without touching workspace
  host.setMode("work");
  host.revokePermission("workspace.read");
  const revoked = await host.callTool("read", { path: "flow.drawio" });
  assert.equal(revoked.status, "not_executed");
  assert.match(revoked.reason, /ERR_PERMISSION/);

  // 4. Granted workspace.read + full level -> creates and reads real .drawio file
  host.grantPermission("workspace.read");
  const applied = await host.callTool("apply", {
    path: "flow.drawio",
    create: true,
    ops: [{ op: "addNode", id: "n1", label: "开始" }],
  });
  assert.equal(applied.status, "succeeded");
  assert.equal(existsSync(targetFile), true);

  const readBack = await host.callTool("read", { path: "flow.drawio" });
  assert.equal(readBack.status, "succeeded");
  assert.equal(readBack.output.nodes[0].label, "开始");

  // 5. UI message bridge works without Electron, persists theme in ctx.dataDir, and rejects file-path RPCs
  const initState = await host.sendUiMessage({ from: { kind: "window", id: "canvas" }, method: "initial", params: {} });
  assert.equal(initState.theme, "firefly-dark");
  await host.sendUiMessage({ from: { kind: "window", id: "canvas" }, method: "setTheme", params: { theme: "pearl-white" } });
  const savedSettings = JSON.parse(await readFile(path.join(dataDir, "settings.json"), "utf8"));
  assert.equal(savedSettings.theme, "pearl-white");
  await assert.rejects(
    host.sendUiMessage({ from: { kind: "window", id: "canvas" }, method: "openDocument", params: { filePath: targetFile } }),
    /未知画布方法/,
  );
  await assert.rejects(
    host.sendUiMessage({ from: { kind: "window", id: "canvas" }, method: "saveDocument", params: { filePath: targetFile } }),
    /未知画布方法/,
  );
});
