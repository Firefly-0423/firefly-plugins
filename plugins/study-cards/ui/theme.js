'use strict';

(() => {
  const api = window.Learning;
  const selector = document.getElementById('theme-select');
  const status = document.getElementById('theme-status');
  const normalize = value => value === 'firefly-dark' ? value : 'pearl-white';
  let applied = normalize(api.initialTheme);

  function apply(theme) {
    applied = normalize(theme);
    document.documentElement.dataset.uiTheme = applied;
    selector.value = applied;
  }
  apply(applied);
  selector.addEventListener('change', async () => {
    if (selector.disabled) return;
    const next = normalize(selector.value);
    selector.disabled = true;
    status.textContent = '';
    try {
      const result = await api.setTheme({theme: next});
      apply(result.theme);
    } catch (error) {
      selector.value = applied;
      status.textContent = '外观未保存：' + String(error.message || '请重试');
    } finally {
      selector.disabled = false;
    }
  });
})();
