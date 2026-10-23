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
export const CATALOG_PLUGIN_IDS = ["text-stats", "json-tools", "timezone-tools", "code-language", "text-trim"];
export const PACKAGE_FILES = ["LICENSE", "README.md", "index.cjs", "manifest.json"];
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Mirrored from src/main/plugin-marketplace.ts, not imported from the host.
export const MAX_REGISTRY_BYTES = 1024 * 1024;
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const lf = text => text.replace(/\r\n/g, "\n");
const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

export function validateId(id) {
  if (typeof id !== "string" || id.length > 100 || !ID_PATTERN.test(id) || id !== id.trim()
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) {
    throw new Error("Invalid plugin id: use at most 100 lowercase letters/digits separated by single hyphens; no Windows device names");
  }
}

async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file, not a symlink: ${file}`);
  if (info.size > MAX_ZIP_BYTES) throw new Error(`File exceeds the 50 MiB package limit: ${file}`);
  return readFile(file, "utf8");
}

export async function readContract(root = REPO_ROOT) {
  const contract = JSON.parse(await regularFile(path.join(root, "schema/host-contract.json")));
  if (!Number.isSafeInteger(contract.pluginApiVersion) || contract.pluginApiVersion < 1
    || typeof contract.semverPattern !== "string") throw new Error("Invalid schema/host-contract.json");
  return { ...contract, semver: new RegExp(contract.semverPattern) };
}

async function readPlugin(root, id, validate, contract) {
  const dir = path.join(root, "plugins", id);
  const manifestText = lf(await regularFile(path.join(dir, "manifest.json")));
  const manifest = JSON.parse(manifestText);
  if (!validate(manifest)) throw new Error(`Invalid ${id} manifest: ${JSON.stringify(validate.errors)}`);
  if (manifest.id !== id || !isText(manifest.version, 100) || manifest.version !== manifest.version.trim()
    || !contract.semver.test(manifest.version) || manifest.apiVersion !== contract.pluginApiVersion
    || manifest.entry !== "index.cjs" || manifest.defaultEnabled !== false || (manifest.deps ?? []).length
    || !isText(manifest.name, 120) || !isText(manifest.description, 4000) || !isText(manifest.author, 120)) {
    throw new Error(`Invalid ${id} manifest: expected matching id, bounded text, valid SemVer, current plugin API, index.cjs, defaultEnabled false and no deps`);
  }
  const catalog = JSON.parse(await regularFile(path.join(dir, "catalog.json")));
  const capabilities = catalog?.capabilities;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)
    || Object.keys(catalog).join() !== "capabilities" || !Array.isArray(capabilities)
    || capabilities.length < 1 || capabilities.length > 20 || !capabilities.every(line => isText(line, 500))) {
    throw new Error(`Invalid ${id} catalog.json: expected only capabilities, 1 to 20 nonempty lines of at most 500 characters`);
  }
  const files = new Map();
  for (const name of PACKAGE_FILES) {
    const text = name === "manifest.json" ? manifestText : lf(await regularFile(path.join(dir, name)));
    if (!text.trim()) throw new Error(`Empty required package file: ${id}/${name}`);
    files.set(name, Buffer.from(text, "utf8"));
  }
  return { manifest, capabilities, files };
}

async function packPlugin(files) {
  const zip = new JSZip();
  // Preserve the host's JSZip 3.10.1 byte format, including ordering and LF normalization.
  // https://stuk.github.io/jszip/documentation/api_jszip/file_data.html
  for (const [name, bytes] of files) {
    zip.file(name, bytes, { date: new Date("1980-01-01T00:00:00.000Z"), unixPermissions: 0o100644, createFolders: false });
  }
  // https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "STORE" });
}

export function validatePluginDirectory(directory) {
  validateId(directory.name);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`Plugin must be a directory, not a symlink: ${directory.name}`);
}

/** Validate and rebuild entirely in memory. Does not load or execute plugin entries. */
export async function prepareMarketplace({ root = REPO_ROOT } = {}) {
  const pluginsDir = path.join(root, "plugins");
  const info = await lstat(pluginsDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("plugins must be a real directory");
  const directories = await readdir(pluginsDir, { withFileTypes: true });
  for (const directory of directories) validatePluginDirectory(directory);
  if (!directories.length) throw new Error("No plugins found");
  const ids = directories.map(dir => dir.name);
  const orderedIds = [...CATALOG_PLUGIN_IDS.filter(id => ids.includes(id)), ...ids.filter(id => !CATALOG_PLUGIN_IDS.includes(id)).sort()];
  const contract = await readContract(root);
  const schema = JSON.parse(await regularFile(path.join(root, "schema/manifest.schema.json")));
  const validate = new Ajv({ strict: false }).compile(schema);
  const plugins = [];
  for (const id of orderedIds) {
    const { manifest, capabilities, files } = await readPlugin(root, id, validate, contract);
    const tag = `${id}-${manifest.version}`;
    const zipName = `${tag}.zip`;
    const zipBytes = await packPlugin(files);
    if (zipBytes.length > MAX_ZIP_BYTES) throw new Error(`${id} ZIP exceeds the 50 MiB host limit`);
    const hash = sha256(zipBytes);
    const entry = {
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: "Firefly-0423",
      downloads: 0,
      pluginApiVersion: manifest.apiVersion,
      capabilities,
      zip: `${RELEASE_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(zipName)}`,
      sha256: hash,
    };
    plugins.push({ id, version: manifest.version, tag, zipName, zipBytes, sha256: hash, entry });
  }
  const registry = { apiVersion: 1, plugins: plugins.map(plugin => plugin.entry) };
  const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
  if (registryBytes.length > MAX_REGISTRY_BYTES) throw new Error("registry.json exceeds the 1 MiB host limit");
  return { registry, registryBytes, registryPath: path.join(root, "registry.json"), plugins };
}

/** Missing dist ZIPs are normal in a clean checkout; registry.json records their expected hashes. */
export async function checkArtifacts(result, outDir) {
  let recorded;
  try { recorded = await readFile(result.registryPath); }
  catch (error) {
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
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ZIP_BYTES) throw new Error(`Invalid ZIP file: ${zipPath}`);
      if (sha256(await readFile(zipPath)) !== plugin.sha256) throw new Error(`ZIP hash differs from registry.json: ${plugin.zipName}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
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
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await buildMarketplace(options);
    console.log(`[marketplace] ${options.check ? "Checked" : "Prepared"} ${result.registryPath}`);
    for (const plugin of result.plugins) console.log(`[marketplace] ${plugin.zipName} (SHA-256 ${plugin.sha256})`);
  } catch (error) {
    console.error(`[marketplace] ${error.message}`);
    process.exitCode = 1;
  }
}
