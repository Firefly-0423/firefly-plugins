import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createRequire } from 'node:module';
import { prepareMarketplace } from '../scripts/build.mjs';

function fixture(t) {
  const box = { module: { exports: {} } }, tools = new Map();
  vm.runInNewContext(readFileSync(new URL('../plugins/color-contrast/index.cjs', import.meta.url), 'utf8'), box, { timeout: 1000 });
  const ctx = { registerTool: tool => tools.set(tool.id, tool), unregisterTool: id => tools.delete(id) };
  const plugin = box.module.exports; plugin.register(ctx); t.after(() => plugin.unregister());
  return { plugin, ctx, tools, invoke: async (tool, args) => JSON.parse(await tools.get('color-contrast_' + tool).execute(args)) };
}

test('sRGB extremes, canonical hex and foreground/background symmetry', async t => {
  const { invoke } = fixture(t);
  const result = await invoke('check', { foreground: '#000', background: '#FFF' });
  assert.equal(result.ratio, 21); assert.equal(result.foreground, '#000000'); assert.equal(result.background, '#ffffff');
  assert.equal(result.aaNormal, true); assert.equal(result.aaaNormal, true);
  assert.equal((await invoke('check', { foreground: '#FFF', background: '#000' })).ratio, result.ratio);
  const equal = await invoke('check', { foreground: '#123456', background: '#123456' });
  assert.equal(equal.ratio, 1); assert.equal(equal.aaLarge, false);
});

test('WCAG checks use the unrounded ratio at threshold boundaries', async t => {
  const { invoke } = fixture(t);
  const failing = await invoke('check', { foreground: '#777777', background: '#fff' });
  assert.ok(Math.abs(failing.ratio - 4.478089) < 0.000001); assert.equal(failing.aaNormal, false); assert.equal(failing.aaLarge, true);
  assert.equal((await invoke('check', { foreground: '#767676', background: '#fff' })).aaNormal, true);
});

test('a palette produces individual results and reports failing normal-text pairs', async t => {
  const { invoke } = fixture(t);
  const result = await invoke('palette', { pairs: [{ foreground: '#000', background: '#fff' }, { foreground: '#888', background: '#999' }] });
  assert.equal(result.results.length, 2); assert.equal(result.failedAaNormal, 1);
  assert.equal(result.results[0].ratio, 21);
});

test('transparent, CSS expression, unknown, coercible and oversized input is rejected', async t => {
  const { invoke } = fixture(t);
  for (const foreground of ['red', '#abcd', '#000000ff', 'rgb(0,0,0)', '#fffffg', 0, null, ' #fff']) await assert.rejects(invoke('check', { foreground, background: '#fff' }));
  await assert.rejects(invoke('check', { foreground: '#000', background: '#fff', extra: 1 }));
  await assert.rejects(invoke('palette', { pairs: [] }));
  await assert.rejects(invoke('palette', { pairs: Array(51).fill({ foreground: '#000', background: '#fff' }) }));
});

test('lifecycle and metadata match the safe four-file plugin pattern', async t => {
  const { plugin, ctx, tools } = fixture(t);
  for (const tool of tools.values()) { assert.equal(tool.risk, 'safe'); assert.equal(tool.effectKind, 'read'); }
  assert.throws(() => plugin.register(ctx));
  plugin.unregister(); plugin.unregister(); assert.equal(tools.size, 0);
  plugin.register(ctx); assert.equal(tools.size, 2);
});

test('the extracted color-contrast ZIP runs without repository dependencies', async () => {
  const entry = (await prepareMarketplace()).plugins.find(x => x.id === 'color-contrast');
  const zip = await createRequire(import.meta.url)('jszip').loadAsync(entry.zipBytes);
  assert.deepEqual(Object.keys(zip.files), ['LICENSE', 'README.md', 'index.cjs', 'manifest.json']);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.apiVersion, 1); assert.equal(manifest.defaultEnabled, false); assert.deepEqual(manifest.deps, []);
  const box = { module: { exports: {} } }, tools = new Map();
  vm.runInNewContext(await zip.file('index.cjs').async('string'), box, { timeout: 1000 });
  box.module.exports.register({ registerTool: x => tools.set(x.id, x), unregisterTool: id => tools.delete(id) });
  assert.equal(JSON.parse(await tools.get('color-contrast_check').execute({ foreground: '#000', background: '#fff' })).ratio, 21);
  box.module.exports.unregister(); assert.equal(tools.size, 0);
});
