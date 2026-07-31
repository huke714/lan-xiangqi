// 对局会话：刷新后自动重连用
const SessionStore = (() => {
  const KEY = 'chess-session-v1';

  function read() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.roomId || !data.playerToken) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function save(partial) {
    const prev = read() || {};
    const next = {
      roomId: partial.roomId != null ? partial.roomId : prev.roomId,
      playerToken: partial.playerToken != null ? partial.playerToken : prev.playerToken,
      playerName: partial.playerName != null ? partial.playerName : prev.playerName,
      color: partial.color !== undefined ? partial.color : prev.color,
      isSpectator: partial.isSpectator != null ? !!partial.isSpectator : !!prev.isSpectator,
      savedAt: Date.now(),
    };
    if (!next.roomId || !next.playerToken) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) { /* ignore */ }
  }

  function clear() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { read, save, clear };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionStore;
}
