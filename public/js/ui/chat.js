// 聊天区域逻辑
const ChatView = (() => {
  function init() {
    const input = document.getElementById('chatInput');
    const sendBtn = input ? input.nextElementSibling : null;
    if (sendBtn) sendBtn.onclick = App.sendChat;
    if (input) input.onkeypress = (e) => { if (e.key === 'Enter') App.sendChat(); };
  }

  function appendMessage(playerName, message) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<span class="name">' + DOM.escapeHtml(playerName) + ':</span> <span class="text">' + DOM.escapeHtml(message) + '</span>';
    container.appendChild(div);
    DOM.scrollToBottom(container);
  }

  return { init, appendMessage };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChatView;
}
