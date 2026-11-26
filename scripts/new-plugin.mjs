import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readContract, REPO_ROOT, validateId } from "./build.mjs";

export async function newPlugin(id, { root = REPO_ROOT } = {}) {
  validateId(id);
  const { schemaVersion, sdkVersion } = await readContract(root);
  const license = await readFile(path.join(root, "LICENSE"), "utf8");
  const parent = path.join(root, "plugins");
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("plugins must be a real directory");
  const dir = path.join(parent, id);
  const manifest = {
    schemaVersion,
    id,
    name: id,
    version: "0.1.0",
    sdk: `^${sdkVersion}`,
    description: "Offline example: trim surrounding whitespace from text. / 离线示例：去除文本两端空白。",
    author: { name: "Firefly-0423" },
    license: "MIT",
    main: "index.cjs",
    native: false,
    tools: [
      {
        name: "trim",
        title: "去除两端空白",
        risk: ["fs-read"],
        modes: ["work", "code"],
      },
    ],
    permissions: [],
  };
  const entry = `"use strict";

const TOOL_NAME = "trim";
let registration;

module.exports = {
  activate(ctx) {
    if (registration) throw new Error("${id} is already activated");
    registration = ctx.tools.register({
      name: TOOL_NAME,
      description: "Trim surrounding whitespace offline. No network, file or shell access.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", maxLength: 10000 } },
        required: ["text"],
        additionalProperties: false,
      },
      describeApproval() {
        return { summary: "离线去除文本两端空白" };
      },
      async execute(args, call) {
        if (call && call.signal && call.signal.aborted) {
          return { status: "not_executed", reason: "已取消" };
        }
        if (!args || typeof args.text !== "string") {
          return { status: "not_executed", reason: "text must be a string" };
        }
        if (args.text.length > 10000) {
          return { status: "not_executed", reason: "text must be at most 10000 characters" };
        }
        return { status: "succeeded", output: { text: args.text.trim() } };
      },
    });
  },
  deactivate() {
    if (!registration) return;
    const current = registration;
    registration = undefined;
    current.dispose();
  },
};
`;
  const readme = `# ${id}

Firefly Plugin SDK ^${sdkVersion}，初次安装停用，由用户明确启用。
工具 \`trim\` 接受 \`{ "text": " hello " }\`，返回 \`{ "text": "hello" }\`。
只做内存内计算；不联网、不读写文件、不执行命令。输入最多 10,000 个 UTF-16 码元。
启用插件即信任该插件进程的代码，离线设计不代表存在 OS 沙箱。

仓库根目录运行 / Run from the repository root: \`npm test\`, \`npm run build\`, \`npm run check\`.
提交前添加行为测试，更新说明与署名，保留所有适用的来源声明。许可证见 LICENSE。
`;
  await mkdir(dir);
  for (const [file, contents] of Object.entries({
    "firefly.plugin.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "index.cjs": entry,
    "README.md": readme,
    LICENSE: license.replace(/\r\n/g, "\n"),
    "catalog.json": `${JSON.stringify({ capabilities: ["离线去除文本两端空白 / Trim surrounding whitespace offline"] }, null, 2)}\n`,
  })) {
    await writeFile(path.join(dir, file), contents, { flag: "wx" });
  }
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/new-plugin.mjs <dev.example.plugin-id>");
    console.log(`Created ${await newPlugin(process.argv[2])}; add tests and review attribution before submitting.`);
  } catch (error) {
    console.error(`[new-plugin] ${error.message}`);
    process.exitCode = 1;
  }
}
