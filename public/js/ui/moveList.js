// 走棋记录逻辑 — 红黑分栏展示
const MoveListView = (() => {
  function formatNotation(record) {
    if (!record) return { text: '', mark: '' };
    let raw = '';
    if (typeof record.notation === 'string' && record.notation && record.notation !== 'undefined') {
      raw = record.notation;
    } else if (record.piece && record.piece.color && record.piece.type &&
        typeof PIECE_NAMES !== 'undefined' &&
        PIECE_NAMES[record.piece.color] &&
        PIECE_NAMES[record.piece.color][record.piece.type]) {
      raw = PIECE_NAMES[record.piece.color][record.piece.type];
    } else {
      raw = '—';
    }
    let mark = '';
    if (raw.endsWith('#') || record.isCheckmate) {
      mark = '杀';
      raw = raw.replace(/#+$/, '');
    } else if (raw.endsWith('+') || record.isCheck) {
      mark = '将';
      raw = raw.replace(/\++$/, '');
    }
    return { text: raw || '—', mark };
  }

  function makePly(color, formatted, isLatest) {
    const ply = document.createElement('div');
    ply.className = 'move-ply move-' + color + (isLatest ? ' is-latest' : '');
    const text = document.createElement('span');
    text.className = 'move-ply-text';
    text.textContent = formatted.text;
    ply.appendChild(text);
    if (formatted.mark) {
      const badge = document.createElement('span');
      badge.className = 'move-mark move-mark-' + (formatted.mark === '杀' ? 'mate' : 'check');
      badge.textContent = formatted.mark;
      badge.title = formatted.mark === '杀' ? '绝杀' : '将军';
      ply.appendChild(badge);
    }
    return ply;
  }

  function rebuild(history) {
    const container = document.getElementById('moveList');
    if (!container) return;
    container.innerHTML = '';
    const list = Array.isArray(history) ? history : [];
    const lastIdx = list.length - 1;

    for (let i = 0; i < list.length; i += 2) {
      const roundNo = Math.floor(i / 2) + 1;
      const round = document.createElement('div');
      round.className = 'move-round';

      const idx = document.createElement('div');
      idx.className = 'move-idx';
      idx.textContent = String(roundNo);
      round.appendChild(idx);

      const red = list[i];
      round.appendChild(makePly('red', formatNotation(red), i === lastIdx));

      if (i + 1 < list.length) {
        const black = list[i + 1];
        round.appendChild(makePly('black', formatNotation(black), i + 1 === lastIdx));
      } else {
        const empty = document.createElement('div');
        empty.className = 'move-ply move-empty';
        empty.setAttribute('aria-hidden', 'true');
        round.appendChild(empty);
      }

      container.appendChild(round);
    }
    DOM.scrollToBottom(container);
  }

  return { rebuild };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MoveListView;
}
