// 棋盘覆盖层：将军横幅、结算横幅
const BoardOverlay = (() => {
  function showCheckBanner() {
    const wrapper = document.querySelector('.board-wrapper');
    if (!wrapper) return;
    const old = wrapper.querySelector('.check-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.className = 'check-banner';
    banner.innerHTML = '将军！';
    wrapper.appendChild(banner);
    setTimeout(() => {
      banner.classList.add('fade-out');
      setTimeout(() => banner.remove(), 600);
    }, 1800);
  }

  function showResultBanner(title, message) {
    const wrapper = document.querySelector('.board-wrapper');
    if (!wrapper) return;
    const old = wrapper.querySelector('.check-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.className = 'check-banner result-banner';
    banner.innerHTML = title + '<br><small>' + message + '</small>';
    wrapper.appendChild(banner);
  }

  return { showCheckBanner, showResultBanner };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoardOverlay;
}
