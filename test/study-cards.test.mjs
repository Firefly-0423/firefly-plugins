import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareMarketplace } from "../scripts/build.mjs";
import { createTestHost, manifestErrors, readManifest } from "./plugin-fixture.mjs";

const require = createRequire(import.meta.url);
const PLUGIN_ID = "dev.firefly.study-cards";
const DAY = 86_400_000;

async function makeDataDir(t) {
  const root = await mkdtemp(path.join(tmpdir(), "firefly-cards-test-"));
  const owned = await realpath(root);
  const parent = await realpath(tmpdir());
  t.after(async () => {
    if (path.dirname(owned) !== parent || await realpath(root) !== owned) {
      throw new Error("Unsafe cleanup target");
    }
    await rm(owned, { recursive: true, force: true });
  });
  return owned;
}

async function activateWithCleanup(t, host, plugin) {
  await host.activate(plugin);
  t.after(() => host.deactivate("disabled"));
}

test("study-cards manifest matches 1.2.0 schema with explicit fs-read/fs-write risks and ui.windows", () => {
  const manifest = readManifest(PLUGIN_ID);
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, PLUGIN_ID);
  assert.equal(manifest.sdk, "^1.2.0");
  assert.equal(manifest.native, false);
  assert.deepEqual(manifest.permissions, ["ui.windows"]);
  assert.equal(manifest.ui?.windows?.[0]?.id, "workbench");
  const byName = Object.fromEntries(manifest.tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(byName).sort(), [
    "collect",
    "create",
    "delete",
    "due",
    "list",
    "lookup",
    "new",
    "review",
    "update",
  ]);
  for (const name of ["create", "review", "update", "delete", "collect"]) {
    assert.deepEqual(byName[name].risk, ["fs-write"]);
  }
  for (const name of ["new", "due", "list", "lookup"]) {
    assert.deepEqual(byName[name].risk, ["fs-read"]);
  }
});

test("cards persist in ctx.dataDir SQLite across deactivate/re-activate and only become due after review", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeDataDir(t);
  let now = 1_000_000_000_000;

  const host1 = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host1.activate(createPlugin({ now: () => now }));

  const created = await host1.callTool("create", { deck: "CANN", front: "什么是算子？", back: "执行计算的单元" });
  assert.equal(created.status, "succeeded");
  const cardId = created.output.cardId;
  assert.equal((await host1.callTool("new", { limit: 10 })).output.cards.length, 1);
  assert.equal((await host1.callTool("due", { limit: 10 })).output.cards.length, 0);

  const reviewed = await host1.callTool("review", { cardId, rating: 1, expectedRevision: 1 });
  assert.equal(reviewed.status, "succeeded");
  assert.equal(reviewed.output.dueAt, now + 600_000);
  assert.equal((await host1.callTool("list", { limit: 10 })).output.cards[0].revision, 2);

  await host1.deactivate("disabled");
  assert.equal(existsSync(path.join(dataDir, "learning.sqlite")), true);

  const host2 = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host2.activate(createPlugin({ now: () => now }));
  assert.equal((await host2.callTool("new", { limit: 10 })).output.cards.length, 0);
  now += 600_000;
  assert.equal((await host2.callTool("due", { limit: 10 })).output.cards[0].front, "什么是算子？");
  await host2.deactivate("disabled");
});

