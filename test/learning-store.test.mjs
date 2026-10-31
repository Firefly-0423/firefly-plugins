import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
async function fixture(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'learning-'));
  return rootDir;
}
test('worker migrates valid legacy cards once and preserves bytes, grading and revisions across restart', async t => {
  const rootDir = await fixture(t);
  const bytes = JSON.stringify({
    version: 1,
    cards: [{
      id: '12345678-1234-1234-1234-123456789012',
      deck: 'Old',
      front: 'A',
      back: 'B',
      reviews: 0,
      revision: 4,
      dueAt: 0,
      interval: 0
    }]
  });
  await writeFile(join(rootDir, 'cards-v1.json'), bytes);
  const {
    createService
  } = require('../plugins/study-cards/runtime/service.cjs');
  let s = createService({
    rootDir,
    now: () => 1000
  });
  t.after(async () => {
    await s.dispose();
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  });
  assert.equal((await s.call('new', {
    limit: 40
  })).cards[0].revision, 4);
  const graded = await s.call('review', {
    cardId: '12345678-1234-1234-1234-123456789012',
    expectedRevision: 4,
    rating: 3
  });
  assert.equal(graded.dueAt, 1000 + 3 * 86400000);
  await assert.rejects(s.call('review', {
    cardId: graded.cardId,
    expectedRevision: 4,
    rating: 3
  }), /版本/);
  await s.dispose();
  s = createService({
    rootDir
  });
  assert.equal((await s.call('list', {
    limit: 40
  })).total, 1);
  assert.equal(await readFile(join(rootDir, 'cards-v1.json'), 'utf8'), bytes);
});
test('corrupt legacy refuses all mutations and retries after repair', async t => {
  const rootDir = await fixture(t);
  await writeFile(join(rootDir, 'cards-v1.json'), '{bad');
  const {
    createService
  } = require('../plugins/study-cards/runtime/service.cjs');
  let s = createService({
    rootDir
  });
  await assert.rejects(s.call('create', {
    deck: 'a',
    front: 'b',
    back: 'c'
  }), /卡片/);
  await s.dispose();
  assert.equal(await readFile(join(rootDir, 'cards-v1.json'), 'utf8'), '{bad');
  await writeFile(join(rootDir, 'cards-v1.json'), '{"version":1,"cards":[]}');
  s = createService({
    rootDir
  });
  t.after(async () => {
    await s.dispose();
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  });
  assert.equal((await s.call('list', {
    limit: 40
  })).total, 0);
});
test('atomic collect deduplicates operations and NFC terms; edits conflict and card deletes remove vocabulary', async t => {
  const rootDir = await fixture(t);
  const {
    createService
  } = require('../plugins/study-cards/runtime/service.cjs');
  const s = createService({
    rootDir,
    now: () => 500
  });
  t.after(async () => {
    await s.dispose();
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  });
  const args = {
    language: 'fr',
    term: 'cafe\u0301',
    meaning: 'coffee',
    operationId: 'one'
  };
  const [a, b] = await Promise.all([s.call('collect', args), s.call('collect', {
    ...args,
    term: 'café',
    operationId: 'two'
  })]);
  assert.equal(a.cardId, b.cardId);
  assert.equal(b.duplicate, true);
  assert.equal((await s.call('vocabulary')).total, 1);
  await s.call('vocabularyUpdate', {
    cardId: a.cardId,
    expectedRevision: 1,
    meaning: '咖啡',
    context: 'un café'
  });
  await assert.rejects(s.call('vocabularyDelete', {
    cardId: a.cardId,
    expectedRevision: 1
  }), /版本/);
  await s.call('delete', {
    cardId: a.cardId,
    expectedRevision: 2
  });
  assert.equal((await s.call('vocabulary')).total, 0);
  assert.equal((await s.call('collect', args)).cardId, a.cardId);
  assert.equal((await s.call('list', {
    limit: 40
  })).total, 0);
});
test('articles, exports, dashboard and cap retain learning data', async t => {
  const rootDir = await fixture(t);
  const {
    createService
  } = require('../plugins/study-cards/runtime/service.cjs');
  const s = createService({
    rootDir
  });
  t.after(async () => {
    await s.dispose();
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  });
  const {
    id
  } = await s.call('articleSave', {
    title: '文章',
    language: 'ja',
    text: '日本語',
    position: 2
  });
  assert.equal((await s.call('articleGet', {
    id
  })).text, '日本語');
  assert.equal((await s.call('articleList')).articles[0].position, 2);
  assert.equal((await s.call('exportData')).articles.length, 1);
  assert.equal((await s.call('dashboard')).cards, 0);
  await assert.rejects(s.call('collect', {
    language: 'xx',
    term: 'x',
    meaning: 'x',
    operationId: 'x'
  }));
});
test('vocabulary filters source deck and review state and includes current review count', async t => {
  const rootDir = await fixture(t);
  const {
    createService
  } = require('../plugins/study-cards/runtime/service.cjs');
  const s = createService({
    rootDir,
    now: () => 100
  });
  t.after(async () => {
    await s.dispose();
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  });
  const a = await s.call('collect', {
    language: 'en',
    term: 'hello',
    meaning: '你好',
    operationId: 'filter-a',
    dictionaryId: 'source-a'
  });
  await s.call('collect', {
    language: 'fr',
    term: 'bonjour',
    meaning: '你好',
    operationId: 'filter-b',
    dictionaryId: 'source-b'
  });
  assert.equal((await s.call('vocabulary', {
    dictionaryId: 'source-a',
    deck: 'en',
    status: 'new'
  })).total, 1);
  await s.call('review', {
    cardId: a.cardId,
    expectedRevision: 1,
    rating: 1
  });
  const v = await s.call('vocabulary', {
    status: 'learning'
  });
  assert.equal(v.total, 1);
  assert.equal(v.items[0].reviews, 1);
  assert.equal((await s.call('vocabulary', {
    status: 'due'
  })).total, 0);
});
test('all original intervals and the 1000 card cap survive migrated library', async t => {
  const rootDir = await fixture(t);
  const cards = Array.from({
    length: 1000
  }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    deck: 'cap',
    front: 'x',
    back: 'y',
    dueAt: 0,
    reviews: 0,
    revision: 1,
    interval: 0
  }));
  await writeFile(join(rootDir, 'cards-v1.json'), JSON.stringify({
    version: 1,
    cards
  }));
  const {
    createService
  } = require('../plugins/study-cards/runtime/service.cjs');
  const s = createService({
    rootDir,
    now: () => 100
  });
  t.after(async () => {
    await s.dispose();
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  });
  await assert.rejects(s.call('create', {
    deck: 'cap',
    front: 'x',
    back: 'y'
  }), /上限/);
  await assert.rejects(s.call('collect', {
    language: 'en',
    term: 'x',
    meaning: 'y',
    operationId: 'cap'
  }), /上限/);
  for (const [i, interval] of [600000, 86400000, 3 * 86400000, 7 * 86400000].entries()) {
    const result = await s.call('review', {
      cardId: cards[i].id,
      expectedRevision: 1,
      rating: i + 1
    });
    assert.equal(result.dueAt, 100 + interval);
  }
  assert.equal((await s.call('list', {
    limit: 40,
    offset: 990
  })).cards.length, 10);
});
test('service rejects uncloneable arguments without poisoning subsequent requests or disposal',async t=>{const rootDir=await fixture(t);const {createService}=require('../plugins/study-cards/runtime/service.cjs');const s=createService({rootDir});t.after(async()=>{await s.dispose();await rm(rootDir,{recursive:true,force:true});});await assert.rejects(s.call('create',{front:()=>{},back:'b',deck:'d'}));assert.equal((await s.call('dashboard')).cards,0);await Promise.all([s.dispose(),s.dispose()]);await assert.rejects(s.call('dashboard'),/停止/);});
test('article limit counts UTF-8 bytes and leaves prior article unchanged',async t=>{const rootDir=await fixture(t);const {createService}=require('../plugins/study-cards/runtime/service.cjs');const s=createService({rootDir});t.after(async()=>{await s.dispose();await rm(rootDir,{recursive:true,force:true});});const {id}=await s.call('articleSave',{title:'a',language:'ja',text:'猫'});await assert.rejects(s.call('articleSave',{id,title:'a',language:'ja',text:'猫'.repeat(400000)}),/文本|MiB/);assert.equal((await s.call('articleGet',{id})).text,'猫');});
