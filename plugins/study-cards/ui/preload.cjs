'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const argument=process.argv.find(a=>a.startsWith('--learning-channel='));
if(!argument) throw new Error('Missing learning channel');
const channel=argument.slice('--learning-channel='.length);
const methods=['dashboard','lookup','collect','vocabulary','vocabularyUpdate','vocabularyDelete','new','due','review','dictionaryList','dictionaryCommit','dictionaryCancel','dictionarySet','dictionaryDelete','demoInstall','articleSave','articleList','articleGet','chooseDictionary','chooseArticle','exportData'];
const api={};
for(const method of methods) api[method]=async args=>{const result=await ipcRenderer.invoke(channel,method,args);if(!result?.ok)throw Object.assign(new Error(result?.error?.message||'学习操作失败'),{code:result?.error?.code});return result.value;};
contextBridge.exposeInMainWorld('Learning',Object.freeze(api));
