import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { prepareMarketplace } from '../scripts/build.mjs';
import { createRequire } from 'node:module';

const source = new URL('../plugins/subtitle-tools/index.cjs', import.meta.url);
const srt = '8\r\n00:00:01,000 --> 00:00:03,000\r\n你好 😀\r\n第二行\r\n\r\n12\r\n00:00:02,500 --> 00:00:04,000\r\n重叠';
function fixture(t) {
  const box = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(source, 'utf8'), box, { timeout: 1000 });
  const plugin = box.module.exports, tools = new Map();
  const ctx = { registerTool: tool => tools.set(tool.id, tool), unregisterTool: id => tools.delete(id) };
  plugin.register(ctx);
  t.after(() => plugin.unregister());
  const invoke = async (name, args) => JSON.parse(await tools.get('subtitle-tools_' + name).execute(args));
  return { plugin, ctx, tools, invoke };
}

test('offline inspection handles BOM, CRLF, Unicode and overlapping cues', async t => {
  const { invoke } = fixture(t);
  const result = await invoke('inspect', { text: '\ufeff' + srt });
  assert.equal(result.format, 'srt'); assert.equal(result.cueCount, 2);
  assert.equal(result.firstStartMs, 1000); assert.equal(result.lastEndMs, 4000);
  assert.equal(result.issueCount, 1); assert.equal(result.issues[0].kind, 'overlap');
});

test('positive shift delays subtitles and outputs canonical SRT numbering', async t => {
  const { invoke } = fixture(t);
  const result = await invoke('transform', { text: srt, format: 'srt', offsetMs: 500 });
  assert.match(result.text, /^1\n00:00:01,500 --> 00:00:03,500\n你好 😀\n第二行/);
  assert.match(result.text, /\n2\n00:00:03,000 --> 00:00:04,500/);
});

test('plain SRT and WebVTT convert without changing cue text or time', async t => {
  const { invoke } = fixture(t);
  const vtt = await invoke('transform', { text: srt, format: 'vtt' });
  assert.match(vtt.text, /^WEBVTT\n\n/);
  const back = await invoke('transform', { text: vtt.text, format: 'srt' });
  assert.match(back.text, /00:00:01,000 --> 00:00:03,000\n你好 😀\n第二行/);
});

test('WebVTT cue IDs, optional hours and cue settings survive a same-format shift', async t => {
  const { invoke } = fixture(t);
  const result = await invoke('transform', { text: 'WEBVTT\n\nintro\n01:02.003 --> 01:03.004 align:start position:10%\nhello', format: 'vtt', offsetMs: -1000 });
  assert.match(result.text, /intro\n00:01:01.003 --> 00:01:02.004 align:start position:10%\nhello/);
  await assert.rejects(invoke('transform', { text: result.text, format: 'srt' }), /loss|无损/);
});

test('negative time, overflow, malformed timestamps and empty cues fail explicitly', async t => {
  const { invoke } = fixture(t);
  await assert.rejects(invoke('transform', { text: srt, format: 'srt', offsetMs: -1001 }), /range|范围/);
  await assert.rejects(invoke('transform', { text: '1\n99:59:59,000 --> 99:59:59,999\nx', format: 'srt', offsetMs: 1 }), /range|范围/);
  for (const text of ['not subtitles', '1\n00:60:00,000 --> 00:61:00,000\nx', '1\n00:00:02,000 --> 00:00:01,000\nx', '1\n00:00:00,000 --> 00:00:01,000']) await assert.rejects(invoke('inspect', { text }));
});

test('unsupported WebVTT blocks refuse transformation rather than silently drop data', async t => {
  const { invoke } = fixture(t);
  for (const text of ['WEBVTT\n\nSTYLE\n::cue {color:red}', 'WEBVTT\n\nNOTE note\ncontent', 'WEBVTT\n\nREGION\nid:region']) await assert.rejects(invoke('transform', { text, format: 'srt' }), /unsupported|不支持/);
});

test('bounded schemas, validation, lifecycle and repeated activation follow Claude originals', async t => {
  const { plugin, ctx, tools, invoke } = fixture(t);
  assert.equal(tools.size, 2);
  for (const tool of tools.values()) { assert.equal(tool.risk, 'safe'); assert.equal(tool.effectKind, 'read'); assert.equal(tool.verificationPolicy, 'none'); }
  for (const args of [null, {}, { text: 1 }, { text: srt, unknown: true }, { text: 'a'.repeat(200001) }]) await assert.rejects(invoke('inspect', args));
  for (const args of [{ text: srt, format: 'ass' }, { text: srt, format: 'srt', offsetMs: 0.1 }]) await assert.rejects(invoke('transform', args));
  assert.throws(() => plugin.register(ctx)); plugin.unregister(); plugin.unregister();
  assert.equal(tools.size, 0); plugin.register(ctx); assert.equal(tools.size, 2);
});

test('real package has the original four-file layout and a disabled API v1 manifest', async () => {
  const packageInfo = (await prepareMarketplace()).plugins.find(x => x.id === 'subtitle-tools');
  assert.ok(packageInfo);
  const zip = await createRequire(import.meta.url)('jszip').loadAsync(packageInfo.zipBytes);
  assert.deepEqual(Object.keys(zip.files), ['LICENSE', 'README.md', 'index.cjs', 'manifest.json']);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.defaultEnabled, false); assert.equal(manifest.apiVersion, 1); assert.deepEqual(manifest.deps, []);
  const box = { module: { exports: {} } }, tools = new Map();
  vm.runInNewContext(await zip.file('index.cjs').async('string'), box, { timeout: 1000 });
  box.module.exports.register({ registerTool: x => tools.set(x.id, x), unregisterTool: id => tools.delete(id) });
  assert.equal(JSON.parse(await tools.get('subtitle-tools_inspect').execute({ text: srt })).cueCount, 2);
  box.module.exports.unregister();
});

test('cue and issue budgets reject oversized collections and report omitted diagnostics', async t => {
  const { invoke } = fixture(t);
  const cues = count => Array.from({ length: count }, (_, i) => (i + 1) + '\n00:00:00,000 --> 00:00:01,000\nx').join('\n\n');
  const report = await invoke('inspect', { text: cues(150) });
  assert.equal(report.issueCount, 149); assert.equal(report.issues.length, 100); assert.equal(report.omittedIssues, 49);
  await assert.rejects(invoke('inspect', { text: cues(2001) }), /2000/);
});
