'use strict';

const {
  DatabaseSync
} = require('node:sqlite');
const {
  mkdirSync,
  existsSync,
  readFileSync
} = require('node:fs');
const {
  join
} = require('node:path');
const {
  randomUUID
} = require('node:crypto');
const DAY = 86400000,
  LANG = ['en', 'ja', 'ko', 'fr', 'de', 'es'];
function text(v, max, empty = false) {
  if (typeof v !== 'string' || v.length > max || !empty && !v.trim()) throw new Error('文本内容无效');
  return v;
}
function language(v) {
  if (!LANG.includes(v)) throw new Error('语言无效');
  return v;
}
function integer(v, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error('数值无效');
  return v;
}
function createStore(rootDir) {
  mkdirSync(rootDir, {
    recursive: true
  });
  const db = new DatabaseSync(join(rootDir, 'learning.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY,deck TEXT NOT NULL,front TEXT NOT NULL,back TEXT NOT NULL,dueAt INTEGER NOT NULL,reviews INTEGER NOT NULL,revision INTEGER NOT NULL,interval INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS vocabulary(cardId TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,language TEXT NOT NULL,term TEXT NOT NULL,reading TEXT NOT NULL,meaning TEXT NOT NULL,context TEXT NOT NULL,dictionaryId TEXT,UNIQUE(language,term,meaning));
 CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,title TEXT NOT NULL,language TEXT NOT NULL,text TEXT NOT NULL,position INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS dictionaries(id TEXT PRIMARY KEY,title TEXT,revision TEXT,sourceLanguage TEXT,targetLanguage TEXT,enabled INTEGER,priority INTEGER,count INTEGER,bytes INTEGER,attribution TEXT,demo INTEGER);
 CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,dictionaryId TEXT REFERENCES dictionaries(id) ON DELETE CASCADE,term TEXT,fold TEXT,reading TEXT,meaning TEXT);
 CREATE INDEX IF NOT EXISTS entry_term ON entries(term); CREATE INDEX IF NOT EXISTS entry_fold ON entries(fold);`);
  const run = (sql, ...v) => db.prepare(sql).run(...v),
    all = (sql, ...v) => db.prepare(sql).all(...v),
    get = (sql, ...v) => db.prepare(sql).get(...v);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    let committing = false;
    try {
      const result = fn();
      committing = true;
      db.exec('COMMIT');
      return result;
    } catch (error) {
      // A failed commit/rollback may have an uncertain durable outcome.
      if (committing) error.effectState = 'unknown';
      try { db.exec('ROLLBACK'); }
      catch { error.effectState = 'unknown'; }
      throw error;
    }
  }
  if (!get("SELECT value FROM meta WHERE key='legacy-migrated'")) transaction(() => {
    let cards = [];
    const path = join(rootDir, 'cards-v1.json');
    if (existsSync(path)) {
      let state;
      try {
        state = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        throw new Error('卡片数据无法读取，未覆盖原文件');
      }
      const valid = c => c && typeof c.id === 'string' && /^[0-9a-f-]{36}$/.test(c.id) && typeof c.deck === 'string' && c.deck.trim() && c.deck.length <= 200 && typeof c.front === 'string' && c.front.trim() && c.front.length <= 4000 && typeof c.back === 'string' && c.back.trim() && c.back.length <= 4000 && Number.isSafeInteger(c.reviews) && c.reviews >= 0 && c.reviews < Number.MAX_SAFE_INTEGER && Number.isSafeInteger(c.revision) && c.revision >= 1 && c.revision < Number.MAX_SAFE_INTEGER && Number.isSafeInteger(c.dueAt) && c.dueAt >= 0 && Number.isSafeInteger(c.interval) && c.interval >= 0 && c.interval <= 365 * DAY;
      if (!state || state.version !== 1 || !Array.isArray(state.cards) || state.cards.length > 1000 || !state.cards.every(valid) || new Set(state.cards.map(c => c.id)).size !== state.cards.length) throw new Error('卡片数据格式无效，未覆盖原文件');
      cards = state.cards;
    }
    for (const c of cards) insertCard(c);
    run("INSERT INTO meta VALUES('legacy-migrated','1')");
  });
  function insertCard(c) {
    run('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?)', c.id, c.deck, c.front, c.back, c.dueAt, c.reviews, c.revision, c.interval);
  }
  function create(a, now) {
    text(a.deck, 200);
    text(a.front, 4000);
    text(a.back, 4000);
    if (get('SELECT COUNT(*) n FROM cards').n >= 1000) throw new Error('卡片数量已达上限');
    const c = {
      id: randomUUID(),
      deck: a.deck.trim(),
      front: a.front,
      back: a.back,
      dueAt: now,
      reviews: 0,
      revision: 1,
      interval: 0
    };
    insertCard(c);
    return {
      cardId: c.id,
      revision: 1
    };
  }
  function current(a) {
    text(a.cardId, 100);
    integer(a.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1);
    const c = get('SELECT * FROM cards WHERE id=?', a.cardId);
    if (!c || c.revision !== a.expectedRevision) throw new Error('卡片不存在或版本已变化');
    return c;
  }
  const dictionaries = require('./dictionaries.cjs').createDictionaries({
    db,
    rootDir,
    transaction,
    language,
    text
  });
  return {
    dispose() {
      dictionaries.dispose();
      db.close();
    },
    cancelImport: a => dictionaries.cancel(a),
    async call(action, a, now) {
      integer(now, 0, Number.MAX_SAFE_INTEGER - 365 * DAY);
      if (dictionaries.actions.includes(action)) return dictionaries.call(action, a);
      switch (action) {
        case 'create':
          return transaction(() => create(a, now));
        case 'list':
        case 'new':
        case 'due':
          {
            integer(a.limit, 1, 40);
            integer(a.offset ?? 0, 0, 1000);
            if (a.deck !== undefined) text(a.deck, 200);
            const cards = all('SELECT * FROM cards ORDER BY dueAt,id').filter(c => (a.deck === undefined || c.deck === a.deck) && (action === 'list' || (action === 'new' ? c.reviews === 0 : c.reviews > 0 && c.dueAt <= now)));
            return {
              total: cards.length,
              cards: cards.slice(a.offset || 0, (a.offset || 0) + a.limit).map(c => ({
                cardId: c.id,
                deck: c.deck,
                front: c.front,
                back: c.back,
                dueAt: c.dueAt,
                revision: c.revision
              }))
            };
          }
        case 'review':
          return transaction(() => {
            const c = current(a);
            integer(a.rating, 1, 4);
            const intervals = [600000, DAY, Math.max(3 * DAY, c.interval * 2), Math.max(7 * DAY, c.interval * 2.5)];
            const interval = Math.min(365 * DAY, Math.round(intervals[a.rating - 1]));
            if (c.reviews >= Number.MAX_SAFE_INTEGER - 1) throw new Error('复习次数已达上限');
            run('UPDATE cards SET interval=?,dueAt=?,reviews=reviews+1,revision=revision+1 WHERE id=?', interval, now + interval, c.id);
            return {
              cardId: c.id,
              dueAt: now + interval,
              revision: c.revision + 1
            };
          });
        case 'update':
          return transaction(() => {
            const c = current(a);
            text(a.front, 4000);
            text(a.back, 4000);
            run('UPDATE cards SET front=?,back=?,revision=revision+1 WHERE id=?', a.front, a.back, c.id);
            run('UPDATE vocabulary SET term=?,meaning=? WHERE cardId=?', a.front.normalize('NFC'), a.back, c.id);
            return {
              cardId: c.id,
              revision: c.revision + 1
            };
          });
        case 'delete':
        case 'vocabularyDelete':
          return transaction(() => {
            const c = current(a);
            run('DELETE FROM cards WHERE id=?', c.id);
            return {
              cardId: c.id
            };
          });
        case 'collect':
          return transaction(() => {
            language(a.language);
            text(a.term, 200);
            text(a.meaning, 4000);
            text(a.operationId, 100);
            text(a.context ?? '', 4000, true);
            text(a.reading ?? '', 200, true);
            if (a.dictionaryId !== undefined) text(a.dictionaryId, 100);
            const prior = get('SELECT result FROM operations WHERE id=?', a.operationId);
            if (prior) return {
              ...JSON.parse(prior.result),
              duplicate: true
            };
            const term = a.term.normalize('NFC');
            const old = get('SELECT v.cardId,c.revision FROM vocabulary v JOIN cards c ON c.id=v.cardId WHERE language=? AND term=? AND meaning=?', a.language, term, a.meaning);
            let result;
            if (old) result = {
              cardId: old.cardId,
              revision: old.revision,
              duplicate: true
            };else {
              result = {
                ...create({
                  deck: a.language,
                  front: term,
                  back: a.meaning
                }, now),
                duplicate: false
              };
              run('INSERT INTO vocabulary VALUES(?,?,?,?,?,?,?)', result.cardId, a.language, term, a.reading || '', a.meaning, a.context || '', a.dictionaryId || null);
            }
            run('INSERT INTO operations VALUES(?,?)', a.operationId, JSON.stringify(result));
            return result;
          });
        case 'vocabulary':
          {
            if (a.language !== undefined) language(a.language);
            if (a.dictionaryId !== undefined) text(a.dictionaryId, 100);
            if (a.deck !== undefined) text(a.deck, 200);
            if (a.status !== undefined && !['new', 'due', 'learning'].includes(a.status)) throw new Error('生词状态无效');
            text(a.query ?? '', 200, true);
            integer(a.limit ?? 40, 1, 40);
            integer(a.offset ?? 0, 0, 1000);
            const items = all('SELECT v.*,c.revision,c.deck,c.dueAt,c.reviews,d.title dictionaryTitle FROM vocabulary v JOIN cards c ON c.id=v.cardId LEFT JOIN dictionaries d ON d.id=v.dictionaryId ORDER BY c.dueAt,v.cardId').filter(v => (!a.language || v.language === a.language) && (!a.dictionaryId || v.dictionaryId === a.dictionaryId) && (!a.deck || v.deck === a.deck) && (!a.status || (a.status === 'new' ? v.reviews === 0 : a.status === 'due' ? v.reviews > 0 && v.dueAt <= now : v.reviews > 0 && v.dueAt > now)) && (!a.query || [v.term, v.meaning, v.context].some(x => x.includes(a.query))));
            return {
              total: items.length,
              items: items.slice(a.offset || 0, (a.offset || 0) + (a.limit ?? 40))
            };
          }
        case 'vocabularyUpdate':
          return transaction(() => {
            const c = current(a);
            text(a.meaning, 4000);
            text(a.context, 4000, true);
            if (!get('SELECT cardId FROM vocabulary WHERE cardId=?', c.id)) throw new Error('生词不存在');
            run('UPDATE vocabulary SET meaning=?,context=? WHERE cardId=?', a.meaning, a.context, c.id);
            run('UPDATE cards SET back=?,revision=revision+1 WHERE id=?', a.meaning, c.id);
            return {
              cardId: c.id,
              revision: c.revision + 1
            };
          });
        case 'dashboard':
          return {
            cards: get('SELECT COUNT(*) n FROM cards').n,
            newCards: get('SELECT COUNT(*) n FROM cards WHERE reviews=0').n,
            dueCards: get('SELECT COUNT(*) n FROM cards WHERE reviews>0 AND dueAt<=?', now).n,
            words: get('SELECT COUNT(*) n FROM vocabulary').n,
            dictionaries: get('SELECT COUNT(*) n FROM dictionaries').n
          };
        case 'articleSave':
          {
            text(a.title, 200);
            language(a.language);
            text(a.text, 1048576, true);
            if (Buffer.byteLength(a.text, 'utf8') > 1048576) throw new Error('文章文本超过 1 MiB');
            integer(a.position ?? 0, 0, a.text.length);
            const id = a.id === undefined ? randomUUID() : text(a.id, 100);
            run('INSERT INTO articles VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,language=excluded.language,text=excluded.text,position=excluded.position', id, a.title, a.language, a.text, a.position || 0);
            return {
              id
            };
          }
        case 'articleList':
          return {
            articles: all('SELECT id,title,language,position FROM articles ORDER BY rowid DESC')
          };
        case 'articleGet':
          {
            text(a.id, 100);
            const article = get('SELECT * FROM articles WHERE id=?', a.id);
            if (!article) throw new Error('文章不存在');
            return article;
          }
        case 'exportData':
          return {
            version: 2,
            cards: all('SELECT * FROM cards'),
            vocabulary: all('SELECT * FROM vocabulary'),
            articles: all('SELECT * FROM articles'),
            dictionaries: all('SELECT * FROM dictionaries'),
            operations: all('SELECT * FROM operations')
          };
        default:
          throw new Error('不支持的学习操作');
      }
    }
  };
}
module.exports = {
  createStore
};
