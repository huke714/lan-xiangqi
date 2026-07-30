// 弹窗 / Toast / 确认框统一管理
const Modals = (() => {
  let queue = [];
  let currentTimer = null;
  let confirmResolver = null;

  function showToast(message, type) {
    type = type || 'info';
    const toast = document.getElementById('toast');
    if (!toast) return;

    queue.push({ message, type });
    if (queue.length === 1) flushToast();
  }

  function flushToast() {
    if (queue.length === 0) return;
    const { message, type } = queue.shift();
    const toast = document.getElementById('toast');
    const textEl = document.getElementById('toastText');
    if (!toast) return;

    if (currentTimer) clearTimeout(currentTimer);
    if (textEl) textEl.textContent = message;
    else toast.textContent = message;
    toast.className = 'toast ' + type + ' show';

    currentTimer = setTimeout(() => {
      toast.classList.remove('show');
      currentTimer = null;
      flushToast();
    }, 2600);
  }

  function closeGameOverModal() {
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.classList.remove('active');
  }

  function closeDrawModal() {
    const modal = document.getElementById('drawModal');
    if (modal) modal.classList.remove('active');
  }

  function closeUndoModal() {
    const modal = document.getElementById('undoModal');
    if (modal) modal.classList.remove('active');
  }

  function openGameOver(title, message) {
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.classList.add('active');
  }

  function setConfirmMock(kind) {
    const stage = document.getElementById('confirmStage');
    const mock = document.getElementById('confirmMock');
    const caption = document.getElementById('confirmMockCaption');
    if (!stage || !mock) return;

    const map = {
      undo: '啧，这就悔棋？',
      resign: '这就怂啦？',
      draw: '这就想和棋？',
    };
    if (kind && map[kind]) {
      stage.dataset.mock = kind;
      mock.hidden = false;
      if (caption) caption.textContent = map[kind];
      mock.classList.remove('is-playing');
      void mock.offsetWidth;
      mock.classList.add('is-playing');
    } else {
      delete stage.dataset.mock;
      mock.hidden = true;
      mock.classList.remove('is-playing');
      if (caption) caption.textContent = '';
    }
  }

  function bindConfirmOnce() {
    const ok = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');
    const overlay = document.getElementById('confirmModal');
    if (!ok || !cancel || !overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';

    const finish = (okResult) => {
      overlay.classList.remove('active');
      setConfirmMock(null);
      const resolve = confirmResolver;
      confirmResolver = null;
      if (resolve) resolve(okResult);
    };

    ok.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
  }

  /**
   * 应用内确认框（替代浏览器原生 confirm）
   * @returns {Promise<boolean>}
   */
  function confirm(message, options) {
    const opts = options || {};
    bindConfirmOnce();
    const overlay = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    if (!overlay || !msgEl) {
      return Promise.resolve(window.confirm(message));
    }

    if (titleEl) titleEl.textContent = opts.title || '请确认';
    msgEl.textContent = message;
    if (okBtn) okBtn.textContent = opts.okText || '确定';
    if (cancelBtn) cancelBtn.textContent = opts.cancelText || '取消';
    if (okBtn) {
      okBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    }
    setConfirmMock(opts.mock || null);

    overlay.classList.add('active');
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  return {
    showToast,
    confirm,
    closeGameOverModal,
    closeDrawModal,
    closeUndoModal,
    openGameOver
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Modals;
}
