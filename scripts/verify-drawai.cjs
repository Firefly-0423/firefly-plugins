/* Isolated component-host acceptance. No production app profile, model or network. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { createRequire } = require('node:module'), { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const ZIP_NAME = 'drawai-' + JSON.parse(fs.readFileSync(path.join(repo, 'plugins/drawai/manifest.json'), 'utf8')).version + '.zip';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function main() {
    const electron = require('electron'), { app, BrowserWindow, dialog } = electron, out = process.env.DRAWAI_QA_OUT, host = process.env.DRAWAI_QA_HOST;
    for (const name of ['appData', 'userData', 'sessionData', 'logs', 'temp', 'cache', 'crashDumps']) {
        const p = path.join(out, name);
        fs.mkdirSync(p, { recursive: true });
        app.setPath(name, p);
    }
    app.commandLine.appendSwitch('disable-background-networking');
    app.commandLine.appendSwitch('disable-component-update');
    const mod = p => require(path.join(host, 'dist/main', p));
    const panels = mod('main/plugin-panel/plugin-panel-protocol.js');
    panels.registerPluginPanelScheme();
    // Keep only this acceptance process's real windows hidden; renderer, preload,
    // session, protocol and IPC are the plugin's actual implementations.
    BrowserWindow.prototype.show = function () { };
    await app.whenReady();
    app.on('window-all-closed', () => { });
    const tools = new Map(), ipc = new Map(), userRoot = path.join(out, 'installed'), dataRoot = path.join(out, 'private'), workspace = path.join(out, 'workspace');
    fs.mkdirSync(userRoot, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    let enabled = {};
    const { PluginManager } = mod('plugins/manager.js'), { PluginVersionStore } = mod('plugins/version-store.js'), { createPluginPromptRegistry } = mod('plugins/prompts.js');
    const manager = new PluginManager({ scanRoots: [{ path: userRoot, source: 'user' }], storageRoot: dataRoot, versionStore: new PluginVersionStore(userRoot), loadEnabledMap: () => enabled, saveEnabledMap: value => { enabled = value; }, runtime: { toolRegistry: { register: t => { assert(!tools.has(t.id)); tools.set(t.id, t); }, unregister: id => tools.delete(id), getById: id => tools.get(id) }, channelManager: { has: () => false, register() { }, startOne: async () => { }, unregister: async () => true }, promptRegistry: createPluginPromptRegistry(), registerIpc: (id, handler) => ipc.set(id, handler), unregisterIpc: id => ipc.delete(id) } });
    panels.installPluginPanelProtocol(id => manager.getSettingsPanelDir(id));
    await manager.start();
    const imported = await manager.installZip(path.join(repo, 'dist', ZIP_NAME));
    assert(imported.ok, JSON.stringify(imported));
    assert.equal(manager.list().find(x => x.id === 'drawai').enabled, false);
    assert.equal(tools.size, 0);
    assert((await manager.setEnabled('drawai', true)).ok);
    assert.equal(tools.size, 2);
    const openPaths = [], savePaths = [], answers = [];
    dialog.showOpenDialog = async () => ({ canceled: !openPaths.length, filePaths: openPaths.length ? [openPaths.shift()] : [] });
    dialog.showSaveDialog = async () => ({ canceled: !savePaths.length, filePath: savePaths.shift() });
    dialog.showMessageBox = async () => ({ response: answers.shift() ?? 2 });
    dialog.showErrorBox = (title, message) => fs.appendFileSync(path.join(out, 'dialog-errors.log'), title + ': ' + message + '\n');
    global.nativeQA = { out, workspace, tools, manager, openPaths, savePaths, answers, checks: ['ZIP imported disabled', 'explicit enable registers two tools'],
        async tool(kind, args) { const t = tools.get('drawai_' + kind); return JSON.parse(await t.execute(args, { userQuery: 'isolated acceptance', resolvedWorkspaceRoot: workspace, conversationId: 'fixture', mode: 'work' })); },
        async outcome(kind, args) { return mod('main/orchestrator/tools/registry/tool-executor.js').executeToolDefinition(tools.get('drawai_' + kind), args, { userQuery: 'isolated acceptance', resolvedWorkspaceRoot: workspace, mode: 'work' }); },
        capture: async (name) => { const w = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('firefly-plugin://drawai/')); const image = await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); fs.writeFileSync(path.join(out, name), image.toPNG()); },
        async disable() { return manager.setEnabled('drawai', false); }, async enable() { return manager.setEnabled('drawai', true); }, async open() { return manager.open('drawai'); },
        countWindows: () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length,
        close: async () => { await manager.stop(); }, forceExit: () => app.exit(0),
    };
    assert((await manager.open('drawai')).ok);
    global.nativeReady = true;
}
async function runner() {
    if (!process.argv[2]) throw new Error('Usage: node scripts/verify-drawai.cjs <compiled-Firefly-checkout>');
    const host = path.resolve(process.argv[2]), out = path.join(repo, '.drawai-qa', new Date().toISOString().replaceAll(':', '-'));
    fs.mkdirSync(out, { recursive: true });
    const { _electron } = createRequire(path.join(host, 'package.json'))('playwright'), exe = path.join(host, 'node_modules/electron/dist/electron.exe');
    const app = await _electron.launch({ executablePath: exe, args: [__filename], env: { ...process.env, DRAWAI_QA_OUT: out, DRAWAI_QA_HOST: host, APPDATA: path.join(out, 'appData'), LOCALAPPDATA: path.join(out, 'localAppData') }, timeout: 30000 });
    const errors = [];
    let passed = false, details = {};
    try {
        await app.evaluate(async () => { while (!global.nativeReady)
            await new Promise(r => setTimeout(r, 50)); });
        const page = await app.firstWindow();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error')
            errors.push(m.text()); });
        await page.waitForFunction(() => window.DrawAI && document.querySelector('#empty-new'));
        await page.click('#empty-new');
        await page.waitForFunction(() => !document.querySelector('[data-shape="rounded"]').disabled && document.querySelector('#file-name').textContent === '未命名.drawio');
        await page.click('[data-shape="rounded"]');
        await page.waitForFunction(() => document.querySelectorAll('.node-group').length === 1);
        const first = page.locator('.node-group').first();
        const box = await first.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 60, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        await page.click('[data-shape="diamond"]');
        await page.waitForFunction(() => document.querySelectorAll('.node-group').length === 2);
        await page.click('#mode-connect');
        await page.locator('.node-group').first().click();
        await page.locator('.node-group').nth(1).click();
        await page.waitForFunction(() => document.querySelectorAll('.edge-hit').length === 1);
        await page.click('#mode-select');
        await app.evaluate((_e, file) => nativeQA.savePaths.push(file), path.join(out, 'workspace/flow.drawio'));
        await page.click('#save');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
        // Selecting without moving must not dirty a saved file or steal double-click.
        await page.locator('.node-group').first().click();
        await page.waitForTimeout(120);
        assert.equal(await page.locator('#save-state').textContent(), '已保存');
        await page.fill('#label', '属性提交');
        await page.fill('#width', '240');
        await page.fill('#height', '100');
        await page.selectOption('#color', 'green');
        await page.click('#properties button[type=submit]');
        await page.waitForFunction(() => document.querySelector('.node-group rect').getAttribute('width') === '240');
        const resize = await page.locator('[data-resize]').first().boundingBox();
        await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
        await page.mouse.down();
        await page.mouse.move(resize.x + resize.width / 2 + 45, resize.y + resize.height / 2 + 30, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(() => Number(document.querySelector('.node-group rect').getAttribute('width')) > 240);
        await page.click('#layout-grid');
        await page.waitForTimeout(130);
        assert.equal((await page.locator('#status').textContent()).startsWith('E_'), false);
        await page.locator('#layers .layer button').first().click();
        await page.waitForFunction(() => document.querySelectorAll('.node-group').length === 0);
        await page.locator('#layers .layer button').first().click();
        await page.waitForFunction(() => document.querySelectorAll('.node-group').length === 2);
        await page.locator('#layers .layer button').nth(1).click();
        await page.waitForFunction(() => document.querySelector('#layers .layer button:nth-of-type(2)').textContent === '锁定');
        await page.locator('#layers .layer button').nth(1).click();
        await page.waitForFunction(() => document.querySelector('#layers .layer button:nth-of-type(2)').textContent === '可改');
        await page.click('#save');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
        let read = await app.evaluate(() => nativeQA.tool('read', { path: 'flow.drawio' }));
        assert(read.ok, JSON.stringify(read));
        assert.equal(read.data.total, 3);
        const id = read.data.nodes[0].id;
        let changed = await app.evaluate(async (_e, { id, revision }) => nativeQA.tool('apply', { path: 'flow.drawio', expectRevision: revision, ops: [{ op: 'setLabel', id, label: 'AI 修改完成' }] }), { id, revision: read.data.revision });
        assert(changed.ok, JSON.stringify(changed));
        await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('AI 修改完成'));
        await page.locator('.node-group').first().dblclick();
        await page.fill('#dialog-label', '手工草稿');
        await page.click('#confirm-label');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === '未保存');
        const refused = await app.evaluate(async (_e, { id, revision }) => nativeQA.tool('apply', { path: 'flow.drawio', expectRevision: revision, ops: [{ op: 'setLabel', id, label: '不应覆盖' }] }), { id, revision: changed.data.revision });
        assert.equal(refused.error.code, 'E_DIRTY');
        const failureOutcome = await app.evaluate(async (_e, { id, revision }) => nativeQA.outcome('apply', { path: 'flow.drawio', expectRevision: revision, ops: [{ op: 'setLabel', id, label: 'host must reject this' }] }), { id, revision: changed.data.revision });
        assert.equal(failureOutcome.status, 'failed');
        assert.equal(failureOutcome.errorCode, 'E_DIRTY');
        await page.click('#undo');
        await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('AI 修改完成'));
        await page.click('#redo');
        await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('手工草稿'));
        await page.click('#save');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
        for (const kind of ['svg', 'png']) {
            await app.evaluate((_e, file) => nativeQA.savePaths.push(file), path.join(out, 'workspace/flow.' + kind));
            await page.click('#export-' + kind);
            await page.waitForFunction(kind => document.querySelector('#status').textContent.includes(kind.toUpperCase() + ' 已导出'), kind);
        }
        const exports = { svg: fs.readFileSync(path.join(out, 'workspace/flow.svg'), 'utf8'), png: fs.readFileSync(path.join(out, 'workspace/flow.png')).subarray(0, 8).toString('hex') };
        assert(exports.svg.includes('手工草稿'));
        assert.equal(exports.png, '89504e470d0a1a0a');
        await app.evaluate(() => nativeQA.capture('drawai-dark.png'));
        await page.selectOption('#theme', 'pearl-white');
        await page.waitForTimeout(150);
        await app.evaluate(() => nativeQA.capture('drawai-light.png'));
        await page.setViewportSize({ width: 800, height: 600 });
        await page.waitForTimeout(100);
        await app.evaluate(() => nativeQA.capture('drawai-narrow.png'));
        await app.evaluate((_e, file) => nativeQA.openPaths.push(file), path.join(out, 'workspace/flow.drawio'));
        await page.click('#open');
        await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('手工草稿'));
        await page.waitForFunction(() => !document.querySelector('#save').disabled);
        const stageBox = await page.locator('#canvas').boundingBox();
        await page.mouse.move(stageBox.x + 12, stageBox.y + 12);
        await page.mouse.down();
        await page.mouse.move(stageBox.x + stageBox.width - 12, stageBox.y + stageBox.height - 50, { steps: 6 });
        await page.mouse.up();
        assert.equal(await page.locator('.selection-box').count(), 2);
        const beforePan = await page.locator('#canvas').getAttribute('viewBox');
        await page.keyboard.down('Space');
        await page.mouse.move(stageBox.x + 15, stageBox.y + 15);
        await page.mouse.down();
        await page.mouse.move(stageBox.x + 60, stageBox.y + 45, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.up('Space');
        assert.notEqual(await page.locator('#canvas').getAttribute('viewBox'), beforePan);
        await page.click('#fit');
        const beforeZoom = await page.locator('#canvas').getAttribute('viewBox');
        await page.click('#zoom-in');
        assert.notEqual(await page.locator('#canvas').getAttribute('viewBox'), beforeZoom);
        await page.click('#fit');
        await page.locator('.edge-hit').first().click();
        const endpoint = await page.locator('[data-reconnect="to"]').boundingBox();
        const targetNode = await page.locator('.node-group').first().boundingBox();
        await page.mouse.move(endpoint.x + 1, endpoint.y + endpoint.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetNode.x + targetNode.width / 2, targetNode.y + targetNode.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(async () => { const state = await window.DrawAI.getState(); return state.doc.edges[0].to === state.doc.nodes[0].id; });
        const lastNodeId = await page.evaluate(async () => (await window.DrawAI.getState()).doc.nodes[1].id);
        await page.selectOption('#edge-to', lastNodeId);
        await page.click('#properties button[type=submit]');
        await page.waitForFunction(async () => { const state = await window.DrawAI.getState(); return state.doc.edges[0].to === state.doc.nodes[1].id; });
        await page.click('#save');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
        const flowText = fs.readFileSync(path.join(out, 'workspace/flow.drawio'), 'utf8');
        const secondPage = '<diagram id="second" name="第二页"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="second-node" value="第二页节点" vertex="1" parent="1"><mxGeometry x="5000" y="5000" width="130" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram>';
        fs.writeFileSync(path.join(out, 'workspace/multi.drawio'), flowText.replace('</mxfile>', secondPage + '</mxfile>'));
        await app.evaluate((_e, file) => nativeQA.openPaths.push(file), path.join(out, 'workspace/multi.drawio'));
        await page.click('#open');
        await page.waitForFunction(() => document.querySelector('#pages').options.length === 2);
        await page.selectOption('#pages', '1');
        await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('第二页节点'));
        const pageNode = await page.locator('.node-group').first().boundingBox();
        assert(pageNode.x >= stageBox.x && pageNode.x + pageNode.width <= stageBox.x + stageBox.width + 1, 'new page must be visible without manual panning');
        const disabled = await app.evaluate(() => nativeQA.disable());
        assert(disabled.ok);
        assert.equal(await app.evaluate(() => nativeQA.tools.size), 0);
        assert.equal(await app.evaluate(() => nativeQA.countWindows()), 0);
        assert((await app.evaluate(() => nativeQA.enable())).ok);
        assert((await app.evaluate(() => nativeQA.open())).ok);
        await app.evaluate(() => nativeQA.close());
        assert.equal(errors.length, 0, errors.join('\n'));
        passed = true;
        details = { checks: ['real ZIP import/default disabled', 'real host enable/two tools', 'real isolated window+preload+protocol', 'new/add/drag/connect/save', 'host tool read and AI apply', 'manual dirty conflict refuses AI overwrite', 'SVG and PNG export', 'dark/light/narrow screenshots', 'reopen saved graph', 'disable cleans tools/window', 're-enable and reopen'], errors };
    }
    catch (e) {
        details = { error: e.stack, errors };
        try {
            await app.evaluate(() => nativeQA.capture('failure.png'));
        }
        catch { }
        ;
        throw e;
    }
    finally {
        fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed, hostCheckout: host, hostHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: host, encoding: 'utf8' }).trim(), zipSha256: hash(path.join(repo, 'dist', ZIP_NAME)), limits: ['compiled component host; not full production settings app', 'no model API; direct host tool invocation', 'native dialogs deterministically selected fixture files'], ...details }, null, 2));
        await app.evaluate(() => nativeQA.forceExit()).catch(() => { });
        await app.close().catch(() => { });
        console.log(out);
    }
}
if (process.versions.electron)
    main().catch(e => { console.error(e); require('electron').app.exit(1); });
else
    runner().catch(e => { console.error(e); process.exitCode = 1; });
