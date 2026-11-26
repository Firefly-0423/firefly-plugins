import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { cp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import {
  buildMarketplace,
  CATALOG_PLUGIN_IDS,
  PACKAGE_BASE_FILES,
  prepareMarketplace,
  RELEASE_PREFIX,
  sha256,
  validatePluginDirectory,
} from "../scripts/build.mjs";
import { newPlugin } from "../scripts/new-plugin.mjs";
import { json, sourceFixture } from "./build-fixture.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const Ajv = require("ajv");
const lf = (text) => text.replace(/\r\n/g, "\n");

test("catalog has the exact ordered 1.2.0 wire shape and checksummed .ffplugin packages", async t => {
  const root = await sourceFixture(t);
  const result = await buildMarketplace({ root });
  assert.equal(result.registryPath, path.join(root, "registry.json"));
  assert.deepEqual(Object.keys(result.registry), ["apiVersion", "plugins"]);
  assert.equal(result.registry.apiVersion, 2);
  assert.deepEqual(result.registry.plugins.map((p) => p.id), CATALOG_PLUGIN_IDS);
  assert.deepEqual((await readdir(result.outDir)).sort(), result.plugins.map((p) => p.zipName).sort());

  const validate = new Ajv({ strict: false }).compile(await json(path.join(root, "schema/manifest.schema.json")));
  for (const plugin of result.plugins) {
    const { entry } = plugin;
    assert.deepEqual(
      Object.keys(entry),
      ["id", "name", "version", "sdk", "description", "author", "license", "native", "permissions", "tools", "capabilities", "package", "sha256"],
    );
    assert.equal(entry.native, false);
    assert.equal(entry.package, `${RELEASE_PREFIX}${encodeURIComponent(plugin.tag)}/${encodeURIComponent(plugin.zipName)}`);
    assert.deepEqual(entry.capabilities, (await json(path.join(root, "plugins", plugin.id, "catalog.json"))).capabilities);

    const bytes = await readFile(path.join(result.outDir, plugin.zipName));
    assert.equal(sha256(bytes), entry.sha256);
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("firefly.plugin.json").async("string"));
    assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
    assert.deepEqual(Object.keys(zip.files).sort(), [...PACKAGE_BASE_FILES, manifest.main].sort());
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.native, false);
    for (const key of ["id", "name", "version", "sdk", "description", "license"]) {
      assert.equal(entry[key], manifest[key]);
    }
    assert.equal(entry.author, manifest.author.name);
    let offset = 0;
    for (const name of Object.keys(zip.files)) {
      assert.equal(await zip.file(name).async("string"), lf(await readFile(path.join(root, "plugins", plugin.id, name), "utf8")));
      assert.equal(zip.files[name].dir, false);
      assert.equal(zip.files[name].date.toISOString(), "1980-01-01T00:00:00.000Z");
      assert.equal(zip.files[name].unixPermissions, 0o100644);
      assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
      assert.equal(bytes.readUInt16LE(offset + 8), 0, "ZIP uses STORE");
      offset += 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28) + bytes.readUInt32LE(offset + 18);
    }
  }
  assert.equal(new Set(result.plugins.map((p) => p.sha256)).size, CATALOG_PLUGIN_IDS.length);
});

test("every package matches the committed registry, so published versions never change bytes", async () => {
  const result = await prepareMarketplace();
  const committed = JSON.parse(await readFile(new URL("../registry.json", import.meta.url), "utf8"));
  assert.equal(committed.apiVersion, 2);
  assert.deepEqual(
    committed.plugins.map((e) => e.id),
    [...CATALOG_PLUGIN_IDS, "dev.firefly.study-cards"],
  );
  assert.equal(committed.plugins.some((e) => e.id === "dev.firefly.drawai"), false);
  for (const plugin of result.plugins) {
    const entry = committed.plugins.find((e) => e.id === plugin.id);
    assert.ok(entry, `${plugin.id} is listed in registry.json`);
    assert.equal(entry.version, plugin.version, `${plugin.id} version`);
    assert.equal(entry.sha256, plugin.sha256, `${plugin.id} ${plugin.version} bytes`);
  }
});

