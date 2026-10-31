"use strict";

// WCAG 2.2 sRGB contrast. Independent implementation, no CSS evaluation.
let activeContext;
const colorSchema = { type: 'string', pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' };
function object(args, keys) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) throw new TypeError('工具参数无效');
}
function color(value) {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) throw new TypeError('颜色必须为不透明 sRGB #RGB 或 #RRGGBB');
  const hex = value.slice(1).toLowerCase();
  return '#' + (hex.length === 3 ? [...hex].map(c => c + c).join('') : hex);
}
function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function check(args) {
  object(args, ['foreground', 'background']);
  const foreground = color(args.foreground), background = color(args.background);
  const a = luminance(foreground), b = luminance(background);
  const raw = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return { foreground, background, ratio: Number(raw.toFixed(6)), aaNormal: raw >= 4.5, aaLarge: raw >= 3, aaaNormal: raw >= 7, aaaLarge: raw >= 4.5 };
}
function palette(args) {
  object(args, ['pairs']);
  if (!Array.isArray(args.pairs) || args.pairs.length < 1 || args.pairs.length > 50) throw new RangeError('pairs 必须包含 1–50 对颜色');
  const results = args.pairs.map(check);
  return { results, failedAaNormal: results.filter(result => !result.aaNormal).length };
}

module.exports = {
  register(ctx) {
    if (activeContext) throw new Error('Color contrast is already registered');
    const pair = { type: 'object', properties: { foreground: colorSchema, background: colorSchema }, required: ['foreground', 'background'], additionalProperties: false };
    const added = [];
    try {
      for (const [name, label, description, schema, execute] of [
        ['check', '检查颜色对比度', '按 WCAG 2.2 计算两个不透明 sRGB 十六进制颜色的对比度，报告普通文字和大字的 AA/AAA 阈值；不代表页面整体合规。', pair, check],
        ['palette', '批量检查配色', '检查最多 50 对前景/背景颜色，列出各项对比度和未达普通文字 AA 的数量。输入为最终不透明颜色，不推测透明合成、字号或背景图片。', { type: 'object', properties: { pairs: { type: 'array', minItems: 1, maxItems: 50, items: pair } }, required: ['pairs'], additionalProperties: false }, palette],
      ]) {
        const id = 'color-contrast_' + name;
        ctx.registerTool({ id, name: label, description, enabled: true, risk: 'safe', effectKind: 'read', verificationPolicy: 'none', inputSchema: schema,
          async execute(args) { return JSON.stringify(execute(args)); },
        });
        added.push(id);
      }
      activeContext = ctx;
    } catch (error) { for (const id of added) ctx.unregisterTool(id); throw error; }
  },
  unregister() {
    if (!activeContext) return;
    const ctx = activeContext; activeContext = undefined;
    ctx.unregisterTool('color-contrast_check');
    ctx.unregisterTool('color-contrast_palette');
  },
};
