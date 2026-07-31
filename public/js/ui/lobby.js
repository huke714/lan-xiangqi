// 大厅页面逻辑
const LobbyView = (() => {
  function init() {
    bindEvents();
  }

  function bindEvents() {
    const btnCreate = document.querySelector('.lobby-panel .btn-primary');
    const btnJoin = document.querySelector('.lobby-panel .btn-join');
    const btnRefresh = document.querySelector('.room-refresh');
    const btnTheme = document.getElementById('btnThemeLobby');

    if (btnCreate) btnCreate.onclick = App.handleCreateRoom;
    if (btnJoin) btnJoin.onclick = App.handleJoinRoom;
    if (btnRefresh) btnRefresh.onclick = App.handleRefreshRooms;
    if (btnTheme) btnTheme.onclick = App.toggleTheme;

    // 房间列表点击由 App.renderRoomList 绑定，避免与观战/加入动作冲突
  }

  return { init };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LobbyView;
}
