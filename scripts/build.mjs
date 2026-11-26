import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const JSZip = require("jszip");

export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const REPOSITORY = "Firefly-0423/firefly-plugins";
export const REGISTRY_URL = `https://raw.githubusercontent.com/${REPOSITORY}/main/registry.json`;
export const RELEASE_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;
export const CATALOG_PLUGIN_IDS = [
  "dev.firefly.text-stats",
  "dev.firefly.json-tools",
  "dev.firefly.timezone-tools",
  "dev.firefly.code-language",
  "dev.firefly.text-trim",
];
export const EXCLUDED_CATALOG_IDS = new Set(["dev.firefly.drawai"]);
export const PACKAGE_BASE_FILES = ["LICENSE", "README.md", "firefly.plugin.json"];
export const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+){2,}$/;
export const LEGACY_MANIFEST_KEYS = [
  "apiVersion",
  "entry",
  "deps",
  "hooks",
  "settingsPanel",
  "settingsSection",
  "defaultEnabled",
];
export const MAX_REGISTRY_BYTES = 1024 * 1024;
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_BYTES = MAX_PACKAGE_BYTES;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lf = (text) => text.replace(/\r\n/g, "\n");
const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

export function validateId(id) {
  if (typeof id !== "string" || id.length < 6 || id.length > 64 || !ID_PATTERN.test(id) || id !== id.trim()) {
    throw new Error("Invalid plugin id: use reverse-domain lowercase id (6-64 chars), e.g. dev.firefly.sample");
  }
  const segments = id.split(".");
  if (segments.some((part) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part))) {
    throw new Error("Invalid plugin id: reserved Windows device name segment");
  }
}

async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
    throw new Error(`Expected a regular file, not a link: ${file}`);
  }
  if (info.size > MAX_PACKAGE_BYTES) {
    throw new Error(`File exceeds the 50 MiB package limit: ${file}`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
}

function validateRelativeAssetPath(name, id) {
  if (
    typeof name !== "string"
    || name.length > 240
    || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name)
    || name.split("/").some(
      (part) =>
        part === "."
        || part === ".."
        || part.startsWith(".")
        || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new Error(`Unsafe asset path: ${id}/${name}`);
  }
  if (/\.(node|dll)$/i.test(name)) {
    throw new Error(`Online catalog rejects native binaries: ${id}/${name}`);
  }
}

async function scanDirectoryForNativeOrLinks(dir, id) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      throw new Error(`Symlink or junction not allowed inside plugin: ${id}/${entry.name}`);
    }
    if (info.isDirectory()) {
      await scanDirectoryForNativeOrLinks(full, id);
    } else if (info.isFile() && /\.(node|dll)$/i.test(entry.name)) {
      throw new Error(`Online catalog rejects native binaries: ${id}/${entry.name}`);
    }
  }
}

export async function readContract(root = REPO_ROOT) {
  const contract = JSON.parse(await regularFile(path.join(root, "schema/host-contract.json")));
  if (
    contract.schemaVersion !== 1
    || typeof contract.sdkVersion !== "string"
    || typeof contract.semverPattern !== "string"
    || typeof contract.idPattern !== "string"
  ) {
    throw new Error("Invalid schema/host-contract.json");
  }
  return { ...contract, semver: new RegExp(contract.semverPattern), idRegex: new RegExp(contract.idPattern) };
}

