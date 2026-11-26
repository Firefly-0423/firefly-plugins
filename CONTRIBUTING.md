# 投稿与审核 / Contributing

## 投稿流程

1. Fork 本仓库，运行 `npm ci`，再用 `npm run new-plugin <id>` 生成 `plugins/<id>/`。`<id>` 必须符合反向域名规则 `^[a-z0-9]+(\.[a-z0-9-]+){2,}$`（6–64 字符），且不能与现有插件重名。
2. 实现入口 `.cjs`/`.mjs`（Firefly 1.2.0 `activate(ctx)` / `deactivate(reason)`），在 `firefly.plugin.json` 中声明 `schemaVersion: 1`、`sdk`、`native: false`、真实工具风险与权限；在 `README.md` 写清用途、用法和权限需要，在 `catalog.json` 写 1–20 行能力说明，放上 `LICENSE`。
3. 在 `test/` 里使用 `createTestHost()` 为插件的工具和权限边界补测试，运行 `npm test` 和 `npm run build`，把更新后的 `registry.json` 一起提交。
4. 发起 PR，按模板勾选自查项。CI 会在 Windows 和 Linux 上跑测试，并核对 `registry.json` 与源码一致。
5. 维护者审核并合并后，手动运行 **Release plugins** 工作流，为新的 `<id>-<version>` 创建 Release（上传 `<id>-<version>.ffplugin`）。

带额外 UI/运行时的包使用 `package-files.json`（仅 `files` 字段）显式列出最多 128 个附加资源，每项最多 2 MiB。只接受普通 UTF-8 文本文件，不接受符号链接、隐藏路径、路径穿越或大小写重复项。工具必须声明真实风险级（不允许 `safe`）；`firefly.plugin.json` 仅使用 1.2.0 schema 已定义的字段。

## 审核标准

- **默认离线**：不联网、不读写文件、不执行命令。确有需要时必须在 `firefly.plugin.json` 里声明对应风险与权限，并在 README 中说明理由；审核会逐项确认。
- **禁止原生二进制模块**：线上目录只收录 `native: false` 的纯 JS / Wasm 插件包，包内出现 `.node` / `.dll` 直接拒绝。
- **代码可读**：不接受混淆、压缩或打包后的代码，也不接受运行时下载并执行的远程代码。
- **默认停用、1.2.0 契约**：不兼容 0.x 清单字段（`apiVersion`、`entry`、`deps`、`defaultEnabled` 等），使用 `schemaVersion: 1` 与当前 `sdk` 范围（见 `schema/host-contract.json`）。
- **许可清楚**：必须带 `LICENSE`；改编自他人的代码要保留原作者的版权声明，并在 README 中注明来源。
- **版本不可变**：已发布版本的字节永远不变。修 bug、改文案也要提升版本号（SemVer）。

## Contributing (English)

1. Fork, `npm ci`, then `npm run new-plugin <id>` (reverse-domain id matching `^[a-z0-9]+(\.[a-z0-9-]+){2,}$`, 6-64 chars; must be unique).
2. Implement the 1.2.0 plugin entry (`activate`/`deactivate`) and `firefly.plugin.json` (`schemaVersion: 1`, `native: false`, explicit tool risks and permissions); document purpose, usage, and permissions in `README.md`; list 1-20 capability lines in `catalog.json`; include a `LICENSE`.
3. Add `createTestHost()` tests under `test/`, run `npm test` and `npm run build`, and commit the regenerated `registry.json`.
4. Open a PR and complete the checklist. CI runs tests on Windows and Linux and checks that `registry.json` matches sources.
5. After review and merge, a maintainer runs **Release plugins** to publish `<id>-<version>.ffplugin`.

Review rules: offline by default, `native: false` only (no `.node`/`.dll` in the online catalog), readable code only (no obfuscation, bundles, or remote code), 1.2.0 manifest only (no `safe` tool risk and no 0.x manifest fields), clear license with upstream notices kept, and immutable published versions.
