import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, link } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

test('saving uses private staging and preserves existing POSIX permission bits', async () => {
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const fs = createRequire(import.meta.url)('node:fs/promises');
    const root = await mkdtemp(path.join(os.tmpdir(), 'drawai-permissions-'));
    const service = createDocumentService({ storageRoot: path.join(root, 'private') });
    const originalOpen = fs.open; let stagedMode;
    try {
        await service.agentApply({ resolvedWorkspaceRoot: root }, { path: 'private.drawio', create: true, ops: [{ op: 'addNode', id: 'a', label: 'private' }] });
        const file = path.join(root, 'private.drawio');
        await fs.chmod(file, 0o600);
        const state = await service.openNative(file);
        fs.open = async (name, flags, mode) => { if (path.basename(name).startsWith('.drawai-')) stagedMode = mode; return originalOpen(name, flags, mode); };
        await service.save(state.handle);
        assert.equal(stagedMode, 0o600);
        if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    } finally { fs.open = originalOpen; await service.stop(); }
});

test('failed atomic replacement keeps original bytes and the accepted draft', async () => {
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const fs = createRequire(import.meta.url)('node:fs/promises');
    const root = await mkdtemp(path.join(os.tmpdir(), 'drawai-write-failure-'));
    const service = createDocumentService({ storageRoot: path.join(root, 'private') });
    const context = { resolvedWorkspaceRoot: root }, file = path.join(root, 'original.drawio'), originalRename = fs.rename;
    try {
        await service.agentApply(context, { path: 'original.drawio', create: true, ops: [{ op: 'addNode', id: 'a', label: 'original bytes' }] });
        let ui = await service.openNative(file);
        ui = await service.edit(ui.handle, { revision: ui.revision, ops: [{ op: 'setLabel', id: 'a', label: 'accepted draft' }] });
        const before = await readFile(file);
        fs.rename = async (source, target) => { if (path.basename(target).toLowerCase() === 'original.drawio') throw Object.assign(new Error('fixture disk replacement failure'), { code: 'EIO' }); return originalRename(source, target); };
        await assert.rejects(service.save(ui.handle), { code: 'EIO' });
        assert.deepEqual(await readFile(file), before);
        assert.equal((await service.state(ui.handle)).doc.nodes[0].label, 'accepted draft');
        assert.equal((await service.state(ui.handle)).dirty, true);
        assert.equal((await service.listRecovery()).length, 1);
    } finally { fs.rename = originalRename; await service.stop(); }
});

