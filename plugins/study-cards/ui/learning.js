'use strict';

const api = window.Learning;
const $ = id => document.getElementById(id);
const names = {
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  zh: '中文',
  und: '未标注'
};
const samples = {
  en: {
    title: 'The quiet joy of small beginnings',
    text: 'Every morning, I open a book before I open my phone. The world can wait for a little while.\n\nThere is a quiet joy in learning something new. A word becomes a sentence, and a sentence becomes a small window into another life.\n\nToday, I read slowly. I notice the light on the table, the sound of rain outside, and the words I want to remember. I do not need to understand everything at once.\n\nOne page. One word. One small beginning.'
  },
  ja: {
    title: '小さな一歩',
    text: '朝、窓を開けると、静かな風が入ってきます。机の上に本があります。\n\n私は毎日、少しずつ新しい言葉を学びます。今日は「学ぶ」という言葉を覚えました。\n\n明日も、本を読んで、小さな一歩を進めたいです。'
  },
  ko: {
    title: '작은 시작',
    text: '아침에 창문을 열고 책을 읽습니다. 오늘은 새로운 단어를 배웁니다.\n\n나는 매일 조금씩 배우다 라는 말의 의미를 생각합니다. 작은 시작이 새로운 세상을 보여 줍니다.\n\n천천히 읽고, 마음에 드는 단어를 기억합니다.'
  },
  fr: {
    title: 'Un petit début',
    text: 'Chaque matin, je prends un livre et je regarde la lumière. Bonjour, le monde.\n\nJe veux apprendre quelque chose de nouveau. Un mot devient une phrase, et une phrase ouvre une fenêtre.\n\nLe voyage commence par un petit pas. Merci pour ce moment de calme.'
  },
  de: {
    title: 'Ein kleiner Anfang',
    text: 'Am Morgen öffne ich ein Buch. Draußen ist es still, und die Straße ist noch leer.\n\nIch möchte jeden Tag etwas lernen. Ein neues Wort ist wie ein kleines Fenster in eine andere Welt.\n\nDie Freude beginnt mit einem kleinen Schritt. Heute nehme ich mir Zeit.'
  },
  es: {
    title: 'Un pequeño comienzo',
    text: 'Cada mañana abro un libro. La luz entra por la ventana y el mundo parece tranquilo.\n\nQuiero aprender una palabra nueva cada día. Una frase puede abrir una ventana a otra vida.\n\nHola, pequeño comienzo. Gracias por este momento. La alegría está en seguir aprendiendo.'
  }
};
let tab = 'reader',
  article = {
    title: '把想读的文字放在这里',
    text: '在这里读一篇文章、一个故事，或者一段你喜欢的文字。\n\n点击「粘贴文章」开始；也可以添加演示词典，试读六种语言的原创短文。',
    language: 'en',
    position: 0
  };
let dictionaries = [],
  requestId = 0,
  selectedContext = '',
  collectDraft = null,
  wordPage = 0,
  wordTotal = 0,
  reviewQueue = [],
  reviewIndex = 0,
  importToken = null,
  importGeneration = 0,
  importBusy = false,
  importActivating = false,
  toastTimer,
  positionTimer;
