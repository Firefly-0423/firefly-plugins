import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function setup() {
  const windows = [], handlers = new Map(), calls = [];
  let assets, requests;
  class Win extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {url:'firefly-plugin://study-cards/ui/index.html'}; this.webContents.setWindowOpenHandler = f => { this.popup = f; }; windows.push(this); }
    isDestroyed() { return !!this.dead; } async loadURL() {} show() {} focus() {} destroy() { this.dead = true; this.emit('closed'); }
  }
  const electron = { BrowserWindow: Win, ipcMain:{handle:(k,f)=>handlers.set(k,f),removeHandler:k=>handlers.delete(k)},protocol:{isProtocolHandled:async()=>true},session:{fromPartition:()=>({protocol:{handle:async(_s,f)=>{assets=f;},unhandle:async()=>{}},setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest:f=>{requests=f;}}})},dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]})} };
  const service={call:async(action,args)=>{calls.push({action,args});return {cards:0};}};
  return {electron,service,windows,handlers,calls,get assets(){return assets;}, get requests(){return requests;},invoke(action,args,event){const win=windows.at(-1);return [...handlers.values()][0](event||{sender:win.webContents,senderFrame:win.webContents.mainFrame},action,args);}};
}

test('learning window coalesces opens, confines assets and rejects spoofed IPC and paths',async()=>{
  const {createLearningWindow}=require('../plugins/study-cards/runtime/window.cjs');
  const h=setup(),host=createLearningWindow({service:h.service,electron:h.electron});
  await Promise.all([host.open(),host.open()]);
  assert.equal(h.windows.length,1);
  const w=h.windows[0];
  assert.equal(w.options.webPreferences.sandbox,true);
  assert.equal(w.options.webPreferences.contextIsolation,true);
  assert.equal(w.options.webPreferences.nodeIntegration,false);
  assert.equal((await h.invoke('lookup',{term:'hello',language:'en'},{sender:{},senderFrame:w.webContents.mainFrame})).ok,false);
  assert.equal((await h.invoke('dictionaryPrepare',{path:'C:/private.zip'})).ok,false);
  assert.equal((await h.invoke('lookup',{term:'hello',language:'en',path:'C:/private'})).ok,false);
  assert.equal((await h.invoke('chooseDictionary',{path:'C:/private.zip'})).ok,false);
  assert.equal((await h.invoke('lookup',{term:'hello',language:'en'})).ok,true);
  assert.deepEqual(w.popup(),{action:'deny'});
  let blocked; h.requests({url:'https://example.com'},r=>{blocked=r.cancel;}); assert.equal(blocked,true);
  assert.equal((await h.assets({url:'firefly-plugin://study-cards/ui/../index.cjs',method:'GET'})).status,404);
  assert.equal((await h.assets({url:'firefly-plugin://study-cards/ui/index.html?x',method:'GET'})).status,404);
  await host.dispose(); assert.equal(h.handlers.size,0); assert.equal(w.dead,true);
});

test('canceled native file selection never reaches dictionary importer',async()=>{
  const {createLearningWindow}=require('../plugins/study-cards/runtime/window.cjs');
  const h=setup(),host=createLearningWindow({service:h.service,electron:h.electron});await host.open();
  assert.equal((await h.invoke('chooseDictionary',{language:'ja'})).value.canceled,true);
  assert.equal(h.calls.length,0);
  await host.dispose();
});
