// 棋盘交互：点击、拖拽、命中测试、合法走法提示、选中态、上一步高亮
const BoardInteraction = (() => {
  let canvas = null;
  let bound = false;

  function init(canvasEl) {
    canvas = canvasEl;
    if (!canvas || bound) return;
    bound = true;
    bindEvents();
  }

  function bindEvents() {
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseup', onCanvasMouseUp);
    canvas.addEventListener('mouseleave', onCanvasMouseUp);
  }

  let dragStartX = 0;
  let dragStartY = 0;

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    // 使用逻辑尺寸映射，避免 DPR / 浏览器缩放导致坐标与画面错位、拉伸感
    const logical = (typeof ChessBoard.getLogicalSize === 'function')
      ? ChessBoard.getLogicalSize()
      : { w: canvas.width, h: canvas.height };
    const scaleX = (logical.w || rect.width) / Math.max(rect.width, 1);
    const scaleY = (logical.h || rect.height) / Math.max(rect.height, 1);
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return { x, y, rect, scaleX, scaleY };
  }

  function toBoardPos(e) {
    const { x, y } = getCanvasPos(e);
    return ChessBoard.toBoardPos(x, y);
  }

  function onCanvasClick(e) {
    if (window._wasDragMove) { window._wasDragMove = false; return; }
    const pos = toBoardPos(e);
    if (pos) {
      if (typeof ChessGame.handleClick === 'function') ChessGame.handleClick(pos.row, pos.col);
    }
  }

  function onCanvasMouseDown(e) {
    if (e.button !== 0) return;
    const pos = toBoardPos(e);
    if (!pos) return;
    const { x, y } = getCanvasPos(e);
    dragStartX = x;
    dragStartY = y;
    window._wasDragMove = false;
    if (typeof ChessGame.startDrag === 'function') ChessGame.startDrag(pos.row, pos.col);
  }

  function onCanvasMouseMove(e) {
    if (typeof ChessGame.isDragging !== 'function' || !ChessGame.isDragging()) return;
    const { x, y } = getCanvasPos(e);
    if (Math.abs(x - dragStartX) > 4 || Math.abs(y - dragStartY) > 4) {
      window._wasDragMove = true;
    }
    ChessGame.updateDrag(x, y);
  }

  function onCanvasMouseUp(e) {
    if (typeof ChessGame.isDragging !== 'function' && !window._boardDragActive) return;
    window._boardDragActive = false;
    const pos = toBoardPos(e);
    if (typeof ChessGame.endDrag === 'function') {
      const moved = ChessGame.endDrag(pos ? pos.row : -1, pos ? pos.col : -1);
      // 拖拽完成走子后，抑制紧随其后的 click，避免二次选子
      if (moved) window._wasDragMove = true;
    }
  }

  return { init, toBoardPos };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoardInteraction;
}
