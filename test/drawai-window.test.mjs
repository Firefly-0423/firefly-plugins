import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createCanvasWindow, validateExport, validSender } = createRequire(import.meta.url)('../plugins/drawai/runtime/window.cjs');
test('concurrent open coalesces to one isolated window and dispose removes all handlers', async () => {
    const windows = [], handlers = new Map();
    let active = 0;
    class Win extends EventEmitter {
        constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'firefly-plugin://drawai/ui/index.html' }; this.webContents.setWindowOpenHandler = () => { }; windows.push(this); }
        isDestroyed() { return !!this.dead; }
        async loadURL() { }
        show() { }
        focus() { }
        destroy() { this.dead = true; this.emit('closed'); }
    }
    const electron = { BrowserWindow: Win, ipcMain: { handle: (k, f) => { if (handlers.has(k))
                throw Error('duplicate'); handlers.set(k, f); }, removeHandler: k => handlers.delete(k) }, protocol: { isProtocolHandled: async () => { await new Promise(r => setTimeout(r, 10)); return true; } }, session: { fromPartition: () => ({ protocol: { handle: async () => { active++; }, unhandle: async () => { active--; } }, setPermissionRequestHandler() { }, setPermissionCheckHandler() { }, webRequest: { onBeforeRequest() { } } }) }, dialog: {} };
    const host = createCanvasWindow({ service: {}, storage: { get() { }, set() { } }, electron });
    const result = await Promise.allSettled([host.open(), host.open()]);
    assert(result.every(x => x.status === 'fulfilled'));
    assert.equal(windows.length, 1);
    assert.equal(handlers.size, 1);
    assert.equal(validSender({ sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }, windows[0]), true);
    assert.equal(validSender({ sender: {}, senderFrame: windows[0].webContents.mainFrame }, windows[0]), false);
    assert.equal(validSender({ sender: windows[0].webContents, senderFrame: { url: 'file:///other' } }, windows[0]), false);
    await host.dispose();
    assert.equal(handlers.size, 0);
    assert.equal(windows.filter(w => !w.dead).length, 0);
});
test('export validation refuses active SVG and invalid PNG', () => {
    for (const data of ['<svg><script/></svg>', '<svg><image href="https://example.com"/></svg>', '<svg onload="x()"/>'])
        assert.throws(() => validateExport('svg', data));
    assert.equal(validateExport('svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>安全</text></svg>').includes(Buffer.from('安全')), true);
    assert.throws(() => validateExport('png', Buffer.from('not png').toString('base64')));
});

test('canceling file selection preserves the current dirty document without asking to discard', async () => {
    const handlers = new Map(); let window, closed = 0, asked = 0;
    class Win extends EventEmitter {
        constructor() { super(); window = this; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'firefly-plugin://drawai/ui/index.html' }; this.webContents.setWindowOpenHandler = () => {}; }
        isDestroyed() { return !!this.dead; } async loadURL() {} show() {} focus() {} destroy() { this.dead = true; this.emit('closed'); }
    }
    const service = { listRecovery: async () => [], newNative: async () => ({ handle: 'draft' }), state: async () => ({ handle: 'draft', dirty: true, name: 'draft.drawio' }), close: async () => { closed++; }, stop: async () => {} };
    const electron = { BrowserWindow: Win, ipcMain: { handle: (k,f) => handlers.set(k,f), removeHandler: k => handlers.delete(k) }, protocol: { isProtocolHandled: async () => true }, session: { fromPartition: () => ({ protocol: { handle: async () => {}, unhandle: async () => {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } }) }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => { asked++; return { response: 1 }; } } };
    const host = createCanvasWindow({ service, storage: { get() {}, set() {} }, electron });
    await host.open();
    const invoke = action => [...handlers.values()][0]({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, action);
    await invoke('newDocument');
    assert.equal((await invoke('openDocument')).value.canceled, true);
    assert.equal(asked, 0); assert.equal(closed, 0);
    assert.equal((await invoke('getState')).value.handle, 'draft');
    await host.dispose();
});
