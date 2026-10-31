# 语言学习 0.2.0 本地验收

2026-10-31，分支 codex/language-learning，基线 firefly-plugins main 6cfc6dc。本地实现保留在该分支；未推送、创建实现 PR、合并或发布 Release。用户先查看实际效果，再将源码 PR 的目标设为 main。

## 实现范围

升级 study-cards，保留原 ID、七个工具的参数/结果主字段、1000 张卡片上限及四档评分。增加两个查词/收词工具和四页独立窗口：阅读、生词、复习、词典。旧 JSON 校验后事务迁移，原文件保留；卡片、生词、例句和幂等收词在同一学习库。降级限制和导出范围已写 README。

确认过的设计调整：独立 SQLite staging，确认后复制进 learning.sqlite 的同一事务，不使用永久独立只读词典数据库。这样避免跨文件/WAL 的激活一致性问题，代价是学习库随词典增大。数据仍在插件私有目录；没有读取其他产品档案。

可读的固定版本 yauzl 3.4.0 和 pend 1.2.0 随包提供 MIT 声明和来源。UI 文字仅作文本，窗口隔离、sandbox、contextIsolation、sender/frame 校验、窄 IPC、资源白名单、网络/导航拒绝。主进程插件本身不属于操作系统沙箱。

## 项目检查

- npm test：**134 passed / 0 failed / 0 skipped**，Node 24。
- npm run build、npm run check、git diff --check：通过。
- study-cards-0.2.0.zip SHA-256：`a95de9cddf616ca4a54d2462757121db5dae3fecd710b684df847ab3489c51ac`。
- 与基线 registry.json 比较，另外六个插件包 SHA-256 全部不变。未修改构建限额、CI 策略、阈值或其他插件。
- 新测试覆盖 worker/SQLite 迁移、损坏保护、重启、并发收词、revision 冲突、评分、ZIP 校验与 staging 取消、六语言 NFC/大小写匹配、独立解包运行、窗口来源/路径限制及 renderer 延迟回复竞态。
- 独立审查发现文章保存 ID 竞态和确认添加时的误导取消入口，均经过 RED→GREEN 修复和一次限定复审；复审无剩余阻塞。详见 learning-final-review.md、learning-review-fixes.md。revision 故障注入触发 4 项测试失败，恢复原文件后存储测试 8/8 通过。

## 正常 Electron 与实际宿主安装器

使用 `E:/Codex/Firefly/firefly-agent` 已编译 PluginManager、Electron 43.7.0 / Node 24.21.0、宿主现有 Playwright。

可复跑入口：

```powershell
npm run build
node scripts/validation/learning-native.cjs E:/Codex/Firefly/firefly-agent <本地六份WTY-gloss词典目录>
```

词典目录参数可省略，仅跑演示流程。脚本创建本仓库下唯一的 `.test-tmp-learning-native-*` 数据目录；没有使用正式 Firefly profile。使用真实 ZIP、真实 PluginManager.installZip/setEnabled/open，原生文件选择接口由验收驱动返回明确指定的本地测试文件，不是人工点选文件对话框的证明。

最终输出：`NATIVE_QA_OK .../.test-tmp-learning-native-Nyuqjp {languages:6,real:6,speech:{status:ended}}`。该目录保留 native-result.json 和四个真实运行截图；不进入插件包、不分发第三方词库。

通过：

- 本地 ZIP 默认停用，启用注册九个工具，实际打开插件窗口。正常 Electron worker 使用内置 SQLite。
- 阅读区原生文本选区查询 quiet，自动带上原句，确认收藏产生一个生词/卡片。
- 生词列表可见；新卡揭晓前隐藏答案，评分后 revision 从 1 到 2。
- en/ja/ko/fr/de/es 演示词条分别查询成功；六份真实词典经窗口准备、预览、确认，查询包含非演示结果。
- 停用清理工具；重新启用/打开后生词、评分及文章位置保留。renderer 无 require、无 pageerror。
- 系统枚举本地语音：日语和中文。日语「学ぶ」通过实际朗读按钮产生 start/end 回调且无 error；这是回调验收，不是人工听音或音质测量。英/韩/法/德/西语没有本地声音，按钮正确禁用。没有网络音频兜底。

