# 颜色对比度 / Color contrast

Firefly Plugin API v1，默认停用。与原五个离线插件相同：在内存中计算，不联网、不读写文件、不执行命令、不调用模型，也不修改界面配色。插件运行在宿主进程中，离线设计不代表存在操作系统沙箱。

工具：

- `color-contrast_check({foreground,background})`：输入 `#RGB` 或 `#RRGGBB`，返回规范化颜色、六位小数的对比度和 `aaNormal`、`aaLarge`、`aaaNormal`、`aaaLarge`。
- `color-contrast_palette({pairs:[{foreground,background},...]})`：一次检查 1–50 对颜色，返回各项结果及未达普通文字 AA 的数量。任一输入无效时拒绝整批。

通过与否使用未舍入的原始比值：普通文字 AA ≥4.5、AAA ≥7；大字 AA ≥3、AAA ≥4.5。大字需由使用者根据实际字号/字重判断（至少 18pt，或粗体 14pt）。这只是颜色对检查，不代表页面整体符合 WCAG。

拒绝颜色名、CSS 表达式、透明度和其他色彩空间。请先取得最终的不透明 sRGB 颜色；不推测背景图片、渐变、混色或透明叠加，也不根据截图自动取色。

GitHub 调研样本：[siege-media/contrast-ratio](https://github.com/siege-media/contrast-ratio)（MIT，源于 Lea Verou 的工作）。此插件按 [W3C WCAG 2.2 说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 的公开公式独立实现，没有复制样本源码或引入运行时依赖。使用 sRGB 线性化分界 0.04045 和亮度权重 0.2126 / 0.7152 / 0.0722。

开发：仓库根目录运行 `npm test`、`npm run build`、`npm run check`。本轮只提交源码、目录和 PR，不自动发布 Release。

Offline contrast calculations for opaque sRGB hex colors. AA/AAA results use the unrounded ratio; output is rounded to six decimals. No network/file/model calls. This is not a complete accessibility audit. See LICENSE.
