'use strict';

const {
  createService
} = require('./runtime/service.cjs');
const text = {
    type: 'string'
  },
  revision = {
    type: 'integer',
    minimum: 1
  };
const language = {
  type: 'string',
  enum: ['en', 'ja', 'ko', 'fr', 'de', 'es']
};
const page = {
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: 40
  },
  deck: text
};
const SPECS = [['create', '创建学习卡片', '在指定牌组创建本地问答卡，卡片内容由用户确认。', true, {
  deck: text,
  front: text,
  back: text
}, ['deck', 'front', 'back']], ['new', '读取新学习卡', '读取尚未复习的卡片。提问时不要提前显示答案。', false, page, ['limit']], ['due', '读取待复习卡', '读取已到复习时间的卡片。提问时不要提前显示答案。', false, page, ['limit']], ['review', '记录复习评分', '仅按用户明确选择记录评分：1 重来、2 困难、3 良好、4 简单。使用读取时的 revision。', true, {
  cardId: text,
  rating: {
    type: 'integer',
    minimum: 1,
    maximum: 4
  },
  expectedRevision: revision
}, ['cardId', 'rating', 'expectedRevision']], ['update', '编辑学习卡片', '修改卡片正面和背面，使用当前 revision；执行前确认内容。', true, {
  cardId: text,
  expectedRevision: revision,
  front: text,
  back: text
}, ['cardId', 'expectedRevision', 'front', 'back']], ['delete', '删除学习卡片', '删除卡片及关联生词和复习状态；必须先向用户确认，使用当前 revision。', true, {
  cardId: text,
  expectedRevision: revision
}, ['cardId', 'expectedRevision']], ['list', '浏览学习卡片', '按牌组和 offset 分页浏览卡片和当前 revision。', false, {
  ...page,
  offset: {
    type: 'integer',
    minimum: 0,
    maximum: 1000
  }
}, ['limit']], ['lookup', '查询本地词典', '在已启用的本地词典中精确查词。支持 en/ja/ko/fr/de/es；未命中可调整选区或尝试原形。不会联网或生成释义。', false, {
  language,
  term: text,
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: 40
  }
}, ['language', 'term']], ['collect', '收藏学习生词', '按用户确认的释义和例句创建生词及学习卡。每次用户操作提供唯一 operationId；同词同义复用已有卡。', true, {
  language,
  term: text,
  reading: text,
  meaning: text,
  context: text,
  dictionaryId: text,
  operationId: text
}, ['language', 'term', 'meaning', 'operationId']]];
function createPlugin(options = {}) {
  let active, windowHost, closing;
  async function cleanup() {
    if (closing) return closing;
    const previous = active;
    if (!previous) return;
    active = null;
    for (const [action] of SPECS) previous.ctx.unregisterTool('study-cards_' + action);
    const previousWindow = windowHost;
    windowHost = null;
    closing = (async () => {
      try {
        await previousWindow?.dispose();
      } finally {
        await previous.service.dispose();
      }
    })().finally(() => {
      closing = null;
    });
    return closing;
  }
  return {
    async register(ctx) {
      if (active || closing) throw new Error('插件已启用或正在关闭');
      if (typeof ctx.storage?.rootDir !== 'function') throw new Error('当前 Firefly 未提供插件私有存储目录');
      const service = (options.createService || createService)({
        rootDir: ctx.storage.rootDir(),
        now: options.now || Date.now
      });
      const instance = {
        ctx,
        service
      };
      active = instance;
      try {
        for (const [action, name, description, write, properties, required] of SPECS) ctx.registerTool({
          id: 'study-cards_' + action,
          name,
          description,
          enabled: true,
          risk: write ? 'fs-write' : 'fs-read',
          effectKind: write ? 'mutation' : 'read',
          verificationPolicy: 'none',
          ledgerPolicy: 'bypass',
          inputSchema: {
            type: 'object',
            properties,
            required,
            additionalProperties: false
          },
          async execute(args) {
            try {
              if (active !== instance || ctx.signal.aborted) throw new Error('插件已停用');
              if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(properties, k)) || required.some(k => !Object.hasOwn(args, k))) throw new Error('工具参数无效');
              return JSON.stringify({
                ok: true,
                data: await service.call(action, args)
              });
            } catch (e) {
              return JSON.stringify({
                ok: false,
                success: false,
                category: 'semantic_failure',
                retryable: false,
                effectState: e.effectState === 'unknown' ? 'unknown' : 'not_applied',
                error: String(e.message).slice(0, 250)
              });
            }
          }
        });
        ctx.onDispose(cleanup);
      } catch (e) {
        await cleanup();
        throw e;
      }
    },
    async open() {
      if (!active || active.ctx.signal.aborted) throw new Error('请先启用语言学习插件');
      if (!windowHost) windowHost = (options.createWindow || require('./runtime/window.cjs').createLearningWindow)({
        service: active.service,
        storage: active.ctx.storage,
        signal: active.ctx.signal
      });
      return windowHost.open();
    },
    unregister: cleanup
  };
}
module.exports = createPlugin();
module.exports.createPlugin = createPlugin;
