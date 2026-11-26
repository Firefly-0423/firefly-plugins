# DrawAI 画布（dev.firefly.drawai）

Firefly 1.2.0 离线插件，版本 0.2.0（暂未收录进 1.2.0 线上市场索引 `registry.json`）。独立画布窗口的打开、另存为与导出流程需要 **1.2.x 宿主文件选择能力**，因此当前仅在源码分支保留代码等待宿主文件选择接口就绪；工作区内的 `read` / `apply` 工具已迁移至 SDK 1.2.0 契约。

## 1.2.0 能力与权限声明

- **工具**：
  - `read`（`fs-read`，`work` / `code`）：读取当前绑定工作区 `.drawio` 的节点、连线、图层、页与 `revision`。
  - `apply`（`fs-write`，`work` / `code`）：在当前绑定工作区新建、结构化修改或布局 `.drawio` 文件，受 `expectRevision` 冲突保护。
- **宿主权限**：
  - `workspace.read`：读取当前会话绑定的工作区根目录。
  - `ui.windows`：打开独立画布窗口并通过 `window.fireflyPlugin` / `ctx.ui` 通信。
- **私有数据**：恢复草稿与界面主题保存在插件数据目录 `ctx.dataDir`。

## 功能与限制

- 支持新建/打开 `.drawio`、节点与连线编辑、图层、多页、撤销/重做（最近 8 次）、SVG/PNG 导出及最多 5 份恢复草稿。
- 限制：UTF-8 `.drawio` 最大 8 MiB、展开累计 16 MiB、25 页、当前页 1000 节点/连线、单次 100 操作、标签 4096 字符、处理最长 10 秒可取消；PNG 最长边 4096 像素。
- 插件不直接调用模型、不联网、不执行命令，且声明 `native: false`。启用插件即信任该插件进程的代码。

## 来源与许可

改编自 `fourzkw/dsh-drawai@80eb15e0a3a11cb4c88cf8716382d03cdf0e5b03`（MIT，Copyright (c) 2026 fourzkw）。完整许可和转换来源见 `upstream/LICENSE` 与 `upstream/SOURCES.json`；XML 校验器许可见 `vendor/`。