test("builds are identical across output paths, CWD, time zones and CRLF source checkouts", async t => {
  const root = await sourceFixture(t);
  const first = await buildMarketplace({ root, outDir: path.join(root, "first") });
  const firstRegistry = await readFile(first.registryPath);
  for (const id of CATALOG_PLUGIN_IDS) {
    for (const name of [...PACKAGE_BASE_FILES, "index.cjs", "catalog.json"]) {
      const file = path.join(root, "plugins", id, name);
      await writeFile(file, lf(await readFile(file, "utf8")).replace(/\n/g, "\r\n"));
    }
  }
  const outDir = path.join(root, "second");
  const cli = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), "--out", outDir], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TZ: "Pacific/Honolulu" },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(await readFile(first.registryPath), firstRegistry);
  for (const p of first.plugins) assert.deepEqual(await readFile(path.join(outDir, p.zipName)), p.zipBytes);
  assert.equal(existsSync(path.join(outDir, "registry.json")), false, "registry always belongs at the repository root");
});

test("check works with no dist and makes no writes; detects changed source, registry and package bytes", async t => {
  const root = await sourceFixture(t);
  const result = await buildMarketplace({ root });
  const zipPath = path.join(result.outDir, result.plugins[0].zipName);
  await writeFile(zipPath, "tampered");
  await assert.rejects(buildMarketplace({ root, check: true }), /Package hash differs/);
  assert.equal(await readFile(zipPath, "utf8"), "tampered");
  await rm(result.outDir, { recursive: true });
  await buildMarketplace({ root, check: true });
  assert.equal(existsSync(result.outDir), false);
  const registry = await readFile(result.registryPath);
  await writeFile(result.registryPath, registry.toString().replace('"apiVersion": 2', '"apiVersion": 99'));
  await assert.rejects(buildMarketplace({ root, check: true }), /registry.json differs/);
  await writeFile(result.registryPath, registry);
  const entryPath = path.join(root, "plugins/dev.firefly.json-tools/index.cjs");
  await writeFile(entryPath, `${await readFile(entryPath, "utf8")}\n// changed\n`);
  await assert.rejects(buildMarketplace({ root, check: true }), /registry.json differs/);
  assert.deepEqual(await readFile(result.registryPath), registry);
  assert.equal(existsSync(result.outDir), false);
});

test("check rejects a missing registry instead of generating a replacement", async t => {
  const root = await sourceFixture(t);
  await assert.rejects(buildMarketplace({ root, check: true }), /registry.json is missing/);
  assert.equal(existsSync(path.join(root, "registry.json")), false);
  assert.equal(existsSync(path.join(root, "dist")), false);
});

test("new plugins are discovered after the catalog order and sorted by id", async t => {
  const root = await sourceFixture(t);
  await newPlugin("dev.firefly.z-last", { root });
  await newPlugin("dev.firefly.a-first", { root });
  const result = await buildMarketplace({ root });
  assert.deepEqual(result.plugins.map((p) => p.id), [...CATALOG_PLUGIN_IDS, "dev.firefly.a-first", "dev.firefly.z-last"]);
});

test("version changes determine names and URLs, including valid prerelease/build metadata", async t => {
  const root = await sourceFixture(t);
  const file = path.join(root, "plugins/dev.firefly.json-tools/firefly.plugin.json");
  const manifest = await json(file);
  manifest.version = "2.1.0-beta.1+Build.2";
  await writeFile(file, JSON.stringify(manifest));
  const p = (await prepareMarketplace({ root })).plugins.find((item) => item.id === "dev.firefly.json-tools");
  assert.equal(p.zipName, "dev.firefly.json-tools-2.1.0-beta.1+Build.2.ffplugin");
  assert.equal(
    p.entry.package,
    `${RELEASE_PREFIX}dev.firefly.json-tools-2.1.0-beta.1%2BBuild.2/dev.firefly.json-tools-2.1.0-beta.1%2BBuild.2.ffplugin`,
  );
  for (const version of ["01.2.3", "1.2", "1.2.3 ", "1.2.3\n", "../evil", "1.0.0-beta.01", `1.0.0+${"a".repeat(100)}`]) {
    await writeFile(file, JSON.stringify({ ...manifest, version }));
    await assert.rejects(buildMarketplace({ root }), /Invalid dev.firefly.json-tools manifest/);
  }
  assert.equal(existsSync(path.join(root, "dist")), false);
});

