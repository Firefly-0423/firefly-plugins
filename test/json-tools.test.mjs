import assert from "node:assert/strict";
import test from "node:test";
import { createTestHost, manifestErrors, readManifest, sandboxHost } from "./plugin-fixture.mjs";

const PLUGIN_ID = "dev.firefly.json-tools";

async function setup(hostOptions = {}) {
  const { manifest, plugin, host } = await sandboxHost(PLUGIN_ID, hostOptions);
  return {
    manifest,
    plugin,
    host,
    validate: async text => structuredClone(await host.callTool("validate", { text })),
    compare: async (left, right) => structuredClone(await host.callTool("compare", { left, right })),
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

test("validate accepts lossless JSON of every root type and names the root type", async () => {
  const { validate, host } = await setup();
  const cases = [
    ['{"a":[1,2,{"b":null}]}', "object"],
    ["[1,2]", "array"],
    ['"text"', "string"],
    ["12.5", "number"],
    ["true", "boolean"],
    ["null", "null"],
    [" \n{} \t", "object"],
  ];
  for (const [text, type] of cases) {
    const res = await validate(text);
    assert.equal(res.status, "succeeded", text);
    assert.deepEqual(res.output, { valid: true, type }, text);
  }
  await host.deactivate();
});

test("validate reports syntax errors with a stable reason and a bounded message", async () => {
  const { validate, host } = await setup();
  for (const text of ["", "{", "{'a':1}", "[1,]", "NaN", "undefined", '{"a":1}{"b":2}', "01"]) {
    const res = await validate(text);
    assert.equal(res.status, "succeeded", text);
    assert.equal(res.output.valid, false, text);
    assert.equal(res.output.reason, "syntax", text);
    assert.equal(typeof res.output.message, "string");
    assert.ok(res.output.message.length > 0 && res.output.message.length <= 300);
  }
  await host.deactivate();
});

test("validate rejects values JSON cannot round-trip: negative zero and overflow to infinity, with the JSON path", async () => {
  const { validate, host } = await setup();
  assert.deepEqual((await validate("-0")).output, {
    valid: false,
    reason: "lossy",
    path: "$",
    message: "negative zero is not preserved",
  });
  assert.deepEqual((await validate('{"a":[1,{"b":-0.0}]}')).output, {
    valid: false,
    reason: "lossy",
    path: "$.a[1].b",
    message: "negative zero is not preserved",
  });
  assert.deepEqual((await validate('{"odd key":1e999}')).output, {
    valid: false,
    reason: "lossy",
    path: '$["odd key"]',
    message: "number is not finite",
  });
  assert.deepEqual((await validate("[0, 0.0, 1e-7, 9007199254740991]")).output, {
    valid: true,
    type: "array",
  });
  await host.deactivate();
});

test("validate handles very deep nesting without recursion limits", async () => {
  const { validate, host } = await setup();
  const depth = 5000;
  const text = "[".repeat(depth) + "-0" + "]".repeat(depth);
  const res = await validate(text);
  // V8 may refuse to parse this deep; either outcome must be a structured answer, never a thrown stack overflow.
  assert.equal(res.status, "succeeded");
  assert.equal(res.output.valid, false);
  assert.ok(["syntax", "lossy"].includes(res.output.reason));
  const shallow = await validate("[".repeat(500) + "1" + "]".repeat(500));
  assert.deepEqual(shallow.output, { valid: true, type: "array" });
  await host.deactivate();
});

test("compare ignores key order and number spelling, and reports equal documents", async () => {
  const { compare, host } = await setup();
  assert.deepEqual((await compare('{"a":1,"b":[1,2,{"c":"x"}]}', '{ "b":[1,2,{"c":"x"}], "a":1.0 }')).output, {
    equal: true,
  });
  assert.deepEqual((await compare("[]", "[]")).output, { equal: true });
  assert.deepEqual((await compare("null", "null")).output, { equal: true });
  await host.deactivate();
});

test("compare reports the first difference with a path and kind", async () => {
  const { compare, host } = await setup();
  assert.deepEqual((await compare('{"a":[1,2,3]}', '{"a":[1,2,4]}')).output, {
    equal: false,
    difference: { path: "$.a[2]", kind: "value" },
  });
  assert.deepEqual((await compare('{"a":[1,2]}', '{"a":[1,2,3]}')).output, {
    equal: false,
    difference: { path: "$.a", kind: "length" },
  });
  assert.deepEqual((await compare('{"a":1}', '{"a":"1"}')).output, {
    equal: false,
    difference: { path: "$.a", kind: "type" },
  });
  assert.deepEqual((await compare('{"a":1,"b":2}', '{"a":1}')).output, {
    equal: false,
    difference: { path: "$.b", kind: "missing-in-right" },
  });
  assert.deepEqual((await compare('{"a":1}', '{"a":1,"c":{}}')).output, {
    equal: false,
    difference: { path: "$.c", kind: "missing-in-left" },
  });
  assert.deepEqual((await compare("[1]", '{"0":1}')).output, {
    equal: false,
    difference: { path: "$", kind: "type" },
  });
  assert.deepEqual((await compare('{"a b":{"x":null}}', '{"a b":{"x":false}}')).output, {
    equal: false,
    difference: { path: '$["a b"].x', kind: "type" },
  });
  await host.deactivate();
});

test("compare uses own keys only: inherited names and __proto__ are ordinary data", async () => {
  const { compare, host } = await setup();
  assert.deepEqual((await compare('{"toString":1}', "{}")).output, {
    equal: false,
    difference: { path: "$.toString", kind: "missing-in-right" },
  });
  assert.deepEqual((await compare('{"__proto__":1}', "{}")).output, {
    equal: false,
    difference: { path: "$.__proto__", kind: "missing-in-right" },
  });
  assert.deepEqual((await compare('{"__proto__":{"a":1}}', '{"__proto__":{"a":1}}')).output, { equal: true });
  assert.deepEqual((await compare('{"constructor":1}', '{"constructor":1}')).output, { equal: true });
  await host.deactivate();
});

test("compare refuses documents that are not lossless JSON and says which side", async () => {
  const { compare, host } = await setup();
  const badLeft = await compare("{", "{}");
  assert.equal(badLeft.status, "not_executed");
  assert.match(badLeft.reason, /left is not valid JSON/);
  const badRight = await compare("{}", "[-0]");
  assert.equal(badRight.status, "not_executed");
  assert.match(badRight.reason, /right is not lossless JSON.*\$\[0\]/);
  await host.deactivate();
});

test("compare handles deep documents iteratively", async () => {
  const { compare, host } = await setup();
  const make = tail => "[".repeat(400) + tail + "]".repeat(400);
  const res = await compare(make("1"), make("2"));
  assert.equal(res.status, "succeeded");
  assert.equal(res.output.equal, false);
  assert.equal(res.output.difference.kind, "value");
  assert.ok(res.output.difference.path.startsWith("$[0][0]"));
  await host.deactivate();
});

test("rejects non-string arguments, caps input size, and checks aborted signals", async () => {
  const { plugin, host } = await setup();
  for (const args of [{}, { text: 1 }, { text: null }, null, undefined, { text: {} }]) {
    const res = await host.callTool("validate", args);
    assert.equal(res.status, "not_executed");
  }
  for (const args of [{ left: "{}" }, { left: "{}", right: 2 }, { left: 1, right: "{}" }, null]) {
    const res = await host.callTool("compare", args);
    assert.equal(res.status, "not_executed");
  }
  const bigValidate = await host.callTool("validate", { text: " ".repeat(1_000_001) });
  assert.equal(bigValidate.status, "not_executed");
  assert.match(bigValidate.reason, /at most 1000000 characters/);

  const bigCompare = await host.callTool("compare", { left: "{}", right: " ".repeat(1_000_001) });
  assert.equal(bigCompare.status, "not_executed");
  assert.match(bigCompare.reason, /at most 1000000 characters/);
  await host.deactivate();

  // Also check direct execute validation and signal.aborted guard
  const direct = captureTools(plugin);
  const ac = new AbortController();
  ac.abort("cancelled");
  assert.equal((await direct.get("validate").execute({ text: "{}" }, { signal: ac.signal })).status, "not_executed");
  assert.equal((await direct.get("compare").execute({ left: "{}", right: "{}" }, { signal: ac.signal })).status, "not_executed");
  assert.match((await direct.get("validate").execute({ text: 1 }, {})).reason, /text must be a string/);
  assert.match((await direct.get("compare").execute({ left: 1, right: "{}" }, {})).reason, /left and right must be strings/);
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

  const rejected = await host.callTool("validate", { text: "{}" });
  assert.equal(rejected.status, "not_executed");
  assert.match(rejected.reason, /ERR_REJECTED/);

  host.setMode("chat");
  const chatBlocked = await host.callTool("compare", { left: "{}", right: "{}" });
  assert.equal(chatBlocked.status, "not_executed");
  assert.match(chatBlocked.reason, /unavailable in chat mode/);

  await host.deactivate("disabled");
  assert.deepEqual(
    host.calls.filter(c => c.method === "tools.unregister").map(c => c.params.name).sort(),
    ["compare", "validate"],
  );
  const afterDeactivate = await host.callTool("validate", { text: "{}" });
  assert.equal(afterDeactivate.status, "not_executed");
});
