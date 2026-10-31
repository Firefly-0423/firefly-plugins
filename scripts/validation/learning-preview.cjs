'use strict';
// Run with the host's Electron binary and --learning-host-root=<built host root>.
const path = require('node:path');
const fs = require('node:fs');
const {app,protocol}=require('electron');
const repo=path.resolve(__dirname,'../..');
const hostArgument=process.argv.find(x=>x.startsWith('--learning-host-root='))?.slice('--learning-host-root='.length);
const qaArgument=process.argv.find(x=>x.startsWith('--learning-qa-root='))?.slice('--learning-qa-root='.length);
const hostRoot=path.resolve(hostArgument||'');
if(!hostArgument || !fs.existsSync(path.join(hostRoot,'dist/main/plugins/manager.js'))) throw new Error('Provide a built Firefly host root');
const qa=qaArgument?path.resolve(qaArgument):fs.mkdtempSync(path.join(repo,'.test-tmp-learning-preview-'));
const relative=path.relative(repo,qa);
if(!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(qa).startsWith('.test-tmp-learning-'))throw new Error('QA root must be a .test-tmp-learning-* child of this repository');
fs.mkdirSync(path.join(qa,'profile'),{recursive:true});
app.setPath('userData',path.join(qa,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'firefly-plugin',privileges:{standard:true,secure:true}}]);
app.whenReady().then(async()=>{
  protocol.handle('firefly-plugin',()=>new Response(null,{status:404}));
  const {PluginManager}=require(path.join(hostRoot,'dist/main/plugins/manager.js'));
  const tools=new Map();let enabled={};
  const pluginsRoot=path.join(qa,'installed');fs.mkdirSync(pluginsRoot,{recursive:true});
  const manager=new PluginManager({scanRoots:[{path:pluginsRoot,source:'user'}],storageRoot:path.join(qa,'plugin-data'),loadEnabledMap:()=>({...enabled}),saveEnabledMap:next=>{enabled={...next};},confirmPluginReplace:async()=>true,runtime:{toolRegistry:{register:tool=>tools.set(tool.id,tool),unregister:id=>tools.delete(id),getById:id=>tools.get(id)},channelManager:{has:()=>false,register(){},unregister:async()=>true,startOne:async()=>{}},registerIpc(){},unregisterIpc(){}}});
  global.learningQA={manager,tools,qa};
  await manager.start();
  const installed=await manager.installZip(path.join(repo,'dist/study-cards-0.2.0.zip'));
  if(!installed.ok)throw Error(JSON.stringify(installed));
  if(manager.list().find(p=>p.id==='study-cards')?.enabled)throw Error('Install must start disabled');
  const activated=await manager.setEnabled('study-cards',true);if(!activated.ok)throw Error(JSON.stringify(activated));
  const opened=await manager.open('study-cards');if(!opened.ok)throw Error(JSON.stringify(opened));
  if(process.argv.includes('--learning-demo-preview')) {
    const win=require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='firefly-plugin://study-cards/ui/index.html');
    await win.webContents.executeJavaScript("(async()=>{await window.Learning.demoInstall();await loadDictionaries();sample();await lookup('quiet','There is a quiet joy in learning something new.');})()");
  }
  console.log('LEARNING_NATIVE_READY '+qa);
}).catch(e=>{console.error(e);app.exit(1);});
let quitting=false;
app.on('window-all-closed',()=>{if(process.env.FIREFLY_LEARNING_QA_KEEP_ALIVE!=='1')app.quit();});
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;Promise.resolve(global.learningQA?.manager.stop()).catch(console.error).finally(()=>app.quit());});
