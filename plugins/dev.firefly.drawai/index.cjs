"use strict";

const { createDocumentService } = require("./runtime/documents.cjs");
const { createCanvasActions } = require("./runtime/canvas-actions.cjs");
const { error } = require("./runtime/paths.cjs");
const { operationSchema, applyDescription } = require("./runtime/tool-contract.cjs");

const PRE_WRITE_ERROR_CODES = new Set([
  "E_ARGUMENT",
  "E_CANCELLED",
  "E_CONFLICT",
  "E_HANDLE",
  "E_LIMIT",
  "E_NOT_FOUND",
  "E_PATH",
  "E_READONLY",
  "E_STOPPED",
  "E_WORKSPACE",
  "E_XML",
]);

function createPlugin() {
  let activeCtx = null;
  let service = null;
  let disposables = [];

  async function cleanup() {
    while (disposables.length > 0) {
      disposables.pop().dispose();
    }
    if (service) {
      const old = service;
      service = null;
      await old.stop();
    }
    activeCtx = null;
  }

  return {
    async activate(ctx) {
      if (service) throw error("E_ACTIVE", "插件已经启用");
      activeCtx = ctx;
      service = createDocumentService({ storageRoot: ctx.dataDir, signal: ctx.signal });
      const canvasActions = createCanvasActions({ service, dataDir: ctx.dataDir });

      for (const [kind, isRead] of [["read", true], ["apply", false]]) {
        const properties = {
          path: { type: "string", description: "绑定工作区内相对 .drawio 路径" },
          page: { type: "integer", description: "从 0 开始的页索引" },
        };
        if (isRead) {
          properties.limit = { type: "integer" };
          properties.cursor = { type: "string" };
        } else {
          properties.expectRevision = { type: "string", description: "read 返回的完整 revision，已有文件必填" };
          properties.create = { type: "boolean", description: "仅新建不存在的文件时为 true" };
          properties.ops = {
            type: "array",
            items: operationSchema(),
            description: "每批最多 100 个结构化操作；仅重新布局时可为空数组并指定 layout",
          };
          properties.layout = { type: "string", enum: ["none", "grid", "dagre-tb", "dagre-lr"] };
        }

        const disp = ctx.tools.register({
          name: kind,
          description: isRead
            ? "读取 Firefly 当前绑定工作区 .drawio 的节点、连线、图层、页和 revision。分页返回；dirty=true 时先让用户保存画布。"
            : applyDescription,
          parameters: {
            type: "object",
            properties,
            required: isRead ? ["path"] : ["path", "ops"],
            additionalProperties: false,
          },
          describeApproval(args) {
            const target = typeof args?.path === "string" ? args.path : undefined;
            return {
              summary: isRead ? "读取工作区 .drawio 流程图" : "创建或修改工作区 .drawio 流程图",
              target,
            };
          },
          async execute(args, call) {
            if (call?.signal?.aborted) {
              return { status: "not_executed", reason: "操作已取消" };
            }
            if (!service || !activeCtx) {
              return { status: "not_executed", reason: "E_STOPPED: 插件已停止" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !Object.hasOwn(properties, k))) {
              return { status: "not_executed", reason: "E_ARGUMENT: 工具参数无效" };
            }
            if (!activeCtx.has("workspace.read")) {
              return { status: "not_executed", reason: "ERR_PERMISSION: 缺少 workspace.read 权限，无法访问当前工作区" };
            }

            let workspace;
            try {
              workspace = await activeCtx.workspace.current(call?.sessionId);
            } catch (err) {
              return { status: "failed", error: String(err?.message ?? err).slice(0, 500), retryable: false };
            }
            if (!workspace || !workspace.root) {
              return { status: "not_executed", reason: "E_WORKSPACE: 当前会话未绑定工作区" };
            }

            try {
              const toolContext = { resolvedWorkspaceRoot: workspace.root, signal: call?.signal };
              const data = await service[isRead ? "agentRead" : "agentApply"](toolContext, args);
              return { status: "succeeded", output: data };
            } catch (e) {
              const code = e?.code || "E_DIAGRAM";
              const msg = `${code}: ${String(e?.message ?? e).slice(0, 460)}`;
              if (isRead) {
                return code === "E_CANCELLED"
                  ? { status: "not_executed", reason: msg }
                  : { status: "failed", error: msg, retryable: false };
              }
              if (PRE_WRITE_ERROR_CODES.has(code)) {
                return { status: "not_executed", reason: msg };
              }
              return {
                status: "unknown",
                reason: msg,
                possibleEffects: "目标 .drawio 文件可能已修改或未修改，请重新读取确认",
              };
            }
          },
        });
        disposables.push(disp);
      }

      if (ctx.has("ui.windows")) {
        const uiDisp = ctx.ui.onMessage(async (event) => {
          return await canvasActions.dispatch(event.method, event.params);
        });
        disposables.push(uiDisp);
      }
    },
    deactivate: cleanup,
  };
}

module.exports = createPlugin();
module.exports.createPlugin = createPlugin;
