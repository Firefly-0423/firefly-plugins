'use strict';

const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const KEY = 'cards-v1';
const DAY = 86400000;
const LIMIT = 1000;
const validText = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

function createPlugin(options = {}) {
  const now = options.now || Date.now;
  let context;
  const ids = ['study-cards_create', 'study-cards_new', 'study-cards_due', 'study-cards_review', 'study-cards_update', 'study-cards_delete', 'study-cards_list'];
  function read() {
    const state = context.storage.get(KEY);
    if (state === undefined) {
      if (typeof context.storage.rootDir === 'function' && existsSync(join(context.storage.rootDir(), KEY + '.json'))) throw new Error('卡片数据无法读取，未覆盖原文件');
      return { version: 1, cards: [] };
    }
    if (!state || state.version !== 1 || !Array.isArray(state.cards) || state.cards.length > LIMIT || state.cards.some(c => !c || typeof c.id !== 'string' || !validText(c.deck, 200) || !validText(c.front, 4000) || !validText(c.back, 4000) || !Number.isSafeInteger(c.reviews) || c.reviews < 0 || !Number.isSafeInteger(c.revision) || c.revision < 1 || !Number.isFinite(c.dueAt) || !Number.isFinite(c.interval))) throw new Error('卡片数据格式无效，未覆盖原文件');
    return state;
  }
  function list(args, fresh) {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 40) throw new Error('limit 必须为 1–40');
    if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0 || args.offset > LIMIT)) throw new Error('offset 无效');
    if (args.deck !== undefined && !validText(args.deck, 200)) throw new Error('牌组名称无效');
    const cards = read().cards.filter(c => (args.deck === undefined || c.deck === args.deck) && (fresh === null || (fresh ? c.reviews === 0 : c.reviews > 0 && c.dueAt <= now())));
    cards.sort((a, b) => a.dueAt - b.dueAt);
    const offset = args.offset || 0;
    return { total: cards.length, cards: cards.slice(offset, offset + args.limit).map(c => ({ cardId: c.id, deck: c.deck, front: c.front, back: c.back, dueAt: c.dueAt, revision: c.revision })) };
  }
  const spec = [
    { id: ids[0], name: '创建学习卡片', description: '在指定牌组创建本地问答卡，卡片内容由用户确认。', write: true, props: { deck: { type: 'string' }, front: { type: 'string' }, back: { type: 'string' } }, required: ['deck','front','back'], run: args => {
      if (!validText(args.deck, 200) || !validText(args.front, 4000) || !validText(args.back, 4000)) throw new Error('牌组、正面和背面必须是有效的非空文本');
      const state = read(); if (state.cards.length >= LIMIT) throw new Error('卡片数量已达上限');
      const card = { id: randomUUID(), deck: args.deck.trim(), front: args.front, back: args.back, dueAt: now(), reviews: 0, revision: 1, interval: 0 };
      state.cards.push(card); context.storage.set(KEY, state); return { cardId: card.id, revision: 1 };
    } },
    { id: ids[1], name: '读取新学习卡', description: '读取尚未复习的卡片。提问时不要提前显示答案。', write: false, props: { limit: { type: 'integer', minimum: 1, maximum: 40 }, deck: { type: 'string' } }, required: ['limit'], run: args => list(args, true) },
    { id: ids[2], name: '读取待复习卡', description: '读取已到复习时间的卡片。提问时不要提前显示答案。', write: false, props: { limit: { type: 'integer', minimum: 1, maximum: 40 }, deck: { type: 'string' } }, required: ['limit'], run: args => list(args, false) },
    { id: ids[3], name: '记录复习评分', description: '仅按用户明确选择记录评分：1 重来、2 困难、3 良好、4 简单。提供读取时的 revision 防止重复或过期写入。', write: true, props: { cardId: { type: 'string' }, rating: { type: 'integer', minimum: 1, maximum: 4 }, expectedRevision: { type: 'integer', minimum: 1 } }, required: ['cardId','rating','expectedRevision'], run: args => {
      if (!validText(args.cardId, 100) || !Number.isInteger(args.rating) || args.rating < 1 || args.rating > 4 || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error('卡片 ID、评分或版本无效');
      const state = read(); const card = state.cards.find(c => c.id === args.cardId);
      if (!card) throw new Error('卡片不存在');
      if (args.expectedRevision !== card.revision) throw new Error('卡片版本已变化，请重新读取');
      const intervals = [600000, DAY, Math.max(3 * DAY, card.interval * 2), Math.max(7 * DAY, card.interval * 2.5)];
      card.interval = Math.min(365 * DAY, Math.round(intervals[args.rating - 1]));
      card.dueAt = now() + card.interval; card.reviews++; card.revision++;
      context.storage.set(KEY, state); return { cardId: card.id, dueAt: card.dueAt, revision: card.revision };
    } },
    { id: ids[4], name: '编辑学习卡片', description: '修改指定卡片的正面和背面，使用当前 revision；执行前确认修改内容。', write: true, props: { cardId: { type: 'string' }, expectedRevision: { type: 'integer' }, front: { type: 'string' }, back: { type: 'string' } }, required: ['cardId','expectedRevision','front','back'], run: args => {
      if (!validText(args.cardId, 100) || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1 || !validText(args.front, 4000) || !validText(args.back, 4000)) throw new Error('卡片内容或版本无效');
      const state = read(); const card = state.cards.find(c => c.id === args.cardId);
      if (!card || card.revision !== args.expectedRevision) throw new Error('卡片不存在或版本已变化');
      card.front = args.front; card.back = args.back; card.revision++;
      context.storage.set(KEY, state); return { cardId: card.id, revision: card.revision };
    } },
    { id: ids[5], name: '删除学习卡片', description: '删除指定卡片及其复习状态；必须先向用户确认，使用当前 revision。', write: true, props: { cardId: { type: 'string' }, expectedRevision: { type: 'integer' } }, required: ['cardId','expectedRevision'], run: args => {
      if (!validText(args.cardId, 100) || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error('卡片 ID 或版本无效');
      const state = read(); const index = state.cards.findIndex(c => c.id === args.cardId);
      if (index < 0 || state.cards[index].revision !== args.expectedRevision) throw new Error('卡片不存在或版本已变化');
      state.cards.splice(index, 1); context.storage.set(KEY, state); return { cardId: args.cardId };
    } },
    { id: ids[6], name: '浏览学习卡片', description: '按牌组和 offset 分页浏览所有卡片和当前 revision。', write: false, props: { limit: { type: 'integer', minimum: 1, maximum: 40 }, deck: { type: 'string' }, offset: { type: 'integer', minimum: 0, maximum: LIMIT } }, required: ['limit'], run: args => list(args, null) },
  ];
  async function cleanup() { if (context) for (const id of ids) context.unregisterTool(id); context = undefined; }
  return {
    async register(ctx) {
      if (context) throw new Error('插件已启用'); context = ctx;
      for (const tool of spec) ctx.registerTool({ id: tool.id, name: tool.name, description: tool.description, enabled: true, risk: tool.write ? 'fs-write' : 'fs-read', effectKind: tool.write ? 'mutation' : 'read', verificationPolicy: 'none', ledgerPolicy: 'bypass', inputSchema: { type: 'object', properties: tool.props, required: tool.required }, async execute(args) {
        try { if (!context || context.signal.aborted) throw new Error('插件已停用'); if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(tool.props, k))) throw new Error('工具参数无效'); return JSON.stringify({ ok: true, data: tool.run(args) }); }
        catch (e) { return JSON.stringify({ ok: false, success: false, category: 'semantic_failure', retryable: false, effectState: tool.write ? 'unknown' : 'not_applied', error: String(e.message).slice(0, 250) }); }
      } });
      ctx.onDispose(cleanup);
    }, unregister: cleanup,
  };
}
module.exports = createPlugin();
module.exports.createPlugin = createPlugin;
