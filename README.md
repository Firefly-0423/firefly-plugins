<p align="center"><b>简体中文</b> · <a href="#english">English</a></p>

# Firefly 插件市场

这是 [Firefly](https://github.com/Firefly-0423/Firefly-Agent) 的官方插件市场：插件源码、应用读取的目录 `registry.json`，以及校验、打包和发布插件的工具。

## 应用如何使用这里

| 内容 | 地址 |
| --- | --- |
| 目录 | `https://raw.githubusercontent.com/Firefly-0423/firefly-plugins/main/registry.json` |
| 插件包 | 本仓库的 GitHub Release，`<id>-<version>/<id>-<version>.zip` |

Firefly 在设置的插件页打开市场时读取目录，安装时只从本仓库的 Release 下载，并核对目录里记录的 SHA-256，不一致就拒绝安装。安装后的插件默认**停用**，需要你手动启用。

## 现有插件

| 插件 | 作用 |
| --- | --- |
| `text-stats` 文本统计 | 统计字符、词和非空行 |
| `json-tools` JSON 工具 | 校验 JSON，比较两段 JSON 的结构差异 |
| `timezone-tools` 时区工具 | 校验 IANA 时区名，在时区之间换算时间（处理夏令时） |
| `code-language` 代码语言识别 | 按文件扩展名识别语法高亮语言，只看文件名 |
| `text-trim` 文本截断 | 按 UTF-8 字节预算截断长文本的开头、结尾或两端 |
| `study-cards` 学习卡片 | 创建和复习本地问答卡，无需 Anki；尚未发布 |

前五个插件完全离线运行：不联网、不读写文件、不执行命令。学习卡片插件不联网，通过 Firefly 的插件私有存储保存卡片和复习记录；详见 [插件说明](plugins/study-cards/README.md)。目录记录不代表 Release ZIP 已发布，市场在线安装需先发布对应 ZIP。

## 开发一个插件

需要 Node.js 24。

```bash
npm ci
npm run new-plugin my-plugin   # 在 plugins/my-plugin/ 生成模板
npm test                       # 运行全部测试
npm run build                  # 生成 dist/ 下的 ZIP 和 registry.json
```

每个插件一个目录 `plugins/<id>/`，包含 `manifest.json`、`index.cjs`、`README.md`、`LICENSE` 和 `catalog.json`（市场里展示的能力说明）。投稿流程和审核标准见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 安全模型

- 目录固定每个包的 SHA-256；同一版本发布后字节不再改变，任何改动都必须提升版本号。
- 包只从本仓库的 Release 下载，由 CI 用已提交的源码构建，构建结果可复现（固定时间戳、固定文件列表、统一 LF 换行）。
- 插件默认停用，权限按宿主的审批规则执行；没有混淆代码，也不加载远程代码。

## 许可

仓库工具采用 [MIT License](./LICENSE)，每个插件以自己目录里的 `LICENSE` 为准，来源说明见 [NOTICE](./NOTICE)。流萤及《崩坏：星穹铁道》相关角色与知识产权归 HoYoverse / 米哈游所有，本项目为非官方、非商业的同人项目。

---

<a id="english"></a>

# Firefly plugin marketplace

The official plugin marketplace for [Firefly](https://github.com/Firefly-0423/Firefly-Agent): plugin sources, the `registry.json` catalog the app reads, and the tooling that validates, packages and releases plugins.

**How the app uses it.** Firefly reads `https://raw.githubusercontent.com/Firefly-0423/firefly-plugins/main/registry.json`, downloads packages only from this repository's GitHub Releases (`<id>-<version>/<id>-<version>.zip`), and checks each package against the SHA-256 in the catalog. Installed plugins start **disabled**.

**Plugins.** `text-stats`, `json-tools`, `timezone-tools`, `code-language` and `text-trim`, all fully offline: no network, no file access, no commands.

**Develop.** With Node.js 24: `npm ci`, `npm run new-plugin <id>`, `npm test`, `npm run build`. Each plugin lives in `plugins/<id>/` with `manifest.json`, `index.cjs`, `README.md`, `LICENSE` and `catalog.json`. See [CONTRIBUTING.md](./CONTRIBUTING.md).

**Security.** Pinned SHA-256 per package, published bytes never change (any change needs a new version), packages are built reproducibly by CI from committed sources, plugins are disabled on install, and no obfuscated or remote code is accepted.

**License.** Tooling is [MIT](./LICENSE); each plugin follows the `LICENSE` in its directory; see [NOTICE](./NOTICE). Firefly and Honkai: Star Rail IP belong to HoYoverse / miHoYo; this is an unofficial, non-commercial fan project.
