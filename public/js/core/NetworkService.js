// Socket.IO 网络服务
const NetworkService = (() => {
  let socket = null;
  const handlers = new Map();
  const pending = [];
  const MAX_PENDING = 32;

  function localizeConnectError(err) {
    const raw = err && (err.message || err.description || err.type)
      ? String(err.message || err.description || err.type)
      : '';
    const msg = raw.toLowerCase();
    if (!msg) return '无法连接服务器，请检查网络';
    if (msg.includes('xhr poll') || msg.includes('polling error')) {
      return '连接失败，请检查网络或稍后重试';
    }
    if (msg.includes('timeout')) return '连接超时，请稍后重试';
    if (msg.includes('websocket')) return '实时连接异常，请刷新页面';
    if (msg.includes('transport')) return '连接通道异常，请刷新页面';
    if (msg.includes('server error')) return '服务器暂时不可用，请稍后重试';
    if (msg.includes('unauthorized') || msg.includes('forbidden')) {
      return '无权连接，请重新打开页面';
    }
    if (msg.includes('closed') || msg.includes('disconnect')) return '连接已断开';
    if (/[\u4e00-\u9fff]/.test(raw)) return raw;
    return '连接失败，请检查网络后重试';
  }

  function flushPending() {
    if (!socket || !socket.connected || pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    batch.forEach((item) => {
      try { socket.emit(item.event, item.payload); } catch (e) { /* ignore */ }
    });
  }

  function connect() {
    if (socket && socket.connected) return;
    // 重连时先断开旧连接，避免重复监听与泄漏
    if (socket) {
      try { socket.removeAllListeners(); socket.disconnect(); } catch (e) { /* ignore */ }
      socket = null;
    }

    // 明确连当前页面来源（必须是房主局域网地址）
    // 局域网只走 polling，避免部分 WiFi/代理上 websocket 升级失败后整段断开
    const url = window.location.origin;
    socket = io(url, {
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 15000,
      transports: ['polling'],
      upgrade: false,
      forceNew: true,
    });

    socket.on('connect', () => {
      flushPending();
      emitLocal('connect');
    });
    socket.on('disconnect', (reason) => emitLocal('disconnect', reason));

    socket.on('connect_error', (err) => {
      emitLocal('connect_error', err);
    });

    socket.on('error', (data) => emitLocal('error', data));
    socket.on('roomCreated', (data) => emitLocal('roomCreated', data));
    socket.on('roomJoined', (data) => emitLocal('roomJoined', data));
    socket.on('playerJoined', (data) => emitLocal('playerJoined', data));
    socket.on('playerLeft', (data) => emitLocal('playerLeft', data));
    socket.on('gameStart', (data) => emitLocal('gameStart', data));
    socket.on('moveMade', (data) => emitLocal('moveMade', data));
    socket.on('gameOver', (data) => emitLocal('gameOver', data));
    socket.on('opponentResigned', () => emitLocal('opponentResigned', {}));
    socket.on('drawOffered', () => emitLocal('drawOffered', {}));
    socket.on('undoRequested', (data) => emitLocal('undoRequested', data));
    socket.on('undoExecuted', (data) => emitLocal('undoExecuted', data));
    socket.on('chatMessage', (data) => emitLocal('chatMessage', data));
    socket.on('roomList', (rooms) => emitLocal('roomList', rooms));
    socket.on('spectatorJoined', (data) => emitLocal('spectatorJoined', data));
    socket.on('spectatorCount', (data) => emitLocal('spectatorCount', data));
    socket.on('roomResumed', (data) => emitLocal('roomResumed', data));
    socket.on('reconnectFailed', (data) => emitLocal('reconnectFailed', data));
    socket.on('playerDisconnected', (data) => emitLocal('playerDisconnected', data));
    socket.on('playerReconnected', (data) => emitLocal('playerReconnected', data));
    socket.on('sessionTaken', (data) => emitLocal('sessionTaken', data));
  }

  function on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(fn);
  }

  function off(name, fn) {
    if (!handlers.has(name)) return;
    handlers.set(name, handlers.get(name).filter(h => h !== fn));
  }

  function emitLocal(name, data) {
    if (!handlers.has(name)) return;
    handlers.get(name).forEach(fn => {
      try { fn(data); } catch (e) { console.error(e); }
    });
  }

  function send(event, payload) {
    if (!socket) {
      connect();
    }
    if (socket && socket.connected) {
      socket.emit(event, payload);
      return true;
    }
    // 连接中：排队，避免一点击就报「尚未连接」
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push({ event, payload });
    emitLocal('send_queued', { event, message: '正在连接…' });
    if (socket && !socket.connected) {
      try { socket.connect(); } catch (e) { /* ignore */ }
    }
    return false;
  }

  function isConnected() {
    return !!(socket && socket.connected);
  }

  return {
    connect,
    on,
    off,
    send,
    isConnected,
    localizeConnectError,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NetworkService;
}
