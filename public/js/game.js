// 游戏状态管理
const ChessGame = (() => {
  let state = {
    board: null,
    currentTurn: RED,
    myColor: null,
    isSpectator: false,
    selectedPos: null,
    validMoves: [],
    lastMove: null,
    inCheck: false,
    status: 'waiting',
    winner: null,
    moveHistory: [],
    roomId: null,
    playerCount: 0,
  };

  // 棋盘快照栈（用于悔棋）
  let boardStack = [];

  // 走子去重：防止服务器广播回本地已应用的走子
  let appliedMoveKeys = new Set();

  let onStateChange = null;
  let onMoveMade = null;

  // 棋钟
  let timerInterval = null;
  let timeControlSeconds = typeof DEFAULT_TIME_CONTROL !== 'undefined' ? DEFAULT_TIME_CONTROL : 600;
  let redTime = timeControlSeconds;
  let blackTime = timeControlSeconds;
  let timeIncrement = 0;
  let activeTimerColor = RED;
  let timerRunning = false;
  let timeoutReported = false;
  // 已触发过的时限提醒档位，避免重复打扰
  let timeWarnFired = { red: Object.create(null), black: Object.create(null) };

  // 沙盘推演（默认 2 分钟；计时对局须在结束前保留 30 秒，强制退出）
  const DEFAULT_SANDBOX_SECONDS = 120;
  const SANDBOX_TIME_RESERVE = 30;
  let isSandbox = false;
  let sandboxSnapshot = null;
  let sandboxTimerId = null;
  let sandboxRemaining = 0;
  let sandboxDuration = DEFAULT_SANDBOX_SECONDS;
  let onSandboxTick = null;
  let onSandboxExpire = null;
  let sandboxRedoStack = [];
  let sandboxBaseHistoryLen = 0;
  let sandboxAwaitingOwnTurn = false;

  const TIME_WARN_SOFT = 60;     // 剩余 ≤60 秒：轻提醒
  const TIME_WARN_URGENT = 30;   // 剩余 ≤30 秒：加强
  const TIME_WARN_CRITICAL = 10; // 剩余 ≤10 秒：紧急闪烁

  function resetTimeWarnState() {
    timeWarnFired = { red: Object.create(null), black: Object.create(null) };
  }

  function setTimeControl(seconds) {
    const sec = parseInt(seconds, 10);
    timeControlSeconds = Number.isFinite(sec) && sec >= 0 ? sec : 600;
    redTime = timeControlSeconds;
    blackTime = timeControlSeconds;
    activeTimerColor = RED;
    timeoutReported = false;
    resetTimeWarnState();
    stopTimer();
    updateTimerDisplay();
  }

  function getTimeControl() {
    return timeControlSeconds;
  }

  function resolveLiveTurnColor() {
    if (isSandbox && sandboxSnapshot && sandboxSnapshot.state) {
      return sandboxSnapshot.state.currentTurn === BLACK ? BLACK : RED;
    }
    return state.currentTurn === BLACK ? BLACK : RED;
  }

  function syncActiveTimerToTurn(turn) {
    activeTimerColor = turn === BLACK ? BLACK : RED;
    return activeTimerColor;
  }

  function tickActiveClock() {
    const color = syncActiveTimerToTurn(resolveLiveTurnColor());
    if (color === RED) {
      redTime--;
      if (redTime <= 0) { redTime = 0; handleTimeOut(RED); }
    } else {
      blackTime--;
      if (blackTime <= 0) { blackTime = 0; handleTimeOut(BLACK); }
    }
    updateTimerDisplay();
  }

  function switchTimer() {
    if (!timeControlSeconds) return;
    if (activeTimerColor === RED) redTime += timeIncrement;
    else blackTime += timeIncrement;
    syncActiveTimerToTurn(state.currentTurn);
    updateTimerDisplay();
  }

  function startTimer() {
    stopTimer();
    timeoutReported = false;
    resetTimeWarnState();
    syncActiveTimerToTurn(state.currentTurn);
    if (!timeControlSeconds) {
      updateTimerDisplay();
      return;
    }
    timerRunning = true;
    timerInterval = setInterval(() => {
      if (!timerRunning) return;
      tickActiveClock();
    }, 1000);
    updateTimerDisplay();
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerRunning = false;
    clearTimeWarnUI();
  }

  function cloneMoveHistory(history) {
    return (history || []).map(m => ({
      from: m.from ? { ...m.from } : null,
      to: m.to ? { ...m.to } : null,
      piece: m.piece ? { ...m.piece } : null,
      captured: m.captured ? { ...m.captured } : null,
      notation: m.notation,
      isCheck: !!m.isCheck,
      isCheckmate: !!m.isCheckmate,
    }));
  }

  function takeLiveSnapshot() {
    return {
      state: {
        board: ChessRules.cloneBoard(state.board),
        currentTurn: state.currentTurn,
        myColor: state.myColor,
        isSpectator: state.isSpectator,
        selectedPos: null,
        validMoves: [],
        lastMove: state.lastMove
          ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to }, color: state.lastMove.color }
          : null,
        inCheck: state.inCheck,
        status: state.status,
        winner: state.winner,
        moveHistory: cloneMoveHistory(state.moveHistory),
        roomId: state.roomId,
        playerCount: state.playerCount,
      },
      boardStack: boardStack.map(s => ({
        board: ChessRules.cloneBoard(s.board),
        currentTurn: s.currentTurn,
        lastMove: s.lastMove
          ? { from: { ...s.lastMove.from }, to: { ...s.lastMove.to }, color: s.lastMove.color }
          : null,
        inCheck: s.inCheck,
      })),
      redTime,
      blackTime,
      activeTimerColor,
      timerRunning,
      timeoutReported,
    };
  }

  function restoreLiveSnapshot(snap) {
    if (!snap) return;
    state = {
      ...snap.state,
      board: ChessRules.cloneBoard(snap.state.board),
      selectedPos: null,
      validMoves: [],
      lastMove: snap.state.lastMove
        ? {
            from: { ...snap.state.lastMove.from },
            to: { ...snap.state.lastMove.to },
            color: snap.state.lastMove.color,
          }
        : null,
      moveHistory: cloneMoveHistory(snap.state.moveHistory),
    };
    boardStack = (snap.boardStack || []).map(s => ({
      board: ChessRules.cloneBoard(s.board),
      currentTurn: s.currentTurn,
      lastMove: s.lastMove
        ? { from: { ...s.lastMove.from }, to: { ...s.lastMove.to }, color: s.lastMove.color }
        : null,
      inCheck: s.inCheck,
    }));
    redTime = snap.redTime;
    blackTime = snap.blackTime;
    activeTimerColor = snap.activeTimerColor;
    timeoutReported = !!snap.timeoutReported;
    ChessBoard.clearDrag();
    ChessBoard.clearFlightAnims();
    ChessBoard.clearCaptureAnims();
    updateTimerDisplay();
    notifyChange();
  }

  function clearSandboxTimer() {
    if (sandboxTimerId) {
      clearInterval(sandboxTimerId);
      sandboxTimerId = null;
    }
  }

  function getMyRemainingTime() {
    if (!state.myColor) return 0;
    if (!timeControlSeconds) return Infinity;
    return state.myColor === RED ? redTime : blackTime;
  }

  function canEnterSandbox() {
    if (isSandbox) return false;
    if (state.status !== 'playing' || state.isSpectator) return false;
    if (!state.myColor) return false;
    if (timeControlSeconds > 0) {
      if (getMyRemainingTime() <= SANDBOX_TIME_RESERVE) return false;
    }
    return true;
  }

  function resolveSandboxDuration() {
    if (!timeControlSeconds) return 0;
    let sec = DEFAULT_SANDBOX_SECONDS;
    const rem = Math.floor(getMyRemainingTime());
    sec = Math.min(sec, Math.max(0, rem - SANDBOX_TIME_RESERVE));
    return sec;
  }

  function startSandboxCountdown() {
    if (!isSandbox || sandboxTimerId) return false;
    if (!timeControlSeconds || sandboxDuration <= 0) return false;
    clearSandboxTimer();
    sandboxTimerId = setInterval(() => {
      if (!isSandbox) return;
      sandboxRemaining -= 1;
      if (onSandboxTick) onSandboxTick(sandboxRemaining, sandboxDuration);
      if (sandboxRemaining <= 0) {
        clearSandboxTimer();
        if (onSandboxExpire) onSandboxExpire();
        else exitSandbox();
      }
    }, 1000);
    if (onSandboxTick) onSandboxTick(sandboxRemaining, sandboxDuration);
    return true;
  }

  function syncLiveClockIntoSnapshot() {
    if (!sandboxSnapshot) return;
    sandboxSnapshot.redTime = redTime;
    sandboxSnapshot.blackTime = blackTime;
    sandboxSnapshot.activeTimerColor = activeTimerColor;
    sandboxSnapshot.timerRunning = timerRunning;
  }

  function maybeStartSandboxTimerOnOwnTurn() {
    if (!isSandbox || !sandboxAwaitingOwnTurn) return false;
    if (!state.myColor) return false;
    const liveTurn = sandboxSnapshot && sandboxSnapshot.state
      ? sandboxSnapshot.state.currentTurn
      : state.currentTurn;
    if (liveTurn !== state.myColor) return false;

    sandboxAwaitingOwnTurn = false;
    syncLiveClockIntoSnapshot();
    stopTimer();

    if (!timeControlSeconds) {
      sandboxDuration = 0;
      sandboxRemaining = 0;
      if (onSandboxTick) onSandboxTick(0, 0);
      return true;
    }

    sandboxDuration = resolveSandboxDuration();
    sandboxRemaining = sandboxDuration;
    if (sandboxDuration <= 0) {
      if (onSandboxTick) onSandboxTick(0, 0);
      if (onSandboxExpire) onSandboxExpire();
      else exitSandbox();
      return false;
    }
    startSandboxCountdown();
    return true;
  }

  function enterSandbox(hooks) {
    if (!canEnterSandbox()) return false;
    const unlimited = !timeControlSeconds;
    const onOwnTurn = state.currentTurn === state.myColor;
    const sec = resolveSandboxDuration();
    if (!unlimited && onOwnTurn && sec <= 0) return false;

    sandboxDuration = unlimited ? 0 : (onOwnTurn ? sec : resolveSandboxDuration());
    sandboxRemaining = sandboxDuration;
    sandboxSnapshot = takeLiveSnapshot();
    isSandbox = true;
    boardStack = [];
    sandboxRedoStack = [];
    sandboxBaseHistoryLen = state.moveHistory.length;
    sandboxAwaitingOwnTurn = false;
    clearSelection();
    onSandboxTick = hooks && hooks.onTick ? hooks.onTick : null;
    onSandboxExpire = hooks && hooks.onExpire ? hooks.onExpire : null;
    clearSandboxTimer();

    if (unlimited) {
      if (onSandboxTick) onSandboxTick(0, 0);
    } else if (onOwnTurn) {
      stopTimer();
      startSandboxCountdown();
    } else {
      sandboxAwaitingOwnTurn = true;
      if (onSandboxTick) onSandboxTick(sandboxRemaining, sandboxDuration);
    }

    notifyChange();
    return true;
  }

  function exitSandbox() {
    if (!isSandbox) return false;
    clearSandboxTimer();
    const snap = sandboxSnapshot;
    const wasAwaiting = sandboxAwaitingOwnTurn;
    isSandbox = false;
    sandboxSnapshot = null;
    sandboxRemaining = 0;
    sandboxRedoStack = [];
    sandboxBaseHistoryLen = 0;
    sandboxAwaitingOwnTurn = false;
    onSandboxTick = null;
    onSandboxExpire = null;

    if (wasAwaiting && snap) {
      snap.redTime = redTime;
      snap.blackTime = blackTime;
      snap.activeTimerColor = activeTimerColor;
      snap.timerRunning = timerRunning;
    }

    const shouldResume = snap && snap.timerRunning && snap.state.status === 'playing';
    const keepLiveTimer = wasAwaiting && timerRunning;
    restoreLiveSnapshot(snap);
    if (keepLiveTimer) {
      updateTimerDisplay();
      return true;
    }
    if (shouldResume && timeControlSeconds > 0) {
      syncActiveTimerToTurn(state.currentTurn);
      timerRunning = true;
      timerInterval = setInterval(() => {
        if (!timerRunning || isSandbox) return;
        tickActiveClock();
      }, 1000);
      updateTimerDisplay();
    }
    return true;
  }

  function isInSandbox() {
    return isSandbox;
  }

  function getSandboxRemaining() {
    return sandboxRemaining;
  }

  function getSandboxDuration() {
    return sandboxDuration;
  }

  function getLiveViewState() {
    if (isSandbox && sandboxSnapshot && sandboxSnapshot.state) {
      return {
        board: sandboxSnapshot.state.board,
        currentTurn: sandboxSnapshot.state.currentTurn,
        lastMove: sandboxSnapshot.state.lastMove,
        inCheck: sandboxSnapshot.state.inCheck,
        selectedPos: null,
        validMoves: [],
        status: sandboxSnapshot.state.status,
        myColor: sandboxSnapshot.state.myColor,
        isSpectator: true,
      };
    }
    return getState();
  }

  function applyLiveMoveToSnapshot(from, to) {
    if (!isSandbox || !sandboxSnapshot) return;
    if (sandboxAwaitingOwnTurn) syncLiveClockIntoSnapshot();
    const snap = sandboxSnapshot;
    const board = snap.state.board;
    const piece = ChessRules.getPiece(board, from.row, from.col);
    if (!piece) return;

    snap.boardStack.push({
      board: ChessRules.cloneBoard(board),
      currentTurn: snap.state.currentTurn,
      lastMove: snap.state.lastMove
        ? { from: { ...snap.state.lastMove.from }, to: { ...snap.state.lastMove.to }, color: snap.state.lastMove.color }
        : null,
      inCheck: snap.state.inCheck,
    });

    const captured = ChessRules.getPiece(board, to.row, to.col);
    const baseNotation = getMoveNotation(board, from, to);
    snap.state.board = ChessRules.applyMove(board, from, to);
    const result = ChessRules.getMoveResult(snap.state.board, piece.color);
    const isCheck = result === 'check' || result === 'checkmate';
    const isCheckmate = result === 'checkmate';
    let notation = baseNotation;
    if (isCheckmate) notation += '#';
    else if (isCheck) notation += '+';

    snap.state.lastMove = { from: { ...from }, to: { ...to }, color: piece.color };
    snap.state.moveHistory.push({
      from: { ...from },
      to: { ...to },
      piece: { ...piece },
      captured: captured ? { ...captured } : null,
      notation,
      isCheck,
      isCheckmate,
    });

    if (isCheckmate) {
      snap.state.inCheck = true;
      snap.state.status = 'ended';
      snap.state.winner = piece.color;
    } else if (result === 'stalemate') {
      snap.state.inCheck = false;
      snap.state.status = 'ended';
      snap.state.winner = null;
    } else {
      snap.state.inCheck = isCheck;
      snap.state.currentTurn = snap.state.currentTurn === RED ? BLACK : RED;
      if (timeControlSeconds) {
        if (snap.activeTimerColor === RED) snap.redTime += timeIncrement;
        else snap.blackTime += timeIncrement;
        snap.activeTimerColor = snap.state.currentTurn === BLACK ? BLACK : RED;
      }
      if (sandboxAwaitingOwnTurn) {
        redTime = snap.redTime;
        blackTime = snap.blackTime;
        syncActiveTimerToTurn(snap.state.currentTurn);
      }
    }
    maybeStartSandboxTimerOnOwnTurn();
  }

  function applyLiveUndoToSnapshot(board, currentTurn, lastMove, moveHistory) {
    if (!isSandbox || !sandboxSnapshot) return;
    const snap = sandboxSnapshot;
    snap.state.board = ChessRules.cloneBoard(board);
    snap.state.currentTurn = currentTurn;
    snap.state.lastMove = lastMove
      ? { from: { ...lastMove.from }, to: { ...lastMove.to }, color: lastMove.color }
      : null;
    snap.state.moveHistory = hydrateMoveHistory(moveHistory);
    snap.state.selectedPos = null;
    snap.state.validMoves = [];
    snap.state.status = 'playing';
    snap.state.winner = null;
    snap.state.inCheck = false;
    snap.boardStack = [];
    snap.activeTimerColor = currentTurn === BLACK ? BLACK : RED;
    if (sandboxAwaitingOwnTurn) syncActiveTimerToTurn(currentTurn);
  }

  function markLiveGameOverOnSnapshot(winner) {
    if (!isSandbox || !sandboxSnapshot) return;
    sandboxSnapshot.state.status = 'ended';
    sandboxSnapshot.state.winner = winner;
    sandboxSnapshot.timerRunning = false;
  }

  function resetSandboxState() {
    clearSandboxTimer();
    isSandbox = false;
    sandboxSnapshot = null;
    sandboxRemaining = 0;
    sandboxRedoStack = [];
    sandboxBaseHistoryLen = 0;
    sandboxAwaitingOwnTurn = false;
    onSandboxTick = null;
    onSandboxExpire = null;
  }

  function cloneStackFrame(frame) {
    if (!frame) return null;
    return {
      board: ChessRules.cloneBoard(frame.board),
      currentTurn: frame.currentTurn,
      lastMove: frame.lastMove
        ? { from: { ...frame.lastMove.from }, to: { ...frame.lastMove.to }, color: frame.lastMove.color }
        : null,
      inCheck: !!frame.inCheck,
      move: frame.move ? {
        from: frame.move.from ? { ...frame.move.from } : null,
        to: frame.move.to ? { ...frame.move.to } : null,
        piece: frame.move.piece ? { ...frame.move.piece } : null,
        captured: frame.move.captured ? { ...frame.move.captured } : null,
        notation: frame.move.notation,
        isCheck: !!frame.move.isCheck,
        isCheckmate: !!frame.move.isCheckmate,
      } : null,
    };
  }

  function canSandboxStepBack() {
    return isSandbox
      && boardStack.length > 0
      && state.moveHistory.length > sandboxBaseHistoryLen;
  }

  function canSandboxStepForward() {
    return isSandbox && sandboxRedoStack.length > 0;
  }

  function getSandboxExploreHistory() {
    if (!isSandbox) return [];
    return cloneMoveHistory(state.moveHistory.slice(sandboxBaseHistoryLen));
  }

  function sandboxStepBack() {
    if (!canSandboxStepBack()) return false;
    const lastMove = state.moveHistory[state.moveHistory.length - 1];
    sandboxRedoStack.push(cloneStackFrame({
      board: state.board,
      currentTurn: state.currentTurn,
      lastMove: state.lastMove,
      inCheck: state.inCheck,
      move: lastMove,
    }));
    const ok = undoMove();
    if (!ok) {
      sandboxRedoStack.pop();
      return false;
    }
    ChessBoard.clearDrag();
    ChessBoard.clearFlightAnims();
    ChessBoard.clearCaptureAnims();
    return true;
  }

  function sandboxStepForward() {
    if (!canSandboxStepForward()) return false;
    const next = sandboxRedoStack.pop();
    if (!next || !next.move) {
      if (next) sandboxRedoStack.push(next);
      return false;
    }
    boardStack.push({
      board: ChessRules.cloneBoard(state.board),
      currentTurn: state.currentTurn,
      lastMove: state.lastMove
        ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to }, color: state.lastMove.color }
        : null,
      inCheck: state.inCheck,
    });
    state.board = ChessRules.cloneBoard(next.board);
    state.currentTurn = next.currentTurn;
    state.lastMove = next.lastMove
      ? { from: { ...next.lastMove.from }, to: { ...next.lastMove.to }, color: next.lastMove.color }
      : null;
    state.inCheck = !!next.inCheck;
    state.moveHistory.push({
      from: next.move.from ? { ...next.move.from } : null,
      to: next.move.to ? { ...next.move.to } : null,
      piece: next.move.piece ? { ...next.move.piece } : null,
      captured: next.move.captured ? { ...next.move.captured } : null,
      notation: next.move.notation,
      isCheck: !!next.move.isCheck,
      isCheckmate: !!next.move.isCheckmate,
    });
    state.selectedPos = null;
    state.validMoves = [];
    state.status = 'playing';
    state.winner = null;
    ChessBoard.clearDrag();
    ChessBoard.clearFlightAnims();
    ChessBoard.clearCaptureAnims();
    notifyChange();
    return true;
  }

  function clearTimeWarnUI() {
    ['red', 'black'].forEach(c => {
      const bar = document.getElementById(c + 'Bar');
      if (bar) bar.classList.remove('time-soft', 'time-urgent', 'time-critical', 'time-active-low');
      const tip = document.getElementById(c + 'TimeWarnTip');
      if (tip) tip.remove();
    });
  }

  function handleTimeOut(color) {
    stopTimer();
    if (timeoutReported) return;
    timeoutReported = true;
    if (typeof NetworkService !== 'undefined' && NetworkService.send) {
      // color = 超时方（判负），对方获胜
      NetworkService.send('timeOut', { color });
    } else {
      // 无网络时本地结算
      state.status = 'ended';
      const loser = color;
      state.winner = loser === RED ? BLACK : RED;
      const loserName = loser === RED ? '红方' : '黑方';
      const winnerName = state.winner === RED ? '红方' : '黑方';
      document.getElementById('gameStatus').textContent = loserName + '超时判负';
      document.getElementById('gameStatus').className = 'game-status ended';
      showGameResultBanner(winnerName + '胜', loserName + '超时判负');
      setTimeout(() => {
        document.getElementById('modalTitle').textContent = winnerName + '胜';
        document.getElementById('modalMessage').textContent = loserName + '超时判负';
        document.getElementById('gameOverModal').classList.add('active');
      }, 1500);
      if (state.winner === state.myColor) ChessAudio.win();
      else ChessAudio.lose();
    }
  }

  function maybeFireTimeWarn(color, time) {
    if (!timerRunning || !timeControlSeconds || time <= 0) return;
    const levels = [
      { at: TIME_WARN_SOFT, key: 'soft', label: '不足 1 分钟' },
      { at: TIME_WARN_URGENT, key: 'urgent', label: '不足 30 秒' },
      { at: TIME_WARN_CRITICAL, key: 'critical', label: '不足 10 秒' },
      { at: 5, key: 'final', label: '即将超时' }
    ];
    const fired = timeWarnFired[color];
    levels.forEach(level => {
      if (time > level.at || fired[level.key]) return;
      // 只在该方正在用时时提醒；未轮到则等轮到再提醒
      if (color !== activeTimerColor) return;
      fired[level.key] = true;
      const isMine = state.myColor === color;
      const sideName = color === RED ? '红方' : '黑方';
      const msg = isMine ? ('你的用时' + level.label) : (sideName + '用时' + level.label);
      if (typeof Modals !== 'undefined' && Modals.showToast) {
        Modals.showToast(msg, level.key === 'soft' ? 'info' : 'error');
      }
      if (isMine && typeof ChessAudio !== 'undefined') {
        if (level.key === 'soft') ChessAudio.timeWarn();
        else ChessAudio.timeUrgent();
      }
    });
  }

  function ensureTimeWarnTip(bar, color, level) {
    let tip = document.getElementById(color + 'TimeWarnTip');
    if (level === 'none') {
      if (tip) tip.remove();
      return;
    }
    if (!bar) return;
    if (!tip) {
      tip = document.createElement('span');
      tip.id = color + 'TimeWarnTip';
      tip.className = 'time-warn-tip';
      const right = bar.querySelector('.player-bar-right');
      if (right) right.insertBefore(tip, right.firstChild);
      else bar.appendChild(tip);
    }
    tip.textContent = level === 'critical' ? '时限将尽' : (level === 'urgent' ? '时间紧张' : '时限提醒');
    tip.className = 'time-warn-tip tip-' + level;
  }

  function updateTimerDisplay() {
    ['red', 'black'].forEach(c => {
      const time = c === 'red' ? redTime : blackTime;
      const el = document.getElementById(c + 'Timer');
      const bar = document.getElementById(c + 'Bar');
      if (!el) return;

      if (!timeControlSeconds) {
        el.textContent = '∞';
        el.className = 'timer-display';
        if (bar) bar.classList.remove('time-soft', 'time-urgent', 'time-critical', 'time-active-low');
        ensureTimeWarnTip(bar, c, 'none');
        return;
      }

      const m = Math.floor(time / 60);
      const s = time % 60;
      el.textContent = m + ':' + String(s).padStart(2, '0');
      el.className = 'timer-display';

      let level = 'none';
      if (time <= TIME_WARN_CRITICAL) {
        el.classList.add('timer-critical');
        level = 'critical';
      } else if (time <= TIME_WARN_URGENT) {
        el.classList.add('timer-urgent');
        level = 'urgent';
      } else if (time <= TIME_WARN_SOFT) {
        el.classList.add('timer-warning');
        level = 'soft';
      }

      if (bar) {
        bar.classList.remove('time-soft', 'time-urgent', 'time-critical', 'time-active-low');
        if (level !== 'none') {
          bar.classList.add('time-' + (level === 'soft' ? 'soft' : level));
          if (c === activeTimerColor && timerRunning) bar.classList.add('time-active-low');
        }
      }
      ensureTimeWarnTip(bar, c, level);
      maybeFireTimeWarn(c, time);
    });
  }

  function showGameResultBanner(title, message) {
    const wrapper = document.querySelector('.board-wrapper');
    if (!wrapper) return;
    const old = wrapper.querySelector('.check-banner');
    if (old) old.remove();
    const banner = document.createElement('div');
    banner.className = 'check-banner result-banner';
    banner.innerHTML = title + '<br><small>' + message + '</small>';
    wrapper.appendChild(banner);
  }

  function rebuildMoveList(history) {
    if (typeof MoveListView !== 'undefined' && MoveListView.rebuild) {
      MoveListView.rebuild(history);
      return;
    }
    const moveList = document.getElementById('moveList');
    if (!moveList) return;
    moveList.innerHTML = '';
    for (let i = 0; i < history.length; i += 2) {
      const round = document.createElement('div');
      round.className = 'move-round';
      const idx = document.createElement('div');
      idx.className = 'move-idx';
      idx.textContent = String(Math.floor(i / 2) + 1);
      round.appendChild(idx);
      const red = history[i];
      const redDiv = document.createElement('div');
      redDiv.className = 'move-ply move-red' + (i === history.length - 1 ? ' is-latest' : '');
      redDiv.textContent = (red && red.notation) || '—';
      round.appendChild(redDiv);
      if (i + 1 < history.length) {
        const black = history[i + 1];
        const blackDiv = document.createElement('div');
        blackDiv.className = 'move-ply move-black' + (i + 1 === history.length - 1 ? ' is-latest' : '');
        blackDiv.textContent = (black && black.notation) || '—';
        round.appendChild(blackDiv);
      } else {
        const empty = document.createElement('div');
        empty.className = 'move-ply move-empty';
        round.appendChild(empty);
      }
      moveList.appendChild(round);
    }
    moveList.scrollTop = moveList.scrollHeight;
  }

  function init(callbacks) {
    onStateChange = callbacks.onStateChange || (() => {});
    onMoveMade = callbacks.onMoveMade || (() => {});
    resetBoard();
  }

  function resetBoard() {
    state.board = ChessRules.cloneBoard(INITIAL_BOARD);
    state.currentTurn = RED;
    state.selectedPos = null;
    state.validMoves = [];
    state.lastMove = null;
    state.inCheck = false;
    state.status = 'waiting';
    state.winner = null;
    state.moveHistory = [];
    boardStack = [];
    // 重置棋钟
    redTime = timeControlSeconds;
    blackTime = timeControlSeconds;
    activeTimerColor = RED;
    timeoutReported = false;
    resetTimeWarnState();
    stopTimer();
    updateTimerDisplay();
    notifyChange();
  }

  function setMyColor(color) {
    state.myColor = color;
    notifyChange();
  }

  function setSpectator(isSpectator) {
    state.isSpectator = isSpectator;
    notifyChange();
  }

  function syncBoard(board, currentTurn, lastMove, moveHistory) {
    state.board = board.map(row => row.map(cell => cell ? { ...cell } : null));
    state.currentTurn = currentTurn;
    state.lastMove = lastMove;
    state.moveHistory = hydrateMoveHistory(moveHistory || []);
    state.selectedPos = null;
    state.validMoves = [];
    // 重建 boardStack（简化：只保留当前状态）
    boardStack = [];
    syncActiveTimerToTurn(currentTurn);
    notifyChange();
  }

  function setStatus(status) {
    state.status = status;
    notifyChange();
  }

  function setWinner(winner) {
    state.winner = winner;
    notifyChange();
  }

  function setRoomInfo(roomId, playerCount) {
    state.roomId = roomId;
    state.playerCount = playerCount;
    notifyChange();
  }

  function getState() {
    return { ...state };
  }

  function notifyChange() {
    if (onStateChange) onStateChange(getState());
  }

  // ===== 标准象棋棋谱记谱 =====
  // 格式：棋子名 + 起始列号 + 动作(进/退/平) + 目标(列号或步数)
  // 红方用中文数字（一~九，从右到左），黑方用阿拉伯数字（1~9，从右到左）
  function getMoveNotation(board, from, to) {
    const piece = ChessRules.getPiece(board, from.row, from.col);
    if (!piece) return '';

    const name = PIECE_NAMES[piece.color] && PIECE_NAMES[piece.color][piece.type];
    if (!name) return '';
    const isRed = piece.color === RED;

    // 列号：红方从右到左 一~九，黑方从右到左 1~9
    const colToNum = (col, color) => {
      const n = 9 - col; // 从左到右 9,8,7...1 → 从右到左 1,2,3...9
      if (color === RED) {
        return ['零','一','二','三','四','五','六','七','八','九'][n];
      }
      return String(n);
    };

    const fromNum = colToNum(from.col, piece.color);

    // 判断走法类型
    if (from.col === to.col) {
      // 平移（直线走，同列）→ 进/退 + 步数
      const forward = isRed ? (from.row > to.row) : (from.row < to.row);
      const dir = forward ? '进' : '退';
      const steps = Math.abs(to.row - from.row);
      const stepsStr = isRed
        ? ['零','一','二','三','四','五','六','七','八','九'][steps]
        : String(steps);
      return `${name}${fromNum}${dir}${stepsStr}`;
    } else if (from.row === to.row) {
      // 水平移动 → 平 + 目标列号
      const toNum = colToNum(to.col, piece.color);
      return `${name}${fromNum}平${toNum}`;
    } else {
      // 斜向移动（马、象、士等）→ 进/退 + 目标列号
      const forward = isRed ? (from.row > to.row) : (from.row < to.row);
      const dir = forward ? '进' : '退';
      const toNum = colToNum(to.col, piece.color);
      return `${name}${fromNum}${dir}${toNum}`;
    }
  }

  // 为缺少 notation 的历史着法补全棋谱（服务端旧数据 / 悔棋同步）
  function hydrateMoveHistory(rawHistory) {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) return [];
    let board = ChessRules.cloneBoard(INITIAL_BOARD);
    return rawHistory.map((m) => {
      if (!m) return { notation: '—' };
      const from = m.from;
      const to = m.to;
      const pieceOnBoard = from ? ChessRules.getPiece(board, from.row, from.col) : null;
      const piece = m.piece ? { ...m.piece } : (pieceOnBoard ? { ...pieceOnBoard } : null);
      let notation = (typeof m.notation === 'string' && m.notation && m.notation !== 'undefined')
        ? m.notation
        : '';
      if (!notation && from && to && pieceOnBoard) {
        notation = getMoveNotation(board, from, to) || '';
        if (m.isCheckmate) notation += '#';
        else if (m.isCheck) notation += '+';
      }
      if (from && to && pieceOnBoard) {
        board = ChessRules.applyMove(board, from, to);
      }
      return Object.assign({}, m, {
        piece,
        notation: notation || '—',
      });
    });
  }

  // ===== 走棋 =====
  function makeMove(from, to, isLocal) {
    const piece = ChessRules.getPiece(state.board, from.row, from.col);
    if (!piece) return;

    // 强制校验：被将军时只能走解将着；平时也不能送将
    if (!ChessRules.isLegalMove(state.board, from, to)) {
      if (isLocal && typeof Modals !== 'undefined' && Modals.showToast) {
        const msg = state.inCheck || ChessRules.isInCheck(state.board, piece.color)
          ? '已被将军，请先应将'
          : '不能送将';
        Modals.showToast(msg, 'error');
      }
      clearSelection();
      return;
    }

    const captured = ChessRules.getPiece(state.board, to.row, to.col);

    boardStack.push({
      board: ChessRules.cloneBoard(state.board),
      currentTurn: state.currentTurn,
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      inCheck: state.inCheck,
    });
    if (isSandbox) sandboxRedoStack = [];

    // 生成基础棋谱（走子前）
    const baseNotation = getMoveNotation(state.board, from, to);

    // 应用走法
    state.board = ChessRules.applyMove(state.board, from, to);

    // 检查将军/绝杀
    const result = ChessRules.getMoveResult(state.board, piece.color);
    const isCheck = result === 'check' || result === 'checkmate';
    const isCheckmate = result === 'checkmate';
    const isStalemate = result === 'stalemate';

    // 棋谱标记：将军+、绝杀#
    let notation = baseNotation;
    if (isCheckmate) notation += '#';
    else if (isCheck) notation += '+';

    state.lastMove = { from: { ...from }, to: { ...to }, color: piece.color };
    state.moveHistory.push({
      from: { ...from },
      to: { ...to },
      piece: { ...piece },
      captured: captured ? { ...captured } : null,
      notation,
      isCheck,
      isCheckmate,
    });

    // 吃子效果（沙盘与对局共用；动画画在主棋盘上）
    if (captured) {
      ChessBoard.triggerCaptureAnim(to.row, to.col, captured);
      if (isLocal) ChessAudio.capture();
    }

    // 将军/绝杀/困毙效果
    if (isSandbox) {
      // 沙盘仅作推演：不结束对局状态；吃子后照常换手，方便继续试着
      state.inCheck = isCheck;
      state.currentTurn = state.currentTurn === RED ? BLACK : RED;
      if (isLocal) {
        if (!captured) {
          if (isCheck) ChessAudio.check();
          else ChessAudio.move();
        } else if (isCheck) {
          ChessAudio.check();
        }
        ChessBoard.triggerFlightAnim(from.row, from.col, to.row, to.col, piece);
      }
      state.selectedPos = null;
      state.validMoves = [];
      ChessBoard.clearDrag();
      if (isLocal && onMoveMade) onMoveMade(from, to);
      notifyChange();
      return;
    }

    if (isCheckmate) {
      state.inCheck = true;
      state.status = 'ended';
      state.winner = piece.color;
      if (isLocal) ChessAudio.win();
    } else if (isStalemate) {
      state.inCheck = false;
      state.status = 'ended';
      state.winner = null; // 困毙为和棋
    } else if (isCheck) {
      state.inCheck = true;
      if (isLocal) ChessAudio.check();
    } else {
      state.inCheck = false;
      if (isLocal) ChessAudio.move();
    }

    if (result !== 'checkmate' && result !== 'stalemate') {
      state.currentTurn = state.currentTurn === RED ? BLACK : RED;
    }

    // 走子飞行动画
    if (isLocal) {
      ChessBoard.triggerFlightAnim(from.row, from.col, to.row, to.col, piece);
    }

    clearSelection();

    // 切换棋钟
    switchTimer();

    if (isLocal && onMoveMade) {
      onMoveMade(from, to);
    }

    notifyChange();
  }

  function receiveMove(from, to) {
    if (isSandbox) return;
    // 本地已应用的走子会被服务端广播回来；起点无子则跳过，避免重复走子/计时错乱
    const piece = ChessRules.getPiece(state.board, from.row, from.col);
    if (!piece) return;
    makeMove(from, to, false);
  }

  // ===== 悔棋 =====
  // 撤销最后一步（需要双方确认后由服务端调用）
  function undoMove() {
    if (boardStack.length === 0) return false;
    if (state.moveHistory.length === 0) return false;

    const snapshot = boardStack.pop();
    state.board = snapshot.board;
    state.currentTurn = snapshot.currentTurn;
    state.lastMove = snapshot.lastMove;
    state.inCheck = snapshot.inCheck;
    state.moveHistory.pop();
    state.selectedPos = null;
    state.validMoves = [];
    state.status = 'playing';
    state.winner = null;
    syncActiveTimerToTurn(state.currentTurn);

    notifyChange();
    return true;
  }

  // 同步悔棋结果（从网络接收）
  function receiveUndo(board, currentTurn, lastMove, moveHistory) {
    state.board = board.map(row => row.map(cell => cell ? { ...cell } : null));
    state.currentTurn = currentTurn;
    state.lastMove = lastMove;
    state.moveHistory = hydrateMoveHistory(moveHistory || []);
    state.selectedPos = null;
    state.validMoves = [];
    state.status = 'playing';
    state.winner = null;
    state.inCheck = false;

    // 重建 boardStack
    boardStack = [];
    syncActiveTimerToTurn(currentTurn);

    notifyChange();
  }

  // ===== 点击处理 =====
  function handleClick(row, col) {
    if (state.status !== 'playing') {
      if (state.status === 'waiting') {
        Modals.showToast('等待对手加入…', 'info');
      }
      return;
    }

    if (state.isSpectator && !isSandbox) {
      const piece = ChessRules.getPiece(state.board, row, col);
      if (piece) { selectPiece(row, col); }
      else { clearSelection(); }
      return;
    }

    // 沙盘：可推演双方任意子力
    if (isSandbox) {
      const piece = ChessRules.getPiece(state.board, row, col);
      if (state.selectedPos) {
        const isValidTarget = state.validMoves.some(m => m.row === row && m.col === col);
        if (isValidTarget) {
          makeMove(state.selectedPos, { row, col }, true);
          return;
        }
        if (piece) {
          selectPiece(row, col);
          ChessAudio.select();
          return;
        }
        clearSelection();
        return;
      }
      if (piece) {
        selectPiece(row, col);
        ChessAudio.select();
      }
      return;
    }

    if (state.currentTurn !== state.myColor) return;

    const piece = ChessRules.getPiece(state.board, row, col);

    if (state.selectedPos) {
      const isValidTarget = state.validMoves.some(m => m.row === row && m.col === col);
      if (isValidTarget) {
        makeMove(state.selectedPos, { row, col }, true);
        return;
      }
      if (piece && piece.color === state.myColor) {
        selectPiece(row, col);
        return;
      }
      clearSelection();
      return;
    }

    if (piece && piece.color === state.myColor) {
      selectPiece(row, col);
      ChessAudio.select();
    }
  }

  function selectPiece(row, col) {
    const moves = ChessRules.getValidMoves(state.board, row, col);
    // 被将军时点选无法解将的棋子：提示并取消
    if (!isSandbox && state.inCheck && moves.length === 0) {
      if (typeof Modals !== 'undefined' && Modals.showToast) {
        Modals.showToast('此子无法解将，请换子', 'info');
      }
      clearSelection();
      return;
    }
    state.selectedPos = { row, col };
    state.validMoves = moves;
    notifyChange();
  }

  function clearSelection() {
    state.selectedPos = null;
    state.validMoves = [];
    ChessBoard.clearDrag();
    notifyChange();
  }

  // ===== 拖拽走子 =====
  function startDrag(row, col) {
    if (state.status !== 'playing') return null;
    if (state.isSpectator && !isSandbox) return null;
    const piece = ChessRules.getPiece(state.board, row, col);
    if (!piece) return null;

    // 已选中棋子时，点到合法目标（含吃子）不要改选，交给 mouseup / click 完成走子
    if (state.selectedPos && state.validMoves && state.validMoves.length) {
      const isValidTarget = state.validMoves.some(m => m.row === row && m.col === col);
      if (isValidTarget) return null;
    }

    if (!isSandbox) {
      if (state.currentTurn !== state.myColor) return null;
      if (piece.color !== state.myColor) return null;
    }

    selectPiece(row, col);
    if (!state.selectedPos) return null;
    ChessBoard.setDrag(piece, row, col,
      ChessBoard.toPixel(row, col).x,
      ChessBoard.toPixel(row, col).y);
    window._boardDragActive = true;
    return { row, col };
  }

  function updateDrag(px, py) {
    ChessBoard.updateDrag(px, py);
  }

  function endDrag(row, col) {
    const drag = ChessBoard.getDrag();
    if (!drag || !drag.active) return false;

    const fromRow = drag.fromRow;
    const fromCol = drag.fromCol;
    ChessBoard.clearDrag();
    window._boardDragActive = false;

    if (typeof row === 'number' && typeof col === 'number' && row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      const isValidTarget = state.validMoves.some(m => m.row === row && m.col === col);
      if (isValidTarget) {
        makeMove(state.selectedPos || { row: fromRow, col: fromCol }, { row, col }, true);
        return true;
      }
      // 松手仍在原点：保留选中，交给后续 click 处理
      if (row === fromRow && col === fromCol) {
        return false;
      }
    }
    clearSelection();
    return false;
  }

  function isDragging() {
    const drag = ChessBoard.getDrag();
    return drag && drag.active;
  }

  function getMoveHistory() {
    return [...state.moveHistory];
  }

  return {
    init, getState, handleClick, resetBoard, setMyColor, setStatus,
    setRoomInfo, receiveMove, getMoveHistory, clearSelection, makeMove,
    setSpectator, syncBoard, undoMove, receiveUndo,
    startDrag, updateDrag, endDrag, isDragging, rebuildMoveList,
    startTimer, stopTimer, switchTimer, updateTimerDisplay,
    setTimeControl, getTimeControl,
    enterSandbox, exitSandbox, isInSandbox, canEnterSandbox, getSandboxRemaining, getSandboxDuration, getLiveViewState, resetSandboxState,
    applyLiveMoveToSnapshot, applyLiveUndoToSnapshot, markLiveGameOverOnSnapshot,
    sandboxStepBack, sandboxStepForward, canSandboxStepBack, canSandboxStepForward, getSandboxExploreHistory,
    isSandboxAwaitingOwnTurn: () => sandboxAwaitingOwnTurn,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChessGame;
}
