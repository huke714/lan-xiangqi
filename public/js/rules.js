// 中国象棋规则引擎
const ChessRules = (() => {
  // 深拷贝棋盘
  function cloneBoard(board) {
    return board.map(row => row.map(cell => cell ? { ...cell } : null));
  }

  // 获取指定位置的棋子
  function getPiece(board, row, col) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return undefined;
    return board[row][col];
  }

  // 找到某方的将/帅位置
  function findKing(board, color) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (p && p.type === KING && p.color === color) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  // 判断位置是否在棋盘内
  function inBoard(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
  }

  // 判断是否在九宫格内
  function inPalace(row, col, color) {
    if (col < 3 || col > 5) return false;
    if (color === RED) return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
  }

  // 判断是否在己方半场
  function inOwnHalf(row, color) {
    if (color === RED) return row >= 5;
    return row <= 4;
  }

  // 获取某棋子的所有候选走法（不考虑将军）
  function getCandidateMoves(board, row, col) {
    const piece = getPiece(board, row, col);
    if (!piece) return [];
    const moves = [];
    const { type, color } = piece;

    switch (type) {
      case KING:
        // 将/帅：上下左右各一步，限九宫格（飞将只用于将军判定，不能当作可走吃王）
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
          const nr = row + dr, nc = col + dc;
          if (inPalace(nr, nc, color)) {
            const target = getPiece(board, nr, nc);
            if (!target || target.color !== color) {
              moves.push({ row: nr, col: nc });
            }
          }
        });
        break;

      case ADVISOR:
        // 仕/士：斜走一步，限九宫格
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
          const nr = row + dr, nc = col + dc;
          if (inPalace(nr, nc, color)) {
            const target = getPiece(board, nr, nc);
            if (!target || target.color !== color) {
              moves.push({ row: nr, col: nc });
            }
          }
        });
        break;

      case BISHOP:
        // 相/象：斜走两步（田字），不能过河，塞象眼
        [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dr, dc]) => {
          const nr = row + dr, nc = col + dc;
          const eyeR = row + dr / 2, eyeC = col + dc / 2;
          if (inBoard(nr, nc) && inOwnHalf(nr, color) && !board[eyeR][eyeC]) {
            const target = getPiece(board, nr, nc);
            if (!target || target.color !== color) {
              moves.push({ row: nr, col: nc });
            }
          }
        });
        break;

      case KNIGHT:
        // 马：走日字，蹩马腿
        [
          [-2, -1, -1, 0], [-2, 1, -1, 0],
          [2, -1, 1, 0], [2, 1, 1, 0],
          [-1, -2, 0, -1], [-1, 2, 0, 1],
          [1, -2, 0, -1], [1, 2, 0, 1]
        ].forEach(([dr, dc, lr, lc]) => {
          const nr = row + dr, nc = col + dc;
          if (inBoard(nr, nc) && !board[row + lr][col + lc]) {
            const target = getPiece(board, nr, nc);
            if (!target || target.color !== color) {
              moves.push({ row: nr, col: nc });
            }
          }
        });
        break;

      case ROOK:
        // 车：横竖走任意步
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
          let nr = row + dr, nc = col + dc;
          while (inBoard(nr, nc)) {
            const target = board[nr][nc];
            if (target) {
              if (target.color !== color) moves.push({ row: nr, col: nc });
              break;
            }
            moves.push({ row: nr, col: nc });
            nr += dr;
            nc += dc;
          }
        });
        break;

      case CANNON:
        // 炮：走直线，吃子需隔一子（炮架）
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
          let nr = row + dr, nc = col + dc;
          let jumped = false;
          while (inBoard(nr, nc)) {
            const target = board[nr][nc];
            if (!jumped) {
              if (target) {
                jumped = true;
              } else {
                moves.push({ row: nr, col: nc });
              }
            } else {
              if (target) {
                if (target.color !== color) moves.push({ row: nr, col: nc });
                break;
              }
            }
            nr += dr;
            nc += dc;
          }
        });
        break;

      case PAWN:
        // 兵/卒：未过河只能前进，过河后可左右
        if (color === RED) {
          // 红方前进是 row-1
          if (row - 1 >= 0) {
            const target = board[row - 1][col];
            if (!target || target.color !== color) moves.push({ row: row - 1, col: col });
          }
          // 过河后可左右
          if (row <= 4) {
            if (col - 1 >= 0) {
              const target = board[row][col - 1];
              if (!target || target.color !== color) moves.push({ row: row, col: col - 1 });
            }
            if (col + 1 < COLS) {
              const target = board[row][col + 1];
              if (!target || target.color !== color) moves.push({ row: row, col: col + 1 });
            }
          }
        } else {
          // 黑方前进是 row+1
          if (row + 1 < ROWS) {
            const target = board[row + 1][col];
            if (!target || target.color !== color) moves.push({ row: row + 1, col: col });
          }
          // 过河后可左右
          if (row >= 5) {
            if (col - 1 >= 0) {
              const target = board[row][col - 1];
              if (!target || target.color !== color) moves.push({ row: row, col: col - 1 });
            }
            if (col + 1 < COLS) {
              const target = board[row][col + 1];
              if (!target || target.color !== color) moves.push({ row: row, col: col + 1 });
            }
          }
        }
        break;
    }
    return moves;
  }

  // 判断两将是否直接对面（飞将），中间无棋子
  function isFlyingGeneral(board, color) {
    const kingPos = findKing(board, color);
    if (!kingPos) return false;
    const dir = color === RED ? -1 : 1; // 红方向上，黑方向下
    let r = kingPos.row + dir;
    while (r >= 0 && r < ROWS) {
      const p = board[r][kingPos.col];
      if (p) {
        if (p.type === KING && p.color !== color) return true;
        break; // 被其他棋子挡住
      }
      r += dir;
    }
    return false;
  }

  // 检查某方是否被将军（含飞将）
  function isInCheck(board, color) {
    const kingPos = findKing(board, color);
    if (!kingPos) return true; // 将/帅被吃
    // 将帅对面即被「将军」（不能送将 / 必须解将）
    if (isFlyingGeneral(board, color)) return true;
    const enemyColor = color === RED ? BLACK : RED;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (p && p.color === enemyColor) {
          const moves = getCandidateMoves(board, r, c);
          if (moves.some(m => m.row === kingPos.row && m.col === kingPos.col)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // 执行走棋，返回新棋盘
  function applyMove(board, from, to) {
    const newBoard = cloneBoard(board);
    newBoard[to.row][to.col] = newBoard[from.row][from.col];
    newBoard[from.row][from.col] = null;
    return newBoard;
  }

  // 获取合法走法（过滤掉会导致自己被将军 / 未能解将的走法）
  function getValidMoves(board, row, col) {
    const piece = getPiece(board, row, col);
    if (!piece) return [];
    const candidates = getCandidateMoves(board, row, col);
    return candidates.filter(to => {
      const newBoard = applyMove(board, { row, col }, to);
      return !isInCheck(newBoard, piece.color);
    });
  }

  /** 该着是否合法（含应将 / 不能送将） */
  function isLegalMove(board, from, to) {
    if (!from || !to) return false;
    const piece = getPiece(board, from.row, from.col);
    if (!piece) return false;
    const target = getPiece(board, to.row, to.col);
    if (target && target.color === piece.color) return false;
    return getValidMoves(board, from.row, from.col).some(
      (m) => m.row === to.row && m.col === to.col
    );
  }

  // 检查某方是否无子可走（将杀或困毙）
  function hasNoValidMoves(board, color) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (p && p.color === color) {
          if (getValidMoves(board, r, c).length > 0) return false;
        }
      }
    }
    return true;
  }

  // 判断走棋结果：'checkmate'=将杀, 'stalemate'=困毙, 'check'=将军, 'normal'=普通
  function getMoveResult(board, moveColor) {
    const enemyColor = moveColor === RED ? BLACK : RED;
    const enemyInCheck = isInCheck(board, enemyColor);
    const enemyNoMoves = hasNoValidMoves(board, enemyColor);
    if (enemyInCheck && enemyNoMoves) return 'checkmate';
    if (enemyNoMoves) return 'stalemate';
    if (enemyInCheck) return 'check';
    return 'normal';
  }

  return {
    cloneBoard, getPiece, findKing, getCandidateMoves,
    isInCheck, isFlyingGeneral, applyMove, getValidMoves, isLegalMove,
    hasNoValidMoves, getMoveResult
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChessRules;
}
