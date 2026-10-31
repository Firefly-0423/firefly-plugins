import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../plugins/study-cards/ui/learning.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function renderer(overrides={}) {
  const nodes=new Map();
  function node(){return {value:'en',textContent:'',hidden:false,disabled:false,open:false,children:[],listeners:{},dataset:{},classList:{toggle(){}},scrollHeight:100,clientHeight:100,scrollTop:0,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},get firstChild(){return this.children[0];},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},showModal(){this.open=true;},close(){this.open=false;},dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn(event);}};}
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const api={dashboard:async()=>({words:0,newCards:0,dueCards:0}),articleList:async()=>({articles:[]}),dictionaryList:async()=>({dictionaries:[]}),dictionaryCancel:async()=>({cancelled:true}),...overrides};
  const context=vm.createContext({window:{Learning:api,addEventListener(){}},document:{getElementById:get,createElement:node,querySelectorAll:()=>[],addEventListener(){},querySelector:()=>null},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),crypto:{randomUUID:()=> 'test-id'}});
  vm.runInContext(source,context);await settle();
  return {get,eval:code=>vm.runInContext(code,context)};
}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}

test('late save keeps article identity and cannot give another article the saved ID',async()=>{
  const pending=deferred(),requests=[];
  const r=await renderer({articleSave:args=>{requests.push({...args});return requests.length===1?pending.promise:Promise.resolve({id:'saved-B'});}});
  r.eval("article={title:'A',text:'original A',language:'en',position:3};globalThis.savedArticle=article;globalThis.saving=saveArticle();article={title:'B',text:'unrelated B',language:'fr',position:0};renderArticle();");
  pending.resolve({id:'saved-A'});await r.eval('saving');
  assert.equal(r.eval('article.id'),undefined);
  assert.equal(r.eval('savedArticle.id'),'saved-A');
  assert.equal(r.get('article-badge').textContent,'未保存的文章');
  assert.notEqual(r.get('toast').textContent,'文章已保存');
  await r.eval('saveArticle()');assert.equal(requests[1].id,undefined);assert.equal(requests[1].text,'unrelated B');
});

test('activation blocks cancel and Escape until commit completes',async()=>{
  const pending=deferred();let cancellations=0;
  const r=await renderer({dictionaryCommit:()=>pending.promise,dictionaryCancel:async()=>{cancellations++;}});
  r.eval("importToken='prepared';$('import-dialog').showModal();");
  r.get('import-confirm').dispatch('click');await settle();
  assert.equal(r.get('import-cancel').disabled,true);
  await r.eval('cancelImport()');let prevented=false;r.get('import-dialog').dispatch('cancel',{preventDefault(){prevented=true;}});await settle();
  assert.equal(prevented,true);assert.equal(cancellations,0);assert.equal(r.get('import-dialog').open,true);
  pending.resolve({});await settle();assert.equal(r.get('import-dialog').open,false);assert.equal(cancellations,0);
});

test('failed activation restores retry and cancellation controls',async()=>{
  const pending=deferred();let cancellations=0;
  const r=await renderer({dictionaryCommit:()=>pending.promise,dictionaryCancel:async()=>{cancellations++;}});
  r.eval("importToken='prepared';$('import-dialog').showModal();");r.get('import-confirm').dispatch('click');await settle();pending.reject(new Error('disk full'));await settle();
  assert.equal(r.get('import-dialog').open,true);assert.equal(r.get('import-confirm').disabled,false);assert.equal(r.get('import-cancel').disabled,false);assert.equal(r.eval('importToken'),'prepared');assert.equal(r.get('toast').textContent,'disk full');
  await r.eval('cancelImport()');assert.equal(cancellations,1);assert.equal(r.get('import-dialog').open,false);
});

test('preparation remains cancellable and late prepared token is discarded',async()=>{
  const pending=deferred(),cancellations=[];
  const r=await renderer({chooseDictionary:()=>pending.promise,dictionaryCancel:async args=>{cancellations.push({...args});}});
  const preparing=r.eval('prepareDictionary()');assert.equal(r.get('import-cancel').disabled,false);
  r.get('import-dialog').dispatch('cancel',{preventDefault(){}});await settle();assert.equal(r.get('import-dialog').open,false);
  pending.resolve({token:'late'});await preparing;
  assert.deepEqual(cancellations,[{},{token:'late'}]);assert.equal(r.eval('importToken'),null);
});

test('late article list response does not replace the next article selection',async()=>{
  const listing=deferred();let lists=0;
  const r=await renderer({articleSave:async()=>({id:'saved-A'}),articleList:()=>++lists===1?Promise.resolve({articles:[]}):listing.promise});
  r.eval("article={title:'A',text:'original A',language:'en',position:0};globalThis.saving=saveArticle();");await settle();
  r.eval("article={id:'saved-B',title:'B',text:'B',language:'fr',position:0};renderArticle();$('articles').value='saved-B';");
  listing.resolve({articles:[{id:'saved-A',title:'A'}]});await r.eval('saving');
  assert.equal(r.get('articles').value,'saved-B');assert.notEqual(r.get('toast').textContent,'文章已保存');
});

test('current article save submits a stable field snapshot and updates its visible state',async()=>{
  const pending=deferred();let request;
  const r=await renderer({articleSave:args=>{request=args;return pending.promise;}});
  r.eval("article={title:'A',text:'original A',language:'en',position:3,demo:true};globalThis.saving=saveArticle();article.language='fr';article.position=9;");
  assert.deepEqual({...request},{title:'A',text:'original A',language:'en',position:3});
  pending.resolve({id:'saved-A'});await r.eval('saving');
  assert.equal(r.eval('article.id'),'saved-A');assert.equal(r.eval('article.demo'),false);assert.equal(r.get('article-badge').textContent,'我的文章');assert.equal(r.get('toast').textContent,'文章已保存');
});
