// 加载画面：延迟展示 + 淡出，大厅再淡入
const LoadingView = (() => {
  const TEXTS = ['铺陈棋盘', '端正棋子', '静候入座', '准备就绪'];
  const MIN_SHOW_MS = 5600;
  const STEP_MS = 1200;
  const READY_HOLD_MS = 480;
  let hidden = false;
  let startedAt = 0;

  function init() {
    const overlay = document.getElementById('loadingOverlay');
    const textEl = document.getElementById('loadingText');
    if (!overlay || !textEl) return;

    startedAt = Date.now();
    textEl.textContent = TEXTS[0];

    let idx = 0;
    const interval = setInterval(() => {
      if (hidden) {
        clearInterval(interval);
        return;
      }
      idx++;
      if (idx >= TEXTS.length) {
        clearInterval(interval);
        return;
      }
      textEl.style.opacity = '0';
      setTimeout(() => {
        if (hidden) return;
        textEl.textContent = TEXTS[idx];
        textEl.style.opacity = '1';
      }, 280);
    }, STEP_MS);

    const beginExit = () => {
      if (hidden) return;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, MIN_SHOW_MS - elapsed);
      setTimeout(() => {
        if (hidden) return;
        hidden = true;
        clearInterval(interval);
        textEl.textContent = TEXTS[TEXTS.length - 1];
        textEl.style.opacity = '1';
        setTimeout(() => {
          if (typeof App !== 'undefined' && App.finishLoading) {
            App.finishLoading();
          } else {
            overlay.classList.add('hidden');
            const lobby = document.getElementById('lobby');
            if (lobby) {
              lobby.style.display = 'flex';
              lobby.classList.add('lobby-fade-in');
            }
            setTimeout(() => {
              if (overlay.parentNode) overlay.remove();
            }, 900);
          }
        }, READY_HOLD_MS);
      }, wait);
    };

    if (document.readyState === 'complete') {
      beginExit();
    } else {
      window.addEventListener('load', beginExit);
      setTimeout(beginExit, MIN_SHOW_MS + 10000);
    }
  }

  return { init };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoadingView;
}
