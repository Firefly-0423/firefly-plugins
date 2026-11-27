import assert from "node:assert/strict";
import test from "node:test";
import { createTestHost, manifestErrors, readManifest, sandboxHost } from "./plugin-fixture.mjs";

const PLUGIN_ID = "dev.firefly.timezone-tools";

async function setup(hostOptions = {}) {
  const { manifest, plugin, host } = await sandboxHost(PLUGIN_ID, hostOptions);
  return {
    manifest,
    plugin,
    host,
    canonicalize: async zone => structuredClone(await host.callTool("canonicalize", { zone })),
    convert: async args => structuredClone(await host.callTool("convert", args)),
  };
}

function captureTools(plugin) {
  const registered = new Map();
  plugin.activate({
    tools: {
      register(def) {
        registered.set(def.name, def);
        return { dispose() { registered.delete(def.name); } };
      },
    },
  });
  return registered;
}

test("manifest passes 1.2.0 schema validation with no 0.x fields", () => {
  const manifest = readManifest(PLUGIN_ID);
  assert.deepEqual(manifestErrors(manifest), []);
  assert.equal(manifest.id, PLUGIN_ID);
  assert.equal(manifest.version, "2.0.1");
  assert.equal(manifest.sdk, "^1.2.0");
});

test("canonicalize follows the deepseek-harness wire profile: UTC or Area/Location, no padding or abbreviations", async () => {
  const { canonicalize, host } = await setup();
  assert.deepEqual((await canonicalize("UTC")).output, { valid: true, canonical: "UTC" });
  assert.deepEqual((await canonicalize("America/New_York")).output, { valid: true, canonical: "America/New_York" });
  assert.deepEqual((await canonicalize("Asia/Shanghai")).output, { valid: true, canonical: "Asia/Shanghai" });
  // Spelling is normalized by the platform's ICU data (which spelling that is can differ between Node builds), the same answer Intl gives.
  for (const alias of ["asia/calcutta", "Asia/Kolkata", "America/Argentina/Buenos_Aires"]) {
    const res = await canonicalize(alias);
    assert.equal(res.status, "succeeded");
    assert.deepEqual(res.output, {
      valid: true,
      canonical: new Intl.DateTimeFormat("en-US", { timeZone: alias }).resolvedOptions().timeZone,
    });
  }
  for (const zone of ["", " UTC", "UTC ", "utc", "EST", "GMT", "PST8PDT", "Tokyo", "Asia/Nowhere", "../etc/passwd", "Area//Loc", "Asia/", "+09:00", "Asia/Tokyo\n"]) {
    const res = await canonicalize(zone);
    assert.equal(res.status, "succeeded", JSON.stringify(zone));
    assert.equal(res.output.valid, false, JSON.stringify(zone));
    assert.equal(res.output.canonical, undefined);
  }
  await host.deactivate();
});

test("convert translates an absolute instant into a target zone with its UTC offset", async () => {
  const { convert, host } = await setup();
  assert.deepEqual((await convert({ time: "2026-03-08T12:00:00Z", to: "America/New_York" })).output, {
    instant: "2026-03-08T12:00:00.000Z",
    to: { zone: "America/New_York", local: "2026-03-08T08:00:00.000", offset: "-04:00" },
  });
  assert.deepEqual((await convert({ time: "2026-01-15T00:30:00+09:00", to: "Europe/London" })).output, {
    instant: "2026-01-14T15:30:00.000Z",
    to: { zone: "Europe/London", local: "2026-01-14T15:30:00.000", offset: "+00:00" },
  });
  assert.deepEqual((await convert({ time: "2026-06-01T00:00:00Z", to: "Asia/Kolkata" })).output.to, {
    zone: "Asia/Kolkata",
    local: "2026-06-01T05:30:00.000",
    offset: "+05:30",
  });
  assert.deepEqual((await convert({ time: "2026-06-01T00:00:00.123456Z", to: "UTC" })).output.to, {
    zone: "UTC",
    local: "2026-06-01T00:00:00.123",
    offset: "+00:00",
  });
  assert.equal((await convert({ time: "2026-06-01 10:00+0200", to: "UTC" })).output.instant, "2026-06-01T08:00:00.000Z");
  await host.deactivate();
});

test("convert interprets a local wall time only with an explicit source zone", async () => {
  const { convert, host } = await setup();
  assert.deepEqual((await convert({ time: "2026-07-01T15:00:00", from: "Asia/Tokyo", to: "America/Los_Angeles" })).output, {
    instant: "2026-07-01T06:00:00.000Z",
    from: { zone: "Asia/Tokyo", local: "2026-07-01T15:00:00.000", offset: "+09:00" },
    to: { zone: "America/Los_Angeles", local: "2026-06-30T23:00:00.000", offset: "-07:00" },
  });
  await host.deactivate();
});

test("convert reports daylight-saving gaps as not_executed and folds as ambiguous, choosing the earlier instant", async () => {
  const { convert, host } = await setup();
  const gap = await convert({ time: "2026-03-08T02:30:00", from: "America/New_York", to: "UTC" });
  assert.equal(gap.status, "not_executed");
  assert.match(gap.reason, /does not exist in America\/New_York/);

  const foldRes = await convert({ time: "2026-11-01T01:30:00", from: "America/New_York", to: "UTC" });
  assert.equal(foldRes.status, "succeeded");
  const fold = foldRes.output;
  assert.equal(fold.ambiguous, true);
  assert.equal(fold.instant, "2026-11-01T05:30:00.000Z");
  assert.deepEqual(fold.from, { zone: "America/New_York", local: "2026-11-01T01:30:00.000", offset: "-04:00" });
  assert.deepEqual(fold.alternativeInstant, "2026-11-01T06:30:00.000Z");

  const normalRes = await convert({ time: "2026-11-01T03:30:00", from: "America/New_York", to: "UTC" });
  assert.equal(normalRes.status, "succeeded");
  assert.equal(normalRes.output.ambiguous, undefined);
  assert.equal(normalRes.output.instant, "2026-11-01T08:30:00.000Z");
  await host.deactivate();
});

