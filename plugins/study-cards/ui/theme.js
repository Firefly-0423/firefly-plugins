'use strict';

(() => {
  const api = window.Learning;
  const selector = document.getElementById('theme-select');
  const status = document.getElementById('theme-status');
  const normalize = value => value === 'firefly-dark' ? value : 'pearl-white';
  let applied = normalize(api.initialTheme);

  function apply(theme, animate = false) {
    const next = normalize(theme);
    const update = () => {
      applied = next;
      document.documentElement.dataset.uiTheme = next;
      selector.value = next;
    };
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || next === applied || reduced || typeof document.startViewTransition !== 'function') {
      update();
      return;
    }
    try {
      const transition = document.startViewTransition(update);
      // A failed snapshot is a visual failure, not a failed preference write.
      // All three promises exist immediately, even when their getters are unused.
      void transition.ready.catch(() => {});
      const finished = transition.finished.catch(() => {});
      return transition.updateCallbackDone.catch(update).then(() => finished);
    } catch {
      update();
    }
  }
  apply(applied);
  selector.addEventListener('change', async () => {
    if (selector.disabled) return;
    const next = normalize(selector.value);
    selector.disabled = true;
    status.textContent = '';
    try {
      const result = await api.setTheme({theme: next});
      await apply(result.theme, true);
    } catch (error) {
      selector.value = applied;
      status.textContent = '外观未保存：' + String(error.message || '请重试');
    } finally {
      selector.disabled = false;
    }
  });
})();
