import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTestHost, evaluateToolPermission } from "./vendor/plugin-sdk-testing.mjs";
import { definePlugin, PluginError, PLUGIN_ERROR_CODES } from "./vendor/plugin-sdk-index.mjs";

const require = createRequire(import.meta.url);
const Ajv = require("ajv");

export { createTestHost, evaluateToolPermission, definePlugin, PluginError, PLUGIN_ERROR_CODES };

export const LEGACY_MANIFEST_KEYS = [
  "apiVersion",
  "entry",
  "deps",
  "hooks",
  "settingsPanel",
  "settingsSection",
  "defaultEnabled",
];

const pluginsRoot = new URL("../plugins/", import.meta.url);

export function pluginPath(id, file) {
  return fileURLToPath(new URL(`${id}/${file}`, pluginsRoot));
}

export function readManifest(id) {
  const file = pluginPath(id, "firefly.plugin.json");
  assert.ok(existsSync(file), `${id} firefly.plugin.json must exist`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function manifestErrors(manifest) {
  const schema = JSON.parse(readFileSync(new URL("../schema/manifest.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv({ strict: false }).compile(schema);
  const errors = validate(manifest) ? [] : [...validate.errors];
  for (const legacyKey of LEGACY_MANIFEST_KEYS) {
    if (manifest && typeof manifest === "object" && Object.hasOwn(manifest, legacyKey)) {
      errors.push({ keyword: "legacy_manifest", message: `Legacy 0.x field "${legacyKey}" is not supported in 1.2.0` });
    }
  }
  return errors;
}

export async function loadPlugin(id) {
  const manifest = readManifest(id);
  const entry = pluginPath(id, manifest.main);
  assert.ok(existsSync(entry), `${id} entry ${manifest.main} must exist`);
  const mod = await import(pathToFileURL(entry).href);
  return mod.default ?? mod;
}

/**
 * Evaluates a pure-JS plugin entry in a fresh VM context without Node, network, filesystem, or timer globals,
 * then activates it inside a 1.2.0 createTestHost().
 */
export async function sandboxHost(id, hostOptions = {}) {
  const manifest = readManifest(id);
  const entry = pluginPath(id, manifest.main);
  assert.ok(existsSync(entry), `${id} entry ${manifest.main} must exist`);
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(entry, "utf8"), sandbox, { timeout: 1000 });
  const plugin = sandbox.module.exports?.default ?? sandbox.module.exports;
  const host = createTestHost({ manifest, mode: "work", level: "full", ...hostOptions });
  await host.activate(plugin);
  return { manifest, plugin, host };
}
