// DOM 工具
const DOM = (() => {
  function el(id) {
    return document.getElementById(id);
  }

  function show(id) {
    const node = el(id);
    if (!node) return;
    node.style.display = '';
  }

  function hide(id) {
    const node = el(id);
    if (!node) return;
    node.style.display = 'none';
  }

  function toggleClass(node, name, force) {
    if (!node) return;
    if (typeof force === 'boolean') {
      node.classList.toggle(name, force);
    } else {
      node.classList.toggle(name);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function scrollToBottom(node) {
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }

  return { el, show, hide, toggleClass, escapeHtml, scrollToBottom };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOM;
}