test('native no-op save preserves UTF-8 BOM bytes', async () => {
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const { runEngine } = createRequire(import.meta.url)('../plugins/drawai/runtime/worker-client.cjs');
    const root = await mkdtemp(path.join(os.tmpdir(), 'drawai-bom-'));
    const made = await runEngine({ action: 'new', text: null });
    const file = path.join(root, 'bom.drawio'), bytes = Buffer.from('\ufeff' + made.text);
    await writeFile(file, bytes);
    const service = createDocumentService({ storageRoot: path.join(root, 'private') });
    try { const ui = await service.openNative(file); await service.save(ui.handle); assert.deepEqual(await readFile(file), bytes); }
    finally { await service.stop(); }
});
test('save-as holds the source identity while AI edits the original path', async () => {
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const fs = createRequire(import.meta.url)('node:fs/promises'), root = await mkdtemp(path.join(os.tmpdir(), 'drawai-saveas-')), storage = await mkdtemp(path.join(os.tmpdir(), 'drawai-saveas-state-')), service = createDocumentService({ storageRoot: storage }), context = { resolvedWorkspaceRoot: root };
    let release, entered;
    const gate = new Promise(r => release = r), atLink = new Promise(r => entered = r), originalLink = fs.link;
    try {
        const created = await service.agentApply(context, { path: 'original.drawio', create: true, ops: [{ op: 'addNode', id: 'a', label: 'original' }] });
        const ui = await service.openNative(path.join(root, 'original.drawio'));
        fs.link = async (a, b) => { if (path.basename(b).toLowerCase() === 'copy.drawio') {
            entered();
            await gate;
        } return originalLink(a, b); };
        const save = service.save(ui.handle, path.join(root, 'copy.drawio'));
        await Promise.race([atLink, save.then(() => { throw new Error('Save completed without reaching the fixture link gate'); })]);
        let aiDone = false;
        const ai = service.agentApply(context, { path: 'original.drawio', expectRevision: created.revision, ops: [{ op: 'setLabel', id: 'a', label: 'changed original' }] }).then(r => { aiDone = true; return r; });
        await new Promise(r => setTimeout(r, 40));
        assert.equal(aiDone, false);
        release();
        await save;
        await ai;
        const state = await service.state(ui.handle);
        assert.equal(state.name, 'copy.drawio');
        assert.equal(state.doc.nodes[0].label, 'original');
        assert.equal(state.dirty, false);
        assert.match(await readFile(path.join(root, 'copy.drawio'), 'utf8'), /original/);
    }
    finally {
        release?.();
        fs.link = originalLink;
        await service.stop();
    }
});
test('new canvas recovery is bounded and cleared after explicit save, then stop rejects calls', async () => {
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const root = await mkdtemp(path.join(os.tmpdir(), 'drawai-recover-')), storage = await mkdtemp(path.join(os.tmpdir(), 'drawai-store-'));
    let service = createDocumentService({ storageRoot: storage });
    let ui = await service.newNative();
    ui = await service.edit(ui.handle, { revision: ui.revision, ops: [{ op: 'addNode', id: 'a', label: '待恢复' }] });
    await service.stop();
    await assert.rejects(service.state(ui.handle), { code: 'E_STOPPED' });
    service = createDocumentService({ storageRoot: storage });
    try {
        const drafts = await service.listRecovery();
        assert.equal(drafts.length, 1);
        ui = await service.recover(drafts[0].key);
        assert.equal(ui.doc.nodes[0].label, '待恢复');
        assert.equal(ui.dirty, true);
        ui = await service.save(ui.handle, path.join(root, 'restored.drawio'));
        assert.equal(ui.dirty, false);
        assert.equal((await service.listRecovery()).length, 0);
    }
    finally {
        await service.stop();
    }
});
test('pagination is tied to file revision and cancellation never creates target', async () => {
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const root = await mkdtemp(path.join(os.tmpdir(), 'drawai-pages-')), storage = await mkdtemp(path.join(os.tmpdir(), 'drawai-priv-')), service = createDocumentService({ storageRoot: storage }), context = { resolvedWorkspaceRoot: root };
    try {
        await service.agentApply(context, { path: 'many.drawio', create: true, ops: Array.from({ length: 60 }, (_, i) => ({ op: 'addNode', id: 'n' + i, label: String(i) })) });
        const read = await service.agentRead(context, { path: 'many.drawio' });
        assert.equal(read.nodes.length, 50);
        assert.ok(read.cursor);
        assert.equal((await service.agentRead(context, { path: 'many.drawio', cursor: read.cursor })).nodes.length, 10);
        await service.agentApply(context, { path: 'many.drawio', expectRevision: read.revision, ops: [{ op: 'setLabel', id: 'n0', label: '变更' }] });
        await assert.rejects(service.agentRead(context, { path: 'many.drawio', cursor: read.cursor }), { code: 'E_CONFLICT' });
        const signal = new AbortController();
        signal.abort();
        await assert.rejects(service.agentApply({ ...context, signal: signal.signal }, { path: 'cancel.drawio', create: true, ops: [{ op: 'addNode', id: 'x' }] }), { code: 'E_CANCELLED' });
        assert.equal(existsSync(path.join(root, 'cancel.drawio')), false);
    }
    finally {
        await service.stop();
    }
});
test('document service coordinates UI drafts, AI, revision conflicts and recovery', async () => {
    assert.ok(existsSync(new URL('../plugins/drawai/runtime/documents.cjs', import.meta.url)), 'document service missing');
    const { createDocumentService } = createRequire(import.meta.url)('../plugins/drawai/runtime/documents.cjs');
    const root = await mkdtemp(path.join(os.tmpdir(), 'firefly-drawai-doc-')), storage = await mkdtemp(path.join(os.tmpdir(), 'firefly-drawai-state-'));
    const service = createDocumentService({ storageRoot: storage });
    try {
        let made = await service.agentApply({ resolvedWorkspaceRoot: root }, { path: 'flow.drawio', create: true, ops: [{ op: 'addNode', id: 'a', label: '开始' }] });
        let ui = await service.openNative(path.join(root, 'flow.drawio'));
        ui = await service.edit(ui.handle, { revision: ui.revision, ops: [{ op: 'setLabel', id: 'a', label: '手动' }] });
        assert.equal(ui.dirty, true);
        await assert.rejects(service.agentApply({ resolvedWorkspaceRoot: root }, { path: process.platform === 'win32' ? 'FLOW.drawio' : 'flow.drawio', expectRevision: made.revision, ops: [{ op: 'setLabel', id: 'a', label: '大小写绕过' }] }), { code: 'E_DIRTY' });
        await assert.rejects(service.agentApply({ resolvedWorkspaceRoot: root }, { path: 'flow.drawio', expectRevision: made.revision, ops: [{ op: 'setLabel', id: 'a', label: 'AI' }] }), { code: 'E_DIRTY' });
        ui = await service.save(ui.handle);
        assert.equal(ui.dirty, false);
        const read = await service.agentRead({ resolvedWorkspaceRoot: root }, { path: 'flow.drawio' });
        assert.equal(read.nodes[0].label, '手动');
        await assert.rejects(service.agentApply({ resolvedWorkspaceRoot: root }, { path: 'flow.drawio', expectRevision: made.revision, ops: [{ op: 'remove', id: 'a' }] }), { code: 'E_CONFLICT' });
        const changed = await service.agentApply({ resolvedWorkspaceRoot: root }, { path: 'flow.drawio', expectRevision: read.revision, ops: [{ op: 'setLabel', id: 'a', label: 'AI' }] });
        assert.equal((await service.state(ui.handle)).doc.nodes[0].label, 'AI');
        ui = await service.undo(ui.handle);
        assert.equal(ui.doc.nodes[0].label, '手动');
        await service.save(ui.handle);
        const bytes = await readFile(path.join(root, 'flow.drawio'), 'utf8');
        await writeFile(path.join(root, 'flow.drawio'), bytes.replace('手动', '外部'));
        await assert.rejects(service.undo(ui.handle), { code: 'E_CONFLICT' });
        await assert.rejects(service.agentRead({}, { path: 'flow.drawio' }), { code: 'E_WORKSPACE' });
        await assert.rejects(service.agentRead({ resolvedWorkspaceRoot: root }, { path: '../outside.drawio' }), { code: 'E_PATH' });
        await link(path.join(root, 'flow.drawio'), path.join(root, 'hard.drawio'));
        await assert.rejects(service.agentRead({ resolvedWorkspaceRoot: root }, { path: 'hard.drawio' }), { code: 'E_PATH' });
    }
    finally {
        await service.stop();
    }
});