test("manifest/schema/native/legacy failures and malformed capabilities fail before any output", async t => {
  const root = await sourceFixture(t);
  const file = path.join(root, "plugins/dev.firefly.text-trim/firefly.plugin.json");
  const catalogFile = path.join(root, "plugins/dev.firefly.text-trim/catalog.json");
  const manifest = await json(file);
  const invalid = [
    { ...manifest, id: "dev.firefly.other" },
    { ...manifest, native: true },
    { ...manifest, apiVersion: 1 },
    { ...manifest, defaultEnabled: false },
    { ...manifest, schemaVersion: 2 },
    { ...manifest, main: "index.txt" },
    { ...manifest, tools: [{ name: "cap", title: "cap", risk: ["safe"], modes: ["work"] }] },
    { ...manifest, extra: true },
    { ...manifest, name: " " },
    { ...manifest, name: "x".repeat(121) },
    { ...manifest, description: "x".repeat(4001) },
    { ...manifest, author: { name: "" } },
  ];
  for (const bad of invalid) {
    await writeFile(file, JSON.stringify(bad));
    await assert.rejects(buildMarketplace({ root }), /Invalid dev.firefly.text-trim manifest/);
  }
  await writeFile(file, JSON.stringify(manifest));
  await writeFile(path.join(root, "plugins/dev.firefly.text-trim/addon.node"), "binary");
  await assert.rejects(buildMarketplace({ root }), /native binaries/);
  await rm(path.join(root, "plugins/dev.firefly.text-trim/addon.node"));

  for (const bad of [{}, { capabilities: [] }, { capabilities: [""] }, { capabilities: [1] },
    { capabilities: Array(21).fill("x") }, { capabilities: ["x".repeat(501)] }, { capabilities: ["x"], extra: 1 }, [], null]) {
    await writeFile(catalogFile, JSON.stringify(bad));
    await assert.rejects(buildMarketplace({ root }), /Invalid dev.firefly.text-trim catalog.json/);
  }
  assert.equal(existsSync(path.join(root, "dist")), false);
  assert.equal(existsSync(path.join(root, "registry.json")), false);
});

test("missing required files and mismatched directory ids are rejected", async t => {
  const root = await sourceFixture(t);
  const license = path.join(root, "plugins/dev.firefly.text-trim/LICENSE");
  await rename(license, `${license}.saved`);
  await assert.rejects(buildMarketplace({ root }), /ENOENT/);
  await rename(`${license}.saved`, license);
  await rename(path.join(root, "plugins/dev.firefly.text-trim"), path.join(root, "plugins/dev.firefly.renamed"));
  await assert.rejects(buildMarketplace({ root }), /Invalid dev.firefly.renamed manifest/);
  assert.equal(existsSync(path.join(root, "dist")), false);
});

test("directory-entry validation refuses symlinks, non-reverse-domain ids, and files", () => {
  for (const [directory, link] of [[true, true], [false, true], [false, false]]) {
    assert.throws(() => validatePluginDirectory({ name: "dev.firefly.linked", isDirectory: () => directory, isSymbolicLink: () => link }), /not a symlink/);
  }
  assert.throws(() => validatePluginDirectory({ name: "single-segment", isDirectory: () => true, isSymbolicLink: () => false }), /Invalid plugin id/);
  assert.doesNotThrow(() => validatePluginDirectory({ name: "dev.firefly.valid", isDirectory: () => true, isSymbolicLink: () => false }));
});

if (process.platform !== "win32") {
  test("real plugin-directory symlinks cannot include outside source", async t => {
    const root = await sourceFixture(t);
    const target = path.join(root, "held-plugin");
    await cp(path.join(root, "plugins/dev.firefly.text-trim"), target, { recursive: true });
    symlinkSync(target, path.join(root, "plugins/dev.firefly.linked"), "dir");
    await assert.rejects(buildMarketplace({ root }), /not a symlink/);
  });
}

test("CLI rejects unknown, duplicate, missing options before producing artifacts", async t => {
  const root = await sourceFixture(t);
  for (const args of [["--unknown"], ["--out"], ["--out", "--check"], ["--check", "--check"], ["--out", root, "--out", root]]) {
    const cli = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), ...args], { cwd: root, encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Unknown|Duplicate|requires/);
    assert.doesNotMatch(cli.stdout, /Prepared|Checked/);
  }
  assert.equal(existsSync(path.join(root, "registry.json")), false);
});
