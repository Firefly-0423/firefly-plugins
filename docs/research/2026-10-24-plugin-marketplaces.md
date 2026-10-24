# GPT、Claude、DeepSeek Harness 插件市场调研与 Firefly 插件核对

核对日期：2026-10-24，Asia/Singapore。

## 本轮范围与证据

本轮先调研三个外部生态，并保留对现有五个 Firefly 插件的逐项核对。开发新插件是后续目标；本报告不代表已选定插件设计或已经开始实现。

- Firefly 插件仓库：`Firefly-0423/firefly-plugins`，提交 `19bae4828d5db2e4e96caa7975a7af1a645a6b48`。
- Firefly 宿主：开发分支 `codex/approval-origin`，提交 `36ade0228944a89eda5f0fe97154d60e5b7a8409`。宿主接入结论针对这份源码，不能外推到其他分支或版本。
- 来源优先级：平台官方文档、实际目录结果、发布者源码和 Release。社区聚合站仅用于发现线索，其数量、星标、下载量和“验证通过”标签不作为本报告的推荐依据。
- 版本写明“源码”或“正式 Release”。源码版本不等于 npm 当前 dist-tag，也不等于 Firefly 兼容版本。网络访问间歇失败，未能取得的发布信息不补猜。
- 本轮没有安装外部插件、连接新账号、调用付费模型或修改产品源码。目录可见不代表账号已授权、运行正常或可直接移植。

结构化来源、目录快照身份和行为探测结果见 [evidence.json](2026-10-24-evidence.json)。

## 三个市场当前是什么

| 生态 | 当前核实的入口与形态 | 对 Firefly 的含义 |
| --- | --- | --- |
| GPT / ChatGPT / Codex | 当前 OpenAI 文档明确：ChatGPT 与 Codex 共享统一公开插件目录。插件可组合 Skills、MCP 和可选 UI；部分执行能力仍取决于使用端 | 可借鉴工作流、服务连接和交互方式；公开目录条目不能直接当成 Firefly ZIP |
| Claude | Claude 面向用户的 Marketplace / Customize 目录，与 Claude Code 的官方仓库及自建 marketplace 有不同范围。Code 插件可组合技能、agents、hooks、MCP 等组件 | 先识别工作流组件与宿主专用机制，避免把能复用的技能误判成需要新写的原生插件 |
| DeepSeek Harness | 官方文档提供自定义 JSON 索引市场，明确宿主不随附索引源；社区市场各有收录范围 | DSH bundle 的配置、服务注入、事件和前端扩展都需要适配，不能拿其市场总量表示 Firefly 生态规模 |

