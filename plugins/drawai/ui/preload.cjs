'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const argument = process.argv.find(a => a.startsWith('--drawai-channel='));
if (!argument)
    throw new Error('Missing DrawAI channel');
const channel = argument.slice('--drawai-channel='.length);
const methods = ['initial', 'newDocument', 'openDocument', 'saveDocument', 'editDocument', 'undo', 'redo', 'changePage', 'getState', 'select', 'exportFile', 'listRecovery', 'recoverDocument', 'setTheme'];
const api = {};
for (const method of methods)
    api[method] = async (args) => { const result = await ipcRenderer.invoke(channel, method, args); if (!result?.ok)
        throw Object.assign(new Error(result?.error?.message || '画布调用失败'), { code: result?.error?.code }); return result.value; };
contextBridge.exposeInMainWorld('DrawAI', Object.freeze(api));
