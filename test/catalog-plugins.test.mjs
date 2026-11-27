// Contract shared by every offline computation plugin in the catalog.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_MANIFEST_KEYS,
  createTestHost,
  manifestErrors,
  pluginPath,
  readManifest,
  sandboxHost,
} from "./plugin-fixture.mjs";

const ported = {
  "dev.firefly.json-tools": {
    tools: ["validate", "compare"],
    sampleCall: ["validate", { text: "{}" }],
  },
  "dev.firefly.timezone-tools": {
    tools: ["canonicalize", "convert"],
    sampleCall: ["canonicalize", { zone: "UTC" }],
  },
  "dev.firefly.code-language": {
    tools: ["detect"],
    sampleCall: ["detect", { paths: ["src/app.ts"] }],
  },
  "dev.firefly.text-trim": {
    tools: ["cap"],
    sampleCall: ["cap", { text: "hello", maxBytes: 5 }],
  },
};

const DEEPSEEK_NOTICE = "Copyright (c) 2026 DeepSeek";
const FORBIDDEN_SOURCE =
  /\b(?:require|process|Buffer|TextEncoder|TextDecoder|fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|setImmediate|globalThis|eval|Function|import)\b\s*[(.[]?/;

for (const [id, spec] of Object.entries(ported)) {
  test(`${id}: firefly.plugin.json matches 1.2.0 manifest schema with no 0.x fields`, () => {
    assert.equal(existsSync(pluginPath(id, "manifest.json")), false, "legacy manifest.json must be removed");
    const manifest = readManifest(id);
    assert.deepEqual(manifestErrors(manifest), []);
    for (const key of LEGACY_MANIFEST_KEYS) {
      assert.equal(Object.hasOwn(manifest, key), false, `legacy key ${key} must not exist`);
    }
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.id, id);
    assert.equal(manifest.version, "2.0.1");
    assert.match(
      manifest.version,
      new RegExp(JSON.parse(readFileSync(new URL("../schema/host-contract.json", import.meta.url), "utf8")).semverPattern),
    );
    assert.equal(manifest.sdk, "^1.2.0");
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.main, "index.cjs");
    assert.equal(manifest.native, false);
    assert.deepEqual(manifest.permissions, []);
    assert.equal(typeof manifest.author, "object");
    assert.equal(manifest.author.name, "Firefly-0423");
    assert.equal(manifest.author.email, undefined);

    assert.deepEqual(manifest.tools.map(t => t.name).sort(), [...spec.tools].sort());
    for (const tool of manifest.tools) {
      assert.ok(typeof tool.title === "string" && tool.title.trim().length > 0);
      assert.deepEqual(tool.risk, ["fs-read"]);
      assert.deepEqual(tool.modes, ["work", "code"]);
    }
  });

  test(`${id}: ships a 1.2.0 README, valid catalog.json, and LICENSE keeping DeepSeek MIT notice`, () => {
    const license = readFileSync(pluginPath(id, "LICENSE"), "utf8");
    assert.match(license, /^MIT License/);
    assert.ok(license.includes(DEEPSEEK_NOTICE), "DeepSeek copyright notice must be retained");
    assert.ok(license.includes("https://github.com/deepseek-ai/deepseek-harness"));
    assert.ok(license.includes("Copyright (c) 2026 Firefly-0423"));
    assert.match(license, /Permission is hereby granted, free of charge/);
    assert.equal((license.match(/Copyright \(c\)/g) ?? []).length, 2, "our notice plus the DeepSeek notice");

    assert.ok(existsSync(pluginPath(id, "README.md")));
    const readme = readFileSync(pluginPath(id, "README.md"), "utf8");
    assert.ok(readme.includes("firefly.plugin.json"));
    assert.ok(readme.includes(id));
    assert.ok(readme.includes("work") && readme.includes("code"));

    assert.ok(existsSync(pluginPath(id, "catalog.json")));
    const catalog = JSON.parse(readFileSync(pluginPath(id, "catalog.json"), "utf8"));
    assert.ok(Array.isArray(catalog.capabilities) && catalog.capabilities.length > 0);
    assert.ok(catalog.capabilities.every(line => typeof line === "string" && line.trim()));
  });

  test(`${id}: activates in sandboxHost and registers declared tools with clean schemas`, async () => {
    const { host } = await sandboxHost(id);
    const registrations = host.calls.filter(c => c.method === "tools.register").map(c => c.params);
    assert.deepEqual(registrations.map(r => r.name).sort(), [...spec.tools].sort());
    for (const reg of registrations) {
      assert.ok(typeof reg.description === "string" && reg.description.trim().length > 0);
      assert.equal(reg.parameters.type, "object");
      assert.ok(Array.isArray(reg.parameters.required) && reg.parameters.required.length > 0);
      for (const req of reg.parameters.required) {
        assert.ok(req in reg.parameters.properties);
      }
      assert.equal(reg.parameters.additionalProperties, false);
    }
    const [toolName, args] = spec.sampleCall;
    const res = await host.callTool(toolName, args);
    assert.equal(res.status, "succeeded");
    assert.equal(typeof res.summary, "string");
    assert.ok(res.summary.length > 0);
    await host.deactivate("disabled");
  });

  test(`${id}: source uses no Node, network, fs, timer or dynamic-code facilities`, () => {
    const source = readFileSync(pluginPath(id, "index.cjs"), "utf8")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    assert.doesNotMatch(source, FORBIDDEN_SOURCE);
  });

  test(`${id}: enforces chat mode rejection, approval rejection, abort signal, and clean deactivate/reactivate`, async () => {
    const [toolName, args] = spec.sampleCall;
    const { manifest, plugin, host } = await sandboxHost(id, {
      mode: "work",
      level: "per-action",
      approvalDecision: "reject",
    });

    // Rejected under per-action approval
    const rejected = await host.callTool(toolName, args);
    assert.equal(rejected.status, "not_executed");
    assert.match(rejected.reason, /ERR_REJECTED/);

    // Rejected in chat mode
    host.setMode("chat");
    const chatBlocked = await host.callTool(toolName, args);
    assert.equal(chatBlocked.status, "not_executed");
    assert.match(chatBlocked.reason, /unavailable in chat mode/);

    // Cancelled before execution via signal
    const ac = new AbortController();
    ac.abort("cancelled");
    const hostFull = createTestHost({ manifest, mode: "code", level: "full" });
    await hostFull.activate(plugin);
    const cancelled = await hostFull.callTool(toolName, args, { signal: ac.signal });
    assert.equal(cancelled.status, "not_executed");

    // Deactivate disposes all tools cleanly, is idempotent, and allows re-activation
    await hostFull.deactivate("disabled");
    const unregs = hostFull.calls.filter(c => c.method === "tools.unregister").map(c => c.params.name);
    assert.deepEqual(unregs.sort(), [...spec.tools].sort());
    await hostFull.deactivate("disabled");
    const afterDeactivate = await hostFull.callTool(toolName, args);
    assert.equal(afterDeactivate.status, "not_executed");
    assert.match(afterDeactivate.reason, /deactivated/);

    await hostFull.activate(plugin);
    const afterReactivate = await hostFull.callTool(toolName, args);
    assert.equal(afterReactivate.status, "succeeded");
    await hostFull.deactivate("disabled");
  });
}
