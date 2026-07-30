// 弹出窗口模式处理
const PopupFlow = (() => {
  function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('popup') !== '1') return false;

    document.body.classList.add('popup-mode');
    const roomId = params.get('room');
    const color = params.get('color');
    const name = params.get('name') || '玩家';

    if (roomId) {
      App.setPopupJoin(roomId, name, color);
    }

    return true;
  }

  return { init };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PopupFlow;
}
