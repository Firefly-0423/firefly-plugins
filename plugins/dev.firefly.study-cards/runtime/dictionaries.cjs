'use strict';

const {
  DatabaseSync
} = require('node:sqlite');
const {
  statSync,
  readdirSync,
  unlinkSync
} = require('node:fs');
const {
  join
} = require('node:path');
const {
  randomUUID
} = require('node:crypto');
const {
  setImmediate: yieldTurn
} = require('node:timers/promises');
const yauzl = require('../vendor/yauzl');
const {
  crc32
} = require('node:zlib');
const MiB = 1024 * 1024;
const fold = s => s.replace(/\p{Script=Latin}/gu, c => c.toLowerCase());
function createDictionaries({
  db,
  rootDir,
  transaction,
  language,
  text
}) {
  let stage = null;
  // Only generated staging names within this private root are removed after interrupted imports.
  for (const name of readdirSync(rootDir)) if (/^dictionary-stage-[0-9a-f-]{36}\.sqlite(?:-journal|-wal|-shm)?$/.test(name)) unlinkSync(join(rootDir, name));
  const all = (sql, ...v) => db.prepare(sql).all(...v),
    run = (sql, ...v) => db.prepare(sql).run(...v);
  function clear() {
    if (stage) {
      stage.db.close();
      try {
        unlinkSync(stage.path);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      stage = null;
    }
  }
  function cancel(a = {}) {
    if (stage && (!a.token || a.token === stage.token)) {
      stage.cancelled = true;
      if (stage.ready) clear();
    }
    return {
      cancelled: true
    };
  }
  function check() {
    if (!stage || stage.cancelled) throw new Error('词典导入已取消');
  }
  function flatten(value, warnings, depth = 0) {
    if (depth > 32) {
      warnings.add('结构化释义嵌套过深，已拒绝');
      return '';
    }
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(x => flatten(x, warnings, depth + 1)).filter(Boolean).join('\n');
    if (!value || typeof value !== 'object') {
      warnings.add('不支持的释义字段');
      return '';
    }
    if (value.type === 'structured-content') return flatten(value.content, warnings, depth + 1);
    if (value.type === 'text') return typeof value.text === 'string' ? value.text : '';
    const allowed = ['ruby', 'rt', 'rp', 'span', 'div', 'br', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'];
    if (allowed.includes(value.tag)) return value.tag === 'br' ? '\n' : flatten(value.content ?? '', warnings, depth + 1);
    warnings.add('不支持的图片、媒体或结构化节点已拒绝');
    return '';
  }
  async function prepare(a) {
    if (stage) throw new Error('请先确认或取消当前导入');
    text(a.path, 32768);
    if (a.language !== undefined) language(a.language);
    const archive = statSync(a.path);
    if (!archive.isFile() || archive.size > 200 * MiB) throw new Error('词典压缩包超过 200 MiB 限额或不是文件');
    const token = randomUUID(),
      path = join(rootDir, `dictionary-stage-${token}.sqlite`),
      sdb = new DatabaseSync(path);
    stage = {
      token,
      path,
      db: sdb,
      cancelled: false,
      ready: false
    };
    sdb.exec('CREATE TABLE entries(id TEXT PRIMARY KEY,term TEXT,fold TEXT,reading TEXT,meaning TEXT)');
    let zip,
      total = 0,
      count = 0,
      index,
      bankCount = 0;
    const warnings = new Set(),
      names = new Set();
    try {
      zip = await yauzl.openPromise(a.path, {
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true
      });
      sdb.exec('BEGIN');
      const insert = sdb.prepare('INSERT INTO entries VALUES(?,?,?,?,?)');
      for await (const e of zip.eachEntry()) {
        check();
        const name = e.fileName,
          alias = name.normalize('NFC').toLowerCase();
        const mode = e.externalFileAttributes >>> 16 & 0xf000;
        if (!name || name.includes('\0') || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.') || names.has(alias) || mode === 0xa000 || mode !== 0 && mode !== 0x8000 && mode !== 0x4000 || e.generalPurposeBitFlag & 1) throw new Error('词典 ZIP 包含不安全路径、链接、别名或加密条目');
        names.add(alias);
        if (names.size > 10000) throw new Error('词典 ZIP 文件数量超限');
        if (e.uncompressedSize > 64 * MiB) throw new Error('词典单文件超过 64 MiB');
        let size = 0,
          crc = 0;
        const chunks = [];
        const wanted = name === 'index.json' || /^term_bank_[1-9]\d*\.json$/.test(name);
        const stream = await zip.openReadStreamPromise(e);
        for await (const chunk of stream) {
          check();
          size += chunk.length;
          total += chunk.length;
          crc = crc32(chunk, crc);
          if (size > 64 * MiB || total > 1024 * MiB) {
            stream.destroy();
            throw new Error('词典实际展开字节超限');
          }
          if (wanted) chunks.push(chunk);
        }
        if (crc !== e.crc32) throw new Error('词典 ZIP CRC 校验失败');
        if (!wanted) {
          if (!name.endsWith('/')) warnings.add(`不支持的资源未载入: ${name.slice(0, 100)}`);
          continue;
        }
        let parsed;
        try {
          parsed = JSON.parse(new TextDecoder('utf-8', {
            fatal: true
          }).decode(Buffer.concat(chunks)));
        } catch {
          throw new Error('词典 JSON 或 UTF-8 无效');
        }
        if (name === 'index.json') {
          index = parsed;
          continue;
        }
        bankCount++;
        if (!Array.isArray(parsed)) throw new Error('词典 bank 必须是数组');
        for (const row of parsed) {
          check();
          if (++count > 2000000) throw new Error('词典词条超过两百万');
          if (!Array.isArray(row) || row.length !== 8 || typeof row[0] !== 'string' || typeof row[1] !== 'string' || typeof row[2] !== 'string' || typeof row[3] !== 'string' || !Number.isFinite(row[4]) || !Array.isArray(row[5]) || !Number.isSafeInteger(row[6]) || typeof row[7] !== 'string') throw new Error('词典 v3 词条格式无效');
          const meaning = flatten(row[5], warnings);
          if (!meaning.trim()) {
            warnings.add('核心释义缺失的词条未导入');
            continue;
          }
          text(row[0], 200);
          text(row[1], 200, true);
          text(meaning, 4000);
          insert.run(randomUUID(), row[0].normalize('NFC'), fold(row[0].normalize('NFC')), row[1], meaning);
          if (count % 500 === 0) await yieldTurn();
        }
        await yieldTurn();
      }
      check();
      if (!index || index.format !== 3 || !bankCount) throw new Error('需要根目录 Yomitan v3 index.json 和 term bank');
      text(index.title, 200);
      text(index.revision, 200);
      const sourceLanguage = language(index.sourceLanguage || a.language),
        targetLanguage = typeof index.targetLanguage === 'string' ? text(index.targetLanguage, 50) : 'unknown';
      if (a.language && index.sourceLanguage && a.language !== index.sourceLanguage) throw new Error('所选语言与词典源语言不一致');
      const attribution = typeof index.attribution === 'string' ? text(index.attribution, 4000, true) : '';
      if (!attribution) warnings.add('词典未提供许可或来源说明，请自行确认使用授权');
      stage.summary = {
        token,
        title: index.title,
        revision: index.revision,
        sourceLanguage,
        targetLanguage,
        count: sdb.prepare('SELECT COUNT(*) n FROM entries').get().n,
        warnings: [...warnings],
        bytes: total,
        attribution
      };
      sdb.exec('COMMIT');
      stage.ready = true;
      return stage.summary;
    } catch (e) {
      if (stage) {
        try {
          sdb.exec('ROLLBACK');
        } catch {}
        clear();
      }
      throw e;
    } finally {
      if (zip) zip.close();
    }
  }
  const actions = ['lookup', 'dictionaryList', 'dictionaryPrepare', 'dictionaryCommit', 'dictionaryCancel', 'dictionarySet', 'dictionaryDelete', 'demoInstall'];
  return {
    actions,
    cancel,
    dispose: clear,
    async call(action, a) {
      switch (action) {
        case 'dictionaryPrepare':
          return prepare(a);
        case 'dictionaryCancel':
          return cancel(a);
        case 'dictionaryList':
          return {
            dictionaries: all('SELECT * FROM dictionaries ORDER BY priority,title').map(d => ({
              ...d,
              enabled: !!d.enabled,
              demo: !!d.demo
            })),
            staging: stage?.summary || (stage ? {
              token: stage.token,
              preparing: true
            } : null)
          };
        case 'dictionaryCommit':
          {
            text(a.token, 100);
            if (!stage || !stage.ready || stage.cancelled || stage.token !== a.token) throw new Error('词典暂存不存在或已取消');
            const summary = stage.summary,
              id = randomUUID();
            transaction(() => {
              run('INSERT INTO dictionaries VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, summary.title, summary.revision, summary.sourceLanguage, summary.targetLanguage, 1, 0, summary.count, summary.bytes, summary.attribution, 0);
              const insert = db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?)');
              for (const e of stage.db.prepare('SELECT * FROM entries').iterate()) insert.run(e.id, id, e.term, e.fold, e.reading, e.meaning);
            });
            clear();
            return {
              id,
              ...summary
            };
          }
        case 'dictionarySet':
          text(a.id, 100);
          if (typeof a.enabled !== 'boolean' || !Number.isSafeInteger(a.priority) || Math.abs(a.priority) > 1000000) throw new Error('词典设置无效');
          run('UPDATE dictionaries SET enabled=?,priority=? WHERE id=?', Number(a.enabled), a.priority, a.id);
          return {
            id: a.id
          };
        case 'dictionaryDelete':
          text(a.id, 100);
          run('DELETE FROM dictionaries WHERE id=?', a.id);
          return {
            id: a.id
          };
        case 'lookup':
          {
            language(a.language);
            text(a.term, 200);
            const limit = a.limit ?? 20;
            if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new Error('查词数量无效');
            const term = a.term.normalize('NFC');
            const sql = `SELECT e.id,e.dictionaryId,d.title,d.revision,d.sourceLanguage,d.targetLanguage,e.term,e.reading,e.meaning FROM entries e JOIN dictionaries d ON d.id=e.dictionaryId WHERE d.enabled=1 AND d.sourceLanguage=? AND e.`;
            let entries = all(sql + 'term=? ORDER BY d.priority,d.title,e.id LIMIT ?', a.language, term, limit);
            if (entries.length) return {
              entries,
              match: 'exact'
            };
            entries = all(sql + 'fold=? ORDER BY d.priority,d.title,e.id LIMIT ?', a.language, fold(term), limit);
            return {
              entries,
              match: entries.length ? 'case' : 'none'
            };
          }
        case 'demoInstall':
          return transaction(() => {
            const samples = {
              en: [['hello','həˈləʊ','你好'],['quiet','ˈkwaɪət','安静的；轻声的'],['joy','dʒɔɪ','喜悦；快乐'],['learning','ˈlɜːnɪŋ','学习；获取知识的过程'],['window','ˈwɪndəʊ','窗；窗口']],
              ja: [['猫','ねこ','猫'],['朝','あさ','早晨'],['本','ほん','书'],['言葉','ことば','词语；语言'],['学ぶ','まなぶ','学习']],
              ko: [['안녕','annyeong','你好'],['아침','achim','早晨'],['책','chaek','书'],['단어','daneo','单词'],['배우다','baeuda','学习']],
              fr: [['bonjour','bɔ̃ʒuʁ','你好；日安'],['apprendre','apʁɑ̃dʁ','学习；获知'],['voyage','vwajaʒ','旅行'],['merci','mɛʁsi','谢谢']],
              de: [['Hallo','halo','你好'],['Morgen','ˈmɔʁɡn̩','早晨；明天'],['lernen','ˈlɛʁnən','学习'],['Straße','ˈʃtʁaːsə','街道'],['Freude','ˈfʁɔʏdə','喜悦']],
              es: [['hola','ola','你好'],['aprender','apɾenˈdeɾ','学习'],['gracias','ˈɡɾasjas','谢谢'],['alegría','aleˈɡɾia','喜悦；快乐']],
            };
            for (const [lang, entries] of Object.entries(samples)) {
              const id = 'demo-' + lang;
              if (db.prepare('SELECT id FROM dictionaries WHERE id=?').get(id)) continue;
              const bytes = Buffer.byteLength(JSON.stringify(entries));
              run('INSERT INTO dictionaries VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, lang + ' 原创演示词典', '1', lang, 'zh', 1, 100, entries.length, bytes, 'Firefly contributors, original demo entries; MIT', 1);
              for (const [i, [term, reading, meaning]] of entries.entries()) {
                run('INSERT INTO entries VALUES(?,?,?,?,?,?)', id + '-' + i, id, term, fold(term), reading, meaning);
              }
            }
            return {
              installed: 6
            };
          });
        default:
          throw new Error('不支持的词典操作');
      }
    }
  };
}
module.exports = {
  createDictionaries
};