const PAGE_SIZE = 20;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, handler, className) {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', () => run(() => handler(node)));
  return node;
}
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 4500);
}
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || '操作未完成，请重试', true);
    return undefined;
  }
}
async function busy(node, fn) {
  node.disabled = true;
  try {
    return await fn();
  } finally {
    node.disabled = false;
  }
}
function language() {
  return $('language').value;
}
function label(code) {
  return names[code] || code || '未标注';
}
function stopVoice() {
  window.speechSynthesis?.cancel();
}
function localVoice(code) {
  return window.speechSynthesis?.getVoices().find(v => v.localService && v.lang.toLowerCase().split(/[-_]/)[0] === code);
}
function voiceButton(term, code) {
  const node = button('合成朗读', () => {
    const voice = localVoice(code);
    if (!voice) throw new Error('此语言尚无可用的本地语音');
    stopVoice();
    const speech = new SpeechSynthesisUtterance(term);
    speech.voice = voice;
    speech.lang = voice.lang;
    speech.onerror = () => toast('合成朗读未完成，请检查系统语音', true);
    window.speechSynthesis.speak(speech);
  }, 'speech');
  const update = () => {
    node.disabled = !localVoice(code);
    node.title = node.disabled ? '没有此语言的本地语音；可在系统中安装语音后重试' : '使用这台设备的本地系统语音';
  };
  update();
  node.dataset.voiceLanguage = code;
  return node;
}
function updateVoices() {
  for (const node of document.querySelectorAll('[data-voice-language]')) {
    node.disabled = !localVoice(node.dataset.voiceLanguage);
    node.title = node.disabled ? '没有此语言的本地语音' : '使用本地系统语音';
  }
}
window.speechSynthesis?.addEventListener('voiceschanged', updateVoices);
function clearLookup() {
  requestId++;
  stopVoice();
  $('lookup-term').value = '';
  selectedContext = '';
  $('lookup-results').replaceChildren();
  const box = el('div', undefined, 'lookup-empty');
  box.append(el('span', 'Aa', 'empty-symbol'), el('h3', '让阅读，多一点理解'), el('p', '选中一个词，或输入你想查询的词语。'));
  $('lookup-results').append(box);
}
function renderArticle() {
  clearTimeout(positionTimer);
  clearLookup();
  $('article-title').textContent = article.title;
  $('article-text').textContent = article.text;
  $('article-badge').textContent = article.demo ? '原创示例文章' : article.id ? '我的文章' : '未保存的文章';
  $('article-length').textContent = article.text.length.toLocaleString() + ' 字符';
  $('language').value = article.language;
  $('save-article').textContent = article.id ? '保存文章' : '保存文章';
  requestAnimationFrame(() => {
    const node = $('article-text');
    node.scrollTop = Math.max(0, Math.min(1, (article.position || 0) / Math.max(1, article.text.length))) * (node.scrollHeight - node.clientHeight);
    updatePosition();
  });
}
function sample() {
  article = {
    ...samples[language()],
    language: language(),
    position: 0,
    demo: true
  };
  $('articles').value = '';
  renderArticle();
}
function updatePosition() {
  const node = $('article-text'),
    fraction = node.scrollHeight > node.clientHeight ? node.scrollTop / (node.scrollHeight - node.clientHeight) : 0;
  $('reading-position').textContent = Math.round(fraction * 100) + '%';
  article.position = Math.round(fraction * article.text.length);
}
async function refreshArticles(expectedArticle = article) {
  const result = await api.articleList();
  if (article !== expectedArticle) return;
  $('articles').replaceChildren(el('option', '未保存的阅读'));
  $('articles').firstChild.value = '';
  for (const item of result.articles) {
    const option = el('option', item.title);
    option.value = item.id;
    $('articles').append(option);
  }
  $('articles').value = article.id || '';
}
async function saveArticle() {
  const target = article,
    request = {
      ...(target.id ? {
        id: target.id
      } : {}),
      title: target.title,
      language: target.language,
      text: target.text,
      position: target.position || 0
    };
  const saved = await api.articleSave(request);
  target.id = saved.id;
  target.demo = false;
  if (article !== target) return;
  $('article-badge').textContent = '我的文章';
  await refreshArticles(target);
  if (article === target) toast('文章已保存');
}
async function refreshStats() {
  const stats = await api.dashboard();
  $('nav-words').textContent = stats.words;
  $('nav-review').textContent = stats.newCards + stats.dueCards;
  $('stat-words').textContent = stats.words;
  $('stat-new').textContent = stats.newCards;
  $('stat-due').textContent = stats.dueCards;
}
const headings = {
  reader: ['阅读', '从一篇喜欢的文章开始', '选中不熟悉的词，查一查，再把它留在生词本。'],
  words: ['生词', '把遇见的词，变成自己的词', '带着语境记住它，在下一次阅读中再见。'],
  review: ['复习', '再见面，就更熟悉一点', '先想一想，再揭晓答案。按真实感受选择评分。'],
  dictionaries: ['词典', '让每一次查词都有出处', '你的词典、你的语言、你的阅读节奏。']
};
async function switchTab(next) {
  stopVoice();
  tab = next;
  const [name, title, subtitle] = headings[next];
  $('page-name').textContent = name;
  $('page-title').textContent = title;
  $('page-subtitle').textContent = subtitle;
  for (const node of document.querySelectorAll('.tab')) node.hidden = node.id !== 'tab-' + next;
  for (const node of document.querySelectorAll('.nav')) {
    const active = node.dataset.tab === next;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page');else node.removeAttribute('aria-current');
  }
  await refreshStats();
  if (next === 'words') await loadWords();
  if (next === 'review') await loadReview();
  if (next === 'dictionaries') await loadDictionaries();
}
function contextForSelection(selection) {
  const range = selection.getRangeAt(0),
    node = $('article-text');
  const before = range.cloneRange();
  before.selectNodeContents(node);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length,
    end = start + selection.toString().length,
    text = article.text;
  const prefix = text.slice(Math.max(0, start - 400), start),
    suffix = text.slice(end, end + 400);
  const left = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('？'), prefix.lastIndexOf('\n'));
  const right = suffix.search(/[.!?。！？\n]/);
  return (prefix.slice(left < 0 ? 0 : left + (prefix.slice(left, left + 2) === '. ' ? 2 : 1)) + selection.toString() + (right < 0 ? suffix : suffix.slice(0, right + 1))).trim().slice(0, 4000);
}
async function lookup(term, context = '') {
  term = term.trim();
  if (!term || term.length > 200) return;
  stopVoice();
  const current = ++requestId,
    code = language();
  selectedContext = context;
  $('lookup-term').value = term;
  $('lookup-results').replaceChildren(el('p', '正在查词……', 'help'));
  try {
    const result = await api.lookup({
      language: code,
      term,
      limit: 12
    });
    if (current !== requestId || code !== language()) return;
    const content = $('lookup-results');
    content.replaceChildren();
    const title = el('div', undefined, 'result-term');
    title.append(el('h3', term), voiceButton(term, code));
    content.append(title);
    const note = el('p', localVoice(code) ? '本地系统语音 · 合成朗读' : '暂无此语言的本地语音，可在系统中安装后使用。', 'voice-note');
    content.append(note);
    if (!result.entries.length) {
      content.append(el('p', dictionaries.some(d => d.enabled && d.sourceLanguage === code) ? '没有匹配的词条。可尝试原形、调整选区，或换一本词典。' : '还没有此语言的可用词典。请先导入本地词典，或添加演示词典。', 'help'), button('管理词典', () => switchTab('dictionaries'), 'text-button'));
      return;
    }
    for (const entry of result.entries) {
      const block = el('section', undefined, 'entry');
      block.append(el('div', entry.title + ' · ' + entry.revision + ' · ' + label(entry.targetLanguage) + '释义', 'entry-source'));
      if (entry.reading) block.append(el('p', entry.term + '  ' + entry.reading, 'reading'));
      block.append(el('p', entry.meaning, 'entry-meaning'));
      if (context) {
        const quote = el('div', undefined, 'entry-context');
        quote.append(el('small', '遇见它的句子'), el('span', context));
        block.append(quote);
      }
      block.append(button('＋ 留在生词本', () => openCollect({
        ...entry,
        language: code,
        term: entry.term || term,
        context
      }), 'primary'));
      content.append(block);
    }
  } catch (e) {
    if (current === requestId) {
      $('lookup-results').replaceChildren(el('p', e.message, 'help'));
      toast(e.message, true);
    }
  }
}
function openCollect(entry, editing = false) {
  stopVoice();
  collectDraft = {
    ...entry,
    editing,
    operationId: crypto.randomUUID()
  };
  $('collect-title').textContent = editing ? '编辑 ' + entry.term : '留住 ' + entry.term;
  $('collect-source').textContent = (entry.title || entry.dictionaryId || '学习卡') + ' · ' + label(entry.language);
  $('collect-meaning').value = entry.meaning;
  $('collect-context').value = entry.context || '';
  $('collect-submit').textContent = editing ? '保存修改' : '保存到生词本';
  $('collect-dialog').showModal();
}
async function confirmDelete(title, detail) {
  $('confirm-title').textContent = title;
  $('confirm-detail').textContent = detail;
  const dialog = $('confirm-dialog');
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), {
    once: true
  }));
}
async function loadWords() {
  const args = {
    language: language(),
    limit: PAGE_SIZE,
    offset: wordPage * PAGE_SIZE
  };
  if ($('word-search').value.trim()) args.query = $('word-search').value.trim();
  if ($('word-state').value) args.status = $('word-state').value;
  if ($('word-source').value) args.dictionaryId = $('word-source').value;
  if ($('word-deck').value.trim()) args.deck = $('word-deck').value.trim();
  const result = await api.vocabulary(args);
  wordTotal = result.total;
  const list = $('word-list');
  list.replaceChildren();
  if (!result.items.length) {
    const box = el('div', undefined, 'empty-state');
    box.append(el('span', '◇', 'empty-symbol'), el('h2', '生词本，等着你的第一份收藏'), el('p', '先在阅读中选一个词，选择释义后保存。也可以试试其他语言或筛选条件。'), button('去阅读', () => switchTab('reader'), 'primary'));
    list.append(box);
  }
  for (const item of result.items) {
    const row = el('div', undefined, 'word-row'),
      main = el('div', undefined, 'word-main'),
      actions = el('div', undefined, 'word-actions');
    main.append(el('h3', item.term), el('p', item.meaning));
    if (item.context) main.append(el('small', item.context));
    main.append(el('small', [label(item.language), item.deck, item.dictionaryTitle || item.dictionaryId || '手动收藏', item.reviews === 0 ? '未复习' : '已进入复习'].join(' · ')));
    actions.append(voiceButton(item.term, item.language), button('编辑', () => openCollect(item, true)), button('查看原句', async () => {
      article = {
        title: '生词原句 · ' + item.term,
        text: item.context || item.term,
        language: item.language,
        position: 0
      };
      renderArticle();
      await switchTab('reader');
      await lookup(item.term, item.context || '');
    }), button('删除', async () => {
      if (!(await confirmDelete('删除这个生词？', '同时删除对应学习卡和复习状态：' + item.term))) return;
      await api.vocabularyDelete({
        cardId: item.cardId,
        expectedRevision: item.revision
      });
      await loadWords();
      await refreshStats();
      toast('生词及对应学习卡已删除');
    }));
    row.append(main, actions);
    list.append(row);
  }
  $('words-page').textContent = result.total ? wordPage * PAGE_SIZE + 1 + '–' + Math.min((wordPage + 1) * PAGE_SIZE, result.total) + ' / ' + result.total : '0 个生词';
  $('words-prev').disabled = wordPage === 0;
  $('words-next').disabled = (wordPage + 1) * PAGE_SIZE >= result.total;
}
async function loadReview() {
  const method = $('review-mode').value === 'new' ? 'new' : 'due';
  const result = await api[method]({
    limit: 40
  });
  reviewQueue = result.cards;
  reviewIndex = 0;
  renderReview();
}
function renderReview() {
  stopVoice();
  const box = $('review-card');
  box.replaceChildren();
  const card = reviewQueue[reviewIndex];
  if (!card) {
    box.append(el('span', '✓', 'empty-symbol'), el('h2', '这组卡片，今天先到这里'), el('p', '可以切换到新卡片，或继续读一篇喜欢的文章。', 'help'), button('继续阅读', () => switchTab('reader'), 'primary'));
    return;
  }
  const progress = el('div', undefined, 'review-progress');
  progress.append(el('span', card.deck), el('span', reviewIndex + 1 + ' / ' + reviewQueue.length));
  box.append(progress, el('h2', card.front, 'review-front'));
  const back = el('div', card.back, 'review-back');
  back.hidden = true;
  box.append(back);
  const ratings = el('div', undefined, 'rating-buttons');
  ratings.hidden = true;
  for (const [rating, name, time] of [[1, '重来', '10 分钟'], [2, '困难', '1 天'], [3, '良好', '至少 3 天'], [4, '简单', '至少 7 天']]) {
    const node = button(name, async () => {
      for (const b of ratings.children) b.disabled = true;
      try {
        await api.review({
          cardId: card.cardId,
          expectedRevision: card.revision,
          rating
        });
        reviewIndex++;
        renderReview();
        await refreshStats();
      } catch (e) {
        await loadReview();
        throw e;
      }
    });
    node.append(el('small', time));
    ratings.append(node);
  }
  const reveal = button('想好了，揭晓答案', () => {
    back.hidden = false;
    ratings.hidden = false;
    reveal.hidden = true;
    ratings.firstChild.focus();
  }, 'primary');
  box.append(reveal, ratings);
}
async function loadDictionaries() {
  const result = await api.dictionaryList();
  dictionaries = result.dictionaries;
  const source = $('word-source'),
    selected = source.value;
  source.replaceChildren(el('option', '全部来源'));
  source.firstChild.value = '';
  for (const item of dictionaries) {
    const option = el('option', item.title);
    option.value = item.id;
    source.append(option);
  }
  source.value = selected;
  const active = dictionaries.filter(d => d.enabled && d.sourceLanguage === language());
  const notice = $('notice');
  notice.replaceChildren();
  notice.hidden = active.length > 0 && !active.every(d => d.demo);
  if (!notice.hidden) {
    notice.append(el('span', active.length ? '当前使用的是小型演示词典，仅用于体验流程。更多词语请导入自己的词典。' : '此语言还没有启用的词典。可导入本地词典，或先体验小型演示词典。'), button(active.length ? '导入词典' : '试用示例', () => active.length ? switchTab('dictionaries') : installDemo()));
  }
  const list = $('dictionary-list');
  list.replaceChildren();
  if (!dictionaries.length) {
    list.append(el('div', '还没有词典。导入后即可在阅读区选词查询。', 'empty-state'));
    return;
  }
  for (const item of dictionaries) {
    const row = el('section', undefined, 'dictionary-row'),
      header = el('header'),
      info = el('div'),
      actions = el('div', undefined, 'dictionary-actions');
    info.append(el('h3', item.title + (item.demo ? ' · 演示词典' : '')), el('p', label(item.sourceLanguage) + ' → ' + label(item.targetLanguage) + ' · ' + item.count.toLocaleString() + ' 个词条'));
    actions.append(button(item.enabled ? '已启用' : '已停用', async () => {
      await api.dictionarySet({
        id: item.id,
        enabled: !item.enabled,
        priority: item.priority
      });
      await loadDictionaries();
    }), button('↑ 优先', async () => {
      await api.dictionarySet({
        id: item.id,
        enabled: item.enabled,
        priority: Math.max(-1000, item.priority - 1)
      });
      await loadDictionaries();
    }), button('删除', async () => {
      if (!(await confirmDelete('删除这本词典？', item.title + '。已收藏的生词和卡片会保留。'))) return;
      await api.dictionaryDelete({
        id: item.id
      });
      await loadDictionaries();
      await refreshStats();
    }));
    header.append(info, actions);
    row.append(header);
    const details = el('div', undefined, 'dictionary-details');
    details.append(el('span', '版本 ' + item.revision), el('span', '顺序 ' + item.priority), el('span', '索引 ' + formatBytes(item.bytes)));
    row.append(details, el('div', item.attribution || '词典未提供授权说明；请自行核实使用权。', 'dictionary-attribution'));
    list.append(row);
  }
}
function formatBytes(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MiB' : Math.ceil(bytes / 1024) + ' KiB';
}
async function installDemo() {
  await busy($('install-demo'), () => api.demoInstall());
  await loadDictionaries();
  await refreshStats();
  if (tab === 'reader') sample();
  toast('已添加六种语言的演示词典');
}
async function prepareDictionary() {
  if (importBusy || importActivating) return;
  importBusy = true;
  const generation = ++importGeneration;
  importToken = null;
  $('import-dialog').showModal();
  $('import-summary').textContent = '请选择本地词典文件。导入在后台进行；确认添加前不会改变现有词典。';
  $('import-confirm').disabled = true;
  $('import-cancel').disabled = false;
  try {
    const result = await api.chooseDictionary({
      language: language()
    });
    if (generation !== importGeneration) {
      if (result?.token) await api.dictionaryCancel({
        token: result.token
      });
      return;
    }
    if (result.canceled) {
      $('import-dialog').close();
      return;
    }
    importToken = result.token;
    const warnings = Array.isArray(result.warnings) ? result.warnings.join('\n') : String(result.warnings || '');
    $('import-summary').textContent = [result.title, '版本 ' + result.revision, label(result.sourceLanguage) + ' → ' + label(result.targetLanguage), result.count.toLocaleString() + ' 个词条 · ' + formatBytes(result.bytes), '', warnings ? '请检查以下内容：\n' + warnings : '校验完成，可添加到词典列表。', '确认前请核实词典许可。原文件不会修改。'].join('\n');
    $('import-confirm').disabled = false;
  } catch (e) {
    if (generation === importGeneration) {
      $('import-summary').textContent = e.message;
      toast(e.message, true);
    }
  } finally {
    if (generation === importGeneration) importBusy = false;
  }
}
async function cancelImport() {
  if (importActivating) return;
  importGeneration++;
  importToken = null;
  importBusy = false;
  $('import-dialog').close();
  await api.dictionaryCancel({});
}
for (const node of document.querySelectorAll('[data-tab]')) node.addEventListener('click', () => run(() => switchTab(node.dataset.tab)));
for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', () => {
  $(node.dataset.close).close();
  stopVoice();
});
$('sample').addEventListener('click', sample);
$('paste-article').addEventListener('click', () => {
  $('editor-title').value = '';
  $('editor-text').value = '';
  $('editor-language').textContent = label(language());
  $('editor-dialog').showModal();
});
$('edit-article').addEventListener('click', () => {
  $('editor-title').value = article.title;
  $('editor-text').value = article.text;
  $('editor-language').textContent = label(language());
  $('editor-dialog').showModal();
});
$('editor-form').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('editor-title').value.trim(),
    text = $('editor-text').value;
  if (!title || !text.trim()) return;
  article = {
    title,
    text,
    language: language(),
    position: 0
  };
  $('articles').value = '';
  $('editor-dialog').close();
  renderArticle();
});
$('save-article').addEventListener('click', () => run(() => busy($('save-article'), saveArticle)));
$('open-article').addEventListener('click', () => run(async () => {
  const result = await api.chooseArticle();
  if (!result.canceled) {
    article = {
      ...result,
      language: language(),
      position: 0
    };
    $('articles').value = '';
    renderArticle();
  }
}));
$('articles').addEventListener('change', () => run(async () => {
  if (!$('articles').value) return;
  article = await api.articleGet({
    id: $('articles').value
  });
  renderArticle();
  await loadDictionaries();
}));
$('article-text').addEventListener('scroll', () => {
  updatePosition();
  clearTimeout(positionTimer);
  if (article.id) {
    const snapshot = {
      ...article
    };
    positionTimer = setTimeout(() => run(() => api.articleSave({
      id: snapshot.id,
      title: snapshot.title,
      text: snapshot.text,
      language: snapshot.language,
      position: snapshot.position
    })), 600);
  }
});
function selectionLookup() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!$('article-text').contains(range.commonAncestorContainer)) return;
  const term = selection.toString().trim();
  if (!term || term.length > 200) return;
  run(() => lookup(term, contextForSelection(selection)));
}
$('article-text').addEventListener('mouseup', selectionLookup);
$('article-text').addEventListener('keyup', e => {
  if (e.key === 'Shift') selectionLookup();
});
$('lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  run(() => lookup($('lookup-term').value));
});
$('language').addEventListener('change', () => run(async () => {
  clearLookup();
  if (article.demo) sample();else article.language = language();
  wordPage = 0;
  await loadDictionaries();
  if (tab === 'words') await loadWords();
  if (tab === 'review') await loadReview();
}));
$('collect-form').addEventListener('submit', event => {
  event.preventDefault();
  run(() => busy($('collect-submit'), async () => {
    const entry = collectDraft;
    if (!entry) return;
    const meaning = $('collect-meaning').value,
      context = $('collect-context').value;
    if (!meaning.trim()) return;
    let result;
    if (entry.editing) result = await api.vocabularyUpdate({
      cardId: entry.cardId,
      expectedRevision: entry.revision,
      meaning,
      context
    });else result = await api.collect({
      language: entry.language,
      term: entry.term,
      reading: entry.reading || '',
      meaning,
      context,
      dictionaryId: entry.dictionaryId || '',
      operationId: entry.operationId
    });
    $('collect-dialog').close();
    collectDraft = null;
    await refreshStats();
    if (tab === 'words') await loadWords();
    toast(entry.editing ? '生词和学习卡已更新' : result.duplicate ? '这个词义已经在生词本里' : '已留在生词本，下次复习见');
  }));
});
let filterTimer;
for (const id of ['word-search', 'word-deck']) $(id).addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => run(async () => {
    wordPage = 0;
    await loadWords();
  }), 250);
});
for (const id of ['word-state', 'word-source']) $(id).addEventListener('change', () => run(async () => {
  wordPage = 0;
  await loadWords();
}));
$('words-prev').addEventListener('click', () => run(async () => {
  if (wordPage > 0) {
    wordPage--;
    await loadWords();
  }
}));
$('words-next').addEventListener('click', () => run(async () => {
  if ((wordPage + 1) * PAGE_SIZE < wordTotal) {
    wordPage++;
    await loadWords();
  }
}));
$('review-mode').addEventListener('change', () => run(loadReview));
$('review-refresh').addEventListener('click', () => run(loadReview));
$('install-demo').addEventListener('click', () => run(installDemo));
$('import-dictionary').addEventListener('click', () => run(prepareDictionary));
$('import-cancel').addEventListener('click', () => run(cancelImport));
$('import-dialog').addEventListener('cancel', e => {
  e.preventDefault();
  run(cancelImport);
});
$('import-confirm').addEventListener('click', () => run(() => busy($('import-confirm'), async () => {
  if (!importToken || importActivating) return;
  importActivating = true;
  $('import-cancel').disabled = true;
  try {
    await api.dictionaryCommit({
      token: importToken
    });
    importToken = null;
    $('import-dialog').close();
  } finally {
    importActivating = false;
    $('import-cancel').disabled = false;
  }
  await loadDictionaries();
  await refreshStats();
  toast('词典已添加，可以查词了');
})));
$('export').addEventListener('click', () => run(() => busy($('export'), async () => {
  const result = await api.exportData();
  if (!result.canceled) toast('已导出 ' + result.name);
})));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    stopVoice();
    if (!document.querySelector('dialog[open]')) clearLookup();
  }
});
window.addEventListener('beforeunload', () => {
  stopVoice();
  clearTimeout(positionTimer);
  clearTimeout(filterTimer);
});
renderArticle();
run(async () => {
  await refreshStats();
  await refreshArticles();
  await loadDictionaries();
});
