"use strict";

const { createService } = require("./runtime/service.cjs");
const { createLearningActions } = require("./runtime/learning-actions.cjs");

const textProp = { type: "string" };
const revisionProp = { type: "integer", minimum: 1 };
const languageProp = { type: "string", enum: ["en", "ja", "ko", "fr", "de", "es"] };
const pageProps = {
  limit: { type: "integer", minimum: 1, maximum: 40 },
  deck: textProp,
};

const SPECS = [
  {
    name: "create",
    description: "在指定牌组创建本地问答卡，卡片内容由用户确认。",
    props: { deck: textProp, front: textProp, back: textProp },
    required: ["deck", "front", "back"],
    describeApproval: (args) => ({ summary: "创建本地学习卡片", target: typeof args?.deck === "string" ? args.deck : undefined }),
  },
  {
    name: "new",
    description: "读取尚未复习的卡片。提问时不要提前显示答案。",
    props: pageProps,
    required: ["limit"],
    describeApproval: (args) => ({ summary: "读取新学习卡片", target: typeof args?.deck === "string" ? args.deck : undefined }),
  },
  {
    name: "due",
    description: "读取已到复习时间的卡片。提问时不要提前显示答案。",
    props: pageProps,
    required: ["limit"],
    describeApproval: (args) => ({ summary: "读取待复习卡片", target: typeof args?.deck === "string" ? args.deck : undefined }),
  },
  {
    name: "review",
    description: "仅按用户明确选择记录评分：1 重来、2 困难、3 良好、4 简单。提供读取时的 revision 防止重复或过期写入。",
    props: {
      cardId: textProp,
      rating: { type: "integer", minimum: 1, maximum: 4 },
      expectedRevision: revisionProp,
    },
    required: ["cardId", "rating", "expectedRevision"],
    describeApproval: (args) => ({ summary: "记录学习卡片复习评分", target: typeof args?.cardId === "string" ? args.cardId : undefined }),
  },
  {
    name: "update",
    description: "修改指定卡片的正面和背面，使用当前 revision；执行前确认修改内容。",
    props: {
      cardId: textProp,
      expectedRevision: revisionProp,
      front: textProp,
      back: textProp,
    },
    required: ["cardId", "expectedRevision", "front", "back"],
    describeApproval: (args) => ({ summary: "编辑学习卡片", target: typeof args?.cardId === "string" ? args.cardId : undefined }),
  },
  {
    name: "delete",
    description: "删除指定卡片及其关联生词和复习状态；必须先向用户确认，使用当前 revision。",
    props: { cardId: textProp, expectedRevision: revisionProp },
    required: ["cardId", "expectedRevision"],
    describeApproval: (args) => ({ summary: "删除学习卡片", target: typeof args?.cardId === "string" ? args.cardId : undefined }),
  },
  {
    name: "list",
    description: "按牌组和 offset 分页浏览所有卡片和当前 revision。",
    props: {
      ...pageProps,
      offset: { type: "integer", minimum: 0, maximum: 1000 },
    },
    required: ["limit"],
    describeApproval: (args) => ({ summary: "浏览学习卡片", target: typeof args?.deck === "string" ? args.deck : undefined }),
  },
  {
    name: "lookup",
    description: "在已启用的本地词典中精确查词。支持 en/ja/ko/fr/de/es；未命中可调整选区或尝试原形。不会联网或生成释义。",
    props: {
      language: languageProp,
      term: textProp,
      limit: { type: "integer", minimum: 1, maximum: 40 },
    },
    required: ["language", "term"],
    describeApproval: (args) => ({ summary: "查询本地词典", target: typeof args?.term === "string" ? args.term : undefined }),
  },
  {
    name: "collect",
    description: "按用户确认的释义和例句创建生词及学习卡。每次用户操作提供唯一 operationId；同词同义复用已有卡。",
    props: {
      language: languageProp,
      term: textProp,
      reading: textProp,
      meaning: textProp,
      context: textProp,
      dictionaryId: textProp,
      operationId: textProp,
    },
    required: ["language", "term", "meaning", "operationId"],
    describeApproval: (args) => ({ summary: "收藏学习生词", target: typeof args?.term === "string" ? args.term : undefined }),
  },
];

function createPlugin(options = {}) {
  let active = null;
  let closing = null;

  async function cleanup() {
    if (closing) return closing;
    const previous = active;
    if (!previous) return;
    active = null;
    while (previous.disposables.length > 0) {
      previous.disposables.pop().dispose();
    }
    closing = Promise.resolve(previous.service.dispose()).finally(() => {
      closing = null;
    });
    return closing;
  }

  return {
    async activate(ctx) {
      if (active || closing) throw new Error("插件已启用或正在关闭");
      if (!ctx || typeof ctx.dataDir !== "string" || !ctx.dataDir) {
        throw new Error("插件数据目录不可用");
      }
      const service = (options.createService || createService)({
        rootDir: ctx.dataDir,
        now: options.now || Date.now,
      });
      const learningActions = createLearningActions({ service, dataDir: ctx.dataDir });
      const instance = { ctx, service, disposables: [] };
      active = instance;

      try {
        for (const tool of SPECS) {
          const disp = ctx.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: {
              type: "object",
              properties: tool.props,
              required: tool.required,
              additionalProperties: false,
            },
            describeApproval: tool.describeApproval,
            async execute(args, call) {
              if (call && call.signal && call.signal.aborted) {
                return { status: "not_executed", reason: "操作已取消" };
              }
              if (active !== instance || ctx.signal.aborted) {
                return { status: "not_executed", reason: "插件已停用" };
              }
              if (
                !args
                || typeof args !== "object"
                || Array.isArray(args)
                || Object.keys(args).some((k) => !Object.hasOwn(tool.props, k))
                || tool.required.some((k) => !Object.hasOwn(args, k))
              ) {
                return { status: "not_executed", reason: "工具参数无效" };
              }
              try {
                const data = await service.call(tool.name, args);
                return { status: "succeeded", output: data };
              } catch (error) {
                if (error && error.effectState === "unknown") {
                  return {
                    status: "unknown",
                    reason: String(error.message).slice(0, 250),
                    possibleEffects: "learning.sqlite 可能已部分写入或未更新",
                  };
                }
                if (error && error.code === "E_VALIDATION") {
                  return { status: "not_executed", reason: String(error.message).slice(0, 250) };
                }
                return { status: "failed", error: String(error.message).slice(0, 250), retryable: false };
              }
            },
          });
          instance.disposables.push(disp);
        }

        if (ctx.has("ui.windows")) {
          const uiDisp = ctx.ui.onMessage(async (event) => {
            return await learningActions.dispatch(event.method, event.params);
          });
          instance.disposables.push(uiDisp);
        }
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
    deactivate: cleanup,
  };
}

module.exports = createPlugin();
module.exports.createPlugin = createPlugin;