async function readPlugin(root, id, validate, contract) {
  const dir = path.join(root, "plugins", id);
  await scanDirectoryForNativeOrLinks(dir, id);

  const manifestText = lf(await regularFile(path.join(dir, "firefly.plugin.json")));
  const manifest = JSON.parse(manifestText);
  for (const legacyKey of LEGACY_MANIFEST_KEYS) {
    if (manifest && typeof manifest === "object" && Object.hasOwn(manifest, legacyKey)) {
      throw new Error(`Invalid ${id} manifest: 0.x field "${legacyKey}" is not supported in 1.2.0`);
    }
  }
  if (!validate(manifest)) {
    throw new Error(`Invalid ${id} manifest: ${JSON.stringify(validate.errors)}`);
  }
  if (
    manifest.id !== id
    || !contract.idRegex.test(manifest.id)
    || manifest.schemaVersion !== contract.schemaVersion
    || !isText(manifest.version, 100)
    || manifest.version !== manifest.version.trim()
    || !contract.semver.test(manifest.version)
    || !isText(manifest.sdk, 100)
    || !isText(manifest.name, 120)
    || !isText(manifest.description ?? "", 4000)
    || !isText(manifest.author?.name ?? "", 120)
    || !isText(manifest.license ?? "", 120)
    || manifest.native === true
  ) {
    throw new Error(
      `Invalid ${id} manifest: expected matching reverse-domain id, schemaVersion 1, valid SemVer, sdk, name, description, author, license, and native=false`,
    );
  }

  const catalog = JSON.parse(await regularFile(path.join(dir, "catalog.json")));
  const capabilities = catalog?.capabilities;
  if (
    !catalog
    || typeof catalog !== "object"
    || Array.isArray(catalog)
    || Object.keys(catalog).join() !== "capabilities"
    || !Array.isArray(capabilities)
    || capabilities.length < 1
    || capabilities.length > 20
    || !capabilities.every((line) => isText(line, 500))
  ) {
    throw new Error(`Invalid ${id} catalog.json: expected only capabilities, 1 to 20 nonempty lines of at most 500 characters`);
  }

  const files = new Map();
  for (const name of PACKAGE_BASE_FILES) {
    const text = name === "firefly.plugin.json" ? manifestText : lf(await regularFile(path.join(dir, name)));
    if (!text.trim()) throw new Error(`Empty required package file: ${id}/${name}`);
    files.set(name, Buffer.from(text, "utf8"));
  }

  const requiredAssets = [manifest.main];
  if (manifest.ui?.settings?.entry) requiredAssets.push(manifest.ui.settings.entry);
  for (const win of manifest.ui?.windows ?? []) {
    if (win.entry) requiredAssets.push(win.entry);
  }

  const extraAssets = [];
  const descriptor = path.join(dir, "package-files.json");
  try {
    const raw = await regularFile(descriptor);
    if (Buffer.byteLength(raw) > 65_536) throw new Error(`Oversized asset list: ${id}`);
    const extra = JSON.parse(raw);
    if (!extra || Object.keys(extra).join() !== "files" || !Array.isArray(extra.files) || extra.files.length > 128) {
      throw new Error(`Invalid asset list: ${id}`);
    }
    extraAssets.push(...extra.files);
  } catch (failure) {
    if (failure?.code !== "ENOENT" || failure?.path !== descriptor) throw failure;
  }

  const seen = new Set(PACKAGE_BASE_FILES.map((name) => name.toLowerCase()));
  const allAssets = [...new Set([...requiredAssets, ...extraAssets])].sort();
  for (const name of allAssets) {
    validateRelativeAssetPath(name, id);
    if (seen.has(name.toLowerCase()) || name.toLowerCase() === "package-files.json") {
      throw new Error(`Unsafe or duplicate asset: ${id}/${name}`);
    }
    seen.add(name.toLowerCase());
    let target = dir;
    for (const part of name.split("/")) {
      target = path.join(target, part);
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink()) throw new Error(`Linked asset rejected: ${id}/${name}`);
    }
    const text = lf(await regularFile(target));
    if (Buffer.byteLength(text) > 2 * 1024 * 1024 || text.includes("\0")) {
      throw new Error(`Asset must be bounded UTF-8 text: ${id}/${name}`);
    }
    files.set(name, Buffer.from(text, "utf8"));
  }

  // Also ensure duplicate case-variants were not provided in package-files.json itself.
  const extraLower = new Set();
  for (const name of extraAssets) {
    const lower = String(name).toLowerCase();
    if (extraLower.has(lower)) throw new Error(`Duplicate asset in package-files.json: ${id}/${name}`);
    extraLower.add(lower);
  }

  return { manifest, capabilities, files };
}

async function packPlugin(files) {
  const zip = new JSZip();
  for (const [name, bytes] of files) {
    zip.file(name, bytes, { date: new Date("1980-01-01T00:00:00.000Z"), unixPermissions: 0o100644, createFolders: false });
  }
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "STORE" });
}

export function validatePluginDirectory(directory) {
  validateId(directory.name);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(`Plugin must be a directory, not a symlink: ${directory.name}`);
  }
}

