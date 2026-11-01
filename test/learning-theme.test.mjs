import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function themeHarness(initialTheme='firefly-dark',save=async({theme})=>({theme})) {
  const selector={value:'',disabled:false,addEventListener(_name,fn){this.change=fn;}},status={textContent:''},root={dataset:{}};
  const source=readFileSync(new URL('../plugins/study-cards/ui/theme.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{window:{Learning:{initialTheme,setTheme:save}},document:{documentElement:root,getElementById:id=>id==='theme-select'?selector:status}});
  return {selector,status,root};
}

test('theme bootstraps from saved choice and persists a user change without reloading content',async()=>{
  const calls=[],h=themeHarness('firefly-dark',async args=>{calls.push(args.theme);return {theme:args.theme};});
  assert.equal(h.root.dataset.uiTheme,'firefly-dark');assert.equal(h.selector.value,'firefly-dark');
  h.selector.value='pearl-white';await h.selector.change();
  assert.equal(h.root.dataset.uiTheme,'pearl-white');assert.deepEqual(calls,['pearl-white']);
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
