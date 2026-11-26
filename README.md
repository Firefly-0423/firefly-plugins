<p align="center"><b>简体中文</b> · <a href="#english">English</a></p>

# Firefly 插件市场

这是 [Firefly](https://github.com/Firefly-0423/Firefly-Agent) 的官方插件市场（面向 Firefly 1.2.0 / Plugin SDK 1.2.0）：插件源码、应用读取的目录 `registry.json`，以及校验、打包和发布插件的工具。

## 应用如何使用这里

| 内容 | 地址 |
| --- | --- |
| 目录 | `https://raw.githubusercontent.com/Firefly-0423/firefly-plugins/main/registry.json` |
| 插件包 | 本仓库的 GitHub Release，`<id>-<version>/<id>-<version>.ffplugin` |

Firefly 1.2.0 在设置的插件页打开市场时读取 `apiVersion: 2` 目录，从对应的仓库目录下载 `.ffplugin` 包，并核对目录记录的 SHA-256。安装后的插件默认**停用**，需要用户明确启用（启用即信任该插件进程的代码）。

## 现有插件

| 插件 | 作用 |
| --- | --- |
| `dev.firefly.text-stats` 文本统计 | 统计 Unicode 字符、空白分隔词和非空行 |
| `dev.firefly.json-tools` JSON 工具 | 无损校验 JSON，比较两段 JSON 的结构差异 |
| `dev.firefly.timezone-tools` 时区工具 | 校验 IANA 时区名，在时区之间换算时间（处理夏令时） |
| `dev.firefly.code-language` 代码语言识别 | 按文件扩展名识别语法高亮语言，只看文件名 |
| `dev.firefly.text-trim` 文本截断 | 按 UTF-8 字节预算截断长文本的开头、结尾或两端 |
| `dev.firefly.study-cards` 语言学习 | 六语言阅读查词、生词与卡片复习（0.3.0，含独立工作台窗口） |

前五个插件完全离线运行：不联网、不读写文件、不执行命令。`dev.firefly.study-cards` 使用插件数据目录 `ctx.dataDir` 下的 `learning.sqlite`（并事务迁移旧版 `cards-v1.json`）持久化数据与主题设置；本机文件打开/导入/导出需等待 1.2.x 宿主文件选择能力。

> **关于 `dev.firefly.drawai`**：分支源码中保留 `plugins/dev.firefly.drawai/`，但**暂未收录进 1.2.0 线上市场索引（`registry.json`）**，原因是其独立画布窗口的打开、另存为和导出流程需要 Firefly **1.2.x 的宿主文件选择能力**；其余 6 个插件照常收录并发布。

## 开发一个插件

1.2.0 的仓库直装目录位于 `marketplace-v2` 分支的 `marketplace/registry.json`，包位于同目录下的 `packages/`。修改插件后先运行 `npm run build`，再运行 `npm run build:repository-catalog`，提交目录和新增包，然后运行 `npm test` 与 `npm run check`。同名包如果字节变化，构建会报错，须先提升插件版本；旧包可保留给仍缓存旧目录的客户端。旧版市场继续使用 `main`，`registry.json` 的 Release 格式供已有发布工具使用。

需要 Node.js 24。

```bash
npm ci
npm run new-plugin dev.example.my-plugin   # 在 plugins/dev.example.my-plugin/ 生成 1.2.0 模板
npm test                                    # 运行全部测试
npm run build                               # 生成 dist/ 下的 .ffplugin 和 registry.json
```

每个插件一个目录 `plugins/<id>/`（`<id>` 须为反向域名 `^[a-z0-9]+(\.[a-z0-9-]+){2,}$`，6–64 字符），包含 `firefly.plugin.json`、入口 `.cjs`/`.mjs`、`README.md`、`LICENSE` 和 `catalog.json`（市场里展示的能力说明）。投稿流程和审核标准见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

带额外 UI/运行时的包可在 `package-files.json` 中显式列出附加文本资源；构建器校验路径、重复项、链接、大小与 UTF-8，并拒绝 `native: true` 或任何 `.node`/`.dll` 二进制文件。DrawAI 的固定上游来源保存在 `scripts/upstream/`，运行 `node scripts/vendor-drawai.mjs --check` 检查离线运行时与来源转换一致。

## 安全模型

- 目录固定每个 `.ffplugin` 包的 SHA-256，以及插件声明的 `sdk`、`native: false`、`permissions` 和 `tools` 风险列表；同一版本发布后字节不再改变，任何改动都必须提升版本号。
- 仓库直装包由已提交的源码生成，构建结果可复现（固定时间戳、固定文件列表、统一 LF 换行）；CI 校验目录和已提交的包。
- 插件运行在独立子进程，默认停用，工具按宿主的权限档位和审批规则执行；线上目录不接受混淆代码、远程加载代码或原生二进制模块。

## 许可

仓库工具采用 [MIT License](./LICENSE)，每个插件以自己目录里的 `LICENSE` 为准，来源说明见 [NOTICE](./NOTICE)。流萤及《崩坏：星穹铁道》相关角色与知识产权归 HoYoverse / 米哈游所有，本项目为非官方、非商业的同人项目。

---

<a id="english"></a>

# Firefly plugin marketplace

The official plugin marketplace for [Firefly](https://github.com/Firefly-0423/Firefly-Agent) (Firefly 1.2.0 / Plugin SDK 1.2.0): plugin sources, the `registry.json` (`apiVersion: 2`) catalog the app reads, and the tooling that validates, packages and releases `.ffplugin` packages.

**How the app uses it.** Firefly 1.2.0 reads `marketplace/registry.json` on `marketplace-v2`, downloads the corresponding packages from `marketplace/packages/`, and checks each package against the SHA-256 in the catalog. Installed plugins start **disabled**; enabling a plugin trusts its process code.

**Plugins.** `dev.firefly.text-stats`, `dev.firefly.json-tools`, `dev.firefly.timezone-tools`, `dev.firefly.code-language`, and `dev.firefly.text-trim` run offline in memory. `dev.firefly.study-cards` (0.3.0) upgrades the cards plugin into a six-language learning workbench with SQLite persistence in `ctx.dataDir`, demo dictionaries, vocabulary/review flows, and a `ui.windows` window (local file open/import/export awaits 1.2.x host file-picker support). `dev.firefly.drawai` remains in `plugins/dev.firefly.drawai/` on the branch, but is **excluded from the 1.2.0 marketplace index (`registry.json`)** because its window open/save-as/export flows require 1.2.x host file-picker capabilities; the 6 remaining plugins are published as normal.

**Develop.** With Node.js 24: `npm ci`, `npm run new-plugin <reverse-domain-id>`, `npm test`, `npm run build`. Each plugin lives in `plugins/<id>/` with `firefly.plugin.json`, a `.cjs`/`.mjs` entry, `README.md`, `LICENSE`, and `catalog.json`. See [CONTRIBUTING.md](./CONTRIBUTING.md).

**Security.** Pinned SHA-256 per `.ffplugin`, `native: false` enforced by the online catalog (`.node`/`.dll` rejected), reproducible builds, plugins start disabled, and no obfuscated or remote code is accepted.

**License.** Tooling is [MIT](./LICENSE); each plugin follows the `LICENSE` in its directory; see [NOTICE](./NOTICE). Firefly and Honkai: Star Rail IP belong to HoYoverse / miHoYo; this is an unofficial, non-commercial fan project.