test("convert rejects ambiguous or invalid input rather than guessing", async () => {
  const { convert, host } = await setup();
  const bad = [
    [{ time: "2026-07-01T15:00:00", to: "UTC" }, /requires from/],
    [{ time: "2026-07-01T15:00:00Z", from: "Asia/Tokyo", to: "UTC" }, /already has an offset/],
    [{ time: "2026-07-01T15:00:00", from: "EST", to: "UTC" }, /from is not a valid zone/],
    [{ time: "2026-07-01T15:00:00Z", to: "Mars/Base" }, /to is not a valid zone/],
    [{ time: "tomorrow", to: "UTC" }, /ISO 8601/],
    [{ time: "2026-02-30T10:00:00Z", to: "UTC" }, /does not name a real date/],
    [{ time: "2026-13-01T10:00:00Z", to: "UTC" }, /does not name a real date/],
    [{ time: "2026-01-01T24:00:00Z", to: "UTC" }, /does not name a real date/],
    [{ time: "2026-01-01T10:60:00Z", to: "UTC" }, /does not name a real date/],
    [{ time: "2026-01-01T10:00:60Z", to: "UTC" }, /does not name a real date/],
    [{ time: "1850-01-01T00:00:00Z", to: "UTC" }, /between 1900 and 2200/],
    [{ time: "2300-01-01T00:00:00Z", to: "UTC" }, /between 1900 and 2200/],
    [{ time: "2026-01-01T10:00:00+25:00", to: "UTC" }, /offset/],
    [{ time: "2026-01-01", to: "UTC" }, /ISO 8601/],
  ];
  for (const [args, pattern] of bad) {
    const res = await convert(args);
    assert.equal(res.status, "not_executed", JSON.stringify(args));
    assert.match(res.reason, pattern, JSON.stringify(args));
  }
  await host.deactivate();
});

test("rejects missing or non-string arguments and checks aborted signals", async () => {
  const { plugin, host } = await setup();
  for (const args of [{}, { zone: 1 }, { zone: null }, null, undefined]) {
    assert.equal((await host.callTool("canonicalize", args)).status, "not_executed");
  }
  for (const args of [{}, { time: 1, to: "UTC" }, { time: "2026-01-01T00:00:00Z" }, { time: "2026-01-01T00:00:00Z", to: 3 }, null, undefined]) {
    assert.equal((await host.callTool("convert", args)).status, "not_executed");
  }
  assert.equal((await host.callTool("convert", { time: "2026-07-01T15:00:00", from: 5, to: "UTC" })).status, "not_executed");
  const tooLong = await host.callTool("canonicalize", { zone: "A/".padEnd(200, "b") });
  assert.equal(tooLong.status, "not_executed");
  assert.match(tooLong.reason, /at most 100 characters/);
  await host.deactivate();

  // Direct execute checks for validation messages and signal.aborted
  const direct = captureTools(plugin);
  const ac = new AbortController();
  ac.abort("cancelled");
  assert.equal((await direct.get("canonicalize").execute({ zone: "UTC" }, { signal: ac.signal })).status, "not_executed");
  assert.equal((await direct.get("convert").execute({ time: "2026-01-01T00:00:00Z", to: "UTC" }, { signal: ac.signal })).status, "not_executed");
  assert.match((await direct.get("canonicalize").execute({ zone: 1 }, {})).reason, /zone must be a string/);
  assert.match((await direct.get("convert").execute({ time: 1, to: "UTC" }, {})).reason, /time and to must be strings/);
  assert.match((await direct.get("convert").execute({ time: "2026-07-01T15:00:00", from: 5, to: "UTC" }, {})).reason, /from must be a string/);
  plugin.deactivate();
});

test("enforces chat mode restriction, per-action rejection, and clean deactivation", async () => {
  const manifest = readManifest(PLUGIN_ID);
  const { plugin } = await sandboxHost(PLUGIN_ID);
  const host = createTestHost({
    manifest,
    mode: "work",
    level: "per-action",
    approvalDecision: "reject",
  });
  await host.activate(plugin);

  const rejected = await host.callTool("canonicalize", { zone: "UTC" });
  assert.equal(rejected.status, "not_executed");
  assert.match(rejected.reason, /ERR_REJECTED/);

  host.setMode("chat");
  const chatBlocked = await host.callTool("convert", { time: "2026-01-01T00:00:00Z", to: "UTC" });
  assert.equal(chatBlocked.status, "not_executed");
  assert.match(chatBlocked.reason, /unavailable in chat mode/);

  await host.deactivate("disabled");
  assert.deepEqual(
    host.calls.filter(c => c.method === "tools.unregister").map(c => c.params.name).sort(),
    ["canonicalize", "convert"],
  );
  assert.equal((await host.callTool("canonicalize", { zone: "UTC" })).status, "not_executed");
});
