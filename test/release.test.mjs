import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildMarketplace, REPOSITORY, sha256 } from "../scripts/build.mjs";
import { createGitHubClient, GitHubError, parseArgs, releaseMarketplace } from "../scripts/release.mjs";
import { sourceFixture } from "./build-fixture.mjs";

const TARGET = "a".repeat(40);
const releaseFor = p => ({ tag_name: p.tag, draft: false, assets: [{ name: p.zipName, state: "uploaded", size: p.zipBytes.length }] });

async function fixture(t) {
  const root = await sourceFixture(t);
  const result = await buildMarketplace({ root });
  const calls = [];
  const releases = new Map();
  const downloads = new Map();
  const client = {
    async assertRepository() { calls.push("repository"); },
    async getRelease(tag) { calls.push(`lookup:${tag}`); return releases.get(tag) ?? null; },
    async tagExists() { return false; },
    async download(p) { calls.push(`download:${p.tag}`); return downloads.get(p.tag) ?? p.zipBytes; },
    async targetCommit() { return TARGET; },
    async registryAt(target) { assert.equal(target, TARGET); return result.registryBytes; },
    async create(p, zipPath, notesPath, target) {
      assert.equal(target, TARGET);
      assert.equal(sha256(await readFile(zipPath)), p.sha256);
      assert.match(await readFile(notesPath, "utf8"), /\n\nSHA-256: [0-9a-f]{64}\nSource commit:/);
      calls.push(`create:${p.tag}`);
      releases.set(p.tag, releaseFor(p));
    },
  };
  return { root, result, calls, releases, downloads, client, log() {} };
}

test("default release mode lists missing versions and verifies existing bytes without mutations", async t => {
  const f = await fixture(t);
  const first = f.result.plugins[0];
  f.releases.set(first.tag, releaseFor(first));
  const before = await readdir(path.join(f.root, "dist"));
  const result = await releaseMarketplace(f);
  assert.deepEqual(result.existing, [first.tag]);
  assert.deepEqual(result.pending, f.result.plugins.slice(1).map(p => p.tag));
  assert.deepEqual(result.created, []);
  assert.ok(f.calls.includes(`download:${first.tag}`));
  assert.ok(!f.calls.some(call => call.startsWith("create:")));
  assert.deepEqual(await readdir(path.join(f.root, "dist")), before);
});

test("publish creates only missing releases, uploads captured bytes, then downloads and verifies every asset", async t => {
  const f = await fixture(t);
  const first = f.result.plugins[0];
  f.releases.set(first.tag, releaseFor(first));
  const result = await releaseMarketplace({ ...f, publish: true });
  assert.deepEqual(result.created, f.result.plugins.slice(1).map(p => p.tag));
  assert.ok(!f.calls.includes(`create:${first.tag}`));
  for (const tag of result.created) assert.ok(f.calls.indexOf(`download:${tag}`) > f.calls.indexOf(`create:${tag}`));
  assert.ok(!(await readdir(path.join(f.root, "dist"))).some(name => name.startsWith(".release-")));
  f.calls.length = 0;
  const retry = await releaseMarketplace({ ...f, publish: true });
  assert.deepEqual(retry.created, []);
  assert.ok(!f.calls.some(call => call.startsWith("create:")));
});

test("changed published bytes abort the entire preflight before any missing release is created", async t => {
  const f = await fixture(t);
  const last = f.result.plugins.at(-1);
  f.releases.set(last.tag, releaseFor(last));
  const corrupt = Buffer.from(last.zipBytes);
  corrupt[0] ^= 1;
  f.downloads.set(last.tag, corrupt);
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /published bytes have a different SHA-256/);
  assert.ok(!f.calls.some(call => call.startsWith("create:")));
});

test("existing incomplete, draft, wrong-tag or extra-asset releases are never repaired", async t => {
  const f = await fixture(t);
  const p = f.result.plugins[0];
  const valid = releaseFor(p);
  for (const bad of [{ ...valid, draft: true }, { ...valid, tag_name: "wrong" }, { ...valid, assets: [] },
    { ...valid, assets: [...valid.assets, valid.assets[0]] }, { ...valid, assets: [{ ...valid.assets[0], size: 1 }] },
    { ...valid, assets: [{ ...valid.assets[0], name: "wrong.zip" }] }, { ...valid, assets: [{ ...valid.assets[0], state: "new" }] }]) {
    f.releases.set(p.tag, bad);
    await assert.rejects(releaseMarketplace({ ...f, publish: true }), /refusing to modify/);
  }
  assert.ok(!f.calls.some(call => call.startsWith("create:")));
});

