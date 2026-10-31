# 新插件项目筛选

日期：2026-10-31。目标是先寻找实际存在的插件项目，再设计 Firefly 原生版本，最后通过 PR 审查。本文是调研与设计材料，不是实现完成声明。

## 本地形式

本地规范仓库是 `E:/Codex/Firefly/firefly-plugins`；本轮与远端 main 一致，基线 `6cfc6dced9c05ce7c8846404339466d911254f67`，包含七个插件。Claude 原始提交 `19bae48` 和 `625a459` 提供了 manifest、register/unregister、catalog、LICENSE、行为测试和可复现打包的形式；复杂界面已有 DrawAI 及 package-files.json 的资源声明先例。

“沿用 Claude 形式”指沿用 Firefly 的插件契约与仓库工程规范，不把任何新需求都缩减为四文件小算法，也不把外部平台插件直接改名宣称兼容。已关闭的 PR #4 不作为本轮实现基础。

## 实际项目

| 项目 | 已读取的实际内容 | 用户价值 | 决定 |
| --- | --- | --- | --- |
| [Obsidian Map View](https://github.com/esm7/obsidian-map-view) | README、package.json、LICENSE、src/main.ts | 将地点与笔记放到地图，查看轨迹、筛选地点和组织出行资料 | 优先设计原生地点工作台 |
| [Timeline (vis-timeline)](https://github.com/rborisov/vis-timeline) | README、package.json、LICENSE、src/main.ts | 把多个事件/日期区间放到可缩放、分组的时间线上，关联原始资料 | 并列设计原生时间线 |
| [Longform](https://github.com/kevboh/longform) | README、package.json、LICENSE.md | 以场景组织小说、剧本和长稿，排序、统计并汇编 | 暂不引入代码：实际为自定义许可证，并非 MIT |
| [Hypothesis browser extension](https://github.com/hypothesis/browser-extension) | 项目说明及仓库信息 | 网页划线批注与来源定位 | 候选但不进入本轮设计：需要单独处理浏览器与批注服务，不能直接映射 Firefly 接口 |

以上都是实际插件或扩展项目，而不是字幕解析、颜色计算之类的功能库。没有安装或实际运行这些外部项目；README 里的能力仅用于产品方向与耦合分析，不当作 Firefly 验收结果。星标数不参与优先级判断。

## 来源身份与许可

- Map View：核对 Git tree `e6e0430acbc58950fe7cd2a85be42e621040bc0e`；源码 package 为 6.1.4/MIT，package blob `fbcdd6ba76c3c41474c14ad38c77b666359de01d`，LICENSE blob `c737d97ae844f3a03b592d289895879125d5d739`，入口 blob `5421188fabcae3d4ba4477e0efa8f5ce40415fd2`。依赖 Leaflet、地图编辑/离线模块及 Obsidian API，不能整体原样安装到 Firefly。
- Timeline：核对 Git tree `2a8094fd44ad317c5592d17745b9475652fdacfb`；源码 package 为 0.3.4，package blob `1e3c597dc282e8ca5093884ffb13179c44a7693f` 写 0-BSD，LICENSE blob `d26e7640ee8bbdc6f81cc474566580541c0ec052` 写 MIT，入口 blob `1bf7ae1626e6a9caf6f014f2473a4e7267857241`。必须先厘清许可，不能自行选择更宽松的一项复制代码。
- Longform：源码 package 为 2.1.0/SEE LICENSE；LICENSE.md blob `a1910d9636754026d3e903ad823083773fbfe6a7` 明确为自定义 FAFO 0.2。排除直接复用，避免根据印象误标 MIT。

版本均指本轮读取的源码 package，不是 npm dist-tag。设计可借鉴公开工作流；任何代码复用必须另行记录文件、固定提交、转换和完整许可。

## 设计推荐

地点工作台新增空间组织能力；时间线新增跨资料的时间组织能力。两者都有持久项目、可编辑界面和 AI 操作同一份数据的工作流，与核心记忆、调度器、浏览器工具和现有静态 Mermaid 展示职责不同。

推荐先评审时间线：可先完成全本地闭环，没有地图瓦片和外部服务的配置前提。若用户主要需要旅行/地点管理，则把地点工作台前移。此为设计建议，不代表用户已选定先开发哪一个。

详细方案见 [原生插件设计](../designs/2026-10-31-map-and-timeline.md)。本 PR 不增加 manifest 或 registry 条目、不产生运行包、不发布 Release；选定并确认设计后才进入实现。
