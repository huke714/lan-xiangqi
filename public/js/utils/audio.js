// 音效系统封装
const AppAudio = (() => {
  const wrapped = typeof ChessAudio !== 'undefined' ? ChessAudio : {};

  function safePlay(fnName) {
    try {
      if (typeof wrapped[fnName] === 'function') wrapped[fnName]();
    } catch (e) { /* ignore */ }
  }

  return {
    select: () => safePlay('select'),
    move: () => safePlay('move'),
    capture: () => safePlay('capture'),
    check: () => safePlay('check'),
    win: () => safePlay('win'),
    lose: () => safePlay('lose'),
    illegal: () => safePlay('illegal')
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppAudio;
}
