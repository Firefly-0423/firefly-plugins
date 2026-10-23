## 插件 / Plugin

- ID 与版本 / id and version:
- 新插件还是新版本 / new plugin or new version:
- 做什么 / what it does:

## 自查 / Checklist

- [ ] `manifest.json` 中 `defaultEnabled` 为 `false`，版本号符合 SemVer / disabled by default, valid SemVer
- [ ] 默认离线：不联网、不读写文件、不执行命令；如需要，已在 README 和 `catalog.json` 中说明理由 / offline by default, or the need is declared and justified
- [ ] 没有混淆或压缩过的代码，没有下载并执行的远程代码 / no obfuscated or minified code, no remote code
- [ ] 带 `LICENSE`，第三方来源已在 LICENSE 和 README 中注明 / license included, third-party sources credited
- [ ] 已发布版本的文件没有改动；任何改动都提升了版本号 / published versions untouched, changes bump the version
- [ ] 已运行 `npm test` 和 `npm run build`，并提交了更新后的 `registry.json` / tests pass, registry regenerated
