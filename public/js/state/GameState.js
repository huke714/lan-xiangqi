// 游戏全局状态管理 — 单一数据源
const GameState = (() => {
  const state = {
    board: null,
    currentTurn: null,
    myColor: null,
    isSpectator: false,
    selectedPos: null,
    validMoves: [],
    lastMove: null,
    inCheck: false,
    status: 'idle',
    winner: null,
    moveHistory: [],
    roomId: null,
    playerCount: 0,
    timer: {
      red: 600,
      black: 600,
      activeColor: null,
      running: false
    }
  };

  const listeners = new Set();

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    const snapshot = getState();
    listeners.forEach(fn => {
      try { fn(snapshot); } catch (e) { console.error(e); }
    });
  }

  function getState() {
    return Object.assign({}, state, {
      timer: Object.assign({}, state.timer)
    });
  }

  function set(partial) {
    if (!partial || typeof partial !== 'object') return;
    Object.keys(partial).forEach(key => {
      if (key === 'timer') {
        state.timer = Object.assign({}, state.timer, partial.timer);
      } else {
        state[key] = partial[key];
      }
    });
    notify();
  }

  function reset() {
    state.board = typeof ChessRules !== 'undefined' && ChessRules.cloneBoard ? ChessRules.cloneBoard(INITIAL_BOARD) : null;
    state.currentTurn = null;
    state.myColor = null;
    state.isSpectator = false;
    state.selectedPos = null;
    state.validMoves = [];
    state.lastMove = null;
    state.inCheck = false;
    state.status = 'idle';
    state.winner = null;
    state.moveHistory = [];
    state.roomId = null;
    state.playerCount = 0;
    state.timer = { red: 600, black: 600, activeColor: null, running: false };
    notify();
  }

  function syncBoard(board, currentTurn, lastMove, moveHistory) {
    state.board = board.map(row => row.map(cell => cell ? Object.assign({}, cell) : null));
    state.currentTurn = currentTurn;
    state.lastMove = lastMove ? Object.assign({}, lastMove) : null;
    state.moveHistory = moveHistory ? moveHistory.map(m => Object.assign({}, m)) : [];
    state.selectedPos = null;
    state.validMoves = [];
    notify();
  }

  return { getState, set, reset, subscribe, syncBoard };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameState;
}
