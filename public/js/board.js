// 棋盘 Canvas 渲染 — 支持视角翻转
const ChessBoard = (() => {
  let canvas, ctx;
  let liveCanvas = null;
  let liveCtx = null;
  let livePreviewEnabled = false;
  let cellSize = 64;
  let padding = 40;
  let pieceRadius = 26;
  let flipped = false;
  let lastLayoutKey = '';
  let logicalW = 0;
  let logicalH = 0;
  let currentDpr = 1;

  // 脏标记
  let lastBoardHash = '';
  let lastSelectedHash = '';
  let lastMoveHash = '';
  let lastCheckState = false;
  let lastFlipped = null;
  let forceRedraw = true;

  // 纸张纹理缓存
  let textureCanvas = null;
  let textureW = 0, textureH = 0;

  // 走子飞行动画
  let flightAnims = [];
  const FLIGHT_DURATION = 160;
  const FLIGHT_ARC = 18;

  // 拖拽状态
  let dragState = null;

  // 选中动画
  let selectedAnim = { active: false, time: 0 };

  const COLORS = {
    bg: '#e8d5b0',
    line: '#5a5040',
    lineLight: '#8a7a65',
    redPiece: '#8b3a2a',
    blackPiece: '#1a1a1e',
    pieceBg: '#f5e6d0',
    pieceBgInner: '#faf0e0',
    pieceBorder: '#9a8a70',
    pieceBorderLight: '#c8b898',
    selected: 'rgba(160,150,130,0.2)',
    selectedBorder: 'rgba(160,150,130,0.5)',
    validMove: 'rgba(100,95,80,0.5)',
    lastMove: 'rgba(180,160,120,0.12)',
    check: 'rgba(160,80,60,0.2)',
    checkBorder: 'rgba(160,80,60,0.5)',
    redGlow: 'rgba(220,80,60,0.35)',
    blackGlow: 'rgba(120,80,180,0.25)',
    redMarker: 'rgba(200,90,70,0.7)',
    blackMarker: 'rgba(80,80,140,0.6)',
  };

  // ===== 纸张纹理 =====
  function generateTexture(w, h) {
    const tc = document.createElement('canvas');
    tc.width = w;
    tc.height = h;
    const tctx = tc.getContext('2d');
    tctx.fillStyle = '#e8d5b0';
    tctx.fillRect(0, 0, w, h);
    const imgData = tctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      data[i]     = Math.min(255, Math.max(0, data[i] + n));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
    }
    tctx.putImageData(imgData, 0, 0);
    return tc;
  }

  function getTexture() {
    if (!textureCanvas || textureW !== canvas.width || textureH !== canvas.height) {
      textureW = canvas.width;
      textureH = canvas.height;
      textureCanvas = generateTexture(textureW, textureH);
    }
    return textureCanvas;
  }

  // ===== 初始化 =====
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
  }

  function initLivePreview(canvasEl) {
    liveCanvas = canvasEl || null;
    liveCtx = liveCanvas ? liveCanvas.getContext('2d') : null;
  }

  function setLivePreviewEnabled(enabled) {
    livePreviewEnabled = !!enabled && !!liveCanvas;
    lastLayoutKey = '';
    forceRedraw = true;
    resize();
    // resize 会重置 canvas 像素缓冲，立刻留白；由调用方随后 render / renderLive
  }

  function isLivePreviewEnabled() {
    return livePreviewEnabled;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // 宽屏横屏 → 左右；窄屏或竖/方屏 → 上下
  function resolveLayoutMode() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = w / Math.max(h, 1);
    // 左右：足够宽，且明显偏横（宽高比 > 1.05）
    if (w >= 900 && ratio > 1.05) return 'row';
    if (w >= 960) return 'row';
    return 'stack';
  }

  function applyLayoutMode(mode) {
    const game = document.getElementById('gameContainer');
    if (!game) return mode;
    game.classList.toggle('layout-row', mode === 'row');
    game.classList.toggle('layout-stack', mode === 'stack');
    return mode;
  }

  function applyCanvasTransform() {
    if (!ctx) return;
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
  }

  function getViewportSize() {
    if (window.visualViewport) {
      return {
        w: window.visualViewport.width,
        h: window.visualViewport.height
      };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function applyCanvasSize(targetCanvas, targetCtx, cssW, cssH, dpr) {
    if (!targetCanvas || !targetCtx) return;
    const bufW = Math.round(cssW * dpr);
    const bufH = Math.round(cssH * dpr);
    targetCanvas.style.width = cssW + 'px';
    targetCanvas.style.height = cssH + 'px';
    targetCanvas.style.maxWidth = '';
    targetCanvas.style.aspectRatio = '';
    if (targetCanvas.width !== bufW) targetCanvas.width = bufW;
    if (targetCanvas.height !== bufH) targetCanvas.height = bufH;
    targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    if (!canvas) return;

    const compact = document.body.classList.contains('compact');
    const popup = document.body.classList.contains('popup-mode');
    const sidePanel = document.querySelector('.side-panel');
    const panelHidden = compact || popup ||
      (sidePanel && getComputedStyle(sidePanel).display === 'none');
    const sandboxDual = livePreviewEnabled;

    let mode = applyLayoutMode(panelHidden ? 'stack' : resolveLayoutMode());
    if (sandboxDual) mode = applyLayoutMode('row');
    const vp = getViewportSize();

    const header = document.querySelector('.game-header');
    const headerH = sandboxDual
      ? 0
      : (header ? Math.ceil(header.getBoundingClientRect().height) + 6 : 48);
    const sandboxBar = document.getElementById('sandboxBar');
    let sandboxBarH = 0;
    if (sandboxDual && sandboxBar && !sandboxBar.hidden) {
      sandboxBarH = Math.max(48, Math.ceil(sandboxBar.getBoundingClientRect().height) + 8);
    }
    // 沙盘对开：预留标题区，避免棋盘底部被裁切
    const chromeH = sandboxDual ? 88 : 0;
    const padX = sandboxDual ? 48 : (popup ? 16 : 28);
    const padY = sandboxDual ? 36 : (popup ? 6 : 10);
    // 玩家信息：大窗在左侧；小窗改为棋盘上下条，不占侧边宽度
    const railEl = document.querySelector('.player-rails');
    const statusRow = document.querySelector('.match-status-row');
    const railGap = 12;
    const railFallback = compact ? 112 : 128;
    let railW = 0;
    let barH = 0;
    let statusH = 0;
    if (!sandboxDual && railEl && getComputedStyle(railEl).display !== 'none') {
      if (popup) {
        // display:contents 时宽度不可用，按上下两条横条预留高度
        barH = 72;
        const blackBar = document.getElementById('blackBar');
        const redBar = document.getElementById('redBar');
        let measured = 0;
        if (blackBar) measured += Math.ceil(blackBar.getBoundingClientRect().height) || 32;
        if (redBar) measured += Math.ceil(redBar.getBoundingClientRect().height) || 32;
        if (measured > 40) barH = measured + 12;
      } else {
        const measured = Math.ceil(railEl.getBoundingClientRect().width);
        railW = (measured > 40 ? measured : railFallback) + railGap;
      }
    }
    if (!sandboxDual && !popup && statusRow && getComputedStyle(statusRow).display !== 'none') {
      statusH = Math.ceil(statusRow.getBoundingClientRect().height) + 8;
      if (statusH < 8) statusH = 28;
    }
    const gaps = sandboxDual ? 16 : 0;
    let sideW = 0;
    if (!sandboxDual && !panelHidden && sidePanel) {
      const sw = Math.ceil(sidePanel.getBoundingClientRect().width);
      sideW = sw > 40 ? sw : 298;
    }
    const bottomH = sandboxDual || panelHidden ? 0 : 132;

    let availW;
    let availH;
    if (mode === 'row') {
      availW = Math.max(vp.w - padX - sideW - railW, 160);
      availH = Math.max(vp.h - headerH - sandboxBarH - chromeH - padY - gaps - statusH - barH, 140);
      if (sandboxDual) {
        availW = Math.max(Math.floor(availW / 2) - 12, 140);
      }
    } else {
      availW = Math.max(vp.w - padX - railW, 160);
      availH = Math.max(vp.h - headerH - bottomH - padY - gaps - statusH - barH, 140);
    }

    // 略收紧留白系数，让棋盘吃满可用区域
    let cs = Math.floor(Math.min(availW / 9.05, availH / 10.15));
    const minCs = popup ? 28 : (compact ? 28 : (sandboxDual ? 20 : 36));
    const maxCs = popup ? 72 : (compact ? 64 : (sandboxDual ? 56 : 108));
    cs = clamp(cs, minCs, maxCs);

    let pad = Math.floor(cs * (popup ? 0.52 : 0.58));
    if (cs * 8 + pad * 2 > availW) {
      cs = clamp(Math.floor(availW / 9.05), minCs, maxCs);
      pad = Math.floor(cs * (popup ? 0.52 : 0.58));
    }
    if (cs * 9 + pad * 2 > availH) {
      cs = clamp(Math.floor(availH / 10.15), minCs, maxCs);
      pad = Math.floor(cs * (popup ? 0.52 : 0.58));
    }

    cellSize = cs;
    padding = pad;
    pieceRadius = Math.floor(cs * 0.4);

    const cssW = cs * 8 + padding * 2;
    const cssH = cs * 9 + padding * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const layoutKey = mode + ':' + (sandboxDual ? 'dual:' : '') + cssW + 'x' + cssH + '@' + dpr.toFixed(3);
    const bufW = Math.round(cssW * dpr);
    const bufH = Math.round(cssH * dpr);
    const liveNeedsSync = !!(liveCanvas && livePreviewEnabled &&
      (liveCanvas.width !== bufW || liveCanvas.height !== bufH ||
        liveCanvas.style.width !== (cssW + 'px')));

    if (layoutKey === lastLayoutKey && canvas.width === bufW && canvas.height === bufH && !liveNeedsSync) {
      return;
    }
    lastLayoutKey = layoutKey;
    logicalW = cssW;
    logicalH = cssH;
    currentDpr = dpr;

    applyCanvasSize(canvas, ctx, cssW, cssH, dpr);
    if (liveCanvas && liveCtx) {
      applyCanvasSize(liveCanvas, liveCtx, cssW, cssH, dpr);
    }
    textureCanvas = null;
    forceRedraw = true;

    const game = document.getElementById('gameContainer');
    if (game) {
      game.style.setProperty('--board-w', cssW + 'px');
    }
  }

  function setFlipped(f) {
    const next = !!f;
    if (flipped !== next) {
      flipped = next;
      forceRedraw = true;
    }
    const game = document.getElementById('gameContainer');
    if (game) game.classList.toggle('board-flipped', flipped);
  }
  function isFlipped() { return flipped; }

  // ===== 坐标转换 =====
  function toPixel(dataRow, dataCol) {
    const dr = flipped ? (9 - dataRow) : dataRow;
    const dc = flipped ? (8 - dataCol) : dataCol;
    return { x: padding + dc * cellSize, y: padding + dr * cellSize };
  }

  function toBoardPos(px, py) {
    let dc = Math.round((px - padding) / cellSize);
    let dr = Math.round((py - padding) / cellSize);
    if (dr < 0 || dr >= ROWS || dc < 0 || dc >= COLS) return null;
    const dataRow = flipped ? (9 - dr) : dr;
    const dataCol = flipped ? (8 - dc) : dc;
    return { row: dataRow, col: dataCol };
  }

  // ===== 棋盘边框随回合变色 =====
  function updateBoardBorder(turn, inCheck) {
    const styles = getComputedStyle(document.documentElement);
    const cssVar = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    if (inCheck) {
      canvas.style.borderColor = cssVar('--board-border-check', 'rgba(200,60,40,0.5)');
      canvas.style.boxShadow = cssVar('--board-shadow-check', '0 0 30px rgba(200,60,40,0.15), 0 0 60px rgba(200,60,40,0.06), 0 2px 24px rgba(0,0,0,0.25)');
    } else if (turn === RED) {
      canvas.style.borderColor = cssVar('--board-border-red', 'rgba(180,80,60,0.2)');
      canvas.style.boxShadow = cssVar('--board-shadow-red', '0 0 24px rgba(180,80,60,0.06), 0 2px 24px rgba(0,0,0,0.25)');
    } else {
      canvas.style.borderColor = cssVar('--board-border-black', 'rgba(60,60,100,0.15)');
      canvas.style.boxShadow = cssVar('--board-shadow-black', '0 0 24px rgba(60,60,100,0.04), 0 2px 24px rgba(0,0,0,0.25)');
    }
  }

  // ===== 棋盘线 =====
  function drawBoardLines() {
    applyCanvasTransform();
    const tex = getTexture();
    // 纹理按逻辑尺寸绘制（缓冲区分辨率为 DPR 倍）
    ctx.drawImage(tex, 0, 0, logicalW || canvas.width, logicalH || canvas.height);

    // 微妙的横向纹理
    ctx.strokeStyle = 'rgba(160,140,110,0.08)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r < ROWS; r++) {
      const y = padding + r * cellSize + cellSize * 0.5;
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(padding + 8 * cellSize, y); ctx.stroke();
    }

    // 主线条
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    for (let r = 0; r < ROWS; r++) {
      const y = padding + r * cellSize;
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(padding + 8 * cellSize, y); ctx.stroke();
    }
    for (let c = 0; c < COLS; c++) {
      const x = padding + c * cellSize;
      ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, padding + 4 * cellSize); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, padding + 5 * cellSize); ctx.lineTo(x, padding + 9 * cellSize); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(padding, padding + 4 * cellSize); ctx.lineTo(padding, padding + 5 * cellSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padding + 8 * cellSize, padding + 4 * cellSize); ctx.lineTo(padding + 8 * cellSize, padding + 5 * cellSize); ctx.stroke();

    // 九宫格斜线
    const palaces = [[3,0,5,2],[5,0,3,2],[3,7,5,9],[5,7,3,9]];
    palaces.forEach(([c1,r1,c2,r2]) => {
      const p1 = toPixel(r1, c1);
      const p2 = toPixel(r2, c2);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    });

    // 柔边框
    const bx = padding - 6, by = padding - 6;
    const bw = 8 * cellSize + 12, bh = 9 * cellSize + 12;
    const gw = 14;
    const edge = 'rgba(90,80,70,0.06)';
    const clear = 'rgba(90,80,70,0)';
    const gTop = ctx.createLinearGradient(bx, by, bx, by + gw);
    gTop.addColorStop(0, edge); gTop.addColorStop(1, clear);
    ctx.fillStyle = gTop; ctx.fillRect(bx, by, bw, gw);
    const gBot = ctx.createLinearGradient(bx, by + bh, bx, by + bh - gw);
    gBot.addColorStop(0, edge); gBot.addColorStop(1, clear);
    ctx.fillStyle = gBot; ctx.fillRect(bx, by + bh - gw, bw, gw);
    const gLeft = ctx.createLinearGradient(bx, by, bx + gw, by);
    gLeft.addColorStop(0, edge); gLeft.addColorStop(1, clear);
    ctx.fillStyle = gLeft; ctx.fillRect(bx, by, gw, bh);
    const gRight = ctx.createLinearGradient(bx + bw, by, bx + bw - gw, by);
    gRight.addColorStop(0, edge); gRight.addColorStop(1, clear);
    ctx.fillStyle = gRight; ctx.fillRect(bx + bw - gw, by, gw, bh);
    // 楚河汉界
    ctx.fillStyle = COLORS.line;
    ctx.font = `500 ${Math.floor(cellSize * 0.34)}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const riverY = padding + 4.5 * cellSize;
    if (flipped) {
      ctx.fillText('汉 界', padding + 2 * cellSize, riverY);
      ctx.fillText('楚 河', padding + 6 * cellSize, riverY);
    } else {
      ctx.fillText('楚 河', padding + 2 * cellSize, riverY);
      ctx.fillText('汉 界', padding + 6 * cellSize, riverY);
    }

    // 列标 — 简约数字
    ctx.font = `${Math.floor(cellSize * 0.22)}px "SF Mono","Fira Code","Consolas",monospace`;
    ctx.fillStyle = COLORS.lineLight;
    const labels = ['9','8','7','6','5','4','3','2','1'];
    for (let c = 0; c < 9; c++) {
      const bottomY = padding + 9 * cellSize + cellSize * 0.32;
      ctx.fillText(labels[c], padding + c * cellSize, bottomY);
    }
    const topLabels = flipped ? ['1','2','3','4','5','6','7','8','9'] : ['9','8','7','6','5','4','3','2','1'];
    for (let c = 0; c < 9; c++) {
      ctx.fillText(topLabels[c], padding + c * cellSize, padding - cellSize * 0.22);
    }
  }

  // ===== 上一步标记（● ◎） =====
  function drawLastMoveMarkers(from, to, moveColor) {
    if (!from || !to) return;
    const markerColor = moveColor === RED ? COLORS.redMarker : COLORS.blackMarker;

    // ● 起始格
    const fp = toPixel(from.row, from.col);
    ctx.fillStyle = markerColor;
    ctx.beginPath(); ctx.arc(fp.x, fp.y, 3.5, 0, Math.PI * 2); ctx.fill();

    // ◎ 目标格
    const tp = toPixel(to.row, to.col);
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(tp.x, tp.y, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = markerColor;
    ctx.beginPath(); ctx.arc(tp.x, tp.y, 2, 0, Math.PI * 2); ctx.fill();
  }

  // ===== 选中棋子光晕 + 名称标签 =====
  function drawSelectionGlow(x, y, piece) {
    // 金色外发光
    const glowGrad = ctx.createRadialGradient(x, y, pieceRadius * 0.5, x, y, pieceRadius * 1.7);
    glowGrad.addColorStop(0, 'rgba(200,170,100,0.3)');
    glowGrad.addColorStop(0.5, 'rgba(200,170,100,0.1)');
    glowGrad.addColorStop(1, 'rgba(200,170,100,0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath(); ctx.arc(x, y, pieceRadius * 1.7, 0, Math.PI * 2); ctx.fill();

    // 金色边框
    ctx.strokeStyle = 'rgba(200,170,100,0.6)';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(x, y, pieceRadius + 2.5, 0, Math.PI * 2); ctx.stroke();

    // 内圈细线
    ctx.strokeStyle = 'rgba(200,170,100,0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, pieceRadius + 5, 0, Math.PI * 2); ctx.stroke();
  }

  function drawSelectionLabel(x, y, piece) {
    const labelText = piece.color === RED
      ? `红${PIECE_NAMES[RED][piece.type]}`
      : `黑${PIECE_NAMES[BLACK][piece.type]}`;
    ctx.font = `500 ${Math.floor(pieceRadius * 0.48)}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const metrics = ctx.measureText(labelText);
    const lw = metrics.width + 12;
    const lh = 18;
    const lx = x - lw / 2;
    const ly = y + pieceRadius + 6;

    ctx.fillStyle = 'rgba(47,47,47,0.92)';
    ctx.beginPath();
    ctx.roundRect(lx, ly, lw, lh, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(lx, ly, lw, lh, 8);
    ctx.stroke();

    ctx.fillStyle = 'rgba(236,236,236,0.95)';
    ctx.fillText(labelText, x, ly + 3);
  }

  // ===== 棋子（玉石质感） =====
  function drawPieceOnCanvas(x, y, piece, scale, alpha, floatOffset) {
    const r = pieceRadius * scale;
    const fy = y + (floatOffset || 0);
    ctx.globalAlpha = alpha;

    // 棋子底色 - 玉质感径向渐变
    const grad = ctx.createRadialGradient(
      x - r * 0.2, fy - r * 0.25, r * 0.05,
      x, fy, r
    );
    grad.addColorStop(0, '#faf5eb');
    grad.addColorStop(0.3, '#f5e8d0');
    grad.addColorStop(0.7, '#e8d5b5');
    grad.addColorStop(1, '#d4c0a0');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, fy, r, 0, Math.PI * 2); ctx.fill();

    // 内阴影效果（模拟棋子厚度）
    const innerGrad = ctx.createRadialGradient(x, fy, r * 0.75, x, fy, r);
    innerGrad.addColorStop(0, 'rgba(0,0,0,0)');
    innerGrad.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = innerGrad;
    ctx.beginPath(); ctx.arc(x, fy, r, 0, Math.PI * 2); ctx.fill();

    // 边框 - 红方朱砂金边 / 黑方墨玉银边
    if (piece.color === RED) {
      ctx.strokeStyle = '#8b3a2a';
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath(); ctx.arc(x, fy, r, 0, Math.PI * 2); ctx.stroke();
      // 金色内细线
      ctx.strokeStyle = 'rgba(200,170,100,0.4)';
      ctx.lineWidth = 0.7 * scale;
      ctx.beginPath(); ctx.arc(x, fy, r - 3.5 * scale, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = '#3a3a40';
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath(); ctx.arc(x, fy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(180,180,200,0.3)';
      ctx.lineWidth = 0.7 * scale;
      ctx.beginPath(); ctx.arc(x, fy, r - 3.5 * scale, 0, Math.PI * 2); ctx.stroke();
    }

    // 棋子文字 - 朱红/墨黑
    ctx.fillStyle = piece.color === RED ? '#8b3a2a' : '#2a2a2e';
    ctx.font = `400 ${Math.floor(r * 1.15)}px "STKaiti","KaiTi","楷体","SimSun","宋体",serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const displayName = piece.color === BLACK
      ? PIECE_NAMES_TRAD[BLACK][piece.type]
      : PIECE_NAMES[RED][piece.type];
    ctx.fillText(displayName, x, fy + 1);

    ctx.globalAlpha = 1;
  }

  function drawPiece(dataRow, dataCol, piece, isSelected, isCheck) {
    const { x, y } = toPixel(dataRow, dataCol);

    // 选中光晕（画在棋子后面）
    if (isSelected) {
      drawSelectionGlow(x, y, piece);
    }

    // 将军光圈 - 呼吸闪烁
    if (isCheck && piece.type === KING) {
      const t = (performance.now() % 1500) / 1500;
      const alpha = 0.3 + Math.sin(t * Math.PI * 2) * 0.25;
      ctx.strokeStyle = `rgba(200,80,60,${alpha})`;
      ctx.lineWidth = 2 + Math.sin(t * Math.PI * 2) * 1;
      ctx.beginPath(); ctx.arc(x, y, pieceRadius + 4, 0, Math.PI * 2); ctx.stroke();
    }

    // 选中时棋子放大10% + 上浮5px
    const scale = isSelected ? 1.1 : 1.0;
    const floatOffset = isSelected ? -5 : 0;
    drawPieceOnCanvas(x, y, piece, scale, 1, floatOffset);

    // 选中名称标签
    if (isSelected) {
      drawSelectionLabel(x, y + floatOffset, piece);
    }
  }

  // ===== 上一步高亮 =====
  function drawLastMove(from, to) {
    if (!from || !to) return;
    [from, to].forEach(pos => {
      const { x, y } = toPixel(pos.row, pos.col);
      ctx.fillStyle = COLORS.lastMove;
      ctx.fillRect(x - cellSize * 0.42, y - cellSize * 0.42, cellSize * 0.84, cellSize * 0.84);
    });
  }

  // ===== 合法走法提示 — 水波涟漪 =====
  function drawValidMoves(validMoves, board, now) {
    validMoves.forEach(move => {
      const { x, y } = toPixel(move.row, move.col);
      const target = board[move.row][move.col];
      if (target) {
        const t = (now % 2500) / 2500;
        const alpha = 0.18 + Math.sin(t * Math.PI * 2) * 0.08;
        ctx.strokeStyle = `rgba(100,85,60,${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, pieceRadius + 2, 0, Math.PI * 2); ctx.stroke();
      } else {
        const t = (now % 3000) / 3000;
        const r = 4 + Math.sin(t * Math.PI * 2) * 0.8;
        const alpha = 0.35 + Math.sin(t * Math.PI * 2) * 0.08;
        ctx.fillStyle = `rgba(100,90,70,${alpha})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  // ===== 走子飞行动画（带水墨拖尾） =====
  function triggerFlightAnim(fromRow, fromCol, toRow, toCol, piece) {
    const from = toPixel(fromRow, fromCol);
    const to = toPixel(toRow, toCol);
    flightAnims.push({
      fromRow, fromCol, toRow, toCol,
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
      piece: { ...piece },
      startTime: performance.now(),
      duration: FLIGHT_DURATION
    });
  }

  function isFlyingTo(row, col) {
    return flightAnims.some(f => f.toRow === row && f.toCol === col);
  }

  function drawFlightAnims(now) {
    flightAnims = flightAnims.filter(anim => {
      const elapsed = now - anim.startTime;
      if (elapsed > anim.duration) return false;

      const t = elapsed / anim.duration;
      const eased = 1 - Math.pow(1 - t, 3);
      const x = anim.fromX + (anim.toX - anim.fromX) * eased;
      const baseY = anim.fromY + (anim.toY - anim.fromY) * eased;
      const arcY = -Math.sin(t * Math.PI) * FLIGHT_ARC;
      const y = baseY + arcY;

      // 水墨拖尾：3个渐隐残影
      const trailCount = 3;
      for (let i = trailCount; i >= 1; i--) {
        const trailT = Math.max(0, t - i * 0.06);
        const trailEased = 1 - Math.pow(1 - trailT, 3);
        const tx = anim.fromX + (anim.toX - anim.fromX) * trailEased;
        const ty = anim.fromY + (anim.toY - anim.fromY) * trailEased;
        const trailAlpha = (1 - i / (trailCount + 1)) * 0.12 * (1 - t);
        if (trailAlpha > 0.005) {
          ctx.globalAlpha = trailAlpha;
          ctx.fillStyle = '#5a5040';
          ctx.beginPath(); ctx.arc(tx, ty, pieceRadius * (0.9 - i * 0.08), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // 落子前最后阶段添加微小的阴影
      if (t > 0.7) {
        const shadowAlpha = (t - 0.7) / 0.3 * 0.12;
        ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
        ctx.beginPath(); ctx.arc(x, y + pieceRadius + 2, pieceRadius * 0.8, 0, Math.PI * 2); ctx.fill();
      }

      drawPieceOnCanvas(x, y, anim.piece, 1.0, 1);
      return true;
    });
  }

  // ===== 吃子动画 — 简约版 =====
  let captureAnims = [];
  const CAPTURE_DURATION = 2200;

  function triggerCaptureAnim(dataRow, dataCol, capturedPiece) {
    const { x, y } = toPixel(dataRow, dataCol);
    captureAnims.push({
      x, y, startTime: performance.now(), duration: CAPTURE_DURATION,
      capturedName: PIECE_NAMES[capturedPiece.color][capturedPiece.type],
      baseR: pieceRadius
    });
  }

  function drawCaptureAnims(now) {
    captureAnims = captureAnims.filter(anim => {
      const elapsed = now - anim.startTime;
      if (elapsed > anim.duration) return false;
      const t = elapsed / anim.duration;

      // 扩散光环
      if (t < 0.35) {
        const st = t / 0.35;
        const alpha = (1 - st) * 0.2;
        ctx.strokeStyle = `rgba(140,120,90,${alpha})`;
        ctx.lineWidth = 1.5 * (1 - st);
        ctx.beginPath(); ctx.arc(anim.x, anim.y, anim.baseR * (1 + st * 2), 0, Math.PI * 2); ctx.stroke();
      }

      // 棋子名上浮
      if (t > 0.05 && t < 0.5) {
        const st = (t - 0.05) / 0.45;
        const alpha = st < 0.2 ? st / 0.2 : (1 - (st - 0.2) / 0.8);
        const ty = anim.y - anim.baseR * 0.5 - st * anim.baseR * 1.5;
        ctx.save(); ctx.translate(anim.x, ty);
        ctx.font = `400 ${Math.floor(anim.baseR * 0.75)}px "KaiTi","楷体",serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(140,100,70,${alpha * 0.6})`;
        ctx.fillText(anim.capturedName, 0, 0);
        ctx.restore();
      }

      // 残留圈
      if (t > 0.4) {
        const st = (t - 0.4) / 0.6;
        ctx.strokeStyle = `rgba(140,120,90,${(1 - st) * 0.06})`;
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(anim.x, anim.y, anim.baseR * (1 + st * 0.4), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      return true;
    });
  }

  // ===== 状态哈希 =====
  function boardHash(board) {
    let h = '';
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        h += p ? p.color[0] + p.type[0] : '.';
      }
    return h;
  }

  // ===== 动画循环 =====
  let animFrameId = null;
  let lastGameState = null;
  let hasAnim = false;
  let animFrameCount = 0;

  function animLoop() {
    if (!lastGameState) { animFrameId = null; return; }
    fullRender(lastGameState, true);
    animFrameCount++;
    if (hasAnim) {
      animFrameId = requestAnimationFrame(animLoop);
    } else {
      animFrameId = null;
      animFrameCount = 0;
      // 动画结束后强制重绘，确保棋子出现在目标位置
      forceRedraw = true;
      if (lastGameState) {
        fullRender(lastGameState, false);
      }
      forceRedraw = false;
    }
  }

  function startAnimIfNeeded() {
    if (!animFrameId) {
      animFrameId = requestAnimationFrame(animLoop);
    }
  }

  function stopAnim() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    animFrameCount = 0;
  }

  // ===== 完整重绘 =====
  function fullRender(gameState, isAnimFrame) {
    const { board, selectedPos, validMoves, lastMove, inCheck } = gameState;
    const now = performance.now();

    const hash = boardHash(board);
    const selHash = selectedPos ? selectedPos.row + ',' + selectedPos.col : '';
    const movHash = lastMove ? lastMove.from.row+','+lastMove.from.col+'-'+lastMove.to.row+','+lastMove.to.col : '';
    const boardChanged = hash !== lastBoardHash || selHash !== lastSelectedHash || movHash !== lastMoveHash || inCheck !== lastCheckState || flipped !== lastFlipped || forceRedraw;

    if (boardChanged) {
      lastBoardHash = hash; lastSelectedHash = selHash; lastMoveHash = movHash;
      lastCheckState = inCheck; lastFlipped = flipped; forceRedraw = false;
      drawBoardLines();
      if (lastMove) {
        drawLastMove(lastMove.from, lastMove.to);
        drawLastMoveMarkers(lastMove.from, lastMove.to, lastMove.color);
      }
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const piece = board[r][c];
          if (!piece) continue;
          // 跳过正在飞行的目标位置
          if (isFlyingTo(r, c)) continue;
          const isSel = selectedPos && selectedPos.row === r && selectedPos.col === c;
          drawPiece(r, c, piece, isSel, inCheck && piece.type === KING);
        }
      // 更新棋盘边框颜色
      if (gameState.currentTurn) updateBoardBorder(gameState.currentTurn, gameState.inCheck);
    }

    const hasValid = validMoves && validMoves.length > 0;
    const hasCapture = captureAnims.length > 0;
    const hasFlight = flightAnims.length > 0;
    hasAnim = false;

    if (hasValid || hasCapture || hasFlight) {
      if (!boardChanged) {
        drawBoardLines();
        if (lastMove) {
          drawLastMove(lastMove.from, lastMove.to);
          drawLastMoveMarkers(lastMove.from, lastMove.to, lastMove.color);
        }
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            if (isFlyingTo(r, c)) continue;
            const isSel = selectedPos && selectedPos.row === r && selectedPos.col === c;
            drawPiece(r, c, piece, isSel, inCheck && piece.type === KING);
          }
      }
      if (hasFlight) { drawFlightAnims(now); hasAnim = true; }
      if (hasValid) { drawValidMoves(validMoves, board, now); hasAnim = true; }
      if (hasCapture) { drawCaptureAnims(now); hasAnim = true; }
      drawDragPreview();
    }
  }

  // ===== 主渲染入口 =====
  function render(gameState) {
    if (!canvas || !ctx) return;
    applyCanvasTransform();
    lastGameState = gameState;
    fullRender(gameState, false);

    if (hasAnim) {
      startAnimIfNeeded();
    } else {
      stopAnim();
    }
  }

  /** 沙盘左侧：只读静态局面（绝不动飞行/吃子动画状态） */
  function renderLive(gameState) {
    if (!livePreviewEnabled || !liveCanvas || !liveCtx || !gameState || !gameState.board) return;

    const savedCanvas = canvas;
    const savedCtx = ctx;
    canvas = liveCanvas;
    ctx = liveCtx;
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

    drawBoardLines();
    const lastMove = gameState.lastMove || null;
    if (lastMove && lastMove.from && lastMove.to) {
      drawLastMove(lastMove.from, lastMove.to);
      if (lastMove.color) drawLastMoveMarkers(lastMove.from, lastMove.to, lastMove.color);
    }
    const board = gameState.board;
    const inCheck = !!gameState.inCheck;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        drawPiece(r, c, piece, false, inCheck && piece.type === KING);
      }
    }

    liveCanvas.style.borderColor = 'rgba(120,110,95,0.22)';
    liveCanvas.style.boxShadow = '0 2px 16px rgba(0,0,0,0.18)';

    canvas = savedCanvas;
    ctx = savedCtx;
    if (ctx) applyCanvasTransform();
  }

  function getCanvas() { return canvas; }
  function getCellSize() { return cellSize; }
  function getPadding() { return padding; }
  function getLogicalSize() {
    return { w: logicalW || (canvas ? canvas.width : 0), h: logicalH || (canvas ? canvas.height : 0) };
  }

  // ===== 拖拽状态 =====
  function setDrag(piece, fromRow, fromCol, px, py) {
    dragState = { piece, fromRow, fromCol, px, py, active: true };
  }
  function updateDrag(px, py) {
    if (dragState) { dragState.px = px; dragState.py = py; }
  }
  function clearDrag() { dragState = null; }
  function getDrag() { return dragState; }

  function drawDragPreview() {
    if (!dragState || !dragState.active) return;
    const { piece, px, py } = dragState;
    ctx.globalAlpha = 0.7;
    drawPieceOnCanvas(px, py, piece, 1.05, 0.7);
    ctx.globalAlpha = 1;
    // 拖拽轨迹线
    const from = toPixel(dragState.fromRow, dragState.fromCol);
    ctx.strokeStyle = 'rgba(200,184,138,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function clearFlightAnims() { flightAnims = []; }
  function clearCaptureAnims() { captureAnims = []; }

  return {
    init, initLivePreview, setLivePreviewEnabled, isLivePreviewEnabled, renderLive,
    render, toBoardPos, toPixel, getCanvas, getCellSize, getPadding, getLogicalSize, resize,
    triggerFlightAnim, triggerCaptureAnim, setFlipped, isFlipped,
    clearFlightAnims, clearCaptureAnims, updateBoardBorder,
    setDrag, updateDrag, clearDrag, getDrag, drawDragPreview
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChessBoard;
}
