import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,realpath,rm,readFile}from'node:fs/promises';
import os from'node:os';import path from'node:path';import {spawnSync}from'node:child_process';import {createRequire}from'node:module';
import {prepareMarketplace}from'../scripts/build.mjs';
test('extracted DrawAI runs its actual entry and worker outside repository dependencies',async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'firefly-drawai-installed-'));
 t.after(async()=>{const actual=await realpath(root);assert.equal(path.dirname(actual),parent);assert.equal(path.basename(actual).startsWith('firefly-drawai-installed-'),true);await rm(actual,{recursive:true,force:true});});
 const plugin=(await prepareMarketplace()).plugins.find(x=>x.id==='drawai'),Zip=createRequire(import.meta.url)('jszip'),zip=await Zip.loadAsync(plugin.zipBytes);
 for(const [name,entry]of Object.entries(zip.files)){if(entry.dir)continue;const file=path.resolve(root,name);assert.ok(file.startsWith(root+path.sep));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,await entry.async('nodebuffer'));}
 const script=[
 "const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');",
 "(async()=>{const root=process.cwd(),entry=require('./index.cjs'),tools=new Map();const controller=new AbortController();",
 "await fs.mkdir('workspace');const context={id:'drawai',signal:controller.signal,storage:{rootDir:()=>path.join(root,'private'),get(){},set(){}},registerTool:t=>tools.set(t.id,t),unregisterTool:id=>tools.delete(id),onDispose(){},log(){}};",
 "await entry.register(context);assert.equal(tools.size,2);",
 "const toolContext={userQuery:'fixture',resolvedWorkspaceRoot:path.join(root,'workspace'),mode:'work'};",
 "let result=JSON.parse(await tools.get('drawai_apply').execute({path:'chart.drawio',create:true,ops:[{op:'addNode',id:'a',label:'独立实包'}]},toolContext));assert(result.ok,JSON.stringify(result));",
 "result=JSON.parse(await tools.get('drawai_read').execute({path:'chart.drawio'},toolContext));assert(result.ok);assert.equal(result.data.nodes[0].label,'独立实包');",
 "await entry.unregister();assert.equal(tools.size,0);console.log('EXTRACTED_DRAWAI_OK');})().catch(e=>{console.error(e);process.exitCode=1});"
 ].join('\n');
 const child=spawnSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,NODE_PATH:''},encoding:'utf8',timeout:20000});
 assert.equal(child.status,0,child.stdout+'\n'+child.stderr);assert.match(child.stdout,/EXTRACTED_DRAWAI_OK/);
});
