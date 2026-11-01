import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function themeHarness(initialTheme='firefly-dark',save=async({theme})=>({theme}),effects={}) {
  const selector={value:'',disabled:false,addEventListener(_name,fn){this.change=fn;}},status={textContent:''},root={dataset:{}};
  const source=readFileSync(new URL('../plugins/study-cards/ui/theme.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{window:{Learning:{initialTheme,setTheme:save},matchMedia:()=>({matches:effects.reduced===true})},document:{documentElement:root,getElementById:id=>id==='theme-select'?selector:status,...effects.document}});
  return {selector,status,root};
}

test('theme bootstraps from saved choice and persists a user change without reloading content',async()=>{
  const calls=[],h=themeHarness('firefly-dark',async args=>{calls.push(args.theme);return {theme:args.theme};});
  assert.equal(h.root.dataset.uiTheme,'firefly-dark');assert.equal(h.selector.value,'firefly-dark');
  h.selector.value='pearl-white';await h.selector.change();
  assert.equal(h.root.dataset.uiTheme,'pearl-white');assert.deepEqual(calls,['pearl-white']);
});

test('successful switch uses a visual transition after saving, while first paint remains immediate',async()=>{
  const events=[];
  const h=themeHarness('pearl-white',async({theme})=>{events.push('saved');return {theme};},{document:{startViewTransition(update){events.push('transition');update();return {ready:Promise.resolve(),updateCallbackDone:Promise.resolve(),finished:Promise.resolve()};}}});
  assert.deepEqual(events,[]);h.selector.value='firefly-dark';await h.selector.change();
  assert.deepEqual(events,['saved','transition']);assert.equal(h.root.dataset.uiTheme,'firefly-dark');
});

test('asynchronously skipped view transition produces no unhandled rejection or false save error',async()=>{
  const h=themeHarness('pearl-white',undefined,{document:{startViewTransition(update){
    update();return {ready:Promise.reject(Error('Transition skipped')),updateCallbackDone:Promise.resolve(),finished:Promise.resolve()};
  }}});
  h.selector.value='firefly-dark';await h.selector.change();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.root.dataset.uiTheme,'firefly-dark');assert.equal(h.selector.disabled,false);assert.equal(h.status.textContent,'');
});

test('reduced motion skips theme animation and broken visual transitions still apply the saved choice',async()=>{
  let animations=0;
  const reduced=themeHarness('pearl-white',undefined,{reduced:true,document:{startViewTransition(){animations++;}}});
  reduced.selector.value='firefly-dark';await reduced.selector.change();assert.equal(animations,0);assert.equal(reduced.root.dataset.uiTheme,'firefly-dark');
  const broken=themeHarness('pearl-white',undefined,{document:{startViewTransition(){throw Error('snapshot failed');}}});
  broken.selector.value='firefly-dark';await broken.selector.change();assert.equal(broken.root.dataset.uiTheme,'firefly-dark');assert.equal(broken.status.textContent,'');assert.equal(broken.selector.disabled,false);
});

test('failed theme save retains applied theme and restores selector with visible error status',async()=>{
  const h=themeHarness('pearl-white',async()=>{throw Error('disk full');});
  h.selector.value='firefly-dark';await h.selector.change();
  assert.equal(h.root.dataset.uiTheme,'pearl-white');assert.equal(h.selector.value,'pearl-white');assert.equal(h.selector.disabled,false);assert.match(h.status.textContent,/disk full/);
});

test('theme defaults safely and disables changes until persistence finishes',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;}),h=themeHarness('bad-value',()=>pending);
  assert.equal(h.root.dataset.uiTheme,'pearl-white');
  h.selector.value='firefly-dark';const saving=h.selector.change();assert.equal(h.selector.disabled,true);
  finish({theme:'firefly-dark'});await saving;assert.equal(h.selector.disabled,false);assert.equal(h.root.dataset.uiTheme,'firefly-dark');
});