test("read-only permission level, rejected approval, chat mode, and abort signal enforce boundaries", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeDataDir(t);

  const host = createTestHost({
    manifest,
    mode: "work",
    level: "read-only",
    dataDir,
    approvalDecision: "reject",
  });
  await host.activate(createPlugin({ now: () => 1_000_000_000_000 }));
  try {
    const deniedCreate = await host.callTool("create", { deck: "A", front: "q", back: "a" });
    assert.equal(deniedCreate.status, "not_executed");
    assert.match(deniedCreate.reason, /ERR_PERMISSION/);

    const deniedCollect = await host.callTool("collect", { language: "en", term: "quiet", meaning: "安静", operationId: "ro-1" });
    assert.equal(deniedCollect.status, "not_executed");
    assert.match(deniedCollect.reason, /ERR_PERMISSION/);

    // fs-read tools work in read-only level
    assert.equal((await host.callTool("list", { limit: 10 })).output.total, 0);
    const lookupOk = await host.callTool("lookup", { language: "en", term: "quiet" });
    assert.equal(lookupOk.status, "succeeded");
    assert.equal(lookupOk.output.match, "none");

    // per-action with rejected approval leaves data untouched
    host.setLevel("per-action");
    const rejectedWrite = await host.callTool("create", { deck: "A", front: "q", back: "a" });
    assert.equal(rejectedWrite.status, "not_executed");
    assert.match(rejectedWrite.reason, /ERR_REJECTED/);
    host.setLevel("full");
    assert.equal((await host.callTool("list", { limit: 10 })).output.total, 0);

    // chat mode blocks plugin tools
    host.setMode("chat");
    const chatBlocked = await host.callTool("lookup", { language: "en", term: "quiet" });
    assert.equal(chatBlocked.status, "not_executed");
    assert.match(chatBlocked.reason, /unavailable in chat mode/);

    // pre-aborted signal returns not_executed
    host.setMode("work");
    const ac = new AbortController();
    ac.abort("cancelled");
    const cancelled = await host.callTool("create", { deck: "A", front: "q", back: "a" }, { signal: ac.signal });
    assert.equal(cancelled.status, "not_executed");
  } finally {
    await host.deactivate("disabled");
  }
});

test("invalid inputs, disallowed path properties, and stale revisions return not_executed", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeDataDir(t);
  const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host.activate(createPlugin({ now: () => 1_000_000_000_000 }));
  try {
    const blankDeck = await host.callTool("create", { deck: "", front: "a", back: "b" });
    assert.equal(blankDeck.status, "not_executed");

    const pathRejected = await host.callTool("lookup", { language: "en", term: "hello", path: "C:/private" });
    assert.equal(pathRejected.status, "not_executed");
    assert.match(pathRejected.reason, /ERR_INVALID_ARGUMENT/);

    const card = (await host.callTool("create", { deck: "A", front: "old", back: "answer" })).output;
    const staleReview = await host.callTool("review", { cardId: card.cardId, rating: 3, expectedRevision: 99 });
    assert.equal(staleReview.status, "not_executed");

    const updated = await host.callTool("update", {
      cardId: card.cardId,
      expectedRevision: 1,
      front: "new",
      back: "answer",
    });
    assert.equal(updated.output.revision, 2);

    const staleDelete = await host.callTool("delete", { cardId: card.cardId, expectedRevision: 1 });
    assert.equal(staleDelete.status, "not_executed");
    assert.equal((await host.callTool("new", { limit: 10 })).output.cards[0].front, "new");

    const deleted = await host.callTool("delete", { cardId: card.cardId, expectedRevision: 2 });
    assert.equal(deleted.status, "succeeded");
    assert.equal((await host.callTool("new", { limit: 10 })).output.total, 0);
  } finally {
    await host.deactivate("disabled");
  }
});

test("unreadable or corrupt cards-v1.json is never replaced by a write", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeDataDir(t);
  const storeFile = path.join(dataDir, "cards-v1.json");
  await writeFile(storeFile, "{broken", "utf8");

  const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host.activate(createPlugin());
  try {
    const failed = await host.callTool("create", { deck: "A", front: "a", back: "b" });
    assert.equal(failed.status, "failed");
    assert.equal(await readFile(storeFile, "utf8"), "{broken");
  } finally {
    await host.deactivate("disabled");
  }
});

test("duplicate ids and negative intervals in legacy cards-v1.json refuse migration and mutations", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const sampleCard = {
    id: "12345678-1234-1234-1234-123456789012",
    deck: "A",
    front: "a",
    back: "b",
    reviews: 0,
    revision: 1,
    dueAt: 0,
    interval: 0,
  };
  for (const corrupt of ["duplicate", "interval"]) {
    const dataDir = await makeDataDir(t);
    const storeFile = path.join(dataDir, "cards-v1.json");
    const state = { version: 1, cards: [structuredClone(sampleCard)] };
    if (corrupt === "duplicate") state.cards.push(structuredClone(sampleCard));
    else state.cards[0].interval = -1;
    const rawCorrupt = JSON.stringify(state);
    await writeFile(storeFile, rawCorrupt, "utf8");

    const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
    await host.activate(createPlugin());
    const failed = await host.callTool("create", { deck: "B", front: "a", back: "b" });
    assert.equal(failed.status, "failed");
    assert.equal(await readFile(storeFile, "utf8"), rawCorrupt);
    await host.deactivate("disabled");
  }
});

