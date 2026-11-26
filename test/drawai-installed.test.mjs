import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { prepareMarketplace } from "../scripts/build.mjs";

test("extracted DrawAI runs its actual 1.2.0 entry and worker outside repository dependencies", async t => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "firefly-drawai-installed-"));
  t.after(async () => {
    const actual = await realpath(root);
    assert.equal(path.dirname(actual), parent);
    assert.equal(actual.startsWith(parent + path.sep), true);
    await rm(actual, { recursive: true, force: true });
  });

  const plugin = (await prepareMarketplace({ includeExcluded: true })).plugins.find((x) => x.id === "dev.firefly.drawai");
  assert.ok(plugin, "dev.firefly.drawai package missing");
  const Zip = createRequire(import.meta.url)("jszip");
  const zip = await Zip.loadAsync(plugin.zipBytes);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const file = path.resolve(root, name);
    assert.ok(file.startsWith(root + path.sep));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await entry.async("nodebuffer"));
  }

  const script = [
    "const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs/promises');",
    "(async () => {",
    "  const root = process.cwd(), entry = require('./index.cjs'), tools = new Map(), uiHandlers = [];",
    "  const controller = new AbortController();",
    "  await fs.mkdir('workspace');",
    "  const ctx = {",
    "    id: 'dev.firefly.drawai', version: '0.2.0', dataDir: path.join(root, 'private'), signal: controller.signal,",
    "    has: (p) => p === 'workspace.read' || p === 'ui.windows',",
    "    tools: { register: (t) => { tools.set(t.name, t); return { dispose: () => tools.delete(t.name) }; } },",
    "    workspace: { current: async () => ({ sessionId: 's1', mode: 'work', root: path.join(root, 'workspace'), name: 'ws' }) },",
    "    ui: { onMessage: (fn) => { uiHandlers.push(fn); return { dispose: () => {} }; } },",
    "  };",
    "  await entry.activate(ctx);",
    "  assert.deepEqual([...tools.keys()], ['read', 'apply']);",
    "  const call = { callId: 'c1', sessionId: 's1', mode: 'work', caller: 'firefly', signal: new AbortController().signal, progress() {} };",
    "  let res = await tools.get('apply').execute({ path: 'chart.drawio', create: true, ops: [{ op: 'addNode', id: 'a', label: '独立实包' }] }, call);",
    "  assert.equal(res.status, 'succeeded', JSON.stringify(res));",
    "  res = await tools.get('read').execute({ path: 'chart.drawio' }, call);",
    "  assert.equal(res.status, 'succeeded');",
    "  assert.equal(res.output.nodes[0].label, '独立实包');",
    "  const init = await uiHandlers[0]({ from: { kind: 'window', id: 'canvas' }, method: 'initial', params: {} });",
    "  assert.equal(init.theme, 'firefly-dark');",
    "  await entry.deactivate('disabled');",
    "  assert.equal(tools.size, 0);",
    "  console.log('EXTRACTED_DRAWAI_OK');",
    "})().catch((e) => { console.error(e); process.exitCode = 1; });",
  ].join("\n");

  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /EXTRACTED_DRAWAI_OK/);
});