test("an orphan release tag cannot be reused", async t => {
  const f = await fixture(t);
  f.client.tagExists = async () => true;
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /tag exists without a release/);
  assert.ok(!f.calls.some(call => call.startsWith("create:")));
});

test("registry/source drift fails locally before any GitHub request", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "registry.json"), "{}\n");
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /registry.json differs/);
  assert.deepEqual(f.calls, []);
});

test("publish requires the checked registry at the exact target commit", async t => {
  const f = await fixture(t);
  f.client.registryAt = async () => Buffer.from("different committed catalog");
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /refusing to publish uncommitted bytes/);
  f.client.targetCommit = async () => "main";
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /full commit SHA/);
  assert.ok(!f.calls.some(call => call.startsWith("create:")));
});

test("a concurrently created release is verified and skipped", async t => {
  const f = await fixture(t);
  const first = f.result.plugins[0];
  let count = 0;
  const lookup = f.client.getRelease;
  f.client.getRelease = async tag => {
    if (tag === first.tag && ++count === 2) f.releases.set(tag, releaseFor(first));
    return lookup(tag);
  };
  const result = await releaseMarketplace({ ...f, publish: true });
  assert.ok(result.existing.includes(first.tag));
  assert.ok(!f.calls.includes(`create:${first.tag}`));
  assert.ok(f.calls.includes(`download:${first.tag}`));
});

test("post-upload hash mismatch stops publication and leaves remote state untouched", async t => {
  const f = await fixture(t);
  const first = f.result.plugins[0];
  const corrupt = Buffer.from(first.zipBytes);
  corrupt[0] ^= 1;
  f.downloads.set(first.tag, corrupt);
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /different SHA-256/);
  assert.deepEqual(f.calls.filter(c => c.startsWith("create:")), [`create:${first.tag}`]);
  assert.ok(f.releases.has(first.tag));
  assert.ok(!(await readdir(path.join(f.root, "dist"))).some(name => name.startsWith(".release-")));
});

test("authentication, API and repository failures never turn into missing releases", async t => {
  const f = await fixture(t);
  f.client.assertRepository = async () => { throw new GitHubError("unauthorized", 401); };
  await assert.rejects(releaseMarketplace({ ...f, publish: true }), /unauthorized/);
  assert.deepEqual(f.calls, []);
  for (const status of [401, 403, 429, 500, undefined]) {
    const client = createGitHubClient(async () => { throw new GitHubError("failure", status); });
    await assert.rejects(client.getRelease("example-1.0.0"), /failure/);
  }
  const client = createGitHubClient(async () => { throw new GitHubError("not found", 404); });
  assert.equal(await client.getRelease("example-1.0.0"), null);
  await assert.rejects(client.assertRepository(), /not found/);
});

test("gh adapter selects an explicit repo/target, one asset and a notes file; downloads are binary", async () => {
  const calls = [];
  const binary = Buffer.from([0x50, 0x4b, 0, 0xff]);
  const client = createGitHubClient(async args => { calls.push(args); return binary; });
  const p = { id: "example", version: "1.0.0-beta.1+Build.2", tag: "example-1.0.0-beta.1+Build.2", zipName: "example-1.0.0-beta.1+Build.2.zip" };
  assert.deepEqual(await client.download(p), binary);
  assert.deepEqual(calls[0], ["release", "download", p.tag, "--repo", REPOSITORY, "--pattern", p.zipName, "--output", "-"]);
  await client.create(p, "/owned/package.zip", "/owned/notes.md", TARGET);
  assert.deepEqual(calls[1], ["release", "create", p.tag, "/owned/package.zip", "--repo", REPOSITORY, "--target", TARGET,
    "--title", "example 1.0.0-beta.1+Build.2", "--notes-file", "/owned/notes.md", "--latest=false", "--prerelease"]);
  assert.deepEqual(parseArgs([]), { publish: false });
  assert.deepEqual(parseArgs(["--publish"]), { publish: true });
  for (const args of [["--clobber"], ["--publish", "--publish"], ["--repo", "other/repo"]]) assert.throws(() => parseArgs(args), /Usage/);
});
