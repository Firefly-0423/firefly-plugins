'use strict';
const path = require('node:path'), fs = require('node:fs/promises'), { randomUUID } = require('node:crypto');
const { checkAbsolute, assertPlain, error } = require('./paths.cjs');
const { SaxesParser } = require('../vendor/saxes.cjs');
const ASSETS = new Set(['ui/index.html', 'ui/editor.mjs', 'ui/editor.css', 'upstream/geometry.mjs', 'upstream/style-kernel.mjs']);
const URL_ROOT = 'firefly-plugin://drawai/';
function validateExport(kind, data) {
    if (kind === 'png') {
        const buffer = Buffer.from(data, 'base64');
        if (buffer.length > 16 * 1024 * 1024 || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.readUInt32BE(16) > 4096 || buffer.readUInt32BE(20) > 4096)
            throw error('E_EXPORT', 'PNG 无效或过大');
        return buffer;
    }
    if (kind !== 'svg' || typeof data !== 'string' || Buffer.byteLength(data) > 16 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(data))
        throw error('E_EXPORT', 'SVG 无效或过大');
    const tags = new Set(['svg', 'g', 'defs', 'marker', 'pattern', 'path', 'polygon', 'rect', 'ellipse', 'circle', 'line', 'polyline', 'text', 'tspan', 'title', 'desc']);
    let count = 0;
    const parser = new SaxesParser();
    parser.on('error', () => { throw error('E_EXPORT', 'SVG XML 无效'); });
    parser.on('opentag', node => {
        if (!tags.has(node.name) || ++count > 25000)
            throw error('E_EXPORT', 'SVG 包含不支持的元素');
        for (const [k, v] of Object.entries(node.attributes)) {
            if (/^on/i.test(k) || /href|^style$/i.test(k) || (/url\(/i.test(v) && !/^url\(#[a-z0-9_-]+\)$/i.test(v)))
                throw error('E_EXPORT', 'SVG 包含外部内容');
        }
    });
    parser.write(data).close();
    return Buffer.from(data, 'utf8');
}
function validSender(event, win) { return !!win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === URL_ROOT + 'ui/index.html'; }
function createCanvasWindow({ service, storage, signal, electron }) {
    const { BrowserWindow, ipcMain, session, protocol, dialog } = electron || require('electron');
    let win = null, ses = null, handle = null, disposed = false, closing = false, busyClose = false, channel = null, opening = null;
    const root = path.resolve(__dirname, '..');
    function live() { if (disposed || signal?.aborted)
        throw error('E_STOPPED', '画布已停止'); }
    async function save(as = false) { const state = await service.state(handle); let dest; if (as || !state.path) {
        const result = await dialog.showSaveDialog(win, { title: '保存 DrawAI 图', defaultPath: state.name, filters: [{ name: 'draw.io 图文件', extensions: ['drawio'] }] });
        if (result.canceled)
            return null;
        dest = result.filePath;
    } return service.save(handle, dest); }
    async function leave() {
        if (!handle)
            return true;
        const state = await service.state(handle);
        if (state.dirty) {
            const result = await dialog.showMessageBox(win, { type: 'question', title: '保留画布修改', message: state.name + ' 尚未保存', buttons: ['保存', '放弃修改', '取消'], defaultId: 0, cancelId: 2, noLink: true });
            if (result.response === 2)
                return false;
            if (result.response === 0 && !await save())
                return false;
        }
        await service.close(handle, { discard: true });
        handle = null;
        return true;
    }
    async function writeExport({ kind, data }) {
        const buffer = validateExport(kind, data);
        if (kind === 'png') {
            const img = (electron || require('electron')).nativeImage.createFromBuffer(buffer);
            if (img.isEmpty())
                throw error('E_EXPORT', 'PNG 无法解码');
        }
        const state = await service.state(handle), result = await dialog.showSaveDialog(win, { title: '导出当前页面', defaultPath: state.name.replace(/\.drawio$/i, '') + '.' + kind, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
        if (result.canceled)
            return { canceled: true };
        const file = await checkAbsolute(result.filePath, { missing: true, extensions: ['.' + kind] }), old = await assertPlain(file, true);
        if (old) {
            const answer = await dialog.showMessageBox(win, { type: 'question', message: '替换已有导出文件？', detail: path.basename(file), buttons: ['替换', '取消'], cancelId: 1, defaultId: 1 });
            if (answer.response !== 0)
                return { canceled: true };
        }
        const temp = path.join(path.dirname(file), '.drawai-export-' + randomUUID() + '.tmp');
        try {
            await fs.writeFile(temp, buffer, { flag: 'wx' });
            live();
            await checkAbsolute(file, { missing: !old, extensions: ['.' + kind] });
            const current = await assertPlain(file, true);
            if (old ? (current?.ino !== old.ino || current?.mtimeMs !== old.mtimeMs) : !!current)
                throw error('E_CONFLICT', '导出目标已改变');
            if (old)
                await fs.rename(temp, file);
            else
                await fs.link(temp, file);
        }
        finally {
            await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT')
                throw e; });
        }
        return { path: file, bytes: buffer.length };
    }
    const actions = {
        async initial() { return { theme: storage.get('theme') || 'firefly-dark', state: handle ? await service.state(handle) : null, recovery: await service.listRecovery() }; },
        async newDocument() { if (!await leave())
            return { canceled: true }; const state = await service.newNative(); handle = state.handle; return state; },
        async openDocument() { if (!await leave())
            return { canceled: true }; const result = await dialog.showOpenDialog(win, { title: '打开 DrawAI 图', properties: ['openFile'], filters: [{ name: 'draw.io 图文件', extensions: ['drawio'] }] }); if (result.canceled)
            return { canceled: true }; const state = await service.openNative(result.filePaths[0]); handle = state.handle; return state; },
        async saveDocument(args) { if (!handle)
            throw error('E_HANDLE', '先新建或打开图'); return await save(args?.as === true) || { canceled: true }; },
        async editDocument(args) { if (!args || Object.keys(args).some(k => !['revision', 'ops', 'layout'].includes(k)))
            throw error('E_ARGUMENT', '编辑参数无效'); return service.edit(handle, args); },
        async undo() { return service.undo(handle); }, async redo() { return service.redo(handle); },
        async changePage(args) { return service.page(handle, args?.page); },
        async getState() { return handle ? service.state(handle) : null; },
        async select(args) { return service.select(handle, args?.ids); },
        async exportFile(args) { return writeExport(args || {}); },
        async listRecovery() { return service.listRecovery(); },
        async recoverDocument(args) { if (!await leave())
            return { canceled: true }; const state = await service.recover(args?.key); handle = state.handle; return state; },
        async setTheme(args) { if (!['firefly-dark', 'pearl-white'].includes(args?.theme))
            throw error('E_ARGUMENT', '主题无效'); storage.set('theme', args.theme); return { theme: args.theme }; },
    };
    async function release() { const previous = ses; ses = null; win = null; if (channel) {
        ipcMain.removeHandler(channel);
        channel = null;
    } if (previous)
        await previous.protocol.unhandle('firefly-plugin'); }
    async function openOnce() {
        live();
        if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            return;
        }
        if (!await protocol.isProtocolHandled('firefly-plugin'))
            throw error('E_HOST', '当前 Firefly 未启用插件资源协议');
        live();
        const id = randomUUID();
        channel = 'firefly:drawai:' + id;
        ses = session.fromPartition('drawai-' + id);
        ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        ses.setPermissionCheckHandler(() => false);
        ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(URL_ROOT) }));
        await ses.protocol.handle('firefly-plugin', async (request) => {
            let url;
            try {
                url = new URL(request.url);
            }
            catch {
                return new Response(null, { status: 404 });
            }
            const asset = url.pathname.slice(1);
            if (url.hostname !== 'drawai' || url.search || !ASSETS.has(asset) || request.method !== 'GET')
                return new Response(null, { status: 404 });
            const bytes = await fs.readFile(path.join(root, asset));
            const type = asset.endsWith('.html') ? 'text/html; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
            return new Response(bytes, { headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'" } });
        });
        win = new BrowserWindow({ title: 'DrawAI 画布 · Firefly', width: 1280, height: 820, minWidth: 760, minHeight: 560, backgroundColor: '#111821', autoHideMenuBar: true, show: false, webPreferences: { session: ses, preload: path.join(root, 'ui/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, additionalArguments: ['--drawai-channel=' + channel] } });
        const owned = win;
        owned.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        owned.webContents.on('will-navigate', event => event.preventDefault());
        owned.webContents.on('will-attach-webview', event => event.preventDefault());
        ipcMain.handle(channel, async (event, action, args) => { try {
            live();
            if (!validSender(event, owned) || win !== owned || typeof action !== 'string' || !Object.hasOwn(actions, action))
                throw error('E_SENDER', '画布调用来源无效');
            if (args !== undefined && Buffer.byteLength(JSON.stringify(args)) > 16 * 1024 * 1024)
                throw error('E_LIMIT', '请求过大');
            return { ok: true, value: await actions[action](args) };
        }
        catch (e) {
            return { ok: false, error: { code: e.code || 'E_DIAGRAM', message: String(e.message).slice(0, 500) } };
        } });
        owned.on('close', event => { if (closing || disposed)
            return; event.preventDefault(); if (busyClose)
            return; busyClose = true; void leave().then(ok => { if (ok) {
            closing = true;
            owned.destroy();
        } }).catch(e => dialog.showErrorBox('画布未关闭', String(e.message))).finally(() => { busyClose = false; }); });
        owned.on('closed', () => { closing = false; void release(); });
        try {
            await owned.loadURL(URL_ROOT + 'ui/index.html');
            live();
            owned.show();
        }
        catch (e) {
            owned.destroy();
            await release();
            throw e;
        }
    }
    function open() { if (opening)
        return opening; opening = openOnce().finally(() => { opening = null; }); return opening; }
    async function dispose() { if (disposed)
        return; disposed = true; closing = true; if (opening)
        await opening.catch(() => { }); if (win && !win.isDestroyed())
        win.destroy(); await release(); }
    signal?.addEventListener('abort', () => { void dispose(); }, { once: true });
    return { open, dispose };
}
module.exports = { createCanvasWindow, validateExport, validSender };
