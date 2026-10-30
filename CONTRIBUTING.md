# 投稿与审核 / Contributing

## 投稿流程

1. Fork 本仓库，运行 `npm ci`，再用 `npm run new-plugin <id>` 生成 `plugins/<id>/`。`<id>` 只用小写字母、数字和连字符，且不能与现有插件重名。
2. 实现 `index.cjs`，在 `README.md` 写清用途、用法和权限需要，在 `catalog.json` 写 1–20 行能力说明，放上 `LICENSE`。
3. 在 `test/` 里为插件的工具补测试，运行 `npm test` 和 `npm run build`，把更新后的 `registry.json` 一起提交。
4. 发起 PR，按模板勾选自查项。CI 会在 Windows 和 Linux 上跑测试，并核对 `registry.json` 与源码一致。
5. 维护者审核并合并后，手动运行 **Release plugins** 工作流，为新的 `<id>-<version>` 创建 Release。

带额外 UI/运行时的包使用 `package-files.json`（仅 `files` 字段）显式列出最多 128 个附加资源，每项最多 2 MiB。只接受普通 UTF-8 文本文件，不接受链接、隐藏路径、路径穿越或大小写重复项。前五个插件的基础四文件构建方式和已发布字节保持不变。文件访问必须在 README 说明范围，并为工具声明真实风险级；manifest 仅使用 schema 已定义的字段。

## 审核标准

- **默认离线**：不联网、不读写文件、不执行命令。确有需要时必须在 manifest 里声明，并在 README 中说明理由；审核会逐项确认。
- **代码可读**：不接受混淆、压缩或打包后的代码，也不接受运行时下载并执行的远程代码。
- **默认停用**：`manifest.json` 中 `defaultEnabled` 必须为 `false`，并使用当前插件 API 版本（见 `schema/host-contract.json`）。
- **许可清楚**：必须带 `LICENSE`；改编自他人的代码要保留原作者的版权声明，并在 README 中注明来源。
- **版本不可变**：已发布版本的字节永远不变。修 bug、改文案也要提升版本号（SemVer）。

## Contributing (English)

1. Fork, `npm ci`, then `npm run new-plugin <id>` (lowercase letters, digits and hyphens; must be unique).
2. Implement `index.cjs`; document purpose, usage and any permissions in `README.md`; list 1-20 capability lines in `catalog.json`; include a `LICENSE`.
3. Add tests under `test/`, run `npm test` and `npm run build`, and commit the regenerated `registry.json`.
4. Open a PR and complete the checklist. CI runs the tests on Windows and Linux and checks that `registry.json` matches the sources.
5. After review and merge, a maintainer runs the **Release plugins** workflow to publish the new `<id>-<version>`.

Review rules: offline by default (any network, file or command access must be declared and justified), readable code only (no obfuscation, bundles or remote code), `defaultEnabled: false` with the current plugin API version, a clear license with upstream notices kept, and immutable published versions (every change bumps the version).
