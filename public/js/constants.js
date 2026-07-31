// 棋盘常量
const COLS = 9;
const ROWS = 10;

// 颜色
const RED = 'red';
const BLACK = 'black';

// 棋子类型
const KING = 'king';       // 帅/将
const ADVISOR = 'advisor'; // 仕/士
const BISHOP = 'bishop';   // 相/象
const KNIGHT = 'knight';   // 马
const ROOK = 'rook';       // 车
const CANNON = 'cannon';   // 炮
const PAWN = 'pawn';       // 兵/卒

// 棋子显示名称
const PIECE_NAMES = {
  red: {
    king: '帅', advisor: '仕', bishop: '相',
    knight: '马', rook: '车', cannon: '炮', pawn: '兵'
  },
  black: {
    king: '将', advisor: '士', bishop: '象',
    knight: '马', rook: '车', cannon: '炮', pawn: '卒'
  }
};

// 黑方繁体显示名称
const PIECE_NAMES_TRAD = {
  red: {
    king: '帥', advisor: '仕', bishop: '相',
    knight: '馬', rook: '車', cannon: '炮', pawn: '兵'
  },
  black: {
    king: '將', advisor: '士', bishop: '象',
    knight: '馬', rook: '車', cannon: '砲', pawn: '卒'
  }
};

// 棋子显示名称 (row 0=黑方顶部, row 9=红方底部)
const INITIAL_BOARD = [
  // row 0 - 黑方底线
  [{ type: ROOK, color: BLACK }, { type: KNIGHT, color: BLACK }, { type: BISHOP, color: BLACK },
   { type: ADVISOR, color: BLACK }, { type: KING, color: BLACK }, { type: ADVISOR, color: BLACK },
   { type: BISHOP, color: BLACK }, { type: KNIGHT, color: BLACK }, { type: ROOK, color: BLACK }],
  // row 1
  [null, null, null, null, null, null, null, null, null],
  // row 2
  [null, { type: CANNON, color: BLACK }, null, null, null, null, null, { type: CANNON, color: BLACK }, null],
  // row 3
  [{ type: PAWN, color: BLACK }, null, { type: PAWN, color: BLACK }, null, { type: PAWN, color: BLACK },
   null, { type: PAWN, color: BLACK }, null, { type: PAWN, color: BLACK }],
  // row 4
  [null, null, null, null, null, null, null, null, null],
  // row 5 - 楚河汉界
  [null, null, null, null, null, null, null, null, null],
  // row 6
  [{ type: PAWN, color: RED }, null, { type: PAWN, color: RED }, null, { type: PAWN, color: RED },
   null, { type: PAWN, color: RED }, null, { type: PAWN, color: RED }],
  // row 7
  [null, { type: CANNON, color: RED }, null, null, null, null, null, { type: CANNON, color: RED }, null],
  // row 8
  [null, null, null, null, null, null, null, null, null],
  // row 9 - 红方底线
  [{ type: ROOK, color: RED }, { type: KNIGHT, color: RED }, { type: BISHOP, color: RED },
   { type: ADVISOR, color: RED }, { type: KING, color: RED }, { type: ADVISOR, color: RED },
   { type: BISHOP, color: RED }, { type: KNIGHT, color: RED }, { type: ROOK, color: RED }]
];

// 单局时长选项（每方用时，秒；0 = 无限制）
const TIME_CONTROLS = [
  { seconds: 300,  label: '5分' },
  { seconds: 600,  label: '10分' },
  { seconds: 900,  label: '15分' },
  { seconds: 1800, label: '30分' },
  { seconds: 0,    label: '不限' },
];
const DEFAULT_TIME_CONTROL = 600;

function formatTimeControl(seconds) {
  if (!seconds) return '不限';
  if (seconds % 60 === 0) return (seconds / 60) + '分';
  return Math.floor(seconds / 60) + '分' + (seconds % 60) + '秒';
}

// 导出（兼容浏览器和 Node.js）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLS, ROWS, RED, BLACK, KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN,
    PIECE_NAMES, PIECE_NAMES_TRAD, INITIAL_BOARD,
    TIME_CONTROLS, DEFAULT_TIME_CONTROL, formatTimeControl
  };
}
