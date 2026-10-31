import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {prepareMarketplace} from '../scripts/build.mjs';

test('extracted learning package runs tools, worker, SQLite and vendored dictionary reader without repository dependencies',async t=>{
  const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'firefly-learning-installed-'));
  t.after(async()=>{const actual=await realpath(root);assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('firefly-learning-installed-'));await rm(actual,{recursive:true,force:true});});
  const pack=(await prepareMarketplace()).plugins.find(p=>p.id==='study-cards'),Zip=createRequire(import.meta.url)('jszip'),zip=await Zip.loadAsync(pack.zipBytes);
  for(const [name,entry]of Object.entries(zip.files)){const dest=path.resolve(root,name);assert.ok(dest.startsWith(root+path.sep));await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,await entry.async('nodebuffer'));}
  const source=`const assert=require('node:assert/strict'),path=require('node:path');
  (async()=>{const p=require('./index.cjs'),tools=new Map(),root=path.join(process.cwd(),'private');
  await p.register({storage:{rootDir:()=>root},signal:new AbortController().signal,registerTool:t=>tools.set(t.id,t),unregisterTool:id=>tools.delete(id),onDispose(){}});
  assert.equal(tools.size,9);
  const c=JSON.parse(await tools.get('study-cards_collect').execute({language:'fr',term:'café',meaning:'咖啡',operationId:'installed-1'}));assert(c.ok,JSON.stringify(c));
  const cards=JSON.parse(await tools.get('study-cards_list').execute({limit:40}));assert.equal(cards.data.cards[0].front,'café');
  await p.unregister();assert.equal(tools.size,0);
  const {createService}=require('./runtime/service.cjs'),s=createService({rootDir:root});
  try{await s.call('demoInstall');assert.equal((await s.call('lookup',{language:'ja',term:'学ぶ'})).entries.length,1);assert.equal((await s.call('vocabulary')).total,1);}finally{await s.dispose();}
  console.log('EXTRACTED_LEARNING_OK');})().catch(e=>{console.error(e);process.exitCode=1});`;
  const child=spawnSync(process.execPath,['-e',source],{cwd:root,env:{...process.env,NODE_PATH:''},encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stdout+'\n'+child.stderr);assert.match(child.stdout,/EXTRACTED_LEARNING_OK/);
});