test("uncertain backend write stays unknown while validation failure stays not_executed", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeDataDir(t);
  const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host.activate(createPlugin({
    createService: () => ({
      dispose: async () => {},
      call: async () => {
        throw Object.assign(new Error("保存结果未知"), { effectState: "unknown" });
      },
    }),
  }));
  try {
    const invalid = await host.callTool("create", { deck: "", front: "a", back: "b", unexpected: 1 });
    assert.equal(invalid.status, "not_executed");

    const unknown = await host.callTool("create", { deck: "A", front: "a", back: "b" });
    assert.equal(unknown.status, "unknown");
    assert.match(unknown.reason, /保存结果未知/);
  } finally {
    await host.deactivate("disabled");
  }
});

test("ratings, 365-day interval cap, pagination, collect/lookup tools, and deactivated host behave consistently", async (t) => {
  const { createPlugin } = require("../plugins/dev.firefly.study-cards/index.cjs");
  const manifest = readManifest(PLUGIN_ID);
  const dataDir = await makeDataDir(t);
  const now = 1_000_000_000_000;
  const host = createTestHost({ manifest, mode: "work", level: "full", dataDir });
  await host.activate(createPlugin({ now: () => now }));

  for (const [rating, interval] of [[1, 600_000], [2, DAY], [3, 3 * DAY], [4, 7 * DAY]]) {
    const c = (await host.callTool("create", { deck: "A", front: String(rating), back: "b" })).output;
    const rev = await host.callTool("review", { cardId: c.cardId, expectedRevision: 1, rating });
    assert.equal(rev.status, "succeeded");
    assert.equal(rev.output.dueAt, now + interval);
    const stale = await host.callTool("review", { cardId: c.cardId, expectedRevision: 1, rating });
    assert.equal(stale.status, "not_executed");
  }

  const listed = (await host.callTool("list", { limit: 2, offset: 2, deck: "A" })).output;
  assert.equal(listed.total, 4);
  assert.equal(listed.cards.length, 2);
  let revision = listed.cards[0].revision;
  for (let i = 0; i < 15; i++) {
    const res = await host.callTool("review", { cardId: listed.cards[0].cardId, expectedRevision: revision++, rating: 4 });
    assert.equal(res.status, "succeeded");
    assert.ok(res.output.dueAt <= now + 365 * DAY);
  }

  // collect deduplicates by operationId and NFC term
  const collected1 = await host.callTool("collect", {
    language: "fr",
    term: "cafe\u0301",
    meaning: "咖啡",
    context: "Un café, s'il vous plaît.",
    operationId: "op-1",
  });
  assert.equal(collected1.status, "succeeded");
  assert.equal(collected1.output.duplicate, false);
  const collected2 = await host.callTool("collect", {
    language: "fr",
    term: "café",
    meaning: "咖啡",
    operationId: "op-2",
  });
  assert.equal(collected2.status, "succeeded");
  assert.equal(collected2.output.cardId, collected1.output.cardId);
  assert.equal(collected2.output.duplicate, true);

  // Install demo via UI bridge and verify lookup tool
  await host.sendUiMessage({ from: { kind: "window", id: "workbench" }, method: "demoInstall", params: {} });
  const looked = await host.callTool("lookup", { language: "ja", term: "学ぶ" });
  assert.equal(looked.status, "succeeded");
  assert.equal(looked.output.entries.length, 1);

  await host.deactivate("disabled");
  const afterStop = await host.callTool("create", { deck: "A", front: "a", back: "b" });
  assert.equal(afterStop.status, "not_executed");
});

test("built dev.firefly.study-cards .ffplugin package packs package-files.json assets cleanly", async () => {
  const plugin = (await prepareMarketplace()).plugins.find((p) => p.id === PLUGIN_ID);
  assert.ok(plugin, "dev.firefly.study-cards must be in marketplace catalog");
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(plugin.zipBytes);
  const extra = JSON.parse(await readFile(new URL("../plugins/dev.firefly.study-cards/package-files.json", import.meta.url), "utf8")).files;
  assert.deepEqual(
    Object.keys(zip.files).sort(),
    ["LICENSE", "README.md", "firefly.plugin.json", "index.cjs", ...extra].sort(),
  );
  assert.equal(zip.file("runtime/window.cjs"), null);
  assert.equal(zip.file("ui/preload.cjs"), null);
  const manifest = JSON.parse(await zip.file("firefly.plugin.json").async("string"));
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.native, false);
});