/** Validate and rebuild entirely in memory. Does not load or execute plugin entries. */
export async function prepareMarketplace({ root = REPO_ROOT, includeExcluded = false } = {}) {
  const pluginsDir = path.join(root, "plugins");
  const info = await lstat(pluginsDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("plugins must be a real directory");
  const directories = await readdir(pluginsDir, { withFileTypes: true });
  for (const directory of directories) validatePluginDirectory(directory);
  const ids = directories.map((dir) => dir.name);
  const activeIds = includeExcluded ? ids : ids.filter((id) => !EXCLUDED_CATALOG_IDS.has(id));
  if (!activeIds.length) throw new Error("No plugins found");
  const orderedIds = [...CATALOG_PLUGIN_IDS.filter((id) => activeIds.includes(id)), ...activeIds.filter((id) => !CATALOG_PLUGIN_IDS.includes(id)).sort()];
  const contract = await readContract(root);
  const schema = JSON.parse(await regularFile(path.join(root, "schema/manifest.schema.json")));
  const validate = new Ajv({ strict: false }).compile(schema);
  const plugins = [];

  for (const id of orderedIds) {
    const { manifest, capabilities, files } = await readPlugin(root, id, validate, contract);
    const tag = `${id}-${manifest.version}`;
    const zipName = `${tag}.ffplugin`;
    const zipBytes = await packPlugin(files);
    if (zipBytes.length > MAX_PACKAGE_BYTES) throw new Error(`${id} package exceeds the 50 MiB host limit`);
    const hash = sha256(zipBytes);
    const entry = {
      id,
      name: manifest.name,
      version: manifest.version,
      sdk: manifest.sdk,
      description: manifest.description,
      author: manifest.author.name,
      license: manifest.license,
      native: false,
      permissions: manifest.permissions ?? [],
      tools: manifest.tools ?? [],
      capabilities,
      package: `${RELEASE_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(zipName)}`,
      sha256: hash,
    };
    plugins.push({ id, version: manifest.version, tag, zipName, zipBytes, sha256: hash, entry });
  }

  const registry = { apiVersion: 2, plugins: plugins.map((plugin) => plugin.entry) };
  const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
  if (registryBytes.length > MAX_REGISTRY_BYTES) throw new Error("registry.json exceeds the 1 MiB host limit");
  return { registry, registryBytes, registryPath: path.join(root, "registry.json"), plugins };
}

export async function checkArtifacts(result, outDir) {
  let recorded;
  try {
    recorded = await readFile(result.registryPath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("registry.json is missing; run npm run build and commit it");
    throw error;
  }
  if (!recorded.equals(result.registryBytes)) {
    throw new Error("registry.json differs from rebuilt sources/hashes; bump changed published versions, run npm run build, and commit registry.json");
  }
  for (const plugin of result.plugins) {
    const zipPath = path.join(outDir, plugin.zipName);
    try {
      const info = await lstat(zipPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PACKAGE_BYTES) {
        throw new Error(`Invalid package file: ${zipPath}`);
      }
      if (sha256(await readFile(zipPath)) !== plugin.sha256) {
        throw new Error(`Package hash differs from registry.json: ${plugin.zipName}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function buildMarketplace({ root = REPO_ROOT, outDir = path.join(root, "dist"), check = false } = {}) {
  if (typeof outDir !== "string" || !outDir.trim() || outDir.includes("\0")) throw new Error("Invalid outDir");
  outDir = path.resolve(outDir);
  const result = await prepareMarketplace({ root });
  if (check) await checkArtifacts(result, outDir);
  else {
    await mkdir(outDir, { recursive: true });
    for (const plugin of result.plugins) await writeFile(path.join(outDir, plugin.zipName), plugin.zipBytes);
    await writeFile(result.registryPath, result.registryBytes);
  }
  return { ...result, outDir };
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--check") {
      if (options.check) throw new Error("Duplicate argument: --check");
      options.check = true;
    } else if (arg === "--out") {
      if (options.outDir !== undefined) throw new Error("Duplicate argument: --out");
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--out requires a directory");
      options.outDir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await buildMarketplace(options);
    console.log(`[marketplace] ${options.check ? "Checked" : "Prepared"} ${result.registryPath}`);
    for (const plugin of result.plugins) {
      console.log(`[marketplace] ${plugin.zipName} (SHA-256 ${plugin.sha256})`);
    }
  } catch (error) {
    console.error(`[marketplace] ${error.message}`);
    process.exitCode = 1;
  }
}
