import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readContract, REPO_ROOT, validateId } from "./build.mjs";

export async function newPlugin(id, { root = REPO_ROOT } = {}) {
  validateId(id);
  const { pluginApiVersion } = await readContract(root);
  const license = await readFile(path.join(root, "LICENSE"), "utf8");
  const parent = path.join(root, "plugins");
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("plugins must be a real directory");
  const dir = path.join(parent, id);
  const manifest = {
    apiVersion: pluginApiVersion,
    id,
    name: id,
    version: "0.1.0",
    description: "Offline example: trim surrounding whitespace from text. / 离线示例：去除文本两端空白。",
    author: "Firefly-0423",
    entry: "index.cjs",
    defaultEnabled: false,
    deps: [],
  };
  const entry = `"use strict";

const TOOL_ID = "${id}_trim";
let activeContext;

module.exports = {
  register(ctx) {
    if (activeContext) throw new Error("${id} is already registered");
    ctx.registerTool({
      id: TOOL_ID,
      name: "Trim whitespace / 去除两端空白",
      description: "Trim surrounding whitespace offline. No network, file or shell access.",
      enabled: true,
      risk: "safe",
      effectKind: "read",
      verificationPolicy: "none",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", maxLength: 10000 } },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args) {
        if (!args || typeof args.text !== "string") throw new TypeError("text must be a string");
        if (args.text.length > 10000) throw new RangeError("text must be at most 10000 characters");
        return JSON.stringify({ text: args.text.trim() });
      },
    });
    activeContext = ctx;
  },
  unregister() {
    if (!activeContext) return;
    const ctx = activeContext;
    activeContext = undefined;
    ctx.unregisterTool(TOOL_ID);
  },
};
`;
  const readme = `# ${id}

Firefly Plugin API v${pluginApiVersion}，初次安装停用，由用户明确启用。
工具 \`${id}_trim\` 接受 \`{ "text": " hello " }\`，返回 JSON 字符串 \`{ "text": "hello" }\`。
只做内存内计算；不联网、不读写文件、不执行命令。输入最多 10,000 个 UTF-16 码元。
插件在宿主主进程中运行，离线设计不代表存在权限沙箱。

An offline Firefly plugin, installed disabled. Explicitly enable it to use \`${id}_trim\`.
The tool trims surrounding whitespace, rejects non-string input, and accepts at most 10,000 UTF-16 code units.
No network, filesystem, shell, timers, or persistence. Plugins run with the host process's privileges.

仓库根目录运行 / Run from the repository root: \`npm test\`, \`npm run build\`, \`npm run check\`.
提交前添加行为测试，更新说明与署名，保留所有适用的来源声明。许可证见 LICENSE。
Add behaviour tests, update documentation and authorship, and retain upstream notices before submitting. See LICENSE.
`;
  // Non-recursive creation refuses existing plugins (including symlinks) without overwriting anything.
  await mkdir(dir);
  for (const [file, contents] of Object.entries({
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "index.cjs": entry,
    "README.md": readme,
    LICENSE: license.replace(/\r\n/g, "\n"),
    "catalog.json": `${JSON.stringify({ capabilities: ["离线去除文本两端空白 / Trim surrounding whitespace offline"] }, null, 2)}\n`,
  })) await writeFile(path.join(dir, file), contents, { flag: "wx" });
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/new-plugin.mjs <lowercase-plugin-id>");
    console.log(`Created ${await newPlugin(process.argv[2])}; add tests and review attribution before submitting.`);
  } catch (error) { console.error(`[new-plugin] ${error.message}`); process.exitCode = 1; }
}
