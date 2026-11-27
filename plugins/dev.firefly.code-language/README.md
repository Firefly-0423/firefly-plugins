# 代码语言识别（dev.firefly.code-language）

Firefly Plugin SDK 1.2.0 插件，版本 2.0.1，清单文件为 `firefly.plugin.json`。

在 `work` 与 `code` 模式下提供离线工具 `detect`（声明风险为 `fs-read`，`permissions: []`，在 `chat` 模式下不可用），按文件名里的扩展名识别语法高亮语言，不读取文件内容。

## `detect`

参数 `{ "paths": ["src/app.ts", "C:\\dir\\main.PS1", ".env"] }`，1 到 200 项，每项最多 1024 个字符。成功时返回 `ToolResult`（`status: "succeeded"`），`output` 为：

```json
{ "results": [
  { "path": "src/app.ts", "language": "typescript", "shortName": "ts" },
  { "path": "C:\\dir\\main.PS1", "language": "powershell", "shortName": "ps1" },
  { "path": ".env", "language": "dotenv", "shortName": "env" }
] }
```

- `language` 是语法高亮语法的 id（如 `shellscript`、`system-verilog`），`shortName` 是短名（如 `sh`、`sv`；`tsx`、`jsx`、`tf`、`tfvars`、`gradle` 保留自己的后缀）。
- 取最后一段文件名里最后一个点之后的文字，不区分大小写；同时识别 `/` 和 `\`。开头的点也算分隔符，所以 `.env` 是 `dotenv`。
- 未收录的扩展名、没有扩展名的名字（`Makefile`、`Dockerfile`、`.gitignore`）、结尾是点的名字，以及 `foo.constructor`、`foo.__proto__` 这类名字都返回 `null`。证书和锁文件扩展名（`pem`、`crt`、`key`、`cer`、`lock`）有意不收录。
- 共 61 种语言、115 个扩展名；这是精选表，不是完整的语言注册表，也不嗅探内容。

## 来源

扩展名表（含短名表）原样复制自 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 `packages/util/code-language/src/index.ts`（提交 `86a402200d95fecef4529d969836f1fe13c6cb0d`），查找逻辑是 `languageForPath` 和 `readLangHintForPath` 的 JavaScript 移植，MIT 许可，`Copyright (c) 2026 DeepSeek`。工具入口、参数校验和结果格式是 Firefly 新写的。随包 LICENSE 保留原版权声明。

## 安全

入口只做内存内纯 JS 计算，无外部运行时依赖，不联网、不读写文件、不启动命令、不使用计时器，不持久化或记录输入。停用时 `deactivate()` 释放工具注册。

构建：在 [firefly-plugins](https://github.com/Firefly-0423/firefly-plugins) 仓库运行 `npm run build`，输出在 `dist/`。
