# DrawAI 画布

Firefly 原生离线插件 0.1.1。直接在 Firefly 插件页导入 ZIP、启用，再点击“打开”进入画布窗口。用户不需要另装 Node.js、DSH 或启动开发项目；窗口由 Firefly 插件生命周期管理。

新建/打开 .drawio，点击左侧形状添加节点；拖动、右下角调整大小、双击改字；连线模式依次选两个节点。选中连线可拖动端点重连。Shift 多选，空格平移，滚轮缩放，Ctrl+S 保存，Ctrl+Z/Shift+Ctrl+Z 撤销/重做。右侧可改样式、图层和布局，导出当前页 SVG/PNG。

手工修改显式保存。关闭时可保存、放弃或取消；强制停用会保留最多五份有界恢复草稿，重新打开时可选择恢复。已有文件改变时，保存/撤销/恢复拒绝覆盖。插件内部串行与写前摘要检查不等于跨进程原子 compare-and-swap。

AI 工具：drawai_read({path,page?,limit?,cursor?})、drawai_apply({path,expectRevision?,create?,ops,page?,layout?})。路径必须在宿主绑定工作区内；先读取得 revision 再改。新建须 create:true，目标必须不存在。手工草稿未保存时拒绝 AI 写入。首次使用可让流萤用 addNode/addEdge 建图；后续使用 setLabel/setStyle/move/setEdge/remove/图层等操作。

0.1.1 补全了通过 ctx.registerTool 交给 Firefly 模型适配器的操作枚举、字段 schema、工具目录提示和调用示例；模型无需读取仓库 README 来猜参数。画布与宿主工具共用同一份文件和冲突保护。

插件不直接调用模型、不联网、不执行命令、不读取 DSH 安装数据。模型工具只在 work/code 模式使用；窗口文件通过原生对话框选择。主进程插件本身以应用权限运行，路径检查与隔离窗口不代表整个插件处在 OS 沙箱。

首版不编辑图片/视频、矢量化或视频复刻。含媒体图页会显示占位，已有原文保留；SVG/PNG 是当前显示页面，包含这些占位而非原媒体。复杂第三方形状的外观不保证与 diagrams.net 完全相同。

限制：UTF-8 .drawio 最大8MiB、展开累计16MiB、25页、当前页1000节点/连线、单次100操作、标签4096字符，处理最长10秒可取消；最近8次撤销/重做。PNG最长边4096像素。

来源：fourzkw/dsh-drawai@80eb15e0a3a11cb4c88cf8716382d03cdf0e5b03，MIT，Copyright (c) 2026 fourzkw。实际复用文档/样式与路由、拖动、选区、对齐算法；替换 DSH 服务为 Firefly 文件/工具/窗口接口。完整许可和转换来源在 upstream/LICENSE 与 upstream/SOURCES.json；XML 校验器许可在 vendor/。

开发：仓库根目录 npm ci --ignore-scripts，node scripts/vendor-drawai.mjs --check，npm test，npm run build。ZIP 可本地导入；本地构建不表示已发布。

