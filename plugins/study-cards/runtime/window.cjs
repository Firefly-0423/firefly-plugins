'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const {
  randomUUID
} = require('node:crypto');
const URL_ROOT = 'firefly-plugin://study-cards/';
const ASSETS = new Set(['ui/index.html', 'ui/learning.css', 'ui/learning.js', 'ui/theme.css', 'ui/theme.js', 'ui/motion.css']);
const THEMES = {'pearl-white':'#f5f6f9', 'firefly-dark':'#000000'};
const normalizeTheme = value => typeof value === 'string' && Object.hasOwn(THEMES, value) ? value : 'pearl-white';
const FIELDS = {
  dashboard: [],
  lookup: ['language', 'term', 'limit'],
  collect: ['language', 'term', 'reading', 'meaning', 'context', 'dictionaryId', 'operationId'],
  vocabulary: ['language', 'query', 'offset', 'limit', 'dictionaryId', 'deck', 'status'],
  vocabularyUpdate: ['cardId', 'expectedRevision', 'meaning', 'context'],
  vocabularyDelete: ['cardId', 'expectedRevision'],
  new: ['limit', 'deck'],
  due: ['limit', 'deck'],
  review: ['cardId', 'rating', 'expectedRevision'],
  dictionaryList: [],
  dictionaryCommit: ['token'],
  dictionaryCancel: ['token'],
  dictionarySet: ['id', 'enabled', 'priority'],
  dictionaryDelete: ['id'],
  demoInstall: [],
  articleSave: ['id', 'title', 'language', 'text', 'position'],
  articleList: [],
  articleGet: ['id']
};
function checkArgs(args, fields) {
  if (args === undefined) return {};
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !fields.includes(k))) throw new Error('请求参数无效');
  if (Buffer.byteLength(JSON.stringify(args)) > 2 * 1024 * 1024) throw new Error('请求内容过大');
  return args;
}
function validSender(event, win) {
  return !!win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === URL_ROOT + 'ui/index.html';
}
async function readArticle(file) {
  if (!['.txt', '.md'].includes(path.extname(file).toLowerCase())) throw new Error('请选择 UTF-8 的 .txt 或 .md 文件');
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('文章必须是 1 MiB 以内的普通文件');
  const handle = await fs.open(file, 'r');
  try {
    const current = await handle.stat();
    if (current.ino !== info.ino || current.dev !== info.dev || current.size !== info.size) throw new Error('文件已变化，请重新选择');
    const buffer = Buffer.alloc(info.size + 1);
    const {
      bytesRead
    } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 1024 * 1024) throw new Error('文章过大');
    return {
      title: path.basename(file),
      text: new TextDecoder('utf-8', {
        fatal: true
      }).decode(buffer.subarray(0, bytesRead))
    };
  } finally {
    await handle.close();
  }
}
function createLearningWindow({
  service,
  storage,
  signal,
  electron
}) {
  const {
    BrowserWindow,
    ipcMain,
    session,
    protocol,
    dialog
  } = electron || require('electron');
  let win = null,
    opening = null,
    disposed = false,
    current = null,
    releasing = Promise.resolve();
  const root = path.resolve(__dirname, '..');
  const readTheme = () => normalizeTheme(storage.get('ui-theme'));
  function live() {
    if (disposed || signal?.aborted) throw new Error('学习插件已停用');
  }
  const actions = Object.fromEntries(Object.entries(FIELDS).map(([name, fields]) => [name, args => service.call(name, checkArgs(args, fields))]));
  actions.getTheme = args => {checkArgs(args, []);return {theme:readTheme()};};
  actions.setTheme = args => {
    const {theme} = checkArgs(args, ['theme']);
    if (typeof theme !== 'string' || !Object.hasOwn(THEMES, theme)) throw new Error('外观必须为浅色或深色');
    storage.set('ui-theme', theme);
    win.setBackgroundColor(THEMES[theme]);
    return {theme};
  };
  actions.chooseDictionary = async args => {
    const {
      language
    } = checkArgs(args, ['language']);
    if (!['en', 'ja', 'ko', 'fr', 'de', 'es'].includes(language)) throw new Error('请选择词典原文语言');
    const owner = win;
    const selected = await dialog.showOpenDialog(owner, {
      title: '导入本地 Yomitan 词典',
      properties: ['openFile'],
      filters: [{
        name: 'Yomitan 词典',
        extensions: ['zip']
      }]
    });
    live();
    if (selected.canceled || !selected.filePaths?.length) return {
      canceled: true
    };
    if (owner !== win || owner.isDestroyed()) throw new Error('窗口已关闭');
    return service.call('dictionaryPrepare', {
      path: selected.filePaths[0],
      language
    });
  };
  actions.chooseArticle = async args => {
    checkArgs(args, []);
    const owner = win;
    const selected = await dialog.showOpenDialog(owner, {
      title: '打开文章',
      properties: ['openFile'],
      filters: [{
        name: '纯文本文章',
        extensions: ['txt', 'md']
      }]
    });
    live();
    if (selected.canceled || !selected.filePaths?.length) return {
      canceled: true
    };
    if (owner !== win || owner.isDestroyed()) throw new Error('窗口已关闭');
    return readArticle(selected.filePaths[0]);
  };
  actions.exportData = async args => {
    checkArgs(args, []);
    const owner = win;
    const selected = await dialog.showSaveDialog(owner, {
      title: '导出学习数据',
      defaultPath: 'firefly-learning.json',
      filters: [{
        name: '学习数据',
        extensions: ['json']
      }]
    });
    live();
    if (selected.canceled || !selected.filePath) return {
      canceled: true
    };
    if (owner !== win || owner.isDestroyed()) throw new Error('窗口已关闭');
    const dest = path.resolve(selected.filePath);
    if (path.extname(dest).toLowerCase() !== '.json') throw new Error('请使用 .json 扩展名');
    let old;
    try {
      old = await fs.lstat(dest);
      if (!old.isFile() || old.isSymbolicLink() || old.nlink > 1) throw new Error('导出目标必须是普通文件');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const data = JSON.stringify(await service.call('exportData'), null, 2);
    const temp = path.join(path.dirname(dest), '.firefly-learning-' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temp, data, {
        flag: 'wx',
        mode: 0o600
      });
      live();
      let next;
      try {
        next = await fs.lstat(dest);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (old ? next?.ino !== old.ino || next?.mtimeMs !== old.mtimeMs || next?.isSymbolicLink() : !!next) throw new Error('导出目标已变化');
      if (old) await fs.rename(temp, dest);else await fs.link(temp, dest);
    } finally {
      await fs.unlink(temp).catch(e => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
    return {
      name: path.basename(dest),
      bytes: Buffer.byteLength(data)
    };
  };
  async function release(owned) {
    if (!owned || owned.released) return;
    owned.released = true;
    ipcMain.removeHandler(owned.channel);
    if (current === owned) {
      current = null;
      win = null;
    }
    await owned.ses.protocol.unhandle('firefly-plugin');
  }
  async function openOnce() {
    live();
    await releasing;
    live();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }
    if (!(await protocol.isProtocolHandled('firefly-plugin'))) throw new Error('当前 Firefly 未启用插件资源协议');
    live();
    const id = randomUUID(),
      channel = 'firefly:learning:' + id,
      ses = session.fromPartition('learning-' + id);
    const owned = {
      ses,
      channel
    };
    current = owned;
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, cb) => {
      let allowed = false;
      try {
        const url = new URL(details.url);
        allowed = url.origin === new URL(URL_ROOT).origin && details.url.startsWith(URL_ROOT) && ASSETS.has(url.pathname.slice(1)) && !url.search;
      } catch {}
      cb({
        cancel: !allowed
      });
    });
    try {
      await ses.protocol.handle('firefly-plugin', async request => {
        let url;
        try {
          url = new URL(request.url);
        } catch {
          return new Response(null, {
            status: 404
          });
        }
        const asset = url.pathname.slice(1);
        if (url.hostname !== 'study-cards' || url.search || url.hash || !ASSETS.has(asset) || request.method !== 'GET') return new Response(null, {
          status: 404
        });
        let bytes = await fs.readFile(path.join(root, asset));
        if (asset === 'ui/index.html') bytes = Buffer.from(bytes.toString('utf8').replace('data-ui-theme="pearl-white"', 'data-ui-theme="' + readTheme() + '"'));
        const type = asset.endsWith('.html') ? 'text/html; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
        return new Response(bytes, {
          headers: {
            'Content-Type': type,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"
          }
        });
      });
      live();
      win = new BrowserWindow({
        title: '语言学习 · Firefly',
        width: 1320,
        height: 880,
        minWidth: 940,
        minHeight: 650,
        backgroundColor: THEMES[readTheme()],
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          session: ses,
          preload: path.join(root, 'ui/preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          additionalArguments: ['--learning-channel=' + channel, '--learning-theme=' + readTheme()]
        }
      });
      const created = win;
      owned.win = created;
      created.webContents.setWindowOpenHandler(() => ({
        action: 'deny'
      }));
      created.webContents.on('will-navigate', e => e.preventDefault());
      created.webContents.on('will-attach-webview', e => e.preventDefault());
      ipcMain.handle(channel, async (event, action, args) => {
        try {
          live();
          if (current !== owned || !validSender(event, created) || typeof action !== 'string' || !Object.hasOwn(actions, action)) throw new Error('调用来源或功能无效');
          return {
            ok: true,
            value: await actions[action](args)
          };
        } catch (e) {
          return {
            ok: false,
            error: {
              code: e.code || 'E_LEARNING',
              message: String(e.message).slice(0, 300)
            }
          };
        }
      });
      created.on('closed', () => {
        releasing = release(owned);
        void service.call('dictionaryCancel', {}).catch(() => {});
      });
      await created.loadURL(URL_ROOT + 'ui/index.html');
      live();
      created.show();
    } catch (e) {
      if (owned.win && !owned.win.isDestroyed()) owned.win.destroy();
      await release(owned);
      throw e;
    }
  }
  function open() {
    if (opening) return opening;
    opening = openOnce().finally(() => {
      opening = null;
    });
    return opening;
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', onAbort);
    if (opening) await opening.catch(() => {});
    const owned = current;
    if (owned?.win && !owned.win.isDestroyed()) owned.win.destroy();
    await release(owned);
    await releasing;
  }
  const onAbort = () => {
    void dispose();
  };
  signal?.addEventListener('abort', onAbort, {
    once: true
  });
  return {
    open,
    dispose
  };
}
module.exports = {
  createLearningWindow,
  validSender,
  readArticle
};
