'use strict';
// Optional acceptance driver; uses the already-built host's Electron and Playwright, no plugin runtime dependency.
const path = require('node:path');
const fs = require('node:fs/promises');
const {mkdtempSync} = require('node:fs');
const assert = require('node:assert/strict');

async function main() {
  if(!process.argv[2]) throw new Error('Usage: node scripts/validation/learning-native.cjs <built Firefly source root> [directory of six WTY gloss ZIPs]');
  const hostRoot=path.resolve(process.argv[2]),repo=path.resolve(__dirname,'../..');
  const {_electron:electron}=require(path.join(hostRoot,'node_modules/playwright'));
  const qa=mkdtempSync(path.join(repo,'.test-tmp-learning-native-'));
  const env={...process.env,FIREFLY_LEARNING_QA_KEEP_ALIVE:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const executable=path.join(hostRoot,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron');
  const app=await electron.launch({executablePath:executable,args:[path.join(__dirname,'learning-preview.cjs'),'--learning-host-root='+hostRoot,'--learning-qa-root='+qa],env,timeout:30000});
  const output=[],errors=[];
  app.process().stdout.on('data',x=>output.push(String(x)));
  app.process().stderr.on('data',x=>output.push(String(x)));
  try {
    const page=await app.firstWindow({timeout:30000});page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>!!window.Learning);
    await page.evaluate(()=>{
      window.nativeMotion={events:[],themeTransitions:0};
      for(const kind of ['animationstart','transitionrun'])document.addEventListener(kind,event=>{
        window.nativeMotion.events.push({kind,target:event.target.id||event.target.className,name:event.animationName||'',property:event.propertyName||''});
      });
      if(document.startViewTransition){const original=document.startViewTransition.bind(document);document.startViewTransition=update=>{window.nativeMotion.themeTransitions++;return original(update);};}
    });
    await page.getByRole('button',{name:'试用示例',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('article-title').textContent==='The quiet joy of small beginnings');
    await page.locator('#article-text').evaluate(node=>{
      const start=node.textContent.indexOf('quiet'),range=document.createRange(),selection=window.getSelection();
      range.setStart(node.firstChild,start);range.setEnd(node.firstChild,start+5);selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    });
    await page.waitForSelector('.entry-meaning');
    assert.ok((await page.locator('.entry-context').textContent()).includes('quiet joy'));
    const themeProof=[];
    const unchangedText=await page.locator('#article-text').textContent();
    for(const theme of ['pearl-white','firefly-dark']) {
      await page.locator('#theme-select').selectOption(theme);
      await page.waitForFunction(choice=>document.documentElement.dataset.uiTheme===choice && !document.getElementById('theme-select').disabled,theme);
      const colours=await page.evaluate(()=>({
        theme:document.documentElement.dataset.uiTheme,
        nativePreference:window.Learning.initialTheme,
        page:getComputedStyle(document.documentElement).backgroundColor,
        reader:getComputedStyle(document.querySelector('.reader-card')).backgroundColor,
        sidebar:getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
        accent:getComputedStyle(document.documentElement).getPropertyValue('--ff-accent').trim(),
        scheme:getComputedStyle(document.documentElement).colorScheme,
      }));
      assert.equal(colours.page,theme==='firefly-dark'?'rgb(27, 32, 30)':'rgb(245, 246, 249)');
      assert.equal(colours.accent,theme==='firefly-dark'?'#8bbca6':'#4d4e69');
      assert.equal(colours.reader,theme==='firefly-dark'?'rgb(34, 40, 37)':'rgb(250, 251, 252)');
      const lookupColour=await page.locator('.lookup-card').evaluate(node=>getComputedStyle(node).backgroundColor);
      assert.equal(lookupColour,colours.reader,'Reader and lookup share a single panel tone');
      assert.equal(await page.locator('#article-text').textContent(),unchangedText);
      await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      await page.screenshot({path:path.join(qa,'learning-reader-'+theme+'.png'),fullPage:true});
      themeProof.push(colours);
    }
    await page.getByRole('button',{name:'＋ 留在生词本',exact:true}).first().click();
    const dialogColour=await page.locator('#collect-dialog').evaluate(node=>getComputedStyle(node).backgroundColor);
    assert.equal(dialogColour,'rgb(34, 40, 37)');
    const dialogBorder=await page.locator('#collect-dialog').evaluate(node=>getComputedStyle(node).borderTopColor);
    const panelBorder=await page.locator('.reader-card').evaluate(node=>getComputedStyle(node).borderTopColor);
    assert.equal(dialogBorder,panelBorder,'Dialog and panel borders share the same tone');
    await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    await page.screenshot({path:path.join(qa,'learning-collect-dark.png')});
    assert.ok((await page.locator('#collect-context').inputValue()).includes('quiet joy'));
    await page.locator('#collect-submit').click();await page.waitForFunction(()=>!document.getElementById('collect-dialog').open);
    assert.equal(await page.locator('#nav-words').textContent(),'1');
    await page.locator('[data-tab="words"]').click();await page.waitForSelector('.word-row');
    await page.screenshot({path:path.join(qa,'learning-words.png'),fullPage:true});
    await page.locator('[data-tab="review"]').click();await page.locator('#review-mode').selectOption('new');await page.waitForSelector('.review-front');
    assert.equal(await page.locator('.review-back').isVisible(),false);
    await page.getByRole('button',{name:'想好了，揭晓答案',exact:true}).click();
    await page.screenshot({path:path.join(qa,'learning-review.png'),fullPage:true});
    await page.locator('.rating-buttons button').nth(2).click();
    await page.waitForFunction(()=>document.querySelector('#review-card h2')?.textContent.includes('今天先到这里'));
    await page.locator('[data-tab="dictionaries"]').click();await page.waitForSelector('.dictionary-row');
    await page.screenshot({path:path.join(qa,'learning-dictionaries.png'),fullPage:true});
    const languages=[['en','quiet'],['ja','学ぶ'],['ko','배우다'],['fr','bonjour'],['de','Straße'],['es','alegría']];
    await page.locator('[data-tab="reader"]').click();
    for(const [code,term]of languages){
      await page.locator('#language').selectOption(code);await page.locator('#lookup-term').fill(term);
      await page.locator('#lookup-form').evaluate(node=>node.requestSubmit());
      await page.waitForFunction(word=>document.querySelector('.result-term h3')?.textContent===word && !!document.querySelector('.entry-meaning'),term);
    }
    const voices=await page.evaluate(()=>({voices:window.speechSynthesis?.getVoices().map(v=>({name:v.name,lang:v.lang,local:v.localService})),node:typeof require}));
    assert.equal(voices.node,'undefined');
    let speech={status:'unavailable'};
    if(voices.voices?.some(v=>v.local && v.lang.startsWith('ja'))){
      await page.locator('#language').selectOption('ja');await page.locator('#lookup-term').fill('学ぶ');await page.locator('#lookup-form').evaluate(node=>node.requestSubmit());
      await page.waitForSelector('.entry-meaning');
      await page.evaluate(()=>{window.voiceProof={status:'waiting'};const Base=window.SpeechSynthesisUtterance;window.SpeechSynthesisUtterance=function(text){const utterance=new Base(text);utterance.addEventListener('start',()=>{window.voiceProof.status='started';});utterance.addEventListener('end',()=>{window.voiceProof.status='ended';});utterance.addEventListener('error',e=>{window.voiceProof={status:'error',error:e.error};});return utterance;};});
      await page.locator('.speech').first().click();
      await page.waitForFunction(()=>['ended','error'].includes(window.voiceProof.status),{},{timeout:15000}).catch(()=>{});
      speech=await page.evaluate(()=>window.voiceProof);
    }
    const real=[];
    if(process.argv[3]){
      const directory=path.resolve(process.argv[3]);
      for(const [code,term]of [['en','hello'],['ja','本'],['ko','책'],['fr','bonjour'],['de','lernen'],['es','hola']]){
        const filename='wty-'+code+'-'+(code==='en'?'zh':'en')+'-gloss.zip',file=path.join(directory,filename);
        await fs.access(file);
        await app.evaluate(({dialog},selected)=>{global.learningQA.originalPicker=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},file);
        await page.locator('[data-tab="dictionaries"]').click();await page.locator('#language').selectOption(code);
        const before=await page.locator('.dictionary-row').count();await page.locator('#import-dictionary').click();
        await page.locator('#import-confirm').waitFor({state:'visible'});
        await page.waitForFunction(()=>!document.getElementById('import-confirm').disabled,{},{timeout:60000});
        const summary=await page.locator('#import-summary').textContent();await page.locator('#import-confirm').click();
        await page.waitForFunction(()=>!document.getElementById('import-dialog').open,{},{timeout:60000});
        await page.waitForFunction(count=>document.querySelectorAll('.dictionary-row').length===count,before+1);
        await app.evaluate(({dialog})=>{dialog.showOpenDialog=global.learningQA.originalPicker;delete global.learningQA.originalPicker;});
        const result=await page.evaluate(({language,term})=>window.Learning.lookup({language,term}),{language:code,term});
        assert.ok(result.entries.some(e=>!e.dictionaryId.startsWith('demo-')),'Real dictionary failed '+code);
        real.push({file:filename,term,summary,matches:result.entries.length});
      }
    }
    const saved=await page.evaluate(()=>window.Learning.articleSave({title:'restart proof',language:'en',text:'quiet joy',position:3}));
    const motion=await page.evaluate(()=>window.nativeMotion);
    assert.ok(motion.themeTransitions>0,'Theme cross-fade used native view transitions');
    assert.ok(motion.events.some(e=>e.kind==='animationstart' && e.target==='tab-words' && e.name==='learning-enter'),'Vocabulary tab entry animated');
    assert.ok(motion.events.some(e=>e.kind==='transitionrun' && e.target==='collect-dialog' && e.property==='opacity'),'Native dialog opacity transitioned');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#theme-select').selectOption('pearl-white');
    await page.waitForFunction(()=>!document.getElementById('theme-select').disabled);
    await page.locator('#theme-select').selectOption('firefly-dark');
    await page.waitForFunction(()=>!document.getElementById('theme-select').disabled);
    assert.equal(await page.evaluate(()=>window.nativeMotion.themeTransitions),motion.themeTransitions,'Reduced motion skips theme cross-fades');
    await page.locator('[data-tab="reader"]').click();await page.locator('#paste-article').click();
    const reduced=await page.evaluate(()=>({
      dialogAnimations:document.getElementById('editor-dialog').getAnimations().length,
      opacity:getComputedStyle(document.getElementById('editor-dialog')).opacity,
      tabAnimation:getComputedStyle(document.getElementById('tab-reader')).animationName,
    }));
    assert.equal(reduced.dialogAnimations,0);assert.equal(reduced.opacity,'1');assert.equal(reduced.tabAnimation,'none');
    await page.locator('#editor-dialog [aria-label="关闭"]').click();
    await page.emulateMedia({reducedMotion:'no-preference'});
    const beforeRestart=await app.evaluate(async()=>{
      const {manager,tools}=global.learningQA;
      return {list:manager.list(),cards:JSON.parse(await tools.get('study-cards_list').execute({limit:40}))};
    });
    assert.equal(beforeRestart.cards.data.cards.length,1);assert.equal(beforeRestart.cards.data.cards[0].revision,2);
    await app.evaluate(async()=>{const {manager,tools}=global.learningQA;await manager.setEnabled('study-cards',false);if(tools.size)throw Error('Tools leaked');await manager.setEnabled('study-cards',true);await manager.open('study-cards');});
    const reopened=await app.firstWindow();await reopened.waitForFunction(()=>!!window.Learning);
    assert.equal(await reopened.locator('html').getAttribute('data-ui-theme'),'firefly-dark');
    assert.equal(await reopened.locator('#theme-select').inputValue(),'firefly-dark');
    assert.equal(await reopened.evaluate(()=>window.Learning.initialTheme),'firefly-dark');
    assert.equal((await reopened.evaluate(()=>window.Learning.getTheme())).theme,'firefly-dark');
    assert.equal((await reopened.evaluate(()=>window.Learning.dashboard())).words,1);
    assert.equal((await reopened.evaluate(id=>window.Learning.articleGet({id}),saved.id)).position,3);
    assert.deepEqual(errors,[],'Renderer errors');
    const result={passed:true,hostRoot,qa,hostInstall:beforeRestart.list,languages,voices,speech,real,themes:themeProof,themeReopen:true,dialogColour,dialogBorder,motion,reduced,output};
    await fs.writeFile(path.join(qa,'native-result.json'),JSON.stringify(result,null,2));
    console.log('NATIVE_QA_OK '+qa+' '+JSON.stringify({languages:languages.length,real:real.length,speech}));
  }catch(error){await fs.writeFile(path.join(qa,'native-error.log'),String(error.stack)+'\n'+output.join(''));throw error;}
  finally{await app.evaluate(async()=>{await global.learningQA?.manager.stop();});await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
