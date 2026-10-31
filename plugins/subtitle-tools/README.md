# 字幕工具 / Subtitle tools

Firefly Plugin API v1，默认停用。按原五个离线插件的形式注册两个工具，直接处理传入的字幕文本并返回 JSON 字符串。不联网、不读写文件、不执行命令、不调用模型、不保存内容。插件运行在宿主主进程中，离线设计不代表存在操作系统沙箱。

- `subtitle-tools_inspect({text})`：返回格式、条数、最早开始与最晚结束的毫秒时间、重叠/乱序问题。最多返回 100 条问题及精确省略数量，不自动重排。
- `subtitle-tools_transform({text,format,offsetMs?})`：返回新字幕文本。format 为 `srt` 或 `vtt`；正数毫秒表示延后，负数表示提前。未提供偏移时为 0。SRT 输出重新从 1 编号；正文多行和 Unicode 保留，换行统一为 LF。

输入上限为 200000 个 UTF-16 码元、2000 条字幕；输出最多 250000 个码元。时间范围为 00:00:00.000–99:59:59.999，偏移最多 ±7 天。任何一条出现负时间或溢出都拒绝整个操作，不截断、不丢弃字幕。

只支持基础 SRT 和简单 WebVTT，不支持 ASS、转写、翻译、编码修复或视频烧录。SRT 需数字序号及 HH:MM:SS,mmm 时间；WebVTT 支持 MM:SS.mmm、小时、cue ID 和时间行 settings。WebVTT 的 NOTE、STYLE、REGION 块不受支持；转成 SRT 时若含标题、非数字 ID 或 settings，明确拒绝，避免丢失信息。需要保留这些内容时请继续输出 WebVTT 或使用完整字幕编辑器。

示例：让流萤“把下面的字幕整体延后 500 毫秒，输出 SRT”，然后提供字幕文本。返回结果是文本，不代表磁盘文件已保存；保存交给 Firefly 既有文件工具及其权限流程。

调研参考：[gsantiago/subtitle.js](https://github.com/gsantiago/subtitle.js) 的解析、resync 和格式转换工作流；该项目仅部分支持 WebVTT。此插件为独立实现，不复制上游源码，也没有新增运行时 npm 依赖。

开发：仓库根目录运行 `npm test`、`npm run build`、`npm run check`。源码和目录进入 PR，不自动发布 Release。当前宿主在线市场分发仍取决于既有目录/安装契约。

Offline Firefly subtitle text tools. Inspect timing, shift milliseconds and convert basic SRT/WebVTT. No file, network or model calls. Unsupported or lossy conversions fail explicitly. The output is text, not a saved file. See LICENSE.
