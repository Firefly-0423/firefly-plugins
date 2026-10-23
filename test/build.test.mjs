// Ported from the host's scripts/plugin-marketplace/build.test.mjs for the standalone layout.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { buildMarketplace, CATALOG_PLUGIN_IDS, PACKAGE_FILES, prepareMarketplace, RELEASE_PREFIX, sha256, validatePluginDirectory } from "../scripts/build.mjs";
import { newPlugin } from "../scripts/new-plugin.mjs";
import { json, sourceFixture } from "./build-fixture.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const Ajv = require("ajv");
const lf = text => text.replace(/\r\n/g, "\n");

test("catalog has the exact ordered wire shape and checksummed disabled API v1 ZIPs", async t => {
  const root = await sourceFixture(t);
  const result = await buildMarketplace({ root });
  assert.equal(result.registryPath, path.join(root, "registry.json"));
  assert.deepEqual(Object.keys(result.registry), ["apiVersion", "plugins"]);
  assert.equal(result.registry.apiVersion, 1);
  assert.deepEqual(result.registry.plugins.map(p => p.id), CATALOG_PLUGIN_IDS);
  assert.deepEqual((await readdir(result.outDir)).sort(), result.plugins.map(p => p.zipName).sort());
  const validate = new Ajv({ strict: false }).compile(await json(path.join(root, "schema/manifest.schema.json")));
  for (const plugin of result.plugins) {
    const { entry } = plugin;
    assert.deepEqual(Object.keys(entry), ["id", "name", "version", "description", "author", "downloads", "pluginApiVersion", "capabilities", "zip", "sha256"]);
    assert.equal(entry.author, "Firefly-0423");
    assert.equal(entry.downloads, 0);
    assert.equal(entry.pluginApiVersion, 1);
    assert.equal(entry.zip, `${RELEASE_PREFIX}${encodeURIComponent(plugin.tag)}/${encodeURIComponent(plugin.zipName)}`);
    assert.deepEqual(entry.capabilities, (await json(path.join(root, "plugins", plugin.id, "catalog.json"))).capabilities);
    const bytes = await readFile(path.join(result.outDir, plugin.zipName));
    assert.equal(sha256(bytes), entry.sha256);
    const zip = await JSZip.loadAsync(bytes);
    assert.deepEqual(Object.keys(zip.files), PACKAGE_FILES);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
    for (const key of ["id", "name", "version", "description"]) assert.equal(entry[key], manifest[key]);
    assert.match(manifest.author, /Firefly-0423/);
    assert.equal(manifest.defaultEnabled, false);
    assert.equal(manifest.entry, "index.cjs");
    assert.deepEqual(manifest.deps ?? [], []);
    let offset = 0;
    for (const name of PACKAGE_FILES) {
      assert.equal(await zip.file(name).async("string"), lf(await readFile(path.join(root, "plugins", plugin.id, name), "utf8")));
      assert.equal(zip.files[name].dir, false);
      assert.equal(zip.files[name].date.toISOString(), "1980-01-01T00:00:00.000Z");
      assert.equal(zip.files[name].unixPermissions, 0o100644);
      assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
      assert.equal(bytes.readUInt16LE(offset + 8), 0, "ZIP uses STORE");
      offset += 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28) + bytes.readUInt32LE(offset + 18);
    }
  }
  assert.equal(new Set(result.plugins.map(p => p.sha256)).size, CATALOG_PLUGIN_IDS.length);
});

test("every package matches the committed registry, so published versions never change bytes", async () => {
  const result = await prepareMarketplace();
  const committed = JSON.parse(await readFile(new URL("../registry.json", import.meta.url), "utf8"));
  for (const plugin of result.plugins) {
    const entry = committed.plugins.find(e => e.id === plugin.id);
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
    for (const name of [...PACKAGE_FILES, "catalog.json"]) {
      const file = path.join(root, "plugins", id, name);
      await writeFile(file, lf(await readFile(file, "utf8")).replace(/\n/g, "\r\n"));
    }
  }
  const outDir = path.join(root, "second");
  const cli = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), "--out", outDir], {
    cwd: root, encoding: "utf8", env: { ...process.env, TZ: "Pacific/Honolulu" },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(await readFile(first.registryPath), firstRegistry);
  for (const p of first.plugins) assert.deepEqual(await readFile(path.join(outDir, p.zipName)), p.zipBytes);
  assert.equal(existsSync(path.join(outDir, "registry.json")), false, "registry always belongs at the repository root");
});

