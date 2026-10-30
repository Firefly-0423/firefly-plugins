'use strict';
const { createDocumentService } = require('./runtime/documents.cjs');
const { error } = require('./runtime/paths.cjs');
const { operationSchema, applyDescription } = require('./runtime/tool-contract.cjs');
function createPlugin({ createWindow } = {}) {
    let ctx, service, windowHost;
    async function cleanup() { if (!service)
        return; const old = service; service = null; await windowHost?.dispose(); windowHost = null; await old.stop(); if (ctx) {
        ctx.unregisterTool('drawai_read');
        ctx.unregisterTool('drawai_apply');
    } ctx = null; }
    return {
        async register(context) {
            if (service)
                throw error('E_ACTIVE', '插件已经启用');
            ctx = context;
            service = createDocumentService({ storageRoot: ctx.storage.rootDir(), signal: ctx.signal });
            for (const [kind, read] of [['read', true], ['apply', false]]) {
                const properties = { path: { type: 'string', description: '绑定工作区内相对 .drawio 路径' }, page: { type: 'integer', description: '从 0 开始的页索引' } };
                if (read) {
                    properties.limit = { type: 'integer' };
                    properties.cursor = { type: 'string' };
                }
                else {
                    properties.expectRevision = { type: 'string', description: 'drawai_read 返回的完整 revision，已有文件必填' };
                    properties.create = { type: 'boolean', description: '仅新建不存在的文件时为 true' };
                    properties.ops = { type: 'array', items: operationSchema(), description: '每批最多 100 个结构化操作；仅重新布局时可为空数组并指定 layout' };
                    properties.layout = { type: 'string', enum: ['none', 'grid', 'dagre-tb', 'dagre-lr'] };
                }
                ctx.registerTool({ id: 'drawai_' + kind, name: read ? '读取 DrawAI 图' : '修改 DrawAI 图', description: read ? '读取 Firefly 当前绑定工作区 .drawio 的节点、连线、图层、页和 revision。分页返回；dirty=true 时先让用户保存画布。' : applyDescription, catalogHint: read ? '读取当前工作区的可编辑流程图与 revision，供后续安全改图。' : '在当前工作区创建、修改和布局 .drawio 流程图，与 Firefly 打开的 DrawAI 画布共用文件。', enabled: true, needsContext: true, modes: ['work', 'code'], risk: read ? 'fs-read' : 'fs-write', effectKind: read ? 'read' : 'mutation', verificationPolicy: read ? 'none' : 'artifact', inputSchema: { type: 'object', properties, required: read ? ['path'] : ['path', 'ops'] },
                    async execute(args, toolContext) { try {
                        if (!service)
                            throw error('E_STOPPED', '插件已停止');
                        if (!args || typeof args !== 'object' || Object.keys(args).some(k => !Object.hasOwn(properties, k)))
                            throw error('E_ARGUMENT', '工具参数无效');
                        return JSON.stringify({ ok: true, data: await service[read ? 'agentRead' : 'agentApply'](toolContext || {}, args) });
                    }
                    catch (e) {
                        const code = e.code || 'E_DIAGRAM';
                        // Firefly's executor recognizes success:false; ok:false alone
                        // would be recorded as a successful tool call by older hosts.
                        return JSON.stringify({ ok: false, success: false, errorCode: code, category: 'semantic_failure', retryable: false, effectState: read ? 'not_applied' : 'unknown', error: { code, message: String(e.message).slice(0, 500) } });
                    } }
                });
            }
            ctx.onDispose(cleanup);
            ctx.log('DrawAI 原生画布已注册');
        },
        async open() { if (!service)
            throw error('E_STOPPED', '请先启用 DrawAI'); if (!windowHost) {
            const factory = createWindow || require('./runtime/window.cjs').createCanvasWindow;
            windowHost = factory({ service, storage: ctx.storage, signal: ctx.signal });
        } await windowHost.open(); },
        unregister: cleanup,
    };
}
module.exports = createPlugin();
module.exports.createPlugin = createPlugin;
