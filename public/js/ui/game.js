// 对局页面逻辑
const GameView = (() => {
  function enter(roomId, color, players, isSpectator) {
    App.showView('game');
    updateRoomInfo(roomId);
    updatePlayerNames(players);
    applyRole(color, isSpectator);
    updatePlayerBars(color, isSpectator);
  }

  function applyRole(color, isSpectator) {
    const myColorName = document.getElementById('myColorName');
    const spectatorTag = document.getElementById('spectatorTag');
    const spectatorBadge = document.getElementById('spectatorBadge');
    const colorInfo = document.getElementById('colorInfo');
    const playerOnlyEls = document.querySelectorAll('.player-only');

    if (isSpectator) {
      if (myColorName) {
        myColorName.textContent = '观战';
        myColorName.className = 'room-meta-role is-spectate';
        myColorName.style.color = '';
      }
      if (spectatorTag) spectatorTag.hidden = false;
      if (colorInfo) colorInfo.hidden = true;
      playerOnlyEls.forEach(el => el.style.display = 'none');
      ChessGame.setSpectator(true);
      ChessGame.setMyColor(null);
      ChessBoard.setFlipped(false);
      GameState.set({ isSpectator: true, myColor: null });
    } else {
      if (myColorName) {
        myColorName.textContent = color === 'red' ? '红方 · 先行' : '黑方 · 后手';
        myColorName.className = 'room-meta-role ' + (color === 'red' ? 'is-red' : 'is-black');
        myColorName.style.color = '';
      }
      if (spectatorTag) spectatorTag.hidden = true;
      if (colorInfo) colorInfo.hidden = false;
      playerOnlyEls.forEach(el => el.style.display = '');
      ChessGame.setSpectator(false);
      ChessGame.setMyColor(color);
      ChessBoard.setFlipped(color === 'black');
      GameState.set({ isSpectator: false, myColor: color });
    }
  }

  function updateRoomInfo(roomId) {
    const el = document.getElementById('gameRoomId');
    if (el) el.textContent = roomId;
  }

  function updatePlayerNames(players) {
    const redName = document.getElementById('redName');
    const blackName = document.getElementById('blackName');
    const red = players.find(p => p.color === 'red');
    const black = players.find(p => p.color === 'black');
    if (redName) redName.textContent = red ? red.name : '等待加入…';
    if (blackName) blackName.textContent = black ? black.name : '等待加入…';
  }

  function updatePlayerBars(_myColor, _isSpectator) {
    // 侧栏上下对调由 CSS `.board-flipped` 处理；这里只负责把被旧逻辑拆散的结构恢复回来
    restoreBoardChrome();
  }

  function restoreBoardChrome() {
    const boardColumn = document.querySelector('.board-column');
    if (!boardColumn) return;

    const blackBar = document.getElementById('blackBar');
    const redBar = document.getElementById('redBar');
    const boardWrapper =
      boardColumn.querySelector('.board-wrapper') ||
      (document.getElementById('chessBoard') && document.getElementById('chessBoard').parentElement);
    if (!blackBar || !redBar || !boardWrapper) return;

    let statusEl = document.getElementById('gameStatus');
    let rails = boardColumn.querySelector('.player-rails');
    let boardRow = boardColumn.querySelector('.board-row');
    let statusRow = boardColumn.querySelector('.match-status-row');
    let boardStage = boardColumn.querySelector('.board-stage');

    const structureOk = !!(
      rails &&
      boardRow &&
      statusRow &&
      boardStage &&
      statusEl &&
      blackBar.parentElement === rails &&
      redBar.parentElement === rails &&
      boardWrapper.parentElement === boardStage
    );
    if (structureOk) {
      // 固定 DOM 顺序：黑在上、红在下；执黑视角用 CSS column-reverse
      if (rails.firstElementChild !== blackBar) rails.insertBefore(blackBar, redBar);
      if (rails.lastElementChild !== redBar) rails.appendChild(redBar);
      return;
    }

    if (!statusEl) {
      statusEl = document.createElement('span');
      statusEl.id = 'gameStatus';
      statusEl.className = 'game-status normal';
      statusEl.textContent = '等待对手加入';
    }

    statusRow = document.createElement('div');
    statusRow.className = 'match-status-row';
    statusRow.appendChild(statusEl);

    rails = document.createElement('aside');
    rails.className = 'player-rails';
    rails.setAttribute('aria-label', '对局信息');
    rails.appendChild(blackBar);
    rails.appendChild(redBar);

    boardStage = document.createElement('div');
    boardStage.className = 'board-stage';
    boardStage.appendChild(boardWrapper);

    boardRow = document.createElement('div');
    boardRow.className = 'board-row';
    boardRow.appendChild(rails);
    boardRow.appendChild(boardStage);

    boardColumn.innerHTML = '';
    boardColumn.appendChild(statusRow);
    boardColumn.appendChild(boardRow);

    requestAnimationFrame(() => {
      if (typeof ChessBoard !== 'undefined' && ChessBoard.resize) {
        ChessBoard.resize();
        if (typeof ChessGame !== 'undefined' && ChessGame.getState) {
          ChessBoard.render(ChessGame.getState());
        }
      }
    });
  }

  function updateTurnUI(currentTurn, inCheck) {
    const redTurn = document.getElementById('redTurn');
    const blackTurn = document.getElementById('blackTurn');
    const statusEl = document.getElementById('gameStatus');

    if (redTurn) {
      redTurn.textContent = currentTurn === 'red' ? '走棋中' : '等待中';
      redTurn.className = 'turn-indicator' + (currentTurn === 'red' ? ' active' : '');
    }
    if (blackTurn) {
      blackTurn.textContent = currentTurn === 'black' ? '走棋中' : '等待中';
      blackTurn.className = 'turn-indicator' + (currentTurn === 'black' ? ' active' : '');
    }

    if (!statusEl) return;
    if (typeof ChessGame !== 'undefined' && ChessGame.isInSandbox && ChessGame.isInSandbox()) {
      // 沙盘倒计时在顶部禅意条展示，此处不再重复
      return;
    }
    const state = GameState.getState();
    const prefix = state.isSpectator ? '观战 | ' : '';
    if (inCheck) {
      statusEl.textContent = prefix + '将军！';
      statusEl.className = 'game-status check';
    } else if (state.status === 'playing') {
      statusEl.textContent = prefix + (currentTurn === 'red' ? '红方走棋' : '黑方走棋');
      statusEl.className = 'game-status normal';
    }
  }

  function updateSpectatorCount(count) {
    const badge = document.getElementById('spectatorBadge');
    if (!badge) return;
    if (count > 0) {
      badge.hidden = false;
      const countEl = document.getElementById('spectatorCount');
      if (countEl) countEl.textContent = count;
    } else {
      badge.hidden = true;
    }
  }

  return { enter, updateTurnUI, updatePlayerNames, updateSpectatorCount };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameView;
}