## 六份真实词典

仅用于本地验收，来自 [WTY 官方下载说明](https://yomidevs.github.io/wiktionary-to-yomitan/download/) 链接的 [公开数据集](https://huggingface.co/datasets/daxida/wty-release)，版本 2026.10.22，数据集 commit `de7ed9cd558acce3423ccf6e17dc690f8a839bf2`。数据集标注 CC BY-SA 4.0；未复制到产品或提交文件中。路径为 latest/dict/<源语言>/<释义语言>/wty-<源语言>-<释义语言>-gloss.zip。

| ZIP | 索引词条 | 查询词 | SHA-256 |
| --- | ---: | --- | --- |
| wty-en-zh-gloss.zip | 1,785 | hello | be8e1f209254bdd1db6be5a5cf6dce18e188c744df47a87e171c01898fa3ee57 |
| wty-ja-en-gloss.zip | 16,650 | 本 | 72a1073fce2a32289256986fd9f295c086f426e9bd0b1587e953dd79915852cf |
| wty-ko-en-gloss.zip | 8,933 | 책 | e9992875a9c56ade57b6e781fc314f9b66d1a7ab2d85ca7def7fad9775c6176c |
| wty-fr-en-gloss.zip | 129,366 | bonjour | 3540c9249f312079fc018081a2f6e360fb23f0f41d5047e035a1653ff5ddf256 |
| wty-de-en-gloss.zip | 81,386 | lernen | ed015faaa68c61d2825c18956f878a03abbec206dd26f9f75d33d3e6a5838ac1 |
| wty-es-en-gloss.zip | 25,352 | hola | 955eebdbe1f8dd2650e8aff4f65748794f9170605612abd1f486b9daff4719c8 |

合计 **263,472** 条。六份都提示 styles.css / tag_bank_1.json 未加载，用户确认后添加；来源和释义语言没有改成虚构中文。后台独立导入/激活约 45 ms–5.7 s/份（非基准测试）；完整窗口验收另跑一次。该数据是较小的 glossary 子集，不证明全部 Yomitan main/Jitendex 的复杂结构、全量覆盖或变形查词可用。英语 quiet 在所测英文→中文真实子集中未命中，显示演示来源时不算真实词典覆盖。

## 分发接口核对与限制

刷新远端 Firefly-Agent main 得到 be9355b81988ebbfbdf45d9a7469a9a3a4f2d932；本地源码9aee67e与该提交在 plugins/plugin-host/plugin-panel 范围没有差异。当前在线市场实现仍从本仓库 registry.json 指向的 Release URL 下载；源码 PR、registry 版本记录和本地 ZIP 安装不能当成在线市场成功或仓库直装的证据。本次按用户要求不发布 Release、不修改宿主或其他人的 AGENTS.md。

未验证：Ubuntu/CI 运行、2 百万行/1 GiB 极限性能、断电及磁盘满提交故障注入、所有大型第三方词典、其余五语言真实发声及人工听音。自动阅读任意外部网页、完整词形还原、网络音源、模型解释及数据导出一键恢复不属于本版已完成范围。

## 用户预览

`scripts/validation/learning-preview.cjs` 用宿主 Electron 启动，必须传 `--learning-host-root=<宿主根>`，可选 `--learning-qa-root=<本仓库.test-tmp-learning-*子目录>`；`--learning-demo-preview` 明确安装演示词典并打开原创示例。最后实际打开 PID 23268 的窗口，使用上述隔离验收数据。关闭窗口正常退出，未启动正式 Firefly profile。

用户接受界面后，源码实现 PR 的 base 为 main；没有授权自动合并，本分支/隔离工作树保留待审。
