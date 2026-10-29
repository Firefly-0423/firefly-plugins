import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareMarketplace } from '../scripts/build.mjs';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
function harness(storage) {
  const tools = new Map();
  return { tools, ctx: { storage, signal: new AbortController().signal, registerTool: t => tools.set(t.id, t), unregisterTool: id => tools.delete(id), onDispose() {}, log() {} } };
}
function storage() {
  const data = new Map();
  return { get: key => structuredClone(data.get(key)), set: (key, value) => data.set(key, structuredClone(value)) };
}

test('cards persist across re-enable and only become due after review', async () => {
  const { createPlugin } = require('../plugins/study-cards/index.cjs');
  let now = 1000000000000;
  const store = storage(); const h = harness(store);
  const plugin = createPlugin({ now: () => now });
  await plugin.register(h.ctx);
  const create = JSON.parse(await h.tools.get('study-cards_create').execute({ deck: 'CANN', front: '什么是算子？', back: '执行计算的单元' }));
  assert.equal(create.ok, true);
  const id = create.data.cardId;
  assert.equal(JSON.parse(await h.tools.get('study-cards_new').execute({ limit: 10 })).data.cards.length, 1);
  assert.equal(JSON.parse(await h.tools.get('study-cards_due').execute({ limit: 10 })).data.cards.length, 0);
  const answer = JSON.parse(await h.tools.get('study-cards_review').execute({ cardId: id, rating: 1, expectedRevision: 1 }));
  assert.equal(answer.data.dueAt, now + 600000);
  assert.equal(JSON.parse(await h.tools.get('study-cards_list').execute({ limit: 10 })).data.cards[0].revision, 2);
  await plugin.unregister();
  const again = createPlugin({ now: () => now });
  await again.register(h.ctx);
  assert.equal(JSON.parse(await h.tools.get('study-cards_new').execute({ limit: 10 })).data.cards.length, 0);
  now += 600000;
  assert.equal(JSON.parse(await h.tools.get('study-cards_due').execute({ limit: 10 })).data.cards[0].front, '什么是算子？');
  await again.unregister();
  assert.equal(h.tools.size, 0);
});

test('invalid inputs and stale reviews cannot change cards', async () => {
  const { createPlugin } = require('../plugins/study-cards/index.cjs');
  const store = storage(); const h = harness(store); const plugin = createPlugin({ now: () => 1000000000000 });
  await plugin.register(h.ctx);
  assert.equal(JSON.parse(await h.tools.get('study-cards_create').execute({ deck: '', front: 'a', back: 'b' })).success, false);
  const card = JSON.parse(await h.tools.get('study-cards_create').execute({ deck: 'A', front: 'a', back: 'b' })).data;
  assert.equal(JSON.parse(await h.tools.get('study-cards_review').execute({ cardId: card.cardId, rating: 7 })).success, false);
  assert.equal(JSON.parse(await h.tools.get('study-cards_review').execute({ cardId: card.cardId, rating: 3, expectedRevision: 99 })).success, false);
  assert.equal(JSON.parse(await h.tools.get('study-cards_new').execute({ limit: 10 })).data.cards.length, 1);
  await plugin.unregister();
});

test('editing and deleting require the current card revision', async () => {
  const { createPlugin } = require('../plugins/study-cards/index.cjs');
  const h = harness(storage()); const plugin = createPlugin();
  await plugin.register(h.ctx);
  const card = JSON.parse(await h.tools.get('study-cards_create').execute({ deck: 'A', front: 'old', back: 'answer' })).data;
  const updated = JSON.parse(await h.tools.get('study-cards_update').execute({ cardId: card.cardId, expectedRevision: 1, front: 'new', back: 'answer' }));
  assert.equal(updated.data.revision, 2);
  assert.equal(JSON.parse(await h.tools.get('study-cards_delete').execute({ cardId: card.cardId, expectedRevision: 1 })).success, false);
  assert.equal(JSON.parse(await h.tools.get('study-cards_new').execute({ limit: 10 })).data.cards[0].front, 'new');
  assert.equal(JSON.parse(await h.tools.get('study-cards_delete').execute({ cardId: card.cardId, expectedRevision: 2 })).ok, true);
  assert.equal(JSON.parse(await h.tools.get('study-cards_new').execute({ limit: 10 })).data.total, 0);
  await plugin.unregister();
});

test('an unreadable existing store is never replaced as an empty collection', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'firefly-cards-test-'));
  const owned = await realpath(root), parent = await realpath(tmpdir());
  t.after(async () => { if (path.dirname(owned) !== parent || await realpath(root) !== owned) throw new Error('Unsafe cleanup target'); await rm(owned, { recursive: true, force: true }); });
  await writeFile(path.join(root, 'cards-v1.json'), '{broken');
  let writes = 0;
  const h = harness({ get: () => undefined, set: () => { writes++; }, rootDir: () => root });
  const { createPlugin } = require('../plugins/study-cards/index.cjs');
  const plugin = createPlugin(); await plugin.register(h.ctx);
  const result = JSON.parse(await h.tools.get('study-cards_create').execute({ deck: 'A', front: 'a', back: 'b' }));
  assert.equal(result.success, false);
  assert.equal(writes, 0);
  await plugin.unregister();
});

test('built plugin package has only the four public files and starts disabled', async () => {
  const plugin = (await prepareMarketplace()).plugins.find(p => p.id === 'study-cards');
  const zip = await require('jszip').loadAsync(plugin.zipBytes);
  assert.deepEqual(Object.keys(zip.files), ['LICENSE', 'README.md', 'index.cjs', 'manifest.json']);
  assert.equal(JSON.parse(await zip.file('manifest.json').async('string')).defaultEnabled, false);
});
