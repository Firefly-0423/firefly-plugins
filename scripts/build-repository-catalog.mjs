import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareMarketplace, REPO_ROOT, REPOSITORY } from "./build.mjs";

const root = path.join(REPO_ROOT, "marketplace");
const packages = path.join(root, "packages");
const base = `https://raw.githubusercontent.com/${REPOSITORY}/marketplace-v2/marketplace/`;
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--check")) {
  throw new Error("Usage: node scripts/build-repository-catalog.mjs [--check]");
}
const check = args.length === 1;
const built = await prepareMarketplace();
const names = new Set(built.plugins.map(plugin => plugin.zipName));

if (!check) await mkdir(packages, { recursive: true });
const existing = await readdir(packages, { withFileTypes: true });
for (const item of existing) {
  if (!item.isFile() || !item.name.endsWith(".ffplugin")) throw new Error(`Unexpected package asset: ${item.name}`);
}
if (check && [...names].some(name => !existing.some(item => item.name === name))) {
  throw new Error("A catalog package is missing");
}
for (const plugin of built.plugins) {
  const target = path.join(packages, plugin.zipName);
  if (existing.some(item => item.name === plugin.zipName)) {
    if (!(await readFile(target)).equals(plugin.zipBytes)) {
      throw new Error(`${plugin.zipName} already exists with different bytes; bump the plugin version`);
    }
  } else {
    await writeFile(target, plugin.zipBytes, { flag: "wx" });
  }
}

const registry = {
  apiVersion: 2,
  plugins: built.plugins.map(plugin => ({
    ...plugin.entry,
    package: `${base}packages/${encodeURIComponent(plugin.zipName)}`,
  })),
};
const registryPath = path.join(root, "registry.json");
const bytes = Buffer.from(JSON.stringify(registry, null, 2) + "\n");
if (check) {
  if (!(await readFile(registryPath)).equals(bytes)) throw new Error("Repository registry differs from the built catalog");
} else {
  await writeFile(registryPath, bytes);
}
console.log(`[marketplace] ${check ? "Checked" : "Built"} ${registry.plugins.length} repository packages`);
