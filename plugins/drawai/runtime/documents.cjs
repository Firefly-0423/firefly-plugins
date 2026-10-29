'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID, createHash } = require('node:crypto');
const { runEngine: defaultEngine } = require('./worker-client.cjs');
const { workspacePath, checkAbsolute, assertPlain, readBounded, error, LIMIT } = require('./paths.cjs');
const digest = s => createHash('sha256').update(s).digest('hex');
const fileKey = p => process.platform === 'win32' ? p.toLowerCase() : p;
function createDocumentService({ storageRoot, runEngine = defaultEngine, signal }) {
    const controller = new AbortController(), byPath = new Map(), handles = new Map(), tails = new Map(), pending = new Set();
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (signal?.aborted)
        controller.abort();
    function live() { if (controller.signal.aborted)
        throw error('E_STOPPED', '插件已停止'); }
    function token(external) { return external ? AbortSignal.any([external, controller.signal]) : controller.signal; }
    function queue(key, work, external) {
        const keys = [...new Set((Array.isArray(key) ? key : [key]).map(fileKey))].sort();
        live();
        const previous = Promise.all(keys.map(k => (tails.get(k) || Promise.resolve()).catch(() => { })));
        const task = previous.then(() => { live(); if (external?.aborted)
            throw error('E_CANCELLED', '操作已取消'); return work(token(external)); });
        for (const k of keys)
            tails.set(k, task);
        pending.add(task);
        task.finally(() => { pending.delete(task); for (const k of keys)
            if (tails.get(k) === task)
                tails.delete(k); }).catch(() => { });
        return task;
    }
    const recoveryRoot = path.join(storageRoot, 'recovery');
    async function ensureRecovery() { await fs.mkdir(recoveryRoot, { recursive: true }); const s = await fs.lstat(recoveryRoot); if (s.isSymbolicLink() || !s.isDirectory())
        throw error('E_PATH', '恢复目录无效'); }
    function stateOf(r) { return { handle: r.handle, name: r.path ? path.basename(r.path) : '未命名.drawio', path: r.path, doc: structuredClone(r.current.doc), revision: r.current.revision, baseRevision: r.baseRevision, dirty: r.current.text !== r.baseText, pages: r.current.pages, pageNames: r.current.pageNames, page: r.current.page, notes: r.current.notes, selection: r.selection.slice(), canUndo: r.undo.length > 0, canRedo: r.redo.length > 0 }; }
    function find(handle) { live(); const r = handles.get(handle); if (!r)
        throw error('E_HANDLE', '文档已关闭'); return r; }
    async function snapshot(text, page = 0, external) { return runEngine({ action: 'read', text, page }, { signal: token(external) }); }
    function record(file, current) { let r = file && byPath.get(fileKey(file)); if (r)
        return r; r = { handle: randomUUID(), path: file || null, current, baseText: file ? current.text : null, baseRevision: file ? current.revision : null, undo: [], redo: [], selection: [] }; handles.set(r.handle, r); if (file)
        byPath.set(fileKey(file), r); return r; }
    async function persist(r) {
        await ensureRecovery();
        const key = digest(r.path || r.handle), destination = path.join(recoveryRoot, key + '.json');
        if (r.current.text === r.baseText) {
            try {
                await fs.unlink(destination);
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
            return;
        }
        const body = JSON.stringify({ path: r.path, baseRevision: r.baseRevision, text: r.current.text, page: r.current.page, time: Date.now() });
        if (Buffer.byteLength(body) > LIMIT + 16384)
            throw error('E_LIMIT', '恢复草稿超过限制');
        const temp = path.join(recoveryRoot, randomUUID() + '.tmp');
        await fs.writeFile(temp, body, { flag: 'wx' });
        try {
            await fs.rename(temp, destination);
        }
        finally {
            await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT')
                throw e; });
        }
        const files = [];
        for (const name of await fs.readdir(recoveryRoot)) {
            if (!/^[a-f0-9]{64}\.json$/.test(name))
                continue;
            const p = path.join(recoveryRoot, name), s = await fs.lstat(p);
            if (s.isSymbolicLink() || !s.isFile() || s.nlink > 1)
                throw error('E_PATH', '恢复文件无效');
            files.push({ p, time: s.mtimeMs });
        }
        files.sort((a, b) => b.time - a.time);
        for (const old of files.slice(5))
            await fs.unlink(old.p);
    }
    async function expectedDisk(r) {
        if (!r.path)
            return;
        const text = await readBounded(await checkAbsolute(r.path));
        if (digest(text) !== r.baseRevision)
            throw error('E_CONFLICT', '文件已被其他程序修改，请重新打开或另存为');
    }
    function push(r, next) { r.undo.push(r.current); if (r.undo.length > 8)
        r.undo.shift(); r.redo = []; r.current = next; r.selection = r.selection.filter(id => [...next.doc.nodes, ...next.doc.edges].some(x => x.id === id)); }
    async function commit(file, text, expected, abort) {
        live();
        if (abort?.aborted)
            throw error('E_CANCELLED', '操作已取消');
        file = await checkAbsolute(file, { missing: expected === null });
        const identity = await assertPlain(file, expected === null);
        if (expected !== null && digest(await readBounded(file)) !== expected)
            throw error('E_CONFLICT', '文件版本已改变');
        if (expected === null && identity)
            throw error('E_CONFLICT', '文件已存在');
        if (Buffer.byteLength(text) > LIMIT)
            throw error('E_LIMIT', '图文件超过限制');
        const temp = path.join(path.dirname(file), '.drawai-' + randomUUID() + '.tmp');
        let fh;
        try {
            fh = await fs.open(temp, 'wx');
            await fh.writeFile(text, 'utf8');
            await fh.sync();
            await fh.close();
            fh = null;
            live();
            if (abort?.aborted)
                throw error('E_CANCELLED', '操作已取消');
            await checkAbsolute(file, { missing: expected === null });
            if (expected === null) {
                await fs.link(temp, file);
            }
            else {
                const now = await assertPlain(file);
                if (now.ino !== identity.ino || now.dev !== identity.dev || digest(await readBounded(file)) !== expected)
                    throw error('E_CONFLICT', '保存前文件已改变');
                await fs.rename(temp, file);
            }
        }
        finally {
            if (fh)
                await fh.close();
            await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT')
                throw e; });
        }
    }
    async function openNative(file) {
        live();
        file = await checkAbsolute(file);
        return queue(file, async (abort) => {
            let r = byPath.get(fileKey(file));
            if (r && r.current.text !== r.baseText)
                throw error('E_DIRTY', '该文件有未保存草稿');
            const current = await runEngine({ action: 'read', text: await readBounded(file) }, { signal: abort });
            if (r) {
                r.current = current;
                r.baseText = current.text;
                r.baseRevision = current.revision;
                r.undo = [];
                r.redo = [];
            }
            else
                r = record(file, current);
            return stateOf(r);
        });
    }
    async function newNative() { live(); const current = await runEngine({ action: 'new', text: null }, { signal: controller.signal }); const r = record(null, current); await persist(r); return stateOf(r); }
    async function edit(handle, { revision, ops, doc, layout } = {}) {
        const r = find(handle);
        return queue(r.path || r.handle, async (abort) => {
            if (revision !== r.current.revision)
                throw error('E_CONFLICT', '画布已改变，请刷新');
            await expectedDisk(r);
            const next = await runEngine({ action: doc ? 'save' : 'apply', text: r.current.text, doc, ops, layout, page: r.current.page }, { signal: abort });
            push(r, next);
            await persist(r);
            return stateOf(r);
        });
    }
    async function save(handle, destination) {
        const r = find(handle), file = destination ? await checkAbsolute(destination, { missing: true }) : r.path;
        if (!file)
            throw error('E_SAVE_AS', '请先选择保存位置');
        return queue([file, r.path || r.handle], async (abort) => {
            const changing = fileKey(file) !== fileKey(r.path || '');
            if (changing && byPath.has(fileKey(file)) && byPath.get(fileKey(file)) !== r)
                throw error('E_CONFLICT', '目标文件已在编辑');
            const expected = changing ? null : r.baseRevision;
            await commit(file, r.current.text, expected, abort);
            if (changing) {
                const oldKey = digest(r.path || r.handle);
                await fs.unlink(path.join(recoveryRoot, oldKey + '.json')).catch(e => { if (e.code !== 'ENOENT')
                    throw e; });
                if (r.path)
                    byPath.delete(fileKey(r.path));
            }
            r.path = file;
            byPath.set(fileKey(file), r);
            r.baseText = r.current.text;
            r.baseRevision = r.current.revision;
            await persist(r);
            return stateOf(r);
        });
    }
    async function history(handle, direction) {
        const r = find(handle);
        return queue(r.path || r.handle, async () => { await expectedDisk(r); const from = direction === 'undo' ? r.undo : r.redo, to = direction === 'undo' ? r.redo : r.undo; if (!from.length)
            return stateOf(r); to.push(r.current); if (to.length > 8)
            to.shift(); r.current = from.pop(); await persist(r); return stateOf(r); });
    }
    async function page(handle, page) {
        const r = find(handle);
        return queue(r.path || r.handle, async (abort) => { if (r.current.text !== r.baseText)
            throw error('E_DIRTY', '切页前请保存当前修改'); r.current = await runEngine({ action: 'read', text: r.current.text, page }, { signal: abort }); return stateOf(r); });
    }
    async function agentRead(context, args) {
        const file = await workspacePath(context, args.path);
        return queue(file, async (abort) => {
            const current = await runEngine({ action: 'read', text: await readBounded(file), page: args.page ?? 0 }, { signal: abort });
            let offset = 0;
            if (args.cursor) {
                let cursor;
                try {
                    cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString());
                }
                catch {
                    throw error('E_ARGUMENT', '分页游标无效');
                }
                if (cursor.revision !== current.revision || cursor.page !== current.page || cursor.path !== args.path)
                    throw error('E_CONFLICT', '图文件已改变，请重新读取');
                offset = cursor.offset;
            }
            const limit = args.limit ?? 50;
            if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000)
                throw error('E_ARGUMENT', '分页参数无效');
            const cells = [...current.doc.nodes.map(n => ({ ...n, type: 'node' })), ...current.doc.edges.map(n => ({ ...n, type: 'edge' }))], part = cells.slice(offset, offset + limit).map(c => { const v = { ...c }; if (v.style?.includes('image='))
                v.style = v.style.replace(/image=[^;]*/g, 'image=[omitted]'); return v; });
            const r = byPath.get(fileKey(file)), result = { path: args.path, revision: current.revision, page: current.page, pages: current.pages, pageNames: current.pageNames, nodes: part.filter(x => x.type === 'node'), edges: part.filter(x => x.type === 'edge'), layers: current.doc.layers, total: cells.length, notes: current.notes, dirty: !!r && r.current.text !== r.baseText, selection: r && r.current.page === current.page ? r.selection : [] };
            if (offset + limit < cells.length)
                result.cursor = Buffer.from(JSON.stringify({ path: args.path, page: current.page, revision: current.revision, offset: offset + limit })).toString('base64url');
            if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
                throw error('E_LIMIT', '读取结果过大，请减少 limit');
            return result;
        }, context.signal);
    }
    async function agentApply(context, args) {
        const file = await workspacePath(context, args.path, { missing: args.create === true });
        return queue(file, async (abort) => {
            const r = byPath.get(fileKey(file));
            if (r && r.current.text !== r.baseText)
                throw error('E_DIRTY', '画布有未保存修改，请先保存或放弃草稿');
            let text = null;
            if (args.create !== true)
                text = await readBounded(file);
            if (text !== null && (typeof args.expectRevision !== 'string' || digest(text) !== args.expectRevision))
                throw error('E_CONFLICT', '请先读取图文件并使用对应 revision');
            const next = await runEngine({ action: 'apply', text, page: args.page ?? 0, ops: args.ops, layout: args.layout }, { signal: abort });
            await commit(file, next.text, text === null ? null : args.expectRevision, abort);
            if (r) {
                push(r, next);
                r.baseText = next.text;
                r.baseRevision = next.revision;
                await persist(r);
            }
            return { path: args.path, revision: next.revision, page: next.page, created: next.changes.created, changed: next.changes.changed, removed: next.changes.removed, notes: next.notes, artifact: { path: file, bytes: Buffer.byteLength(next.text) } };
        }, context.signal);
    }
    async function state(handle) { const r = find(handle); return stateOf(r); }
    async function select(handle, ids) { const r = find(handle); if (!Array.isArray(ids) || ids.length > 1000 || ids.some(v => typeof v !== 'string'))
        throw error('E_ARGUMENT', '选区无效'); const valid = new Set([...r.current.doc.nodes, ...r.current.doc.edges].map(c => c.id)); r.selection = ids.filter(id => valid.has(id)); return stateOf(r); }
    async function close(handle, { discard = false } = {}) { const r = find(handle); if (r.current.text !== r.baseText && !discard)
        throw error('E_DIRTY', '有未保存修改'); if (discard) {
        r.current.text = r.baseText;
        await persist(r);
    } handles.delete(handle); if (r.path)
        byPath.delete(fileKey(r.path)); }
    async function listRecovery() { await ensureRecovery(); const out = []; for (const name of await fs.readdir(recoveryRoot)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name))
            continue;
        const p = path.join(recoveryRoot, name), s = await assertPlain(p);
        if (s.size > LIMIT + 16384)
            continue;
        const data = JSON.parse(await fs.readFile(p, 'utf8'));
        out.push({ key: name.slice(0, -5), name: data.path ? path.basename(data.path) : '未命名.drawio', time: data.time });
    } return out; }
    async function recover(key) {
        if (!/^[a-f0-9]{64}$/.test(key))
            throw error('E_ARGUMENT', '恢复标识无效');
        const file = path.join(recoveryRoot, key + '.json'), meta = await assertPlain(file);
        if (meta.size > LIMIT + 16384)
            throw error('E_LIMIT', '恢复文件过大');
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        if (typeof data.text !== 'string' || Buffer.byteLength(data.text) > LIMIT)
            throw error('E_LIMIT', '恢复草稿无效');
        let baseText = null;
        if (data.path) {
            await checkAbsolute(data.path);
            baseText = await readBounded(data.path);
            if (digest(baseText) !== data.baseRevision)
                throw error('E_CONFLICT', '原文件已改变，请先保留恢复草稿并检查原件');
        }
        const current = await snapshot(data.text, data.page), r = record(data.path, current);
        r.current = current;
        r.baseText = baseText;
        r.baseRevision = data.baseRevision;
        // A recovered untitled document receives a new opaque handle. Move its
        // recovery identity too, so saving it cannot leave the old draft behind.
        if (digest(r.path || r.handle) !== key) {
            await persist(r);
            await fs.unlink(file);
        }
        return stateOf(r);
    }
    async function stop() { controller.abort(); await Promise.allSettled([...pending]); for (const r of handles.values())
        if (r.current.text !== r.baseText)
            await persist(r); handles.clear(); byPath.clear(); }
    return { openNative, newNative, edit, save, undo: h => history(h, 'undo'), redo: h => history(h, 'redo'), page, agentRead, agentApply, state, select, close, listRecovery, recover, stop };
}
module.exports = { createDocumentService };
