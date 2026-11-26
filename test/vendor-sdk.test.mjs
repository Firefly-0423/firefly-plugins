import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EXPECTED_VENDOR_SDK, REPO_ROOT, verifyVendoredSdk } from "../scripts/verify-vendor-sdk.mjs";
import { createTestHost, definePlugin, PluginError } from "./plugin-fixture.mjs";

async function makeTempRoot(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vendor-sdk-test-"));
  const owned = await realpath(dir);
  const parent = await realpath(os.tmpdir());
  t.after(async () => {
    if (path.dirname(owned) !== parent || await realpath(dir) !== owned) throw new Error("Unsafe cleanup");
    await rm(owned, { recursive: true, force: true });
  });
  await cp(path.join(REPO_ROOT, "test/vendor"), path.join(owned, "test/vendor"), { recursive: true });
  return owned;
}

test("vendored plugin-sdk-testing helper passes integrity and provenance verification", async () => {
  const result = await verifyVendoredSdk();
  assert.equal(result.sourceCommit, EXPECTED_VENDOR_SDK.sourceCommit);
  assert.equal(result.vendoredBodySha256, EXPECTED_VENDOR_SDK.vendoredBodySha256);
  assert.equal(result.upstreamBundleSha256, EXPECTED_VENDOR_SDK.upstreamBundleSha256);
  assert.equal(result.companionIndexSha256, EXPECTED_VENDOR_SDK.companionIndexSha256);
});

test("vendored plugin-sdk-testing helper shares PluginError constructor across testing and index modules", async () => {
  const host = createTestHost({
    manifest: {
      schemaVersion: 1,
      id: "dev.firefly.vendor-check",
      name: "Vendor Check",
      version: "1.0.0",
      sdk: "^1.2.0",
      main: "index.mjs",
      native: false,
      permissions: [],
    },
  });
  await assert.rejects(
    host.activate(definePlugin({
      async activate(ctx) {
        await ctx.secrets.get("api_key");
      },
      deactivate() {},
    })),
    (err) => err instanceof PluginError && err.code === "ERR_UNDECLARED",
  );
  assert.equal(new PluginError("ERR_INVALID_ARGUMENT", "bad") instanceof PluginError, true);
});

test("vendor integrity script rejects tampered body, altered provenance header, BOM, and tampered companion index", async (t) => {
  const testingRel = "test/vendor/plugin-sdk-testing.mjs";
  const indexRel = "test/vendor/plugin-sdk-index.mjs";

  // 1. Tampered body
  {
    const root = await makeTempRoot(t);
    const target = path.join(root, testingRel);
    const text = await readFile(target, "utf8");
    await writeFile(target, `${text}\n// tampered\n`, "utf8");
    await assert.rejects(verifyVendoredSdk({ root }), /Vendored testing body SHA-256 mismatch/);
  }

  // 2. Altered provenance commit / hash
  {
    const root = await makeTempRoot(t);
    const target = path.join(root, testingRel);
    const text = await readFile(target, "utf8");
    await writeFile(target, text.replace(EXPECTED_VENDOR_SDK.sourceCommitShort, "0000000"), "utf8");
    await assert.rejects(verifyVendoredSdk({ root }), /provenance header missing or altered/);
  }

  // 3. UTF-8 BOM injected
  {
    const root = await makeTempRoot(t);
    const target = path.join(root, testingRel);
    const text = await readFile(target, "utf8");
    await writeFile(target, `\uFEFF${text}`, "utf8");
    await assert.rejects(verifyVendoredSdk({ root }), /Unexpected UTF-8 BOM/);
  }

  // 4. Tampered companion index
  {
    const root = await makeTempRoot(t);
    const target = path.join(root, indexRel);
    const text = await readFile(target, "utf8");
    await writeFile(target, `${text}\n// tampered\n`, "utf8");
    await assert.rejects(verifyVendoredSdk({ root }), /Vendored index SHA-256 mismatch/);
  }
});
