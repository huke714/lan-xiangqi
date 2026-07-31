// 对局页顶部控制区
const Controls = (() => {
  function init() {
    bindThemeButtons();
    bindCompactButton();
    bindPiPButton();
    bindDushuButton();
    bindGameButtons();
  }

  function bindThemeButtons() {
    const btnGame = document.getElementById('btnTheme');
    const btnLobby = document.getElementById('btnThemeLobby');
    if (btnGame) btnGame.onclick = App.toggleTheme;
    if (btnLobby) btnLobby.onclick = App.toggleTheme;
  }

  function bindCompactButton() {
    const btn = document.getElementById('btnCompact');
    if (!btn) return;
    btn.onclick = App.toggleCompact;
  }

  function bindPiPButton() {
    const btn = document.getElementById('btnPiP');
    if (!btn) return;
    btn.onclick = App.openPiPWindow;
  }

  function bindDushuButton() {
    const btn = document.getElementById('btnDushu');
    if (!btn) return;
    btn.onclick = App.sendRandomDushu;
  }

  function bindGameButtons() {
    const undoBtn = document.querySelector('button[onclick="App.requestUndo()"]');
    const resignBtn = document.querySelector('button[onclick="App.resign()"]');
    const drawBtn = document.querySelector('button[onclick="App.offerDraw()"]');
    const restartBtn = document.querySelector('button[onclick="App.restartGame()"]');
    const leaveBtn = document.querySelector('button[onclick="App.leaveGame()"]');
    if (undoBtn) undoBtn.onclick = App.requestUndo;
    if (resignBtn) resignBtn.onclick = App.resign;
    if (drawBtn) drawBtn.onclick = App.offerDraw;
    if (restartBtn) restartBtn.onclick = App.restartGame;
    if (leaveBtn) leaveBtn.onclick = App.leaveGame;
  }

  function updateCompactButton(active) {
    const btn = document.getElementById('btnCompact');
    if (!btn) return;
    if (typeof active === 'boolean') {
      btn.classList.toggle('active', active);
    }
  }

  function updatePiPButton(active) {
    const btn = document.getElementById('btnPiP');
    if (!btn) return;
    if (typeof active === 'boolean') {
      btn.classList.toggle('active', active);
    }
  }

  return { init, updateCompactButton, updatePiPButton };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Controls;
}
