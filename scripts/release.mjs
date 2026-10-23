import { realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildMarketplace, MAX_ZIP_BYTES, REPO_ROOT, REPOSITORY, sha256 } from "./build.mjs";

const execute = promisify(execFile);
const endpoint = `repos/${REPOSITORY}`;

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** No shell, repository inference, or local git invocation. Keep ZIP output binary. */
export async function runGh(args) {
  try {
    const { stdout } = await execute("gh", args, {
      cwd: REPO_ROOT, encoding: "buffer", maxBuffer: MAX_ZIP_BYTES + 1, timeout: 120_000, windowsHide: true,
      env: { ...process.env, GH_HOST: "github.com", GH_REPO: REPOSITORY, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    });
    return stdout;
  } catch (error) {
    const status = Number(/\(HTTP (\d{3})\)/.exec(String(error.stderr ?? ""))?.[1]) || undefined;
    // Never print token-bearing environment variables or arbitrary response bodies.
    throw new GitHubError(`GitHub CLI failed${status ? ` (HTTP ${status})` : ` (${error.code ?? "unknown error"})`}; check gh authentication, connectivity and repository access`, status);
  }
}

export function createGitHubClient(run = runGh) {
  async function api(route, { missing = false } = {}) {
    try { return JSON.parse((await run(["api", `${endpoint}${route}`])).toString("utf8")); }
    catch (error) {
      if (missing && error instanceof GitHubError && error.status === 404) return null;
      throw error;
    }
  }
  return {
    async assertRepository() {
      const repo = await api("");
      if (repo.full_name !== REPOSITORY || repo.private !== false) throw new Error(`Expected public repository ${REPOSITORY}`);
    },
    getRelease: tag => api(`/releases/tags/${encodeURIComponent(tag)}`, { missing: true }),
    tagExists: async tag => (await api(`/git/ref/tags/${encodeURIComponent(tag)}`, { missing: true })) !== null,
    // gh documents stdout downloads: https://cli.github.com/manual/gh_release_download
    download: plugin => run(["release", "download", plugin.tag, "--repo", REPOSITORY, "--pattern", plugin.zipName, "--output", "-"]),
    async targetCommit() {
      const target = process.env.GITHUB_SHA || (await api("/commits/main")).sha;
      if (!/^[0-9a-f]{40}$/.test(target)) throw new Error("Release target must be a full commit SHA");
      return target;
    },
    registryAt: target => run(["api", `${endpoint}/contents/registry.json?ref=${target}`, "--header", "Accept: application/vnd.github.raw+json"]),
    async create(plugin, zipPath, notesPath, target) {
      // One explicit asset; no upload/edit/delete/clobber operation exists in this tool.
      // --target and --repo avoid relying on local git state: https://cli.github.com/manual/gh_release_create
      await run(["release", "create", plugin.tag, zipPath, "--repo", REPOSITORY, "--target", target,
        "--title", `${plugin.id} ${plugin.version}`, "--notes-file", notesPath, "--latest=false",
        ...(plugin.version.split("+")[0].includes("-") ? ["--prerelease"] : [])]);
    },
  };
}

async function verifyRelease(client, plugin, release) {
  if (!release || release.tag_name !== plugin.tag || release.draft !== false
    || !Array.isArray(release.assets) || release.assets.length !== 1
    || release.assets[0].name !== plugin.zipName || release.assets[0].state !== "uploaded"
    || release.assets[0].size !== plugin.zipBytes.length) {
    throw new Error(`${plugin.tag}: existing release must be published with exactly one matching ZIP asset; refusing to modify it`);
  }
  const bytes = await client.download(plugin);
  if (sha256(bytes) !== plugin.sha256) {
    throw new Error(`${plugin.tag}: published bytes have a different SHA-256; refusing to modify or re-create the release. Use a new version`);
  }
}

async function inspectRelease(client, plugin) {
  const release = await client.getRelease(plugin.tag);
  if (release) {
    await verifyRelease(client, plugin, release);
    return "existing";
  }
  if (await client.tagExists(plugin.tag)) {
    throw new Error(`${plugin.tag}: tag exists without a release; refusing to reuse a possibly published version`);
  }
  return "pending";
}

/** Default: read-only list plus verification. All checks precede any remote mutation. */
export async function releaseMarketplace({ root = REPO_ROOT, publish = false, client = createGitHubClient(), log = console.log } = {}) {
  const result = await buildMarketplace({ root, check: true });
  await client.assertRepository(); // A repository/auth 404 must never mean "all releases are missing".
  const pending = [];
  const existing = [];
  for (const plugin of result.plugins) {
    const status = await inspectRelease(client, plugin);
    (status === "pending" ? pending : existing).push(plugin);
    log(`${status === "pending" ? "Pending" : "Verified existing"}: ${plugin.tag} (SHA-256 ${plugin.sha256})`);
  }
  if (!publish || !pending.length) {
    log(publish ? "No releases to create." : `${pending.length} pending release(s). Read-only; pass --publish to create them.`);
    return { pending: pending.map(p => p.tag), existing: existing.map(p => p.tag), created: [] };
  }
  const target = await client.targetCommit();
  if (!/^[0-9a-f]{40}$/.test(target)) throw new Error("Release target must be a full commit SHA");
  const committedRegistry = await client.registryAt(target);
  if (!Buffer.from(committedRegistry).equals(result.registryBytes)) {
    throw new Error("Target commit registry.json differs from the checked local registry; refusing to publish uncommitted bytes");
  }
  const outDir = path.join(root, "dist");
  await mkdir(outDir, { recursive: true });
  const outInfo = await lstat(outDir);
  if (!outInfo.isDirectory() || outInfo.isSymbolicLink()) throw new Error("dist must be a real directory");
  const parent = realpathSync(outDir);
  const staging = await mkdtemp(path.join(parent, ".release-"));
  const ownedStaging = realpathSync(staging);
  const created = [];
  try {
    for (const plugin of pending) {
      // Another publisher may have raced the initial inspection. Verify it; never update it.
      if (await inspectRelease(client, plugin) === "existing") { existing.push(plugin); continue; }
      const zipPath = path.join(staging, plugin.zipName);
      const notesPath = path.join(staging, `${plugin.tag}.notes.md`);
      await writeFile(zipPath, plugin.zipBytes, { flag: "wx" });
      await writeFile(notesPath, `${plugin.entry.name}\n\nOffline Firefly plugin package. Installed disabled.\n\nSHA-256: ${plugin.sha256}\nSource commit: ${target}\n\nLicense and original attributions are included in the ZIP.\n`, { flag: "wx" });
      await client.create(plugin, zipPath, notesPath, target);
      await verifyRelease(client, plugin, await client.getRelease(plugin.tag));
      created.push(plugin.tag);
      log(`Created and downloaded/verified: ${plugin.tag}`);
    }
  } finally {
    // Delete only the private directory this call created, after checking its resolved boundary again.
    if (path.dirname(ownedStaging) !== parent || realpathSync(staging) !== ownedStaging) {
      throw new Error("Release staging path changed; refusing cleanup");
    }
    await rm(staging, { recursive: true, force: true });
  }
  return { pending: [], existing: existing.map(p => p.tag), created };
}

export function parseArgs(args) {
  if (args.length === 0) return { publish: false };
  if (args.length === 1 && args[0] === "--publish") return { publish: true };
  throw new Error("Usage: node scripts/release.mjs [--publish]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await releaseMarketplace(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(`[release] ${error.message}`); process.exitCode = 1; }
}
