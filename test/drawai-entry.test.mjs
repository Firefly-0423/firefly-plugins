import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

test('Firefly receives the concrete operation schema instead of an opaque object', async () => {
    const { createPlugin } = createRequire(import.meta.url)('../plugins/drawai/index.cjs');
    const tools = new Map(), root = await mkdtemp(path.join(os.tmpdir(), 'drawai-schema-'));
    const plugin = createPlugin();
    await plugin.register({ id: 'drawai', signal: new AbortController().signal, storage: { rootDir: () => root, get() {}, set() {} }, registerTool: t => tools.set(t.id, t), unregisterTool: id => tools.delete(id), onDispose() {}, log() {} });
    try {
        const apply = tools.get('drawai_apply'), item = apply.inputSchema.properties.ops.items;
        assert.ok(item.properties, 'operation fields are missing from the Firefly contract');
        assert.equal(item.properties.op.enum.includes('addNode'), true, 'operation names must be discoverable in the host schema');
        assert.deepEqual(item.required, ['op']);
        for (const name of ['label', 'id', 'from', 'to', 'x', 'y', 'w', 'h', 'shape', 'layer']) assert.ok(item.properties[name], name);
        const Ajv = createRequire(import.meta.url)('ajv'), validate = new Ajv({ strict: false }).compile(apply.inputSchema);
        assert.equal(validate({path:'flow.drawio',create:true,ops:[{op:'addNode',id:'a',label:'开始',shape:'rounded',x:10,y:20}]}),true);
        assert.equal(validate({path:'flow.drawio',ops:[{op:'traceImage'}]}),false);
        assert.equal(validate({path:'flow.drawio',ops:[{label:'missing op'}]}),false);
        assert.equal(apply.needsContext,true);
        assert.deepEqual(apply.modes,['work','code']);
    } finally { await plugin.unregister(); }
});

test('plugin registers two context-scoped tools and cleans up for re-enable', async () => {
    assert.ok(existsSync(new URL('../plugins/drawai/index.cjs', import.meta.url)), 'entry missing');
    const { createPlugin } = createRequire(import.meta.url)('../plugins/drawai/index.cjs'), tools = new Map(), dispose = [];
    const root = await mkdtemp(path.join(os.tmpdir(), 'drawai-entry-'));
    const p = createPlugin();
    const ctx = { id: 'drawai', signal: new AbortController().signal, storage: { rootDir: () => root, get: () => undefined, set() { } }, registerTool: t => tools.set(t.id, t), unregisterTool: id => tools.delete(id), onDispose: f => dispose.push(f), log() { } };
    await p.register(ctx);
    assert.deepEqual([...tools.keys()], ['drawai_read', 'drawai_apply']);
    assert.equal(tools.get('drawai_apply').risk, 'fs-write');
    const result = JSON.parse(await tools.get('drawai_read').execute({ path: 'x.drawio' }, {}));
    assert.equal(result.ok, false);
    assert.equal(result.success, false, 'host executor must classify the response as failed');
    assert.equal(result.errorCode, 'E_WORKSPACE');
    assert.equal(result.error.code, 'E_WORKSPACE');
    await p.unregister();
    assert.equal(tools.size, 0);
    await p.register(ctx);
    assert.equal(tools.size, 2);
    await p.unregister();
});
