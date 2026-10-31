# 新插件调研与形式核对

核对日期：2026-10-31，Asia/Singapore。本轮目标是沿用 Claude 已完成的本地原生插件形式，寻找新用途并提交源码/设计 PR；不安装外部插件、不发布 Release。

## 本地与远端基线

本地仓库现位于 `E:/Codex/Firefly/firefly-plugins`，远端为 `Firefly-0423/firefly-plugins`；开始本轮时本地和远端 main 均为 `6cfc6dced9c05ce7c8846404339466d911254f67`，共七个插件。旧的 `E:/Codex/firefly-plugins` 路径已经不存在。

Git 历史中 `19bae48` 创建原五个离线插件，`625a459` 修正包内说明并升至 1.0.1，两者均保留 Claude Opus 5.5 共同作者记录。本轮读取 `text-stats`、`json-tools`、生成器、CONTRIBUTING、构建器及现有测试，将它们作为“Claude 的形式”的可验证依据；未发现另一套新增的 Claude 插件目录。

沿用：`plugins/<id>/`、API v1 manifest、`index.cjs` 导出 register/unregister、插件前缀工具 ID、默认停用、`deps:[]`、safe/read/none 元数据、四个包文件、根目录 catalog.json 描述及 node:test。许可证仍为 Firefly MIT，新增实现不复制样本源码。没有运行时依赖、网络、文件或模型调用。

当前主仓公开 `src/plugins/api.ts` blob 为 `be9637ccd3c8b08a55090dc2af01442ba7ec8791`，包含 registerTool/unregisterTool 和上述工具元数据；本轮没有修改宿主接口。插件仓库现有 registry/ZIP 分发规则仍被保留，不据此触发 Release。

## 实际 GitHub 样本与取舍

| 样本 | 本轮核实 | 决定 |
| --- | --- | --- |
| [gsantiago/subtitle.js](https://github.com/gsantiago/subtitle.js) | README 有解析、resync、stringify，明确仅部分支持 WebVTT；package 源码 4.2.2/MIT，blob `a98fe4ae2542305c962e6550d1800ff923720fdd` | 实现字幕检查、偏移和基础格式转换。服务于配音后的时间调整；宿主已有 ASR，故不重复建设转写服务 |
| [siege-media/contrast-ratio](https://github.com/siege-media/contrast-ratio) | README 是 WCAG 颜色对比度工具，MIT-LICENSE 保留 Lea Verou 版权，license blob `71c50b618f73a1457415e3dc6e56cf585be5de04` | 实现两颜色及批量配色计算，给配色选择提供确定结果；不把它描述为整页审计 |
| [kazuhikoarase/qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | JavaScript 文档支持二维码生成及 SVG；MIT；默认字节编码需留意 Unicode | 暂留候选。宿主已有微信渠道内部二维码生成；通用工具虽有增量，但需要另行定义输出与扫码解码验收，本轮不引入第三方编码器 |

W3C [WCAG 2.2 最低对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)及[相对亮度说明](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)是颜色公式和阈值的主依据，GitHub 项目用于确认具体用户工作流。源码版本不等于当前 npm dist-tag；本轮未安装样本，也不把其 README 自报覆盖率作为我们的验证结果。

## 首版选择

选择字幕工具与颜色对比度：都有明确的输入、可核对输出，并且能沿用原五插件的无权限纯计算形式。相比嵌入完整第三方界面或启动外部服务，这个范围不要求新宿主入口或新增运行时依赖。

完整交互式字幕编辑器、OCR/语音转写、页面截图审计和二维码生成均不在本次交付内。设计和验收见 `docs/designs/2026-10-31-offline-tools.md`。
