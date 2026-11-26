import assert from "node:assert/strict";
import test from "node:test";
import { createTestHost, manifestErrors, readManifest, sandboxHost } from "./plugin-fixture.mjs";

const PLUGIN_ID = "dev.firefly.code-language";

async function setup(hostOptions = {}) {
  const { manifest, plugin, host } = await sandboxHost(PLUGIN_ID, hostOptions);
  return {
    manifest,
    plugin,
    host,
    detect: async paths => {
      const res = await host.callTool("detect", { paths });
      assert.equal(res.status, "succeeded");
      return structuredClone(res.output.results);
    },
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
  assert.equal(manifest.version, "2.0.0");
  assert.equal(manifest.sdk, "^1.2.0");
});

test("maps paths to the grammar id and the short name, case-insensitively and across both separators", async () => {
  const { detect, host } = await setup();
  assert.deepEqual(await detect(["src/app.ts", "C:\\dir\\main.PS1", "Docs/README.MD", "web/App.tsx", "infra/main.tf", "build.gradle"]), [
    { path: "src/app.ts", language: "typescript", shortName: "ts" },
    { path: "C:\\dir\\main.PS1", language: "powershell", shortName: "ps1" },
    { path: "Docs/README.MD", language: "markdown", shortName: "md" },
    { path: "web/App.tsx", language: "typescript", shortName: "tsx" },
    { path: "infra/main.tf", language: "hcl", shortName: "tf" },
    { path: "build.gradle", language: "groovy", shortName: "gradle" },
  ]);
  await host.deactivate();
});

test("follows the documented edge cases of the upstream table", async () => {
  const { detect, host } = await setup();
  const results = await detect([".env", ".gitignore", "Makefile", "foo.makefile", "archive.", "noext", "dir.v1/noext", "foo.constructor", "foo.__proto__", "a.toString", "cert.pem", "package.lock", "data.CSV", "x.sv", "x.cjs"]);
  const byPath = Object.fromEntries(results.map(item => [item.path, item.language]));
  assert.deepEqual(byPath, {
    ".env": "dotenv",
    ".gitignore": null,
    Makefile: null,
    "foo.makefile": "make",
    "archive.": null,
    noext: null,
    "dir.v1/noext": null,
    "foo.constructor": null,
    "foo.__proto__": null,
    "a.toString": null,
    "cert.pem": null,
    "package.lock": null,
    "data.CSV": "csv",
    "x.sv": "system-verilog",
    "x.cjs": "javascript",
  });
  assert.deepEqual(results.find(item => item.path === ".gitignore"), { path: ".gitignore", language: null, shortName: null });
  assert.equal(results.find(item => item.path === "x.sv").shortName, "sv");
  await host.deactivate();
});

test("every recognized extension resolves and every language has a short name", async () => {
  const { detect, host } = await setup();
  const reg = host.calls.find(c => c.method === "tools.register" && c.params.name === "detect");
  assert.equal(reg.params.parameters.properties.paths.type, "array");
  assert.equal(reg.params.parameters.properties.paths.items.type, "string");
  const sample = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "sh", "bash", "zsh", "fish", "json", "jsonc", "jsonl", "ndjson", "ipynb", "csv", "py", "pyw", "pyi", "rb", "rake", "gemspec", "go", "rs", "java", "c", "h", "cc", "cpp", "cxx", "hh", "hpp", "hxx", "cs", "kt", "kts", "swift", "php", "yaml", "yml", "toml", "ini", "conf", "cfg", "properties", "env", "log", "diff", "patch", "http", "md", "markdown", "mdx", "rst", "tex", "sty", "cls", "bib", "adoc", "html", "htm", "xhtml", "css", "scss", "less", "sql", "xml", "xsd", "xsl", "xslt", "plist", "svg", "lua", "bat", "cmd", "ps1", "psm1", "psd1", "r", "jl", "dart", "scala", "clj", "cljs", "edn", "erl", "hrl", "ex", "exs", "hs", "fs", "fsi", "fsx", "vb", "pl", "pm", "v", "sv", "svh", "graphql", "gql", "proto", "tf", "tfvars", "hcl", "nix", "vue", "svelte", "makefile", "mk", "cmake", "gradle", "groovy"];
  assert.equal(sample.length, 115, "keep this list in step with the upstream extension table");
  const results = await detect(sample.map(extension => `file.${extension}`));
  for (const item of results) {
    assert.equal(typeof item.language, "string", item.path);
    assert.equal(typeof item.shortName, "string", item.path);
  }
  assert.equal(new Set(results.map(item => item.language)).size, 61);
  await host.deactivate();
});

test("accepts only a bounded array of strings and checks aborted signals", async () => {
  const { plugin, host } = await setup();
  for (const args of [{}, { paths: "a.ts" }, { paths: [1] }, { paths: ["a.ts", null] }, null, undefined]) {
    assert.equal((await host.callTool("detect", args)).status, "not_executed");
  }
  const emptyRes = await host.callTool("detect", { paths: [] });
  assert.equal(emptyRes.status, "not_executed");
  assert.match(emptyRes.reason, /between 1 and 200/);

  const tooManyRes = await host.callTool("detect", { paths: Array(201).fill("a.ts") });
  assert.equal(tooManyRes.status, "not_executed");
  assert.match(tooManyRes.reason, /between 1 and 200/);

  const tooLongPath = await host.callTool("detect", { paths: ["a".repeat(1025) + ".ts"] });
  assert.equal(tooLongPath.status, "not_executed");
  assert.match(tooLongPath.reason, /at most 1024 characters/);

  const maxRes = await host.callTool("detect", { paths: Array(200).fill("a.ts") });
  assert.equal(maxRes.status, "succeeded");
  assert.equal(maxRes.output.results.length, 200);
  await host.deactivate();

  // Direct execute checks
  const direct = captureTools(plugin);
  const ac = new AbortController();
  ac.abort("cancelled");
  assert.equal((await direct.get("detect").execute({ paths: ["a.ts"] }, { signal: ac.signal })).status, "not_executed");
  assert.match((await direct.get("detect").execute({ paths: [1] }, {})).reason, /paths must be an array of strings/);
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

  const rejected = await host.callTool("detect", { paths: ["a.ts"] });
  assert.equal(rejected.status, "not_executed");
  assert.match(rejected.reason, /ERR_REJECTED/);

  host.setMode("chat");
  const chatBlocked = await host.callTool("detect", { paths: ["a.ts"] });
  assert.equal(chatBlocked.status, "not_executed");
  assert.match(chatBlocked.reason, /unavailable in chat mode/);

  await host.deactivate("disabled");
  assert.deepEqual(
    host.calls.filter(c => c.method === "tools.unregister").map(c => c.params.name),
    ["detect"],
  );
  assert.equal((await host.callTool("detect", { paths: ["a.ts"] })).status, "not_executed");
});
