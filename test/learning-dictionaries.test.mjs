import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  crc32
} = require('node:zlib');
// Minimal stored ZIP writer keeps adversarial names intact, independent of importer.
function zip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name),
      b = Buffer.from(data),
      h = Buffer.alloc(30),
      c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc32(b), 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc32(b), 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, n, b);
    central.push(c, n);
    offset += h.length + n.length + b.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const index = JSON.stringify({
  title: 'Test dictionary',
  revision: '1',
  format: 3,
  sourceLanguage: 'fr',
  targetLanguage: 'en',
  attribution: 'Original test data'
});
async function setup(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'learning-dict-'));
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
  return {
    s,
    rootDir
  };
}
test('dictionaries activate only after confirmation, NFC/case filtering and disable persist', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  const p = join(rootDir, 'test.zip');
  await writeFile(p, zip([['index.json', index], ['term_bank_1.json', JSON.stringify([['café', '', '', '', 0, ['coffee'], 1, ''], ['Bonjour', '', '', '', 0, ['hello'], 2, '']])]]));
  const summary = await s.call('dictionaryPrepare', {
    path: p
  });
  assert.equal(summary.count, 2);
  assert.equal((await s.call('lookup', {
    language: 'fr',
    term: 'café'
  })).match, 'none');
  await s.call('dictionaryCommit', {
    token: summary.token
  });
  assert.equal((await s.call('lookup', {
    language: 'fr',
    term: 'cafe\u0301'
  })).match, 'exact');
  assert.equal((await s.call('lookup', {
    language: 'fr',
    term: 'BONJOUR'
  })).match, 'case');
  assert.equal((await s.call('lookup', {
    language: 'en',
    term: 'café'
  })).match, 'none');
  const d = (await s.call('dictionaryList')).dictionaries[0];
  await s.call('dictionarySet', {
    id: d.id,
    enabled: false,
    priority: 2
  });
  assert.equal((await s.call('lookup', {
    language: 'fr',
    term: 'café'
  })).match, 'none');
});
test('malicious paths, aliases, malformed banks roll back and cancel prevents activation', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  await s.call('demoInstall');
  for (const files of [[['../x', 'x']], [['index.json', index], ['INDEX.JSON', index]], [['index.json', index], ['term_bank_1.json', '{}']]]) {
    const p = join(rootDir, 'bad.zip');
    await writeFile(p, zip(files));
    await assert.rejects(s.call('dictionaryPrepare', {
      path: p
    }));
    assert.equal((await s.call('dictionaryList')).staging, null);
    assert.equal((await s.call('dictionaryList')).dictionaries.length, 6);
  }
  const p = join(rootDir, 'good.zip');
  await writeFile(p, zip([['index.json', index], ['term_bank_1.json', '[["x","","","",0,["word"],1,""]]']]));
  const a = await s.call('dictionaryPrepare', {
    path: p
  });
  await s.call('dictionaryCancel', {
    token: a.token
  });
  await assert.rejects(s.call('dictionaryCommit', {
    token: a.token
  }));
});
test('demo install is explicit idempotent, all six languages lookup and media warnings count', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  assert.equal((await s.call('dictionaryList')).dictionaries.length, 0);
  await s.call('demoInstall');
  await s.call('demoInstall');
  assert.equal((await s.call('dictionaryList')).dictionaries.length, 6);
  for (const [language, term] of [['en', 'hello'], ['ja', '猫'], ['ko', '안녕'], ['fr', 'bonjour'], ['de', 'Hallo'], ['es', 'hola']]) assert.equal((await s.call('lookup', {
    language,
    term
  })).entries.length, 1);
  const p = join(rootDir, 'media.zip');
  await writeFile(p, zip([['index.json', index], ['term_bank_1.json', JSON.stringify([['x', '', '', '', 0, [{
    type: 'image',
    path: 'a.png'
  }], 1, ''], ['y', '', '', '', 0, [{
    type: 'structured-content',
    content: {
      tag: 'div',
      content: ['safe', {
        tag: 'script',
        content: 'bad'
      }]
    }
  }], 2, '']])], ['styles.css', 'body{}']]));
  const a = await s.call('dictionaryPrepare', {
    path: p
  });
  assert.equal(a.count, 1);
  assert.ok(a.warnings.length);
  await s.call('dictionaryCancel', {
    token: a.token
  });
});
test('cancel during active preparation rejects without staging or activation', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  const p = join(rootDir, 'cancel.zip');
  const rows = Array.from({
    length: 15000
  }, (_, i) => ['word' + i, '', '', '', 0, ['meaning'], i, '']);
  await writeFile(p, zip([['index.json', index], ['term_bank_1.json', JSON.stringify(rows)]]));
  const preparing = s.call('dictionaryPrepare', {
    path: p
  });
  const failure = assert.rejects(preparing, /取消/);
  await new Promise(r => setTimeout(r, 30));
  await s.call('dictionaryCancel', {});
  await failure;
  assert.equal((await s.call('dictionaryList')).staging, null);
  assert.equal((await s.call('dictionaryList')).dictionaries.length, 0);
});
test('ZIP corrupted contents refuse staging even when JSON remains parseable', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  const p = join(rootDir, 'crc.zip');
  const bytes = zip([['index.json', index], ['term_bank_1.json', '[["x","","","",0,["word"],1,""]]']]);
  const i = bytes.indexOf(Buffer.from('word'));
  bytes[i] = 0x57;
  await writeFile(p, bytes);
  await assert.rejects(s.call('dictionaryPrepare', {
    path: p
  }), /CRC/);
  assert.equal((await s.call('dictionaryList')).staging, null);
});
test('disposing removes prepared stage files and refuses future calls', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  const p = join(rootDir, 'dispose.zip');
  await writeFile(p, zip([['index.json', index], ['term_bank_1.json', '[["x","","","",0,["word"],1,""]]']]));
  await s.call('dictionaryPrepare', {
    path: p
  });
  await s.dispose();
  const {
    readdir
  } = await import('node:fs/promises');
  assert.deepEqual((await readdir(rootDir)).filter(n => n.startsWith('dictionary-stage-')), []);
  await assert.rejects(s.call('dashboard'), /停止/);
});
test('ZIP rejects encrypted entries, symbolic links, oversized archives and banks', async t => {
  const {
    s,
    rootDir
  } = await setup(t);
  const normal = () => zip([['index.json', index], ['term_bank_1.json', '[["x","","","",0,["word"],1,""]]']]);
  const p = join(rootDir, 'hostile.zip');
  for (const type of ['encrypted', 'symlink']) {
    const b = normal();
    const c = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (type === 'encrypted') b.writeUInt16LE(1, c + 8);else b.writeUInt32LE(0xa1ff * 65536 >>> 0, c + 38);
    await writeFile(p, b);
    await assert.rejects(s.call('dictionaryPrepare', {
      path: p
    }), /链接|加密|size mismatch/);
  }
  const {
    truncate
  } = await import('node:fs/promises');
  await writeFile(p, '');
  await truncate(p, 200 * 1024 * 1024 + 1);
  await assert.rejects(s.call('dictionaryPrepare', {
    path: p
  }), /200 MiB/);
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  z.file('index.json', index);
  z.file('term_bank_1.json', ' '.repeat(64 * 1024 * 1024 + 1));
  await writeFile(p, await z.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  }));
  await assert.rejects(s.call('dictionaryPrepare', {
    path: p
  }), /64 MiB/);
  assert.equal((await s.call('dictionaryList')).staging, null);
});
test('original demo dictionaries cover the reader sample vocabulary in six languages',async t=>{const {s}=await setup(t);await s.call('demoInstall');for(const [language,terms] of Object.entries({en:['quiet','joy','learning','window'],ja:['朝','本','言葉','学ぶ'],ko:['아침','책','단어','배우다'],fr:['bonjour','apprendre','voyage','merci'],de:['Morgen','lernen','Straße','Freude'],es:['hola','aprender','gracias','alegría']})){for(const term of terms){const result=await s.call('lookup',{language,term});assert.equal(result.entries.length,1,`${language}: ${term}`);assert.equal(result.entries[0].targetLanguage,'zh');}}});
