import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {prepareMarketplace} from '../scripts/build.mjs';
import {mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
async function harness(t) {
  const parent=await realpath(tmpdir()),root=await mkdtemp(path.join(parent,'firefly-cards-test-')),tools=new Map(),plugins=[];
  const storage={rootDir:()=>root};
  const ctx={storage,signal:new AbortController().signal,registerTool:x=>tools.set(x.id,x),unregisterTool:id=>tools.delete(id),onDispose(){},log(){}};
  t.after(async()=>{for(const p of plugins)await p.unregister();const actual=await realpath(root);assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('firefly-cards-test-'));await rm(actual,{recursive:true,force:true});});
  return {root,ctx,tools,async plugin(options={}) {const p=require('../plugins/study-cards/index.cjs').createPlugin(options);plugins.push(p);await p.register(ctx);return p;},async call(name,args){return JSON.parse(await tools.get('study-cards_'+name).execute(args));}};
}

test('cards persist across re-enable and only become due after review',async t=>{
  const h=await harness(t);let now=1000000000000;const p=await h.plugin({now:()=>now});
  const created=await h.call('create',{deck:'CANN',front:'什么是算子？',back:'执行计算的单元'});assert.equal(created.ok,true);
  assert.equal((await h.call('new',{limit:10})).data.cards.length,1);assert.equal((await h.call('due',{limit:10})).data.cards.length,0);
  const answer=await h.call('review',{cardId:created.data.cardId,rating:1,expectedRevision:1});assert.equal(answer.data.dueAt,now+600000);
  assert.equal((await h.call('list',{limit:10})).data.cards[0].revision,2);await p.unregister();
  const again=await h.plugin({now:()=>now});assert.equal((await h.call('new',{limit:10})).data.cards.length,0);now+=600000;
  assert.equal((await h.call('due',{limit:10})).data.cards[0].front,'什么是算子？');await again.unregister();assert.equal(h.tools.size,0);
});

test('invalid inputs and stale reviews cannot change cards',async t=>{
  const h=await harness(t);await h.plugin({now:()=>1000000000000});
  assert.equal((await h.call('create',{deck:'',front:'a',back:'b'})).success,false);
  const card=(await h.call('create',{deck:'A',front:'a',back:'b'})).data;
  assert.equal((await h.call('review',{cardId:card.cardId,rating:7})).success,false);
  assert.equal((await h.call('review',{cardId:card.cardId,rating:3,expectedRevision:99})).success,false);
  assert.equal((await h.call('new',{limit:10})).data.cards.length,1);
  assert.equal((await h.call('lookup',{language:'en',term:'hello',path:'C:/private'})).success,false);
});

test('editing and deleting require the current card revision',async t=>{
  const h=await harness(t);await h.plugin();const card=(await h.call('create',{deck:'A',front:'old',back:'answer'})).data;
  assert.equal((await h.call('update',{cardId:card.cardId,expectedRevision:1,front:'new',back:'answer'})).data.revision,2);
  assert.equal((await h.call('delete',{cardId:card.cardId,expectedRevision:1})).success,false);
  assert.equal((await h.call('new',{limit:10})).data.cards[0].front,'new');
  assert.equal((await h.call('delete',{cardId:card.cardId,expectedRevision:2})).ok,true);assert.equal((await h.call('new',{limit:10})).data.total,0);
});

test('an unreadable existing store is never replaced as an empty collection',async t=>{
  const h=await harness(t);await writeFile(path.join(h.root,'cards-v1.json'),'{broken');await h.plugin();
  assert.equal((await h.call('create',{deck:'A',front:'a',back:'b'})).success,false);
  assert.equal(await readFile(path.join(h.root,'cards-v1.json'),'utf8'),'{broken');
});

test('built plugin packages all declared readable resources and starts disabled',async()=>{
  const plugin=(await prepareMarketplace()).plugins.find(p=>p.id==='study-cards');const zip=await require('jszip').loadAsync(plugin.zipBytes);
  const extra=JSON.parse(await readFile(new URL('../plugins/study-cards/package-files.json',import.meta.url),'utf8')).files;
  assert.deepEqual(Object.keys(zip.files).sort(),['LICENSE','README.md','index.cjs','manifest.json',...extra].sort());
  assert.equal(JSON.parse(await zip.file('manifest.json').async('string')).defaultEnabled,false);
});

test('validation failures are not applied while an uncertain backend write stays unknown',async t=>{
  const h=await harness(t);await h.plugin({createService:()=>({dispose:async()=>{},call:async()=>{throw Object.assign(new Error('保存结果未知'),{effectState:'unknown'});}})});
  assert.equal((await h.call('create',{deck:'',front:'a',back:'b',unexpected:1})).effectState,'not_applied');
  const failed=await h.call('create',{deck:'A',front:'a',back:'b'});assert.equal(failed.success,false);assert.equal(failed.effectState,'unknown');
});

test('duplicate ids and negative intervals in legacy data refuse migration and mutations',async t=>{
  const card={id:'12345678-1234-1234-1234-123456789012',deck:'A',front:'a',back:'b',reviews:0,revision:1,dueAt:0,interval:0};
  for(const corrupt of ['duplicate','interval']) {const h=await harness(t),state={version:1,cards:[{...card}]};if(corrupt==='duplicate')state.cards.push({...card});else state.cards[0].interval=-1;
    const original=JSON.stringify(state);await writeFile(path.join(h.root,'cards-v1.json'),original);await h.plugin();assert.equal((await h.call('create',{deck:'B',front:'a',back:'b'})).success,false);assert.equal(await readFile(path.join(h.root,'cards-v1.json'),'utf8'),original);
  }
});

test('ratings, upper interval bound, pagination and stopped handlers behave consistently',async t=>{
  const h=await harness(t),plugin=await h.plugin({now:()=>1000000000000}),day=86400000;
  for(const [rating,interval]of [[1,600000],[2,day],[3,3*day],[4,7*day]]){const c=(await h.call('create',{deck:'A',front:String(rating),back:'b'})).data;assert.equal((await h.call('review',{cardId:c.cardId,expectedRevision:1,rating})).data.dueAt,1000000000000+interval);assert.equal((await h.call('review',{cardId:c.cardId,expectedRevision:1,rating})).success,false);}
  const listed=(await h.call('list',{limit:2,offset:2,deck:'A'})).data;assert.equal(listed.total,4);assert.equal(listed.cards.length,2);let revision=listed.cards[0].revision;
  for(let i=0;i<15;i++){const result=await h.call('review',{cardId:listed.cards[0].cardId,expectedRevision:revision++,rating:4});assert.ok(result.data.dueAt<=1000000000000+365*day);}
  const handler=h.tools.get('study-cards_create');await plugin.unregister();await h.plugin();assert.equal(JSON.parse(await handler.execute({deck:'A',front:'a',back:'b'})).success,false);
});
