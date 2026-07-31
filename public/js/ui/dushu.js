// 吐槽飘字逻辑
const DushuOverlay = (() => {
  const MESSAGES = [
    '😏 就这？', '😴 快点啊，等得花都谢了', '🤡 你这走的是什么啊', '💀 你已经无路可走了',
    '🦭 我都不好意思吃你这个子', '😂 笑死，这也叫下棋？', '🧠 用点脑子好不好', '🎯 别挣扎了，投降吧',
    '🔥 这把我要杀你个片甲不留', '😎 你已经被我看穿了', '🦆 菜得抠脚', '🎉 谢谢你送的子',
    '📉 你的水平在走下坡路啊', '🐌 你是在思考人生吗', '🥊 来吧，让你三步', '👋 再见了您嘞',
    '🫡 承让承让', '🥺 大佬饶命', '🎵 凉凉~', '🏆 冠军之路从你开始', '🪦 你已经可以写遗书了',
    '🍕 谢谢请客，这子真香', '🧓 你的棋路比你还老', '💤 催眠大师，走快点', '🎪 马戏团看了都直呼内行',
    '🫠 你怎么还在挣扎', '🏆 这局MVP非我莫属', '🧊 你的思路比冰箱还冷', '🎰 走棋跟摇彩票似的',
    '🐢 下棋还是在散步？'
  ];
  const MAX_BUBBLES = 3;
  let lastIndex = -1;

  function sendRandom() {
    if (document.body && document.body.classList.contains('popup-mode')) return;
    if (!NetworkService || !NetworkService.send) return;
    let idx;
    do { idx = Math.floor(Math.random() * MESSAGES.length); } while (idx === lastIndex && MESSAGES.length > 1);
    lastIndex = idx;
    const text = MESSAGES[idx];
    NetworkService.send('chatMessage', { message: text });
    showFloat(text, true);
  }

  function onReceive(message) {
    if (document.body && document.body.classList.contains('popup-mode')) return;
    // 兼容有 emoji 前缀的文案（跳过前两字符做匹配）
    const isDushu = MESSAGES.some(m =>
      message === m || message.includes(m) || message.includes(m.slice(2))
    );
    if (isDushu) showFloat(message, false);
  }

  function showFloat(text, isMe) {
    if (document.body && document.body.classList.contains('popup-mode')) return;
    const container = document.getElementById('dushuFloat');
    if (!container) return;

    const cap = MAX_BUBBLES;
    while (container.children.length >= cap) {
      container.removeChild(container.firstChild);
    }

    const bubble = document.createElement('div');
    bubble.className = 'dushu-bubble ' + (isMe ? 'from-me' : 'from-opponent');
    bubble.textContent = text;
    bubble.style.top = (20 + Math.random() * 50) + '%';
    container.appendChild(bubble);
    setTimeout(() => {
      if (bubble.parentNode) bubble.remove();
    }, 5200);
  }

  return { sendRandom, onReceive };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DushuOverlay;
}
