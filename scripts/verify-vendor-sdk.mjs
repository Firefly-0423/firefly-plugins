import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PROVENANCE_MARKER = "// --- END VENDOR PROVENANCE ---";

export const EXPECTED_VENDOR_SDK = {
  sourceCommit: "f046ac9ae74c684fcf1bdf7dfa5cc6c08ded5739",
  sourceCommitShort: "f046ac9",
  sourceSha256: {
    "plugin-sdk/src/testing/index.ts": "cf8b0fcd3f08e046af50455656c1e4098bf67d4ff06cd8a0865d837f3360737c",
    "plugin-sdk/src/index.ts": "c8c045e3f07e72ecff0ee23ecb205f14c1fc915183d9219728ee44282f2a7ed8",
    "src/shared/plugin-protocol.ts": "4a5b5f977c621f2b82a076a3862dfc983c747c64c53840e2a146b6f19924dd50",
  },
  upstreamBundleSha256: "7c91d34449496a70906f7fb4504d9fadc6b744f941384bc5a1873ea510f790fc",
  companionIndexSha256: "22ddbbcfdfdab375316386374a73bea3cb0f67f95459057e05282cb5bd241c47",
  vendoredBodySha256: "ce5258f453a306c7a681782d7fadf916566ee4dc1e8d1e3549e92866b5443284",
  generationCommand: "node scripts/plugin-sdk/build-sdk.mjs",
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readRegularUtf8(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
    throw new Error(`Expected regular file, not link: ${filePath}`);
  }
  const raw = await readFile(filePath);
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    throw new Error(`Unexpected UTF-8 BOM in vendored file: ${path.basename(filePath)}`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (text.includes("\r\n")) {
    throw new Error(`Expected LF line endings in vendored file: ${path.basename(filePath)}`);
  }
  return text;
}

function assertProvenanceHeader(header) {
  const requiredSnippets = [
    `Source commit: ${EXPECTED_VENDOR_SDK.sourceCommit} (${EXPECTED_VENDOR_SDK.sourceCommitShort})`,
    ...Object.entries(EXPECTED_VENDOR_SDK.sourceSha256).map(
      ([file, digest]) => `Source SHA-256 (${file}): ${digest}`,
    ),
    `Upstream bundle SHA-256 (plugin-sdk/dist/esm/testing/index.mjs): ${EXPECTED_VENDOR_SDK.upstreamBundleSha256}`,
    `Companion index SHA-256 (test/vendor/plugin-sdk-index.mjs): ${EXPECTED_VENDOR_SDK.companionIndexSha256}`,
    `Vendored body SHA-256 (below provenance marker, ./plugin-sdk-index.mjs import): ${EXPECTED_VENDOR_SDK.vendoredBodySha256}`,
    `Generation command: ${EXPECTED_VENDOR_SDK.generationCommand}`,
  ];
  for (const snippet of requiredSnippets) {
    if (!header.includes(snippet)) {
      throw new Error(`Vendored SDK provenance header missing or altered: "${snippet}"`);
    }
  }
}

export async function verifyVendoredSdk({ root = REPO_ROOT, sourceRepo } = {}) {
  const testingPath = path.join(root, "test/vendor/plugin-sdk-testing.mjs");
  const indexPath = path.join(root, "test/vendor/plugin-sdk-index.mjs");

  const testingText = await readRegularUtf8(testingPath);
  const indexText = await readRegularUtf8(indexPath);

  const markerLine = `${PROVENANCE_MARKER}\n`;
  const markerAt = testingText.indexOf(markerLine);
  if (markerAt === -1) {
    throw new Error(`Missing provenance marker "${PROVENANCE_MARKER}" in test/vendor/plugin-sdk-testing.mjs`);
  }

  const header = testingText.slice(0, markerAt);
  const body = testingText.slice(markerAt + markerLine.length);
  assertProvenanceHeader(header);

  const actualBodySha = sha256(Buffer.from(body, "utf8"));
  if (actualBodySha !== EXPECTED_VENDOR_SDK.vendoredBodySha256) {
    throw new Error(
      `Vendored testing body SHA-256 mismatch: expected ${EXPECTED_VENDOR_SDK.vendoredBodySha256}, got ${actualBodySha}`,
    );
  }

  const restoredUpstream = body.replace('from "./plugin-sdk-index.mjs";', 'from "../index.mjs";');
  const actualUpstreamSha = sha256(Buffer.from(restoredUpstream, "utf8"));
  if (actualUpstreamSha !== EXPECTED_VENDOR_SDK.upstreamBundleSha256) {
    throw new Error(
      `Restored upstream bundle SHA-256 mismatch: expected ${EXPECTED_VENDOR_SDK.upstreamBundleSha256}, got ${actualUpstreamSha}`,
    );
  }

  const actualIndexSha = sha256(Buffer.from(indexText, "utf8"));
  if (actualIndexSha !== EXPECTED_VENDOR_SDK.companionIndexSha256) {
    throw new Error(
      `Vendored index SHA-256 mismatch: expected ${EXPECTED_VENDOR_SDK.companionIndexSha256}, got ${actualIndexSha}`,
    );
  }

  const imports = [...body.matchAll(/^import\s+[^;]+\s+from\s+"([^"]+)";$/gm)].map((m) => m[1]);
  if (imports.length !== 2 || imports[0] !== "ajv" || imports[1] !== "./plugin-sdk-index.mjs") {
    throw new Error(`Unexpected external imports in vendored testing helper: ${JSON.stringify(imports)}`);
  }

  if (sourceRepo) {
    for (const [rel, expectedDigest] of Object.entries(EXPECTED_VENDOR_SDK.sourceSha256)) {
      const normalized = (await readFile(path.join(sourceRepo, rel), "utf8")).replace(/\r\n/g, "\n");
      const actual = sha256(Buffer.from(normalized, "utf8"));
      if (actual !== expectedDigest) {
        throw new Error(`Source file SHA-256 mismatch for ${rel}: expected ${expectedDigest}, got ${actual}`);
      }
    }
  }

  return {
    sourceCommit: EXPECTED_VENDOR_SDK.sourceCommit,
    vendoredBodySha256: actualBodySha,
    upstreamBundleSha256: actualUpstreamSha,
    companionIndexSha256: actualIndexSha,
  };
}

export function parseArgs(args) {
  let sourceRepo;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source") {
      sourceRepo = args[++i];
      if (!sourceRepo) throw new Error("--source requires a directory path");
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  return { sourceRepo };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyVendoredSdk(parseArgs(process.argv.slice(2)));
    console.log(
      `[vendor-sdk] Verified test/vendor/plugin-sdk-testing.mjs (commit ${result.sourceCommit.slice(0, 7)}, body SHA-256 ${result.vendoredBodySha256})`,
    );
  } catch (error) {
    console.error(`[vendor-sdk] ${error.message}`);
    process.exitCode = 1;
  }
}
