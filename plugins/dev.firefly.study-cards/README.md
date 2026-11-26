# 语言学习（dev.firefly.study-cards）

Firefly 1.2.0 插件，版本 0.3.0。阅读文章、划词查词、收藏生词与卡片复习，支持英语、日语、韩语、法语、德语、西班牙语，中文界面；保留学习卡全部七个基础工具并新增查词与生词收藏工具，无需 Anki、MCP 服务或额外运行时。

## 1.2.0 能力与权限声明

- **工具**（`work` / `code` 模式可用）：
  - `create`（`fs-write`）、`review`（`fs-write`）、`update`（`fs-write`）、`delete`（`fs-write`）、`collect`（`fs-write`）
  - `new`（`fs-read`）、`due`（`fs-read`）、`list`（`fs-read`）、`lookup`（`fs-read`）
- **宿主权限**：
  - `ui.windows`：通过 `manifest.ui.windows` 声明独立学习窗口，使用宿主提供的 `window.fireflyPlugin` 桥接与插件进程（`ctx.ui.onMessage`）通信，遵守严格 CSP（无内联脚本）。
- **私有数据**：
  - 学习卡片、生词、文章与词典索引保存在 `ctx.dataDir` 下的 `learning.sqlite`，界面主题偏好保存在 `ctx.dataDir` 下的 `settings.json`。
  - 首次启用若 `ctx.dataDir` 中存在 0.1.x 的 `cards-v1.json`，会在 SQLite 事务中一次性校验并迁入原卡片 ID、版本、牌组、到期时间、间隔与复习次数；原 `cards-v1.json` 不会被删除或改写，损坏文件拒绝迁移和写入。

## 当前功能与 1.2.x 待开放项

- **已支持**：
  1. 独立学习工作台窗口：试读六语种示例、粘贴/编辑/保存文章、记录阅读进度、划词或输入查词、系统本地语音合成朗读。
  2. 六语种原创演示词典（`demoInstall`）、词典启用/停用/排序/删除，以及生词本搜索/筛选/编辑/删除。
  3. 卡片复习队列（四档评分：重来 10 分钟、困难 1 天、良好至少 3 天或 2 倍、简单至少 7 天或 2.5 倍，上限 365 天，卡片总量上限 1000 张）。
  4. 浅色（Firefly 冷灰蓝）与深色（黑底配流萤绿）外观切换及尊重系统「减少动态效果」的轻量过渡动画。
- **等待 Firefly 1.2.x 宿主文件选择能力**：
  - 打开本机 `.txt`/`.md` 文章文件、选择导入本机 Yomitan v3 `.zip` 词典、以及选择本机路径导出 JSON 备份需要宿主文件选择/保存对话框能力，窗口中已禁用对应入口并在 1.2.x 就绪后恢复；当前版本不接受窗口消息传入的任意本机路径。

## 来源与许可

插件采用 MIT 许可。主题配色参考 Firefly-Agent 默认浅色与流萤深色规范；内置 Yomitan v3 词典读取器所依赖的 `yauzl@3.4.0` 与 `pend@1.2.0` 随包提供（均为 MIT，见 `vendor/PROVENANCE.md`）。启用插件即信任该插件进程的代码，离线设计不代表存在操作系统沙箱。