test("check works with no dist and makes no writes; detects changed source, registry and ZIP bytes", async t => {
  const root = await sourceFixture(t);
  const result = await buildMarketplace({ root });
  const zipPath = path.join(result.outDir, result.plugins[0].zipName);
  await writeFile(zipPath, "tampered");
  await assert.rejects(buildMarketplace({ root, check: true }), /ZIP hash differs/);
  assert.equal(await readFile(zipPath, "utf8"), "tampered");
  await rm(result.outDir, { recursive: true }); // Known fixture-owned dist directory.
  await buildMarketplace({ root, check: true });
  assert.equal(existsSync(result.outDir), false);
  const registry = await readFile(result.registryPath);
  await writeFile(result.registryPath, registry.toString().replace('"downloads": 0', '"downloads": 1'));
  await assert.rejects(buildMarketplace({ root, check: true }), /registry.json differs/);
  await writeFile(result.registryPath, registry);
  const entryPath = path.join(root, "plugins/json-tools/index.cjs");
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

test("new plugins are discovered after the host order and sorted by id", async t => {
  const root = await sourceFixture(t);
  await newPlugin("z-last", { root });
  await newPlugin("a-first", { root });
  const result = await buildMarketplace({ root });
  assert.deepEqual(result.plugins.map(p => p.id), [...CATALOG_PLUGIN_IDS, "a-first", "z-last"]);
});

test("version changes determine names and URLs, including valid prerelease/build metadata", async t => {
  const root = await sourceFixture(t);
  const file = path.join(root, "plugins/json-tools/manifest.json");
  const manifest = await json(file);
  manifest.version = "1.2.3-beta.1+Build.2";
  await writeFile(file, JSON.stringify(manifest));
  const p = (await prepareMarketplace({ root })).plugins.find(p => p.id === "json-tools");
  assert.equal(p.zipName, "json-tools-1.2.3-beta.1+Build.2.zip");
  assert.equal(p.entry.zip, `${RELEASE_PREFIX}json-tools-1.2.3-beta.1%2BBuild.2/json-tools-1.2.3-beta.1%2BBuild.2.zip`);
  for (const version of ["01.2.3", "1.2", "1.2.3 ", "1.2.3\n", "../evil", "1.0.0-beta.01", "1.0.0+" + "a".repeat(100)]) {
    await writeFile(file, JSON.stringify({ ...manifest, version }));
    await assert.rejects(buildMarketplace({ root }), /Invalid json-tools manifest/);
  }
  assert.equal(existsSync(path.join(root, "dist")), false);
});

test("manifest/schema/host-limit failures and malformed capabilities fail before any output", async t => {
  const root = await sourceFixture(t);
  const file = path.join(root, "plugins/text-trim/manifest.json");
  const catalogFile = path.join(root, "plugins/text-trim/catalog.json");
  const manifest = await json(file);
  const missingDefault = { ...manifest };
  delete missingDefault.defaultEnabled;
  const invalid = [missingDefault, { ...manifest, id: "other-id" }, { ...manifest, defaultEnabled: true },
    { ...manifest, deps: ["llm"] }, { ...manifest, entry: "main.cjs" }, { ...manifest, apiVersion: 2 },
    { ...manifest, extra: true }, { ...manifest, name: " " }, { ...manifest, name: "x".repeat(121) },
    { ...manifest, description: "x".repeat(4001) }, { ...manifest, author: "" }, { ...manifest, deps: "llm" }];
  for (const bad of invalid) {
    await writeFile(file, JSON.stringify(bad));
    await assert.rejects(buildMarketplace({ root }), /Invalid text-trim manifest/);
  }
  await writeFile(file, JSON.stringify(manifest));
  for (const bad of [{}, { capabilities: [] }, { capabilities: [""] }, { capabilities: [1] },
    { capabilities: Array(21).fill("x") }, { capabilities: ["x".repeat(501)] }, { capabilities: ["x"], extra: 1 }, [], null]) {
    await writeFile(catalogFile, JSON.stringify(bad));
    await assert.rejects(buildMarketplace({ root }), /Invalid text-trim catalog.json/);
  }
  assert.equal(existsSync(path.join(root, "dist")), false);
  assert.equal(existsSync(path.join(root, "registry.json")), false);
});

test("missing required files and mismatched directory ids are rejected", async t => {
  const root = await sourceFixture(t);
  const license = path.join(root, "plugins/text-trim/LICENSE");
  await rename(license, `${license}.saved`);
  await assert.rejects(buildMarketplace({ root }), /ENOENT/);
  await rename(`${license}.saved`, license);
  await rename(path.join(root, "plugins/text-trim"), path.join(root, "plugins/renamed"));
  await assert.rejects(buildMarketplace({ root }), /Invalid renamed manifest/);
  assert.equal(existsSync(path.join(root, "dist")), false);
});

// Windows sandbox cannot create junctions; validate the same Dirent boundary on every OS.
test("directory-entry validation refuses symlinks and files, including links presented as directories", () => {
  for (const [directory, link] of [[true, true], [false, true], [false, false]]) {
    assert.throws(() => validatePluginDirectory({ name: "linked", isDirectory: () => directory, isSymbolicLink: () => link }), /not a symlink/);
  }
  assert.doesNotThrow(() => validatePluginDirectory({ name: "valid", isDirectory: () => true, isSymbolicLink: () => false }));
});

// Required on Ubuntu CI. Native link creation is a separate integration layer.
if (process.platform !== "win32") test("real plugin-directory symlinks cannot include outside source", async t => {
  const root = await sourceFixture(t);
  const target = path.join(root, "held-plugin");
  await cp(path.join(root, "plugins/text-trim"), target, { recursive: true });
  symlinkSync(target, path.join(root, "plugins/linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildMarketplace({ root }), /not a symlink/);
});

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
