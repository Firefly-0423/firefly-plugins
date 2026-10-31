"use strict";

// Firefly API v1, in-memory subtitle text only. No runtime dependency.
const MAX_TEXT = 200000;
const MAX_CUES = 2000;
const MAX_TIME = 359999999; // 99:59:59.999, shared SRT/WebVTT subset.
let activeContext;

function timestamp(value, format) {
  const match = /^(?:(\d{2}):)?([0-5]\d):([0-5]\d)([,.])(\d{3})$/.exec(value);
  if (!match || (format === 'srt' && (!match[1] || match[4] !== ','))
    || (format === 'vtt' && match[4] !== '.')) throw new TypeError('字幕时间戳格式无效');
  return (Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[5]);
}

function parse(text) {
  const normalized = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  const blocks = normalized.split(/\n[ \t]*\n+/);
  const format = /^WEBVTT(?:[ \t].*)?$/.test(blocks[0]) ? 'vtt' : 'srt';
  let header = 'WEBVTT';
  if (format === 'vtt') header = blocks.shift();
  if (blocks.length > MAX_CUES) throw new RangeError('字幕最多 2000 条');
  const cues = blocks.map((block, index) => {
    const lines = block.split('\n');
    if (format === 'vtt' && /^(NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0])) {
      throw new TypeError('首版不支持 WebVTT NOTE、STYLE 或 REGION 块');
    }
    let id;
    if (!lines[0]?.includes('-->')) id = lines.shift();
    if (format === 'srt' && !/^\d+$/.test(id || '')) throw new TypeError('SRT 需要数字序号');
    const timing = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.+))?$/.exec(lines.shift() || '');
    if (!timing || !lines.length || !lines.some(line => line.trim())) throw new TypeError('字幕缺少有效时间或正文：第 ' + (index + 1) + ' 条');
    if (format === 'srt' && timing[3]) throw new TypeError('不支持 SRT 时间行扩展信息');
    const start = timestamp(timing[1], format), end = timestamp(timing[2], format);
    if (end <= start) throw new RangeError('字幕结束时间必须晚于开始时间');
    return { id, start, end, settings: timing[3] || '', text: lines.join('\n') };
  });
  if (!cues.length) throw new TypeError('字幕内容不能为空');
  return { format, header, cues };
}

function validate(args, transform) {
  const keys = transform ? ['text', 'format', 'offsetMs'] : ['text'];
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) throw new TypeError('工具参数无效');
  if (typeof args.text !== 'string' || args.text.length > MAX_TEXT || !args.text.trim()) throw new TypeError('text 必须是非空字幕文本，最多 200000 个 UTF-16 码元');
  if (transform && !['srt', 'vtt'].includes(args.format)) throw new TypeError('format 只能为 srt 或 vtt');
  if (transform && args.offsetMs !== undefined && (!Number.isSafeInteger(args.offsetMs) || Math.abs(args.offsetMs) > 604800000)) throw new RangeError('offsetMs 必须是 ±7 天范围内的整数毫秒');
}

function inspect(args) {
  validate(args, false);
  const { format, cues } = parse(args.text);
  const issues = [];
  let issueCount = 0, latestEnd = -1, previousStart = -1;
  const add = (kind, cue) => { issueCount++; if (issues.length < 100) issues.push({ kind, cue }); };
  cues.forEach((cue, index) => {
    if (cue.start < previousStart) add('out-of-order', index + 1);
    if (cue.start < latestEnd) add('overlap', index + 1);
    previousStart = cue.start;
    latestEnd = Math.max(latestEnd, cue.end);
  });
  return { format, cueCount: cues.length, firstStartMs: Math.min(...cues.map(cue => cue.start)), lastEndMs: latestEnd, issueCount, issues, omittedIssues: issueCount - issues.length };
}

function formatTime(ms, format) {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_TIME) throw new RangeError('偏移后的时间超出 00:00:00.000–99:59:59.999 范围，未输出部分结果');
  const pad = (value, width) => String(value).padStart(width, '0');
  return pad(Math.floor(ms / 3600000), 2) + ':' + pad(Math.floor(ms / 60000) % 60, 2) + ':'
    + pad(Math.floor(ms / 1000) % 60, 2) + (format === 'srt' ? ',' : '.') + pad(ms % 1000, 3);
}

function transform(args) {
  validate(args, true);
  const parsed = parse(args.text), offset = args.offsetMs ?? 0;
  if (parsed.format === 'vtt' && args.format === 'srt'
    && (parsed.header !== 'WEBVTT' || parsed.cues.some(cue => cue.settings || (cue.id && !/^\d+$/.test(cue.id))))) {
    throw new TypeError('无法无损转换为 SRT：WebVTT 包含标题、非数字 ID 或 cue settings');
  }
  const blocks = parsed.cues.map((cue, index) => {
    const id = args.format === 'srt' ? String(index + 1) : cue.id;
    return (id === undefined ? '' : id + '\n') + formatTime(cue.start + offset, args.format)
      + ' --> ' + formatTime(cue.end + offset, args.format)
      + (args.format === 'vtt' && cue.settings ? ' ' + cue.settings : '') + '\n' + cue.text;
  });
  const result = (args.format === 'vtt' ? parsed.header + '\n\n' : '') + blocks.join('\n\n') + '\n';
  if (result.length > 250000) throw new RangeError('输出字幕超过 250000 个 UTF-16 码元');
  return { text: result, format: args.format, cueCount: parsed.cues.length, offsetMs: offset };
}

module.exports = {
  register(ctx) {
    if (activeContext) throw new Error('Subtitle tools is already registered');
    const added = [];
    try {
      for (const [name, label, description, execute] of [
        ['inspect', '检查字幕时序', '检查 SRT 或简单 WebVTT 文本，报告条数、时间范围、重叠和乱序；不自动重排。', inspect],
        ['transform', '调整和转换字幕', '在内存中偏移字幕并转换 SRT/WebVTT。正 offsetMs 为延后、负数为提前。负时间、溢出和有损转换均拒绝；不读取或保存文件。', transform],
      ]) {
        const properties = { text: { type: 'string', minLength: 1, maxLength: MAX_TEXT } };
        if (name === 'transform') {
          properties.format = { type: 'string', enum: ['srt', 'vtt'] };
          properties.offsetMs = { type: 'integer', minimum: -604800000, maximum: 604800000 };
        }
        const id = 'subtitle-tools_' + name;
        ctx.registerTool({ id, name: label, description, enabled: true, risk: 'safe', effectKind: 'read', verificationPolicy: 'none',
          inputSchema: { type: 'object', properties, required: name === 'transform' ? ['text', 'format'] : ['text'], additionalProperties: false },
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
    ctx.unregisterTool('subtitle-tools_inspect');
    ctx.unregisterTool('subtitle-tools_transform');
  },
};