来源：[OpenAI 插件架构](https://developers.openai.com/plugins/concepts/plugins)、[OpenAI 打包规范](https://developers.openai.com/plugins/build/plugins)、[Claude Marketplace 公告](https://claude.com/resources/articles/claude-marketplace)、[Claude 统一目录](https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory)、[Claude Code 插件](https://code.claude.com/docs/en/plugins)、[DSH 插件市场规范](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)。

OpenAI 当前规范已包含根目录 `plugin.json` 的 Agent Plugins 格式，`.codex-plugin/plugin.json` 仍作为兼容形式。不能只靠旧脚手架推断当前格式。这个变化也不意味着 Firefly 已经支持这些包。

## GPT 侧：实际查到的五个服务型样本

以下五项均通过当前插件目录查询取得。这里研究产品方向，不要求连接这些账号。目录没有提供可统一比较的包版本，所以不编造版本或“最近发布”排序。

| 样本 | 用户任务 | Firefly 侧处理判断 |
| --- | --- | --- |
| GitHub | 远程仓库、Issue、PR、CI 协作 | 区别于本地 Git；先评估官方接口或 MCP，不重写 Git 引擎 |
| Figma | 设计稿、组件、设计信息与协作 | 有对应账号和设计工作流时才评估连接；不是通用截图或画图工具的替代名 |
| Notion | 页面、数据库、团队文档读写 | 属于外部内容连接，不承担 Firefly 个人记忆核心 |
| Linear | 团队 Issue、项目和状态管理 | 属于外部项目系统，不替代宿主调度器 |
| Google Drive | 云端文件以及 Docs、Sheets、Slides 工作 | 与本地办公文件处理有不同的数据来源和授权；需单独验证认证及协议 |

OpenAI 官方入口还展示了 Spreadsheets、Presentations、Data Analytics 等面向完整任务的插件。[官方插件文档](https://developers.openai.com/plugins)；公开目录入口为 [Plugins Directory](https://chatgpt.com/plugins)。上述五个服务条目的存在由本次目录工具查询确认，不据此推断其开放源代码或允许复制实现。

调研启示：外部账号和数据源、可重复工作流、可编辑结果，是应分别分析的三类价值。服务商连接不是换一个 manifest 就可移植的代码资产。

## Claude 侧：官方目录中的五个样本

本次读取 `anthropics/claude-plugins-official` 的 `.claude-plugin/marketplace.json`，得到 **315 条目录记录**，blob SHA 为 `4013c22afd516f1108134c87ed2d6f9839526e85`。这个数量仅表示该仓库快照的记录数，不是 Claude 所有市场的总量，也不是安装量。

| 样本 | 目录声明的主要能力 | Firefly 侧处理判断 |
| --- | --- | --- |
| `frontend-design` | 前端设计与实现工作流 | 优先评估为 Skill；不是新建一套 UI 引擎 |
| `code-review` | PR 审查工作流 | 优先评估技能及现有专业 Agent 编排；不能照搬 Claude 专用命令 |
| `plugin-dev` | Claude 插件开发指南与工具 | 可参考开发者体验；其宿主契约不是 Firefly SDK |
| `context7` | 版本相关文档检索 MCP | 属于服务接入候选；当前目录配置为 HTTP，存在 Firefly 传输适配前提 |
| `playwright` | 浏览器自动化与测试 MCP | Firefly 已有浏览器能力；先确认新增测试需求，不能因目录存在就列为缺口 |

来源：[官方目录 JSON](https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json)、[frontend-design manifest](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/frontend-design/.claude-plugin/plugin.json)、[code-review manifest](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-review/.claude-plugin/plugin.json)、[Context7 MCP 配置](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/context7/.mcp.json)、[安装与市场说明](https://code.claude.com/docs/en/discover-plugins)。

已读取的 frontend-design、code-review manifest 未给出版本；本报告用目录快照定位，不填假定的 1.0.0。官方目录中既有内部插件也有外部发布者，收录不等于全部由 Anthropic 开发。

## DSH 侧：五个有发布者源码的样本

| 项目 | 本次核实的信息 | 新增价值与适配边界 |
| --- | --- | --- |
| [STARDUSTLC666/dsh-rss](https://github.com/STARDUSTLC666/dsh-rss) | 源码 0.7.0；更新日志 2026-10-17；MIT | 订阅、增量获取、去重、OPML。是功能候选；其配置存储、面板和依赖不能直接复制进 Firefly |
| [Nagi-ovo/dsh-visualize](https://github.com/Nagi-ovo/dsh-visualize) | 源码 0.1.7；BSD-3-Clause | 交互式 HTML 卡片。Firefly 已有 Mermaid / SVG；只有交互式内容构成这里的增量，聊天内嵌版本需宿主扩展 |
| [Vncntvx/dsh-zotero](https://github.com/Vncntvx/dsh-zotero) | 源码及 GitHub Release 0.13.0；Release 2026-10-20；MIT | 文献元数据、批注、引用与来源定位。有 Zotero 用户需求时再评估；不是再实现个人记忆 |
| [ikashana/dsh-notify](https://github.com/ikashana/dsh-notify) | 源码 0.1.0；MIT | 外部通知链可参考。Firefly 已有本地提醒；首版若做，只评估公开完成 / 失败事件的远程送达 |
| [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) | 直接读取的源码 package 为 1.9.36；MIT | 账单、预算、余额等交互可参考。Firefly 已有 token 用量存储，不先另建一套采集与计数系统 |

版本与能力来源：[RSS package](https://github.com/STARDUSTLC666/dsh-rss/blob/master/package.json)、[RSS 更新日志](https://github.com/STARDUSTLC666/dsh-rss/blob/master/CHANGELOG.md)、[RSS 使用说明](https://github.com/STARDUSTLC666/dsh-rss/blob/master/docs/USAGE.en.md)、[Visualize package](https://github.com/Nagi-ovo/dsh-visualize/blob/main/package.json)、[Visualize README](https://github.com/Nagi-ovo/dsh-visualize/blob/main/README.en.md)、[Zotero Release](https://github.com/Vncntvx/dsh-zotero/releases)、[Zotero README](https://github.com/Vncntvx/dsh-zotero/blob/main/README.md)、[Notify package](https://github.com/ikashana/dsh-notify/blob/main/package.json)、[Notify README](https://github.com/ikashana/dsh-notify/blob/main/README.md)、[Cost Meter package](https://github.com/Han-1413141/dsh-cost-meter/blob/master/package.json)。

Cost Meter 的搜索索引和 Release 页返回了不同的旧版本，不能混称为当前 npm 最新版。这里仅记录实际读取的 package 版本及 blob SHA。Zotero 的 README 与 0.13.0 Release 对可选 scholarly 组件默认启用状态的描述也不一致，实施时必须检查选定提交的实际配置。

上述源码均未在 Firefly 中安装、执行或完成安全审查。已有 [zotero-mcp](https://github.com/54yyyu/zotero-mcp/releases) 可作为另一个接入候选，本次其 Release 页显示 0.15.1；是否适合 Firefly 仍须验证传输、启动依赖和具体工具行为。

## 现有五个 Firefly 插件：逐项核对

现有五个都为 Plugin API v1、版本 1.0.0、首次安装停用。它们有 Firefly manifest、生命周期和工具入口；部分小型算法保留了上游许可来源，这不改变其 Firefly 插件身份。[实际市场目录](https://github.com/Firefly-0423/firefly-plugins/blob/main/registry.json)。

| 插件 | 实现定位 | 测试和本次额外探测揭示的边界 | 处理判断 |
| --- | --- | --- | --- |
| `text-stats` | 输入文本的字符、词、非空行统计 | 字符按 Unicode 码点；组合字符和家庭 emoji 不按一个视觉字符计。探测 `é 👨‍👩‍👧‍👦` 返回 10 个码点、2 个空白分隔词 | 保留；不宣称中文分词或阅读器式字数。源码未设输入长度上限，作为后续资源边界改进项 |
| `json-tools` | JSON 解析校验与首处结构差异 | 明确不检测重复键和超安全整数精度。探测两个不同的超大整数比较为 equal；重复键会先被 JSON.parse 覆盖 | 保留；不能用于需要保留数字字面精度、重复键的严格审计，不把其“无损”描述扩展到这些场景 |
| `timezone-tools` | 时区名校验、带偏移时间和本地墙钟时间换算 | 处理 gap / fold；本次 Lord Howe 探测识别出间隔 30 分钟的两个候选。别名依赖 ICU，年份 1900–2200，精度为毫秒 | 保留；不与宿主定时器合并，不把时间换算说成调度引擎 |
| `code-language` | 仅按扩展名识别语言与短名 | 61 类语言、115 个扩展名。Makefile、Dockerfile、`.env.local` 本次返回 null，`.env` 返回 dotenv；不读取内容 | 保留；不当成 LSP、语法分析或文件内容检测 |
| `text-trim` | 按 UTF-8 字节保留头、尾或两端 | 切口不拆完整码点。两端模式的省略标记不计入 keptBytes；探测预算为 2 字节时，返回文本还包含完整标记 | 保留；不能把返回字符串总字节数保证为预算以内 |

本次实际运行：`npm test`，runner 报告 **79 passed / 0 failed / 0 skipped**。额外探测通过已有 `sandboxTools()` 在新 VM 中注册并调用五个入口，结果记录于 evidence.json。VM 是测试条件，不是 Firefly 生产权限沙箱，也不代表安装、重启或真实 UI 验收。

发现一个共同文档问题：五个插件包内 README 都仍写 `node scripts/plugin-marketplace/build.mjs`，这是主工程的构建路径；独立仓库应使用根目录的 `npm run build`。README 属于打包字节，修订必须考虑版本不可变规则，本轮没有直接改写已列为 1.0.0 的包。

## Firefly 接入前提：需要先分清的三层

### 1. 插件包格式

独立市场 `scripts/build.mjs:19` 仅收 `LICENSE`、`README.md`、`index.cjs`、`manifest.json`；`:56` 拒绝非空 deps。宿主 API 虽支持 settingsPanel 和服务声明，当前市场打包器并不支持所有宿主能力。带面板、额外模块或宿主依赖的候选需单独设计分发，不能笼统承诺全部可上架。

### 2. MCP 传输与认证

当前宿主 `src/main/orchestrator/mcp-adapter.ts:23` 配置只声明 stdio / sse，连接实现分别构造 StdioClientTransport / SSEClientTransport；`mcp-manager.ts` 的配置校验也只接受这两个值。未找到 Streamable HTTP 连接分支。

Claude 目录的 Context7 使用 `type: http`。这份 JSON 不能直接填入当前 Firefly。若服务提供已核实的本地 stdio 方案，可先评估该方案；否则需要宿主传输及认证接入工作。协议支持、账号授权、工具权限与 UI 资源是不同的验证层，安装包形似不代表兼容。

### 3. 产品职责与 UI

宿主已经直接装配默认 S/M/H 记忆链、事实记忆和历史检索；已经注册内置 weather 工具；已经有 SchedulerSubsystem、MCP 管理界面、浏览器工具与 token 用量存储。聊天 `StreamdownMessageContent.tsx:53-54` 已渲染 Mermaid / SVG。公开插件能力中没有核心记忆服务，不能把导入示例描述为已有的统一记忆接入接口。

本轮核对文件包括 `src/main/application/default-dependencies.ts`、`src/plugins/api.ts`、`src/main/plugin-host/host-services.ts`、`src/main/scheduler/bootstrap.ts`、`src/main/orchestrator/tools/built-in-tools.ts`、`src/main/orchestrator/mcp-adapter.ts` 和聊天渲染分支。结论来自这些实际入口，不以 examples 名称推断产品缺口。

## 面向后续开发的候选结论

| 候选 | 建议形态 | 当前判断 |
| --- | --- | --- |
| RSS / Atom 订阅 | Firefly 原生插件；复用宿主存储、模型与调度的已支持部分 | 优先候选。先界定订阅、获取、去重、检索与 OPML 首版范围，再设计联网、解析和分发边界 |
| 外部任务通知 | 监听稳定宿主终态事件的窄插件 | 小型候选。已有本地提醒保留；审批等待、确认超时不能在没有稳定事件时承诺 |
| 版本化官方文档检索 | 优先 MCP 接入配合 Skill | 有价值，但先解决实际传输与认证；不为了市场条目另写一套原生插件 |
| Zotero 文献连接 | 优先试验现有 MCP；有专用 UI 需要再评估插件 | 取决于用户是否有文献库工作流，不列为默认必做 |
| 交互式 HTML 内容 | 宿主先定义渲染扩展与持久化契约，再做插件 | 后续能力；不与已有静态 Mermaid / SVG 混为一谈 |

工作流型样本优先落在 Firefly 已有 Skills 机制；外部服务型样本优先验证开放协议；需要独立状态、面板或生命周期的明确产品能力才进入原生插件实现。上述为调研建议，开发方向仍待本报告后的选择。

## 尚未完成的验证

- 外部插件的安装、实际运行和源码安全审查；各服务账号认证与真实 API 调用。
- 所有候选的 npm 最新 dist-tag；未取得时仅记源码或已核实 Release 版本。
- Firefly 真实 Electron 安装、启停、重启恢复和 UI 验收。
- 新插件设计、代码、版本、目录及发布产物；没有据此扩大宿主权限或改动 CI。

## 后续处理（同日）

本报告保持核对当时的结论。报告提出的两项问题已另行处理：

- MCP 传输：Firefly-0423/Firefly-Agent#2 增加 Streamable HTTP（`http`）连接，设置页可直接填写远程地址；以 `/sse` 结尾的地址仍走旧式 SSE。
- 插件 README 的构建路径：Firefly-0423/firefly-plugins#1 改为本仓库的 `npm run build`，五个插件按版本不可变规则升为 1.0.1，1.0.0 Release 保持不变。
