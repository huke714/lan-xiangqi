// 应用主入口
const App = (() => {
  let currentView = 'loading';
  let initialized = false;
  let myName = '';
  let pendingRoomId = null;
  let pendingAction = null;
  let connectionState = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let popupMode = false;
  let popupJoin = null;
  const MAX_RECONNECT = 8;
  let selectedTimeControl = typeof DEFAULT_TIME_CONTROL !== 'undefined' ? DEFAULT_TIME_CONTROL : 600;
  let sandboxLiveDirty = false;
  let pipWindow = null;
  let pipWatchTimer = null;
  let pipActive = false;
  /** 主页正从小窗夺回席位：用于调整 roomResumed 提示文案 */
  let reclaimingPip = false;

  function init() {
    if (initialized) return;
    initialized = true;
    initModules();
    bindNetwork();
    initBoardInteraction();
    bindWindowResize();
    bindLifecycle();
    bindPipBridge();
    initTheme();
  }

  function initModules() {
    LoadingView.init();
    LobbyView.init();
    ChatView.init();
    Controls.init();
    PopupFlow.init();
    initTheme();
  }

  function bindLifecycle() {
    const params = new URLSearchParams(window.location.search);
    popupMode = params.get('popup') === '1';

    if (popupMode) {
      enterPopupMode(params);
      return;
    }

    showView('loading');
    updateLobbyConnStatus('connecting');
    setLobbyActionsEnabled(false);
    fetch('/api/lan-ips').then(r => r.json()).then(data => {
      const el = document.getElementById('serverUrl');
      if (!el) return;
      const port = data.port || 3000;
      const ip = data.preferred || (data.ips && data.ips[0]);
      if (ip) {
        el.textContent = `http://${ip}:${port}`;
        if (data.ips && data.ips.length > 1) {
          el.title = data.ips.map((x) => `http://${x}:${port}`).join('\n');
        }
      } else {
        el.textContent = window.location.origin;
      }
    }).catch(() => {
      const el = document.getElementById('serverUrl');
      if (el) el.textContent = window.location.href;
    });

    // 用 health 区分「页面来源不对」与「实时通道未通」
    fetch('/api/health').then((r) => r.json()).then((data) => {
      if (!data || !data.ok) return;
      if (!NetworkService.isConnected()) {
        // 页面已打到房主，等待 socket；稍后再提示
        setTimeout(() => {
          if (!NetworkService.isConnected() && connectionState !== 'connected') {
            updateLobbyConnStatus('connecting');
          }
        }, 2000);
      }
    }).catch(() => {
      updateLobbyConnStatus('error');
      Modals.showToast('打不开服务，请确认打开的是上方分享地址', 'error');
    });

    NetworkService.connect();

    // 对局中意外刷新由 SessionStore 重连恢复，不再使用浏览器原生 beforeunload 弹窗
  }

  function setPopupJoin(roomId, name, color) {
    popupJoin = { roomId, name, color };
  }

  function enterPopupMode(params) {
    document.body.classList.add('popup-mode');
    showView('game');
    const roomId = params.get('room');
    const color = params.get('color');
    const name = params.get('name') || '玩家';
    // sessionStorage 不跨窗口，必须从 URL 带上 token，才能接续原席位
    const token = params.get('token');
    myName = name;

    if (!roomId) return;

    NetworkService.on('connect', () => {
      if (token) {
        NetworkService.send('reconnectRoom', {
          roomId: String(roomId).toUpperCase(),
          playerToken: token,
          playerName: myName,
        });
        return;
      }
      // 无 token 时兜底：按加入处理（满员会失败）
      NetworkService.send('joinRoom', {
        roomId,
        playerName: myName,
        preferredColor: color || null,
      });
    });
    NetworkService.connect();
  }

  function bindNetwork() {
    NetworkService.on('connect', () => {
      connectionState = 'connected';
      reconnectAttempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      updateLobbyConnStatus('connected');
      setLobbyActionsEnabled(true);
      if (popupMode) return;
      if (tryReconnectSession()) return;
      // 加载页由 LoadingView 控制时长与淡入，此处不抢切大厅
      NetworkService.send('getRoomList');
    });

    NetworkService.on('disconnect', () => {
      connectionState = 'disconnected';
      updateLobbyConnStatus('disconnected');
      setLobbyActionsEnabled(false);
      // NetworkService 已开启自动重连，这里只提示，避免双重定时器抢连
      if (!popupMode) {
        Modals.showToast('连接已断开，正在重连…', 'info');
      }
    });

    NetworkService.on('connect_error', () => {
      connectionState = 'error';
      updateLobbyConnStatus('error');
      setLobbyActionsEnabled(false);
    });

    NetworkService.on('send_failed', (data) => {
      const message = (data && data.message) || '尚未连接到服务器';
      Modals.showToast(message + '。请用浏览器打开上方分享地址，不要另开程序', 'error');
      updateLobbyConnStatus('error');
      setLobbyActionsEnabled(false);
    });

    NetworkService.on('send_queued', (data) => {
      const message = (data && data.message) || '正在连接…';
      Modals.showToast(message, 'info');
      updateLobbyConnStatus('connecting');
    });

    NetworkService.on('error', (data) => {
      const message = data && data.message ? data.message : '网络异常';
      Modals.showToast(message, 'error');
    });

    NetworkService.on('roomCreated', (data) => {
      myName = myName || getPlayerName();
      pendingAction = null;
      pendingRoomId = null;
      if (typeof data.timeControl === 'number') {
        ChessGame.setTimeControl(data.timeControl);
      }
      SessionStore.save({
        roomId: data.roomId,
        playerToken: data.playerToken,
        playerName: myName,
        color: data.color,
        isSpectator: false,
      });
      GameState.set({ myColor: data.color, roomId: data.roomId, playerCount: data.players.length, status: 'waiting' });
      GameView.enter(data.roomId, data.color, data.players, false);
      Modals.showToast('房间已创建', 'success');
    });

    NetworkService.on('roomJoined', (data) => {
      myName = myName || getPlayerName();
      pendingAction = null;
      pendingRoomId = null;
      if (typeof data.timeControl === 'number') {
        ChessGame.setTimeControl(data.timeControl);
      }
      SessionStore.save({
        roomId: data.roomId,
        playerToken: data.playerToken,
        playerName: myName,
        color: data.color,
        isSpectator: false,
      });
      GameState.set({ myColor: data.color, roomId: data.roomId, playerCount: data.players.length });
      GameView.enter(data.roomId, data.color, data.players, false);
      Modals.showToast('加入成功', 'success');
    });

    NetworkService.on('playerJoined', (data) => {
      GameView.updatePlayerNames(data.players);
      GameState.set({ playerCount: data.players.length });
      Modals.showToast(data.playerName + ' 已加入', 'info');
    });

    NetworkService.on('playerLeft', (data) => {
      GameView.updatePlayerNames(data.players);
      Modals.showToast('对手已离开', 'error');
      const s = GameState.getState();
      const statusEl = document.getElementById('gameStatus');
      if (s.status !== 'playing') {
        setStatusText(statusEl, '等待加入');
      } else {
        setStatusText(statusEl, '对手已离开');
        GameState.set({ status: 'ended' });
      }
      resetTurnIndicators();
      BoardOverlay.showCheckBanner();
      Modals.closeGameOverModal();
      const restartBtn = document.getElementById('btnRestart');
      if (restartBtn) restartBtn.style.display = 'none';
    });

    NetworkService.on('gameStart', (data) => {
      if (ChessGame.isInSandbox()) {
        ChessGame.resetSandboxState();
        setSandboxUiActive(false);
        markSandboxLiveDirty(false);
      }
      if (typeof data.timeControl === 'number') {
        ChessGame.setTimeControl(data.timeControl);
      }
      ChessGame.resetBoard();
      MoveListView.rebuild([]);
      const myColor = data.myColor || GameState.getState().myColor;
      if (myColor) {
        GameState.set({ myColor });
        ChessGame.setMyColor(myColor);
      }
      GameView.enter(GameState.getState().roomId, myColor, data.players, false);
      GameState.set({ status: 'playing', selectedPos: null, validMoves: [] });
      ChessGame.setStatus('playing');
      setStatusText(document.getElementById('gameStatus'), '红方走棋');
      setStatusClass(document.getElementById('gameStatus'), 'normal');
      ChessGame.startTimer();
      ChessBoard.updateBoardBorder(RED);
      Modals.showToast('对局开始', 'success');
    });

    NetworkService.on('moveMade', (data) => {
      if (ChessGame.isInSandbox()) {
        ChessGame.applyLiveMoveToSnapshot(data.from, data.to);
        markSandboxLiveDirty(true);
        refreshLiveBoardPreview();
        return;
      }
      ChessGame.receiveMove(data.from, data.to);
      MoveListView.rebuild(ChessGame.getMoveHistory());
      ChessBoard.updateBoardBorder(ChessGame.getState().currentTurn);
      if (ChessGame.getState().inCheck) BoardOverlay.showCheckBanner();
    });

    NetworkService.on('gameOver', (data) => {
      SessionStore.clear();
      if (ChessGame.isInSandbox()) {
        ChessGame.markLiveGameOverOnSnapshot(data.winner);
        markSandboxLiveDirty(true);
        exitSandbox(true);
      }
      const statusEl = document.getElementById('gameStatus');
      GameState.set({ status: 'ended' });
      ChessGame.stopTimer();
      ChessBoard.clearFlightAnims();
      ChessBoard.clearCaptureAnims();

      let title, message;
      if (data.winner === null) {
        title = '和棋';
        message = data.result;
      } else {
        const winnerName = data.winner === 'red' ? '红方' : '黑方';
        const isWin = data.winner === GameState.getState().myColor;
        title = isWin ? '你赢了' : '你输了';
        message = winnerName + '获胜（' + data.result + '）';
      }

      setStatusText(statusEl, title);
      setStatusClass(statusEl, 'ended');

      BoardOverlay.showResultBanner(title, message);
      setTimeout(() => {
        const titleEl = document.getElementById('modalTitle');
        const msgEl = document.getElementById('modalMessage');
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        Modals.openGameOver(title, message);
      }, 2000);
      const restartBtn = document.getElementById('btnRestart');
      if (restartBtn) restartBtn.style.display = '';
    });

    NetworkService.on('opponentResigned', () => {
      Modals.showToast('对手认输了', 'success');
    });

    NetworkService.on('drawOffered', () => {
      Modals.closeDrawModal();
      const drawModal = document.getElementById('drawModal');
      if (drawModal) drawModal.classList.add('active');
    });

    NetworkService.on('undoRequested', (data) => {
      const undoMessage = document.getElementById('undoMessage');
      if (undoMessage) undoMessage.textContent = data.playerName + ' 请求悔棋，是否同意？';
      Modals.closeUndoModal();
      const undoModal = document.getElementById('undoModal');
      if (undoModal) undoModal.classList.add('active');
    });

    NetworkService.on('undoExecuted', (data) => {
      if (ChessGame.isInSandbox()) {
        ChessGame.applyLiveUndoToSnapshot(data.board, data.currentTurn, data.lastMove, data.moveHistory);
        markSandboxLiveDirty(true);
        refreshLiveBoardPreview();
        return;
      }
      ChessGame.receiveUndo(data.board, data.currentTurn, data.lastMove, data.moveHistory);
      MoveListView.rebuild(ChessGame.getMoveHistory());
      ChessBoard.clearFlightAnims();
      ChessBoard.clearCaptureAnims();
      ChessBoard.updateBoardBorder(ChessGame.getState().currentTurn);
      Modals.showToast('悔棋成功', 'success');
    });

    NetworkService.on('roomList', (rooms) => {
      RoomStore.set(rooms);
      renderRoomList(rooms);
    });

    NetworkService.on('chatMessage', (data) => {
      ChatView.appendMessage(data.playerName, data.message);
      DushuOverlay.onReceive(data.message);
    });

    NetworkService.on('spectatorJoined', (data) => {
      if (typeof data.timeControl === 'number') {
        ChessGame.setTimeControl(data.timeControl);
      }
      SessionStore.save({
        roomId: data.roomId,
        playerToken: data.playerToken,
        playerName: myName || getPlayerName(),
        color: null,
        isSpectator: true,
      });
      GameView.enter(data.roomId, null, data.players, true);
      ChessGame.syncBoard(data.board, data.currentTurn, data.lastMove, data.moveHistory);
      GameState.set({ status: 'playing' });
      const statusEl = document.getElementById('gameStatus');
      setStatusText(statusEl, data.currentTurn === 'red' ? '红方走棋' : '黑方走棋');
      setStatusClass(statusEl, 'normal');
      GameView.updateSpectatorCount(data.spectatorCount);
      Modals.showToast('进入观战模式', 'info');
      MoveListView.rebuild(ChessGame.getMoveHistory());
      ChessGame.updateTimerDisplay();
    });

    NetworkService.on('spectatorCount', (data) => {
      GameView.updateSpectatorCount(data.count);
    });

    NetworkService.on('roomResumed', (data) => {
      applyRoomResume(data);
    });

    NetworkService.on('reconnectFailed', (data) => {
      reclaimingPip = false;
      SessionStore.clear();
      const message = data && data.message ? data.message : '无法恢复对局';
      Modals.showToast(message, 'error');
      showView('lobby');
      NetworkService.send('getRoomList');
    });

    NetworkService.on('playerDisconnected', (data) => {
      if (data && data.players) GameView.updatePlayerNames(data.players);
      const name = data && data.playerName ? data.playerName : '对手';
      Modals.showToast(name + ' 暂时离开，等待重连…', 'info');
      const statusEl = document.getElementById('gameStatus');
      if (statusEl && GameState.getState().status === 'playing') {
        setStatusText(statusEl, '等待对手重连');
      }
    });

    NetworkService.on('playerReconnected', (data) => {
      if (data && data.players) GameView.updatePlayerNames(data.players);
      const name = data && data.playerName ? data.playerName : '对手';
      Modals.showToast(name + ' 已重新连接', 'success');
      const st = ChessGame.getState();
      if (st.status === 'playing') {
        GameView.updateTurnUI(st.currentTurn, st.inCheck);
      }
    });

    NetworkService.on('sessionTaken', (data) => {
      // 主窗口席位被小窗接管：遮罩屏蔽，等小窗返回
      if (popupMode) return;
      showPipShield(true);
      ChessGame.setSpectator(true);
      GameState.set({ isSpectator: true });
      const message = (data && data.message) || '请在小窗中行棋';
      Modals.showToast(message, 'info');
    });
  }

  function showPipShield(show) {
    pipActive = !!show;
    const el = document.getElementById('pipShield');
    if (el) el.hidden = !show;
    document.body.classList.toggle('pip-transferred', !!show);
    if (!show && typeof Controls !== 'undefined' && Controls.updatePiPButton) {
      Controls.updatePiPButton(false);
    }
  }

  function stopPipWatch() {
    if (pipWatchTimer) {
      clearInterval(pipWatchTimer);
      pipWatchTimer = null;
    }
    pipWindow = null;
  }

  /** 从小窗回到主页：夺回席位并解除遮罩 */
  function reclaimSeatFromPip() {
    if (!pipActive && !document.body.classList.contains('pip-transferred')) {
      stopPipWatch();
      return;
    }
    stopPipWatch();
    const session = typeof SessionStore !== 'undefined' ? SessionStore.read() : null;
    showPipShield(false);
    if (!session || !session.roomId || !session.playerToken) {
      reclaimingPip = false;
      Modals.showToast('会话丢失，请刷新页面', 'error');
      return;
    }
    myName = myName || session.playerName || getPlayerName();
    if (session.color) {
      ChessGame.setSpectator(false);
      ChessGame.setMyColor(session.color);
      GameState.set({ isSpectator: false, myColor: session.color });
      document.querySelectorAll('.player-only').forEach((el) => { el.style.display = ''; });
    }
    reclaimingPip = true;
    NetworkService.send('reconnectRoom', {
      roomId: session.roomId,
      playerToken: session.playerToken,
      playerName: myName,
    });
    requestAnimationFrame(() => {
      if (typeof ChessBoard !== 'undefined') {
        ChessBoard.resize();
        ChessBoard.render(ChessGame.getState());
      }
    });
  }

  function bindPipBridge() {
    window.addEventListener('message', (e) => {
      if (popupMode) return;
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== 'chess-pip-return') return;
      reclaimSeatFromPip();
    });
  }

  function tryReconnectSession() {
    const session = SessionStore.read();
    if (!session) return false;
    myName = session.playerName || myName || getPlayerName();
    NetworkService.send('reconnectRoom', {
      roomId: session.roomId,
      playerToken: session.playerToken,
      playerName: myName,
    });
    Modals.showToast('正在恢复对局…', 'info');
    return true;
  }

  function sendJoinRoom(roomId, options) {
    const opts = options || {};
    const asSpectator = !!opts.asSpectator;
    const preferredColor = opts.preferredColor == null ? null : opts.preferredColor;
    const id = String(roomId || '').trim().toUpperCase();
    if (!id) return;
    myName = getPlayerName();
    const session = SessionStore.read();
    // 同一房间且要进对局：优先重连回原席
    if (!asSpectator && session && session.roomId && String(session.roomId).toUpperCase() === id && session.playerToken) {
      NetworkService.send('reconnectRoom', {
        roomId: id,
        playerToken: session.playerToken,
        playerName: myName,
      });
      Modals.showToast('正在恢复对局…', 'info');
      return;
    }
    NetworkService.send('joinRoom', {
      roomId: id,
      playerName: myName,
      preferredColor,
      playerToken: session && session.playerToken ? session.playerToken : null,
      asSpectator,
    });
  }

  function applyRoomResume(data) {
    myName = myName || getPlayerName();
    const prev = SessionStore.read();
    SessionStore.save({
      roomId: data.roomId,
      playerToken: prev && prev.playerToken,
      playerName: myName,
      color: data.color || data.myColor || null,
      isSpectator: !!data.isSpectator,
    });
    if (typeof data.timeControl === 'number') {
      ChessGame.setTimeControl(data.timeControl);
    }

    const isSpectator = !!data.isSpectator;
    const color = data.color || data.myColor || null;
    GameView.enter(data.roomId, color, data.players || [], isSpectator);
    ChessGame.syncBoard(data.board, data.currentTurn, data.lastMove, data.moveHistory || []);
    if (color) ChessGame.setMyColor(color);
    ChessGame.setSpectator(isSpectator);

    const status = data.status === 'ended' ? 'ended' : (data.status === 'waiting' ? 'waiting' : 'playing');
    ChessGame.setStatus(status === 'waiting' ? 'waiting' : (status === 'ended' ? 'ended' : 'playing'));
    GameState.set({
      roomId: data.roomId,
      myColor: color,
      isSpectator,
      status,
      playerCount: (data.players || []).length,
    });

    MoveListView.rebuild(ChessGame.getMoveHistory());
    ChessBoard.updateBoardBorder(data.currentTurn);
    const statusEl = document.getElementById('gameStatus');
    const waiting = document.getElementById('waitingOverlay');
    if (status === 'waiting') {
      if (waiting) {
        const codeEl = document.getElementById('waitingRoomCode');
        if (codeEl) codeEl.textContent = data.roomId;
        waiting.classList.add('active');
      }
      setStatusText(statusEl, '等待对手加入');
      setStatusClass(statusEl, 'normal');
    } else {
      if (waiting) waiting.classList.remove('active');
      if (status === 'ended') {
        setStatusText(statusEl, '对局结束');
        setStatusClass(statusEl, 'ended');
      } else {
        setStatusText(statusEl, data.currentTurn === 'red' ? '红方走棋' : '黑方走棋');
        setStatusClass(statusEl, 'normal');
        ChessGame.startTimer();
        GameView.updateTurnUI(data.currentTurn, false);
      }
    }
    if (typeof data.spectatorCount === 'number') {
      GameView.updateSpectatorCount(data.spectatorCount);
    }
    // 弹出窗口里不重复刷「已恢复」；从小窗返回用专用文案
    if (popupMode) {
      Modals.showToast('小窗已接续对局，可以行棋', 'success');
    } else if (reclaimingPip) {
      reclaimingPip = false;
      Modals.showToast('已回到主页面，可以继续行棋', 'success');
    } else {
      Modals.showToast('已恢复对局', 'success');
    }
    requestAnimationFrame(() => {
      ChessBoard.resize();
      ChessBoard.render(ChessGame.getState());
    });
  }

  function initBoardInteraction() {
    const canvas = document.getElementById('chessBoard');
    if (!canvas) return;

    ChessBoard.init(canvas);
    const liveCanvas = document.getElementById('chessBoardLive');
    if (liveCanvas && ChessBoard.initLivePreview) {
      ChessBoard.initLivePreview(liveCanvas);
    }

    ChessGame.init({
      onStateChange: (state) => {
        ChessBoard.render(state);
        GameView.updateTurnUI(state.currentTurn, state.inCheck);
        ChessBoard.updateBoardBorder(state.currentTurn, state.inCheck);
      },
      onMoveMade: (from, to) => {
        if (ChessGame.isInSandbox()) {
          MoveListView.rebuild(ChessGame.getMoveHistory());
          ChessBoard.updateBoardBorder(ChessGame.getState().currentTurn);
          return;
        }
        MoveListView.rebuild(ChessGame.getMoveHistory());
        ChessBoard.updateBoardBorder(ChessGame.getState().currentTurn);
        const hist = ChessGame.getMoveHistory();
        const last = hist[hist.length - 1];
        NetworkService.send('makeMove', {
          from,
          to,
          notation: last && last.notation ? last.notation : '',
        });
      }
    });

    BoardInteraction.init(canvas);
  }

  function bindWindowResize() {
    let timer = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (currentView !== 'game' && !popupMode) return;
        resizeGameBoard();
      }, 80);
    };
    window.addEventListener('resize', schedule);
    // 浏览器缩放 / 移动端视口变化
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule);
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT) {
      Modals.showToast('连接失败，请刷新页面', 'error');
      return;
    }
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.6, reconnectAttempts), 10000);
    if (reconnectAttempts === 1) {
      Modals.showToast('连接失败，正在重连…', 'info');
    } else {
      Modals.showToast('连接已断开，正在重连…', 'info');
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      try { NetworkService.connect(); } catch (e) { /* ignore */ }
    }, delay);
  }

  function showView(name) {
    currentView = name;
    hideAllViews();
    switch (name) {
      case 'loading': {
        const el = document.getElementById('loadingOverlay');
        if (el) el.style.display = '';
        break;
      }
      case 'lobby': {
        const el = document.getElementById('lobby');
        if (el) {
          el.style.display = 'flex';
          el.classList.remove('lobby-fade-in');
          void el.offsetWidth;
          el.classList.add('lobby-fade-in');
        }
        break;
      }
      case 'waiting': {
        const el = document.getElementById('waitingOverlay');
        if (el) el.classList.add('active');
        break;
      }
      case 'colorSelect': {
        const el = document.getElementById('colorSelectOverlay');
        if (el) el.classList.add('active');
        syncTimeSelectUI();
        break;
      }
      case 'game': {
        const el = document.getElementById('gameContainer');
        if (el) {
          el.classList.add('active');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              el.classList.add('visible');
              resizeGameBoard();
            });
          });
        }
        break;
      }
    }
  }

  function hideAllViews() {
    const loading = document.getElementById('loadingOverlay');
    const lobby = document.getElementById('lobby');
    const waiting = document.getElementById('waitingOverlay');
    const colorSelect = document.getElementById('colorSelectOverlay');
    const game = document.getElementById('gameContainer');

    if (loading) {
      loading.style.display = 'none';
      loading.classList.remove('hidden');
    }
    if (lobby) {
      lobby.style.display = 'none';
      lobby.classList.remove('lobby-fade-in');
    }
    if (waiting) waiting.classList.remove('active');
    if (colorSelect) colorSelect.classList.remove('active');
    if (game) game.classList.remove('active', 'visible');
  }

  function setLobbyActionsEnabled(enabled) {
    const ids = ['playerName', 'roomIdInput'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    });
    document.querySelectorAll('#lobby .lobby-cta, #lobby .btn-join, #lobby .room-refresh').forEach((btn) => {
      btn.disabled = !enabled;
      btn.classList.toggle('is-disabled', !enabled);
    });
  }

  function updateLobbyConnStatus(state) {
    const el = document.getElementById('lobbyConnStatus');
    if (!el) return;
    el.classList.remove('is-ok', 'is-bad', 'is-wait');
    if (state === 'connected') {
      el.textContent = '已连接 · 可以创建或加入房间';
      el.classList.add('is-ok');
    } else if (state === 'error' || state === 'disconnected') {
      el.textContent = '未连接 · 请用浏览器打开上方分享地址';
      el.classList.add('is-bad');
    } else {
      el.textContent = '正在连接…';
      el.classList.add('is-wait');
    }
  }

  /** 加载页淡出 → 大厅淡入（不立刻 display:none，保留过渡） */
  function finishLoading() {
    if (currentView !== 'loading') return;
    currentView = 'lobby';

    const overlay = document.getElementById('loadingOverlay');
    const lobby = document.getElementById('lobby');
    const waiting = document.getElementById('waitingOverlay');
    const colorSelect = document.getElementById('colorSelectOverlay');
    const game = document.getElementById('gameContainer');

    if (waiting) waiting.classList.remove('active');
    if (colorSelect) colorSelect.classList.remove('active');
    if (game) game.classList.remove('active', 'visible');

    if (lobby) {
      lobby.style.display = 'flex';
      lobby.classList.remove('lobby-fade-in');
      void lobby.offsetWidth;
      lobby.classList.add('lobby-fade-in');
    }

    if (overlay) {
      overlay.classList.add('hidden');
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 900);
    }

    // 进大厅后再拉一次列表，避免加载动画期间漏掉推送
    if (NetworkService.isConnected()) {
      NetworkService.send('getRoomList');
      updateLobbyConnStatus('connected');
    } else {
      updateLobbyConnStatus(connectionState === 'error' ? 'error' : 'connecting');
    }
  }

  function resizeGameBoard() {
    if (typeof ChessBoard !== 'undefined' && ChessBoard.resize && ChessBoard.render) {
      ChessBoard.resize();
      const state = (typeof ChessGame !== 'undefined' && ChessGame.getState) ? ChessGame.getState() : GameState.getState();
      ChessBoard.render(state);
      // 缩放会清空 live canvas 缓冲，必须重绘左侧对局盘
      if (ChessGame.isInSandbox && ChessGame.isInSandbox()) {
        refreshLiveBoardPreview();
      }
    }
  }

  function setStatusText(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  function setStatusClass(el, name) {
    if (!el) return;
    el.className = 'game-status ' + name;
  }

  function resetTurnIndicators() {
    const redTurn = document.getElementById('redTurn');
    const blackTurn = document.getElementById('blackTurn');
    if (redTurn) redTurn.textContent = '等待中';
    if (blackTurn) blackTurn.textContent = '等待中';
  }

  function formatTimeControlLabel(seconds) {
    if (typeof formatTimeControl === 'function') return formatTimeControl(seconds);
    if (!seconds) return '不限';
    return (seconds / 60) + '分';
  }

  function syncTimeSelectUI() {
    const wrap = document.getElementById('timeSelect');
    const buttons = document.getElementById('timeSelectButtons');
    if (!wrap || !buttons) return;
    // 仅创建房间时可设置时长；加入方沿用房主设置
    wrap.style.display = pendingAction === 'create' ? '' : 'none';
    buttons.querySelectorAll('.time-btn').forEach(btn => {
      const sec = parseInt(btn.getAttribute('data-seconds'), 10);
      btn.classList.toggle('active', sec === selectedTimeControl);
      btn.onclick = () => {
        selectedTimeControl = sec;
        buttons.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });
  }

  function renderRoomList(rooms) {
    const container = document.getElementById('roomListContent');
    if (!container) return;
    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<div class="no-rooms">暂无房间<br><span>创建一个，然后把地址发给朋友</span></div>';
      return;
    }
    container.innerHTML = rooms.map(r => {
      const session = SessionStore.read();
      const isMyRoom = session && session.roomId && String(session.roomId).toUpperCase() === String(r.id).toUpperCase();
      const statusTag = r.status === 'playing' ? '对局中' : '等待中';
      const spectatorText = r.spectatorCount > 0 ? ' · 观战' + r.spectatorCount : '';
      const timeText = formatTimeControlLabel(typeof r.timeControl === 'number' ? r.timeControl : 600);
      let actionsHtml = '';
      if (isMyRoom) {
        actionsHtml = '<button type="button" class="btn btn-success btn-sm" data-action="rejoin" data-room-id="' + r.id + '">回到对局</button>';
      } else if (r.status === 'waiting') {
        actionsHtml = '<button type="button" class="btn btn-success btn-sm" data-action="join" data-room-id="' + r.id + '">加入</button>';
      } else {
        // 对局中：加入=尝试入座，观战=旁观（分开按钮）
        actionsHtml =
          '<button type="button" class="btn btn-success btn-sm" data-action="join" data-room-id="' + r.id + '">加入</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-action="spectate" data-room-id="' + r.id + '">观战</button>';
      }
      return '<div class="room-item">' +
        '<span class="room-id">' + r.id + '</span>' +
        '<span class="room-host">' + r.playerName + '</span>' +
        '<span class="room-time">' + timeText + '</span>' +
        '<span class="room-status-tag ' + r.status + '">' + statusTag + spectatorText + '</span>' +
        '<span class="room-actions">' + actionsHtml + '</span>' +
      '</div>';
    }).join('');
    container.querySelectorAll('button[data-room-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.getAttribute('data-room-id');
        const action = btn.getAttribute('data-action');
        const input = document.getElementById('roomIdInput');
        if (input) input.value = roomId;
        if (action === 'spectate') {
          sendJoinRoom(roomId, { asSpectator: true });
        } else {
          sendJoinRoom(roomId, { asSpectator: false });
        }
      });
    });
  }

  function getPlayerName() {
    const input = document.getElementById('playerName');
    const name = input ? input.value.trim() : '';
    return name || '玩家' + Math.floor(Math.random() * 1000);
  }

  function handleCreateRoom() {
    myName = getPlayerName();
    pendingAction = 'create';
    pendingRoomId = null;
    showView('colorSelect');
  }

  function handleJoinRoom() {
    const input = document.getElementById('roomIdInput');
    const roomId = input ? input.value.trim() : '';
    if (!roomId) {
      Modals.showToast('请输入房间号', 'error');
      return;
    }
    sendJoinRoom(roomId, { asSpectator: false });
  }

  function handleRefreshRooms() {
    NetworkService.send('getRoomList');
  }

  function formatSandboxClock(sec) {
    const s = Math.max(0, sec | 0);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function markSandboxLiveDirty(dirty) {
    sandboxLiveDirty = !!dirty;
    const hint = document.getElementById('sandboxLiveHint');
    if (hint) hint.hidden = !sandboxLiveDirty;
  }

  function setSandboxUiActive(active) {
    const bar = document.getElementById('sandboxBar');
    const btn = document.getElementById('btnSandbox');
    const container = document.getElementById('gameContainer');
    const liveArea = document.getElementById('liveBoardArea');
    const sandboxLabel = document.getElementById('sandboxBoardLabel');
    if (bar) bar.hidden = !active;
    if (btn) btn.classList.toggle('active', active);
    if (liveArea) liveArea.hidden = !active;
    if (sandboxLabel) sandboxLabel.hidden = !active;
    if (container) container.classList.toggle('sandbox-active', active);
    document.querySelectorAll('.multiplayer-only').forEach(el => {
      if (active) el.style.visibility = 'hidden';
      else el.style.visibility = '';
    });
    if (typeof ChessBoard !== 'undefined') {
      ChessBoard.setLivePreviewEnabled(active);
    }
  }

  function refreshLiveBoardPreview() {
    if (!ChessGame.isInSandbox()) return;
    if (typeof ChessBoard === 'undefined' || !ChessBoard.renderLive) return;
    ChessBoard.renderLive(ChessGame.getLiveViewState());
  }

  function updateSandboxTimeUi(remaining, duration) {
    const el = document.getElementById('sandboxTime');
    if (el) {
      el.textContent = formatSandboxClock(remaining);
      el.classList.toggle('urgent', remaining <= 10);
    }
  }

  function toggleSandbox() {
    if (popupMode) {
      Modals.showToast('小窗模式专注行棋，请回主窗口使用沙盘', 'info');
      return;
    }
    if (ChessGame.isInSandbox()) {
      exitSandbox();
      return;
    }
    const gs = ChessGame.getState();
    if (gs.status !== 'playing' || gs.isSpectator) {
      Modals.showToast('对局进行中才能使用沙盘', 'info');
      return;
    }
    if (gs.currentTurn !== gs.myColor) {
      Modals.showToast('轮到你行棋时才能使用沙盘', 'info');
      return;
    }
    enterSandbox();
  }

  function enterSandbox() {
    if (popupMode) {
      Modals.showToast('小窗模式专注行棋，请回主窗口使用沙盘', 'info');
      return;
    }
    const ok = ChessGame.enterSandbox({
      onTick: updateSandboxTimeUi,
      onExpire: () => {
        Modals.showToast('沙盘时间到，已回到对局', 'info');
        exitSandbox(true);
      },
    });
    if (!ok) {
      const gs = ChessGame.getState();
      if (gs.currentTurn !== gs.myColor) {
        Modals.showToast('轮到你行棋时才能使用沙盘', 'info');
      } else {
        Modals.showToast('需保留至少 30 秒对局用时，无法进入沙盘', 'error');
      }
      return;
    }
    markSandboxLiveDirty(false);
    setSandboxUiActive(true);
    updateSandboxTimeUi(ChessGame.getSandboxRemaining(), ChessGame.getSandboxDuration());
    MoveListView.rebuild(ChessGame.getMoveHistory());
    requestAnimationFrame(() => {
      ChessBoard.resize();
      ChessBoard.render(ChessGame.getState());
      refreshLiveBoardPreview();
    });
    const dur = ChessGame.getSandboxDuration();
    Modals.showToast('已进入沙盘 · ' + formatSandboxClock(dur), 'success');
  }

  function exitSandbox(auto) {
    if (!ChessGame.isInSandbox()) {
      setSandboxUiActive(false);
      return;
    }
    ChessGame.exitSandbox();
    setSandboxUiActive(false);
    markSandboxLiveDirty(false);
    const st = ChessGame.getState();
    MoveListView.rebuild(ChessGame.getMoveHistory());
    requestAnimationFrame(() => {
      ChessBoard.resize();
      ChessBoard.render(st);
      ChessBoard.updateBoardBorder(st.currentTurn, st.inCheck);
    });
    GameView.updateTurnUI(st.currentTurn, st.inCheck);
    if (st.inCheck) BoardOverlay.showCheckBanner();
    if (!auto) Modals.showToast('已回到对局', 'info');
  }

  function requestUndo() {
    if (ChessGame.isInSandbox()) {
      Modals.showToast('沙盘中请先回到对局', 'info');
      return;
    }
    Modals.confirm('羞羞羞，这就想悔棋啦？', {
      title: '悔棋',
      okText: '我就要悔',
      mock: 'undo',
    }).then((ok) => {
      if (ok) NetworkService.send('undoRequest');
    });
  }

  function resign() {
    if (ChessGame.isInSandbox()) {
      Modals.showToast('沙盘中请先回到对局', 'info');
      return;
    }
    Modals.confirm('这就怂啦？认输可是要判负的哦～', {
      title: '认输',
      okText: '我认怂',
      danger: true,
      mock: 'resign',
    }).then((ok) => {
      if (ok) NetworkService.send('resign');
    });
  }

  function offerDraw() {
    if (ChessGame.isInSandbox()) {
      Modals.showToast('沙盘中请先回到对局', 'info');
      return;
    }
    Modals.confirm('真要跟对手握手言和？', {
      title: '求和',
      okText: '求和吧',
      mock: 'draw',
    }).then((ok) => {
      if (!ok) return;
      NetworkService.send('offerDraw');
      try { AppAudio.select(); } catch (e) { /* ignore */ }
      Modals.showToast('已发送求和请求', 'info');
    });
  }

  function selectColor(color) {
    hideColorSelect();
    if (pendingAction === 'create') {
      myName = getPlayerName();
      NetworkService.send('createRoom', {
        playerName: myName,
        preferredColor: color,
        timeControl: selectedTimeControl
      });
    }
    pendingAction = null;
    pendingRoomId = null;
  }

  function cancelColorSelect() {
    hideColorSelect();
    pendingAction = null;
    pendingRoomId = null;
  }

  function hideColorSelect() {
    const el = document.getElementById('colorSelectOverlay');
    if (el) el.classList.remove('active');
  }

  function leaveWaiting() {
    SessionStore.clear();
    NetworkService.send('leaveRoom');
    const waiting = document.getElementById('waitingOverlay');
    if (waiting) waiting.classList.remove('active');
    hideColorSelect();
  }

  function showWaiting(roomId) {
    const codeEl = document.getElementById('waitingRoomCode');
    if (codeEl) codeEl.textContent = roomId;
    const waiting = document.getElementById('waitingOverlay');
    if (waiting) waiting.classList.add('active');
  }

  function respondDraw(accept) {
    Modals.closeDrawModal();
    NetworkService.send('respondDraw', { accept });
  }

  function confirmUndo(accept) {
    Modals.closeUndoModal();
    NetworkService.send('undoConfirm', { accept });
  }

  function closeGameOverAndLeave() {
    Modals.closeGameOverModal();
    leaveGame();
    showView('lobby');
  }

  function restartGame() {
    Modals.closeGameOverModal();
    NetworkService.send('restartGame');
  }

  function leaveGame() {
    if (ChessGame.isInSandbox()) {
      ChessGame.resetSandboxState();
      setSandboxUiActive(false);
      markSandboxLiveDirty(false);
    }
    SessionStore.clear();
    ChessGame.stopTimer();
    ChessBoard.clearFlightAnims();
    ChessBoard.clearCaptureAnims();
    NetworkService.send('leaveRoom');
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer) gameContainer.classList.remove('active', 'visible', 'sandbox-active');
    const lobby = document.getElementById('lobby');
    if (lobby) lobby.style.display = 'flex';
    const btnRestart = document.getElementById('btnRestart');
    if (btnRestart) btnRestart.style.display = 'none';
    const spectatorTag = document.getElementById('spectatorTag');
    if (spectatorTag) spectatorTag.hidden = true;
    const spectatorBadge = document.getElementById('spectatorBadge');
    if (spectatorBadge) spectatorBadge.hidden = true;
    const colorInfo = document.getElementById('colorInfo');
    if (colorInfo) colorInfo.hidden = false;
    document.querySelectorAll('.player-only').forEach(el => el.style.display = '');
    document.querySelectorAll('.multiplayer-only').forEach(el => { el.style.visibility = ''; });
    document.body.classList.remove('pip-transferred');
    showPipShield(false);
    stopPipWatch();
    ChessBoard.setFlipped(false);
    ChessGame.resetBoard();
    NetworkService.send('getRoomList');
    GameState.reset();
  }

  function sendChat() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    NetworkService.send('chatMessage', { message: text });
    input.value = '';
  }

  function sendRandomDushu() {
    if (popupMode) {
      Modals.showToast('小窗模式已关闭吐槽', 'info');
      return;
    }
    DushuOverlay.sendRandom();
  }

  function initTheme() {
    const isLight = localStorage.getItem('chess-theme') === 'light';
    if (isLight) {
      document.body.classList.add('light-theme');
      const btnGame = document.getElementById('btnTheme');
      const btnLobby = document.getElementById('btnThemeLobby');
      if (btnGame) btnGame.classList.add('active');
      if (btnLobby) btnLobby.classList.add('active');
    }
  }

  function toggleTheme() {
    const isLight = !document.body.classList.contains('light-theme');
    document.body.classList.toggle('light-theme', isLight);
    const btnGame = document.getElementById('btnTheme');
    const btnLobby = document.getElementById('btnThemeLobby');
    if (btnGame) btnGame.classList.toggle('active', isLight);
    if (btnLobby) btnLobby.classList.toggle('active', isLight);
    localStorage.setItem('chess-theme', isLight ? 'light' : 'dark');
    setTimeout(() => {
      ChessBoard.resize();
      ChessBoard.render(ChessGame.getState());
    }, 50);
  }

  function toggleCompact() {
    if (popupMode) return;
    const isCompact = !document.body.classList.contains('compact');
    document.body.classList.toggle('compact', isCompact);
    const btn = document.getElementById('btnCompact');
    if (btn) btn.classList.toggle('active', isCompact);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ChessBoard.resize();
        ChessBoard.render(ChessGame.getState());
      });
    });
  }

  function openPiPWindow() {
    if (popupMode) return;
    const boardCanvas = ChessBoard.getCanvas();
    const state = GameState.getState();

    if (!state.roomId) {
      Modals.showToast('请先加入房间', 'error');
      return;
    }

    const session = typeof SessionStore !== 'undefined' ? SessionStore.read() : null;
    const token = (session && session.playerToken) || '';
    if (!token) {
      Modals.showToast('会话丢失，请刷新后重试', 'error');
      return;
    }

    const color = state.myColor || '';
    const url = window.location.origin +
      '?popup=1' +
      '&room=' + encodeURIComponent(state.roomId) +
      '&color=' + encodeURIComponent(color) +
      '&name=' + encodeURIComponent(myName || (session && session.playerName) || '玩家') +
      '&token=' + encodeURIComponent(token);
    const w = 520, h = 680;
    const left = Math.round((screen.width - w) / 2);
    const top = Math.round((screen.height - h) / 2);
    const win = window.open(
      url,
      'chess_' + state.roomId,
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=no'
    );
    if (!win) {
      Modals.showToast('无法打开小窗，请允许浏览器弹窗', 'error');
      return;
    }

    pipWindow = win;
    // 立刻屏蔽主页行棋，不必等 sessionTaken
    ChessGame.setSpectator(true);
    GameState.set({ isSpectator: true });
    showPipShield(true);
    if (boardCanvas && typeof Controls !== 'undefined' && Controls.updatePiPButton) {
      Controls.updatePiPButton(true);
    }
    if (pipWatchTimer) clearInterval(pipWatchTimer);
    pipWatchTimer = setInterval(() => {
      if (!pipWindow || pipWindow.closed) {
        reclaimSeatFromPip();
      }
    }, 500);
    Modals.showToast('小窗已打开，主页已暂停', 'success');
  }

  /** 小窗：交还席位并关闭，回到主页面 */
  function returnToMain() {
    if (!popupMode) return;
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'chess-pip-return' }, window.location.origin);
      }
    } catch (e) { /* ignore */ }
    window.close();
    setTimeout(() => {
      Modals.showToast('若窗口未关闭，请手动关掉小窗', 'info');
    }, 400);
  }

  function getCurrentView() {
    return currentView;
  }

  function isPopupMode() {
    return !!popupMode;
  }

  function backToLobby() {
    leaveGame();
    showView('lobby');
  }

  function resetViews() {
    GameState.reset();
    RoomStore.clear();
    hideAllViews();
    showView('loading');
  }

  return {
    init,
    showView,
    finishLoading,
    getCurrentView,
    isPopupMode,
    openPiPWindow,
    returnToMain,
    backToLobby,
    resetViews,
    initBoardInteraction,
    bindWindowResize,
    getPlayerName,
    handleCreateRoom,
    handleJoinRoom,
    handleRefreshRooms,
    requestUndo,
    selectColor,
    cancelColorSelect,
    leaveWaiting,
    showWaiting,
    resign,
    offerDraw,
    respondDraw,
    confirmUndo,
    closeGameOverAndLeave,
    restartGame,
    leaveGame,
    sendChat,
    sendRandomDushu,
    initTheme,
    toggleTheme,
    toggleCompact,
    setPopupJoin,
    toggleSandbox,
    enterSandbox,
    exitSandbox,
  };
})();

window.App = App;
