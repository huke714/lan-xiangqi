const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Vault = require('./vault-lib');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // 客户端脚本改由 public/js/vendor 提供；pkg 下 serveClient 读不到 node_modules 会断连
  serveClient: false,
  cors: { origin: true, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingInterval: 25000,
  pingTimeout: 20000,
});

const RECONNECT_GRACE_MS = 90 * 1000; // 刷新/断线后保留席位 90 秒
const disconnectTimers = new Map(); // key -> timeoutId

function generatePlayerToken() {
  return crypto.randomBytes(16).toString('hex');
}

function disconnectKey(roomId, token) {
  return roomId + ':' + token;
}

function clearDisconnectTimer(roomId, token) {
  const key = disconnectKey(roomId, token);
  const t = disconnectTimers.get(key);
  if (t) {
    clearTimeout(t);
    disconnectTimers.delete(key);
  }
}

/** 席位被新窗口接管：旧连接失去行棋权 */
function takeOverSeat(roomId, seat, newSocket) {
  const oldId = seat.id;
  seat.id = newSocket.id;
  seat.disconnectedAt = null;
  if (!oldId || oldId === newSocket.id) return;
  const oldSock = io.sockets.sockets.get(oldId);
  if (!oldSock) return;
  try { oldSock.leave(roomId); } catch (e) { /* ignore */ }
  oldSock.roomId = null;
  oldSock.playerColor = null;
  oldSock.playerToken = null;
  oldSock.isSpectator = true;
    oldSock.emit('sessionTaken', { message: '请在小窗中行棋' });
}

function scheduleFinalizeDisconnect(roomId, token, isSpectator) {
  clearDisconnectTimer(roomId, token);
  const key = disconnectKey(roomId, token);
  const timer = setTimeout(() => {
    disconnectTimers.delete(key);
    finalizeDisconnect(roomId, token, isSpectator);
  }, RECONNECT_GRACE_MS);
  disconnectTimers.set(key, timer);
}

// 开发：public/；正式包：asset-vault.bin
const publicDir = path.join(__dirname, 'public');
const vaultPath = path.join(__dirname, 'asset-vault.bin');
let vaultAssets = null;

function tryLoadVault() {
  if (!process.pkg) return null;
  if (!fs.existsSync(vaultPath)) return null;
  let packKey = '';
  try {
    const stamped = require('./build-key');
    packKey = stamped && stamped.key ? stamped.key : '';
  } catch (e) {
    packKey = '';
  }
  if (!packKey) return null;
  try {
    return Vault.unpackToMap(vaultPath, packKey);
  } catch (e) {
    console.error('[vault] failed to load assets');
    return null;
  }
}

vaultAssets = tryLoadVault();

// 开发态关闭静态缓存，保证刷新能拿到最新 CSS/JS
if (!process.pkg) {
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });
}

if (vaultAssets) {
  app.get('/favicon.ico', (req, res) => {
    const ico = vaultAssets.get('favicon.ico');
    if (!ico) {
      res.status(404).end();
      return;
    }
    res.type('image/x-icon');
    res.send(ico);
  });
  app.use(Vault.createVaultStatic(vaultAssets));
} else {
  app.get('/favicon.ico', (req, res) => {
    res.type('image/x-icon');
    res.sendFile(path.join(publicDir, 'favicon.ico'));
  });
  app.use(express.static(publicDir));
}

// 返回局域网地址（可选 hint：当前访问用的 Host，便于挑对网卡）
app.get('/api/lan-ips', (req, res) => {
  const ips = getLocalIPs();
  const hostHeader = String((req.headers && req.headers.host) || '').split(':')[0];
  let preferred = ips[0] || null;
  if (hostHeader && ips.includes(hostHeader)) preferred = hostHeader;
  res.json({ ips, preferred, port: PORT });
});

// 连通性探测：局域网客户端可确认是否打到开房那台服务
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    port: PORT,
  });
});

// 获取局域网 IP（优先返回真实局域网地址，过滤虚拟网卡）
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const results = [];
  const virtualKeywords = ['vmware', 'virtualbox', 'vethernet', 'loopback', 'docker', 'wsl', 'hyper-v', 'tunnel', 'isatap', 'teredo'];
  for (const name of Object.keys(interfaces)) {
    const isVirtual = virtualKeywords.some(kw => name.toLowerCase().includes(kw));
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push({ address: iface.address, name, isVirtual });
      }
    }
  }
  // 优先返回真实局域网地址 (10.x / 192.168.x / 172.16-31.x)
  const real = results.filter(r => !r.isVirtual && (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(r.address)));
  if (real.length > 0) return real.map(r => r.address);
  // 没找到就返回全部非 internal
  if (results.length > 0) return results.map(r => r.address);
  return ['localhost'];
}

// ===== 游戏逻辑（服务端权威） =====
// 复制必要的常量和规则
const COLS = 9, ROWS = 10;
const RED = 'red', BLACK = 'black';
const KING = 'king', ADVISOR = 'advisor', BISHOP = 'bishop';
const KNIGHT = 'knight', ROOK = 'rook', CANNON = 'cannon', PAWN = 'pawn';

const INITIAL_BOARD = [
  [{ type: ROOK, color: BLACK }, { type: KNIGHT, color: BLACK }, { type: BISHOP, color: BLACK },
   { type: ADVISOR, color: BLACK }, { type: KING, color: BLACK }, { type: ADVISOR, color: BLACK },
   { type: BISHOP, color: BLACK }, { type: KNIGHT, color: BLACK }, { type: ROOK, color: BLACK }],
  [null, null, null, null, null, null, null, null, null],
  [null, { type: CANNON, color: BLACK }, null, null, null, null, null, { type: CANNON, color: BLACK }, null],
  [{ type: PAWN, color: BLACK }, null, { type: PAWN, color: BLACK }, null, { type: PAWN, color: BLACK },
   null, { type: PAWN, color: BLACK }, null, { type: PAWN, color: BLACK }],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  [{ type: PAWN, color: RED }, null, { type: PAWN, color: RED }, null, { type: PAWN, color: RED },
   null, { type: PAWN, color: RED }, null, { type: PAWN, color: RED }],
  [null, { type: CANNON, color: RED }, null, null, null, null, null, { type: CANNON, color: RED }, null],
  [null, null, null, null, null, null, null, null, null],
  [{ type: ROOK, color: RED }, { type: KNIGHT, color: RED }, { type: BISHOP, color: RED },
   { type: ADVISOR, color: RED }, { type: KING, color: RED }, { type: ADVISOR, color: RED },
   { type: BISHOP, color: RED }, { type: KNIGHT, color: RED }, { type: ROOK, color: RED }]
];

// 规则引擎（服务端版本）
const Rules = {
  cloneBoard(board) {
    return board.map(row => row.map(cell => cell ? { ...cell } : null));
  },
  inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; },
  inPalace(r, c, color) {
    if (c < 3 || c > 5) return false;
    return color === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  },
  inOwnHalf(r, color) { return color === RED ? r >= 5 : r <= 4; },
  findKing(board, color) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] && board[r][c].type === KING && board[r][c].color === color)
          return { row: r, col: c };
    return null;
  },
  getCandidateMoves(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    const moves = [];
    const { type, color } = piece;
    const self = this;

    switch (type) {
      case KING:
        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc]) => {
          const nr = row+dr, nc = col+dc;
          if (self.inPalace(nr,nc,color) && (!board[nr][nc] || board[nr][nc].color !== color))
            moves.push({row:nr,col:nc});
        });
        break;
      case ADVISOR:
        [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => {
          const nr = row+dr, nc = col+dc;
          if (self.inPalace(nr,nc,color) && (!board[nr][nc] || board[nr][nc].color !== color))
            moves.push({row:nr,col:nc});
        });
        break;
      case BISHOP:
        [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(([dr,dc]) => {
          const nr = row+dr, nc = col+dc;
          if (self.inBoard(nr,nc) && self.inOwnHalf(nr,color) && !board[row+dr/2][col+dc/2]
              && (!board[nr][nc] || board[nr][nc].color !== color))
            moves.push({row:nr,col:nc});
        });
        break;
      case KNIGHT:
        [[-2,-1,-1,0],[-2,1,-1,0],[2,-1,1,0],[2,1,1,0],
         [-1,-2,0,-1],[-1,2,0,1],[1,-2,0,-1],[1,2,0,1]].forEach(([dr,dc,lr,lc]) => {
          const nr = row+dr, nc = col+dc;
          if (self.inBoard(nr,nc) && !board[row+lr][col+lc]
              && (!board[nr][nc] || board[nr][nc].color !== color))
            moves.push({row:nr,col:nc});
        });
        break;
      case ROOK:
        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc]) => {
          let nr = row+dr, nc = col+dc;
          while (self.inBoard(nr,nc)) {
            if (board[nr][nc]) {
              if (board[nr][nc].color !== color) moves.push({row:nr,col:nc});
              break;
            }
            moves.push({row:nr,col:nc});
            nr += dr; nc += dc;
          }
        });
        break;
      case CANNON:
        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc]) => {
          let nr = row+dr, nc = col+dc, jumped = false;
          while (self.inBoard(nr,nc)) {
            if (!jumped) {
              if (board[nr][nc]) jumped = true;
              else moves.push({row:nr,col:nc});
            } else {
              if (board[nr][nc]) {
                if (board[nr][nc].color !== color) moves.push({row:nr,col:nc});
                break;
              }
            }
            nr += dr; nc += dc;
          }
        });
        break;
      case PAWN:
        if (color === RED) {
          if (row-1 >= 0 && (!board[row-1][col] || board[row-1][col].color !== color))
            moves.push({row:row-1,col:col});
          if (row <= 4) {
            if (col-1 >= 0 && (!board[row][col-1] || board[row][col-1].color !== color))
              moves.push({row:row,col:col-1});
            if (col+1 < COLS && (!board[row][col+1] || board[row][col+1].color !== color))
              moves.push({row:row,col:col+1});
          }
        } else {
          if (row+1 < ROWS && (!board[row+1][col] || board[row+1][col].color !== color))
            moves.push({row:row+1,col:col});
          if (row >= 5) {
            if (col-1 >= 0 && (!board[row][col-1] || board[row][col-1].color !== color))
              moves.push({row:row,col:col-1});
            if (col+1 < COLS && (!board[row][col+1] || board[row][col+1].color !== color))
              moves.push({row:row,col:col+1});
          }
        }
        break;
    }
    return moves;
  },
  isFlyingGeneral(board, color) {
    const kingPos = this.findKing(board, color);
    if (!kingPos) return false;
    const dir = color === RED ? -1 : 1;
    let r = kingPos.row + dir;
    while (r >= 0 && r < ROWS) {
      const p = board[r][kingPos.col];
      if (p) {
        if (p.type === KING && p.color !== color) return true;
        break;
      }
      r += dir;
    }
    return false;
  },
  isInCheck(board, color) {
    const kingPos = this.findKing(board, color);
    if (!kingPos) return true;
    if (this.isFlyingGeneral(board, color)) return true;
    const enemy = color === RED ? BLACK : RED;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] && board[r][c].color === enemy)
          if (this.getCandidateMoves(board, r, c).some(m => m.row === kingPos.row && m.col === kingPos.col))
            return true;
    return false;
  },
  applyMove(board, from, to) {
    const nb = this.cloneBoard(board);
    nb[to.row][to.col] = nb[from.row][from.col];
    nb[from.row][from.col] = null;
    return nb;
  },
  getValidMoves(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    return this.getCandidateMoves(board, row, col).filter(to =>
      !this.isInCheck(this.applyMove(board, {row,col}, to), piece.color)
    );
  },
  isLegalMove(board, from, to) {
    if (!from || !to) return false;
    const piece = board[from.row] && board[from.row][from.col];
    if (!piece) return false;
    const target = board[to.row] && board[to.row][to.col];
    if (target && target.color === piece.color) return false;
    return this.getValidMoves(board, from.row, from.col).some(
      (m) => m.row === to.row && m.col === to.col
    );
  },
  hasNoValidMoves(board, color) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] && board[r][c].color === color && this.getValidMoves(board, r, c).length > 0)
          return false;
    return true;
  },
  getMoveResult(board, moveColor) {
    const enemy = moveColor === RED ? BLACK : RED;
    const check = this.isInCheck(board, enemy);
    const noMoves = this.hasNoValidMoves(board, enemy);
    if (check && noMoves) return 'checkmate';
    if (noMoves) return 'stalemate';
    if (check) return 'check';
    return 'normal';
  }
};

// ===== 房间管理 =====
const rooms = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const DEFAULT_TIME_CONTROL = 600; // 每方默认 10 分钟
const ALLOWED_TIME_CONTROLS = new Set([0, 300, 600, 900, 1800]);

function normalizeTimeControl(value) {
  const sec = parseInt(value, 10);
  if (ALLOWED_TIME_CONTROLS.has(sec)) return sec;
  return DEFAULT_TIME_CONTROL;
}

function createRoom(socket, playerName, preferredColor, timeControl) {
  const roomId = generateRoomId();
  const color = preferredColor === 'black' ? BLACK : RED;
  const token = generatePlayerToken();
  const room = {
    id: roomId,
    players: [{ id: socket.id, token, name: playerName, color, disconnectedAt: null }],
    board: Rules.cloneBoard(INITIAL_BOARD),
    currentTurn: RED,
    status: 'waiting', // waiting, playing, ended
    moveHistory: [],
    lastMove: null,
    spectators: [],
    boardStack: [], // 悔棋用棋盘快照栈
    undoPending: null, // 待确认的悔棋请求 { from: socketId }
    timeControl: normalizeTimeControl(timeControl),
  };
  rooms.set(roomId, room);
  socket.join(roomId);
  socket.roomId = roomId;
  socket.playerColor = color;
  socket.playerToken = token;
  socket.isSpectator = false;
  return room;
}

function joinRoom(socket, roomId, playerName, preferredColor, playerToken, asSpectator) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (room.status === 'ended') return { error: '游戏已结束' };

  const name = (playerName || '').trim().slice(0, 10) || '玩家';
  const wantSpectate = !!asSpectator;

  // 1) 凭会话 token 认回自己的席位（刷新后点加入 / 自动重连失败后的兜底）
  if (playerToken && !wantSpectate) {
    const found = findSeatByToken(room, playerToken);
    if (found) {
      clearDisconnectTimer(roomId, playerToken);
      takeOverSeat(roomId, found.seat, socket);
      found.seat.name = name;
      socket.join(roomId);
      socket.roomId = roomId;
      socket.playerToken = playerToken;
      socket.isSpectator = found.kind === 'spectator';
      socket.playerColor = found.kind === 'player' ? found.seat.color : null;
      return {
        room,
        isSpectator: found.kind === 'spectator',
        token: playerToken,
        resumed: true,
        color: socket.playerColor,
      };
    }
  }

  // 2) 显式观战：只有点「观战」才进观战席
  if (wantSpectate) {
    const token = generatePlayerToken();
    room.spectators.push({ id: socket.id, token, name, disconnectedAt: null });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerColor = null;
    socket.playerToken = token;
    socket.isSpectator = true;
    return { room, isSpectator: true, token };
  }

  // 3) 同名认回暂时离线的对弈席（局域网友好）
  const offlineSeat = room.players.find(p => p.disconnectedAt && p.name === name);
  if (offlineSeat) {
    clearDisconnectTimer(roomId, offlineSeat.token);
    offlineSeat.id = socket.id;
    offlineSeat.disconnectedAt = null;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerToken = offlineSeat.token;
    socket.playerColor = offlineSeat.color;
    socket.isSpectator = false;
    return {
      room,
      isSpectator: false,
      token: offlineSeat.token,
      resumed: true,
      color: offlineSeat.color,
    };
  }

  const onlinePlayers = room.players.filter(p => !p.disconnectedAt);
  const hasOfflinePlayer = room.players.some(p => p.disconnectedAt);

  // 4) 对弈席已满：加入失败，提示去点观战（不再自动转观战）
  if (onlinePlayers.length >= 2) {
    return { error: '房间已满，请点击「观战」旁观' };
  }

  // 5) 名义上已有 2 人，但有人暂时离线
  if (room.players.length >= 2 && hasOfflinePlayer) {
    return { error: '有玩家暂时离线，请稍等其重连；若你是原玩家，请刷新页面自动恢复' };
  }

  // 6) 作为对弈者加入
  let color;
  if (preferredColor) {
    color = preferredColor === 'black' ? BLACK : RED;
    if (room.players[0] && color === room.players[0].color) {
      color = color === RED ? BLACK : RED;
    }
  } else {
    color = room.players[0] && room.players[0].color === RED ? BLACK : RED;
  }
  const token = generatePlayerToken();
  room.players.push({ id: socket.id, token, name, color, disconnectedAt: null });
  socket.join(roomId);
  socket.roomId = roomId;
  socket.playerColor = color;
  socket.playerToken = token;
  socket.isSpectator = false;
  room.status = 'playing';
  return { room, isSpectator: false, token, color };
}

function buildRoomSyncPayload(room, myColor, isSpectator) {
  return {
    roomId: room.id,
    color: myColor,
    myColor: myColor,
    isSpectator: !!isSpectator,
    board: room.board,
    currentTurn: room.currentTurn,
    lastMove: room.lastMove,
    players: room.players.map(p => ({
      name: p.name,
      color: p.color,
      online: !p.disconnectedAt,
    })),
    moveHistory: room.moveHistory,
    spectatorCount: room.spectators.length,
    timeControl: room.timeControl,
    status: room.status,
  };
}

function findSeatByToken(room, token) {
  const player = room.players.find(p => p.token === token);
  if (player) return { kind: 'player', seat: player };
  const spectator = room.spectators.find(s => s.token === token);
  if (spectator) return { kind: 'spectator', seat: spectator };
  return null;
}

function buildRoomList() {
  const list = [];
  rooms.forEach((room, id) => {
    if (room.status === 'waiting') {
      list.push({
        id,
        playerCount: room.players.length,
        playerName: room.players[0].name,
        status: 'waiting',
        spectatorCount: room.spectators.length,
        timeControl: room.timeControl
      });
    } else if (room.status === 'playing') {
      list.push({
        id,
        playerCount: room.players.length,
        playerName: room.players.map(p => p.name).join(' vs '),
        status: 'playing',
        spectatorCount: room.spectators.length,
        timeControl: room.timeControl
      });
    }
  });
  return list;
}

function broadcastRoomList() {
  io.emit('roomList', buildRoomList());
}

function sendRoomList(socket) {
  socket.emit('roomList', buildRoomList());
}

// ===== Socket.IO 事件处理 =====
io.on('connection', (socket) => {
  // 一连上就推房间列表，避免客户端漏发 getRoomList 时大厅一直空
  sendRoomList(socket);

  // 创建房间
  socket.on('createRoom', ({ playerName, preferredColor, timeControl }) => {
    // 先清理旧房间（重摆一局时玩家可能仍在旧房间中）
    if (socket.roomId) {
      socket.leaveIntentionally = true;
      handleDisconnect(socket);
      socket.leaveIntentionally = false;
    }
    const room = createRoom(socket, playerName, preferredColor, timeControl);
    socket.emit('roomCreated', {
      roomId: room.id,
      color: socket.playerColor,
      playerToken: socket.playerToken,
      players: room.players.map(p => ({ name: p.name, color: p.color })),
      timeControl: room.timeControl
    });
    broadcastRoomList();
  });

  // 加入房间
  socket.on('joinRoom', ({ roomId, playerName, preferredColor, playerToken, asSpectator }) => {
    const result = joinRoom(
      socket,
      roomId.toUpperCase(),
      playerName,
      preferredColor,
      playerToken || null,
      !!asSpectator
    );
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    const room = result.room;

    // 认回原席位：同步当前局面，不要当成新开局
    if (result.resumed) {
      const payload = buildRoomSyncPayload(
        room,
        result.isSpectator ? null : socket.playerColor,
        result.isSpectator
      );
      socket.emit('roomResumed', payload);
      socket.to(room.id).emit('playerReconnected', {
        playerName: playerName,
        color: socket.playerColor,
        isSpectator: !!result.isSpectator,
        players: room.players.map(p => ({
          name: p.name,
          color: p.color,
          online: !p.disconnectedAt,
        })),
      });
      if (result.isSpectator) {
        io.to(room.id).emit('spectatorCount', { count: room.spectators.length });
      }
      return;
    }

    if (result.isSpectator) {
      socket.emit('spectatorJoined', {
        roomId: room.id,
        playerToken: socket.playerToken,
        board: room.board,
        currentTurn: room.currentTurn,
        lastMove: room.lastMove,
        players: room.players.map(p => ({ name: p.name, color: p.color })),
        moveHistory: room.moveHistory,
        spectatorCount: room.spectators.length,
        timeControl: room.timeControl
      });
      io.to(room.id).emit('spectatorCount', { count: room.spectators.length });
      return;
    }

    socket.emit('roomJoined', {
      roomId: room.id,
      color: socket.playerColor,
      playerToken: socket.playerToken,
      players: room.players.map(p => ({ name: p.name, color: p.color })),
      timeControl: room.timeControl
    });
    socket.to(room.id).emit('playerJoined', {
      playerName,
      color: socket.playerColor,
      players: room.players.map(p => ({ name: p.name, color: p.color })),
      timeControl: room.timeControl
    });
    // 通知双方游戏开始（包含各自颜色）
    room.players.forEach(p => {
      if (!p.id || p.disconnectedAt) return;
      const playerSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
      if (playerSocket) {
        playerSocket.emit('gameStart', {
          players: room.players.map(pl => ({ name: pl.name, color: pl.color })),
          myColor: p.color,
          timeControl: room.timeControl
        });
      }
    });
    broadcastRoomList();
  });

  // 刷新/断线后重连回房间
  socket.on('reconnectRoom', ({ roomId, playerToken, playerName }) => {
    if (!roomId || !playerToken) {
      socket.emit('reconnectFailed', { message: '会话无效' });
      return;
    }
    const id = String(roomId).toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      socket.emit('reconnectFailed', { message: '房间已不存在' });
      return;
    }
    const found = findSeatByToken(room, playerToken);
    if (!found) {
      socket.emit('reconnectFailed', { message: '席位已失效，请重新加入' });
      return;
    }

    // 若当前 socket 还挂着别的房间，先主动离开
    if (socket.roomId && socket.roomId !== id) {
      socket.leaveIntentionally = true;
      handleDisconnect(socket);
      socket.leaveIntentionally = false;
    }

    const { kind, seat } = found;
    clearDisconnectTimer(id, playerToken);
    takeOverSeat(id, seat, socket);
    if (playerName && typeof playerName === 'string' && playerName.trim()) {
      seat.name = playerName.trim().slice(0, 10);
    }

    socket.join(id);
    socket.roomId = id;
    socket.playerToken = playerToken;
    socket.isSpectator = kind === 'spectator';
    socket.playerColor = kind === 'player' ? seat.color : null;

    const payload = buildRoomSyncPayload(
      room,
      kind === 'player' ? seat.color : null,
      kind === 'spectator'
    );
    socket.emit('roomResumed', payload);
    socket.to(id).emit('playerReconnected', {
      playerName: seat.name,
      color: seat.color || null,
      isSpectator: kind === 'spectator',
      players: room.players.map(p => ({
        name: p.name,
        color: p.color,
        online: !p.disconnectedAt,
      })),
    });
    if (kind === 'spectator') {
      io.to(id).emit('spectatorCount', { count: room.spectators.length });
    }
  });

  // 走棋
  socket.on('makeMove', ({ from, to, notation }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    // 观战者不能走棋
    if (socket.isSpectator) {
      socket.emit('error', { message: '你是观战者，不能走棋' });
      return;
    }

    // 席位已被其他窗口接管
    const seat = room.players.find(p => p.token === socket.playerToken);
    if (!seat || seat.id !== socket.id) {
      socket.emit('error', { message: '席位已在其他窗口，请在新窗口行棋' });
      return;
    }

    // 验证是否轮到该玩家
    if (room.currentTurn !== socket.playerColor) {
      socket.emit('error', { message: '还没轮到你走棋' });
      return;
    }

    // 验证走法合法性
    const piece = room.board[from.row][from.col];
    if (!piece || piece.color !== socket.playerColor) {
      socket.emit('error', { message: '无效的棋子' });
      return;
    }

    const validMoves = Rules.getValidMoves(room.board, from.row, from.col);
    if (!validMoves.some(m => m.row === to.row && m.col === to.col)) {
      socket.emit('error', { message: room.currentTurn === socket.playerColor && Rules.isInCheck(room.board, socket.playerColor)
        ? '已被将军，请先应将'
        : '不合法的走法' });
      return;
    }

    // 执行走棋
    const captured = room.board[to.row][to.col];
    // 保存快照（悔棋用）
    room.boardStack.push({
      board: Rules.cloneBoard(room.board),
      currentTurn: room.currentTurn,
      lastMove: room.lastMove ? { ...room.lastMove } : null,
    });
    room.board = Rules.applyMove(room.board, from, to);
    room.lastMove = { from, to };

    const result = Rules.getMoveResult(room.board, piece.color);
    const inCheck = result === 'check' || result === 'checkmate';
    const isCheckmate = result === 'checkmate';
    let moveNotation = (typeof notation === 'string' && notation) ? notation : '';
    if (moveNotation && isCheckmate && !moveNotation.includes('#')) moveNotation += '#';
    else if (moveNotation && inCheck && !isCheckmate && !moveNotation.includes('+')) moveNotation += '+';

    room.moveHistory.push({
      from,
      to,
      piece: { ...piece },
      captured: captured ? { ...captured } : null,
      notation: moveNotation || undefined,
      isCheck: inCheck,
      isCheckmate,
    });

    if (result === 'checkmate' || result === 'stalemate') {
      room.status = 'ended';
      room.currentTurn = null;
      io.to(roomId).emit('moveMade', { from, to, inCheck, result, notation: moveNotation });
      io.to(roomId).emit('gameOver', {
        winner: result === 'checkmate' ? piece.color : null,
        result: result === 'checkmate' ? '将杀' : '困毙'
      });
      broadcastRoomList();
      return;
    }

    room.currentTurn = room.currentTurn === RED ? BLACK : RED;
    io.to(roomId).emit('moveMade', { from, to, inCheck, result, notation: moveNotation });
  });

  // 认输
  socket.on('resign', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (socket.isSpectator || !socket.playerColor) {
      socket.emit('error', { message: '观战者不能认输' });
      return;
    }

    room.status = 'ended';
    const winner = socket.playerColor === RED ? BLACK : RED;
    io.to(roomId).emit('gameOver', { winner, result: '认输' });
    broadcastRoomList();
  });

  // 求和
  socket.on('offerDraw', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (socket.isSpectator || !socket.playerColor) {
      socket.emit('error', { message: '观战者不能求和' });
      return;
    }
    socket.to(roomId).emit('drawOffered', {});
  });

  // 回应求和
  socket.on('respondDraw', ({ accept }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (socket.isSpectator || !socket.playerColor) return;

    if (accept) {
      room.status = 'ended';
      io.to(roomId).emit('gameOver', { winner: null, result: '和棋' });
      broadcastRoomList();
    } else {
      socket.to(roomId).emit('error', { message: '对方拒绝了求和' });
    }
  });

  // 悔棋请求
  socket.on('undoRequest', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (socket.isSpectator) return;
    if (room.boardStack.length === 0) {
      socket.emit('error', { message: '没有可以悔棋的步骤' });
      return;
    }
    if (room.undoPending) {
      socket.emit('error', { message: '已有悔棋请求等待处理' });
      return;
    }

    room.undoPending = { from: socket.id };
    const player = room.players.find(p => p.id === socket.id);
    socket.to(roomId).emit('undoRequested', { playerName: player ? player.name : '对手' });
    socket.emit('error', { message: '悔棋请求已发送，等待对方确认…' });
  });

  // 悔棋确认
  socket.on('undoConfirm', ({ accept }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || !room.undoPending) return;

    if (accept) {
      // 执行悔棋：回退一步
      if (room.boardStack.length > 0) {
        const snapshot = room.boardStack.pop();
        room.board = snapshot.board;
        room.currentTurn = snapshot.currentTurn;
        room.lastMove = snapshot.lastMove;
        room.moveHistory.pop();
        room.status = 'playing';

        io.to(roomId).emit('undoExecuted', {
          board: room.board,
          currentTurn: room.currentTurn,
          lastMove: room.lastMove,
          moveHistory: room.moveHistory,
        });
      }
    } else {
      const requester = room.players.find(p => p.id === room.undoPending.from);
      if (requester) {
        const requesterSocket = [...io.sockets.sockets.values()].find(s => s.id === room.undoPending.from);
        if (requesterSocket) {
          requesterSocket.emit('error', { message: '对方拒绝了悔棋请求' });
        }
      }
    }

    room.undoPending = null;
  });

  // 聊天
  socket.on('chatMessage', ({ message }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = room.players.find(p => p.id === socket.id)
                || room.spectators.find(s => s.id === socket.id);
    if (sender) {
      io.to(roomId).emit('chatMessage', { playerName: sender.name, message });
    }
  });

  // 重新开始
  socket.on('restartGame', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (socket.isSpectator || !socket.playerColor) {
      socket.emit('error', { message: '观战者不能重开' });
      return;
    }
    if (room.players.length < 2) {
      socket.emit('error', { message: '对手已离开，无法再弈' });
      return;
    }

    // 交换颜色
    room.players.forEach(p => {
      p.color = p.color === RED ? BLACK : RED;
    });

    room.board = Rules.cloneBoard(INITIAL_BOARD);
    room.currentTurn = RED;
    room.status = 'playing';
    room.moveHistory = [];
    room.lastMove = null;
    room.boardStack = [];
    room.undoPending = null;

    room.players.forEach(p => {
      const playerSocket = [...io.sockets.sockets.values()].find(s => s.id === p.id);
      if (playerSocket) {
        playerSocket.playerColor = p.color;
        playerSocket.emit('gameStart', {
          players: room.players.map(pl => ({ name: pl.name, color: pl.color })),
          myColor: p.color,
          timeControl: room.timeControl
        });
      }
    });

    room.spectators.forEach(s => {
      const spectatorSocket = [...io.sockets.sockets.values()].find(sock => sock.id === s.id);
      if (spectatorSocket) {
        spectatorSocket.emit('spectatorJoined', {
          roomId: room.id,
          board: room.board,
          currentTurn: room.currentTurn,
          lastMove: room.lastMove,
          players: room.players.map(p => ({ name: p.name, color: p.color })),
          moveHistory: room.moveHistory,
          spectatorCount: room.spectators.length,
          timeControl: room.timeControl
        });
      }
    });

    broadcastRoomList();
  });

  // 超时认负（客户端棋钟耗尽后上报）：超时方负，对方胜
  socket.on('timeOut', ({ color }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (socket.isSpectator) return;
    if (!room.timeControl) return; // 无限制对局不接受超时
    if (color !== RED && color !== BLACK) return;

    room.status = 'ended';
    const loser = color;
    const winner = loser === RED ? BLACK : RED;
    const loserName = loser === RED ? '红方' : '黑方';
    io.to(roomId).emit('gameOver', {
      winner,
      result: loserName + '超时判负',
    });
  });

  // 获取房间列表（先回给自己，再同步大厅）
  socket.on('getRoomList', () => {
    sendRoomList(socket);
  });

  // 离开房间
  socket.on('leaveRoom', () => {
    socket.leaveIntentionally = true;
    handleDisconnect(socket);
    socket.leaveIntentionally = false;
  });

  // 断开连接
  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  const token = socket.playerToken;
  const intentional = !!socket.leaveIntentionally;
  const isSpectator = !!socket.isSpectator;

  socket.leave(roomId);
  socket.roomId = null;
  socket.playerToken = null;
  socket.playerColor = null;
  socket.isSpectator = false;

  // 观战者
  if (isSpectator) {
    const seat = room.spectators.find(s => s.token === token || s.id === socket.id);
    if (!seat) {
      broadcastRoomList();
      return;
    }
    if (!intentional && room.status === 'playing') {
      seat.disconnectedAt = Date.now();
      seat.id = null;
      scheduleFinalizeDisconnect(roomId, seat.token, true);
      return;
    }
    room.spectators = room.spectators.filter(s => s.token !== seat.token);
    io.to(roomId).emit('spectatorCount', { count: room.spectators.length });
    if (room.players.length === 0 && room.spectators.length === 0) {
      rooms.delete(roomId);
    }
    broadcastRoomList();
    return;
  }

  // 对弈者
  const player = room.players.find(p => p.token === token || p.id === socket.id);
  if (!player) {
    broadcastRoomList();
    return;
  }

  // 意外断线（刷新等）：保留席位一段时间，允许重连
  if (!intentional && (room.status === 'playing' || room.status === 'waiting')) {
    player.disconnectedAt = Date.now();
    player.id = null;
    io.to(roomId).emit('playerDisconnected', {
      playerName: player.name,
      color: player.color,
      graceMs: RECONNECT_GRACE_MS,
      players: room.players.map(p => ({
        name: p.name,
        color: p.color,
        online: !p.disconnectedAt,
      })),
    });
    scheduleFinalizeDisconnect(roomId, player.token, false);
    return;
  }

  finalizeDisconnect(roomId, player.token, false, true);
}

function finalizeDisconnect(roomId, token, isSpectator, force) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (isSpectator) {
    room.spectators = room.spectators.filter(s => s.token !== token);
    io.to(roomId).emit('spectatorCount', { count: room.spectators.length });
    if (room.players.length === 0 && room.spectators.length === 0) {
      rooms.delete(roomId);
    }
    broadcastRoomList();
    return;
  }

  const player = room.players.find(p => p.token === token);
  if (!player) return;
  // 已重连则不再处理（超时清理时）
  if (!force && player.id && !player.disconnectedAt) return;

  room.players = room.players.filter(p => p.token !== token);
  clearDisconnectTimer(roomId, token);

  if (room.players.length === 0) {
    room.spectators.forEach(s => {
      const spectatorSocket = [...io.sockets.sockets.values()].find(sock => sock.id === s.id);
      if (spectatorSocket) {
        spectatorSocket.emit('gameOver', { winner: null, result: '对局已解散' });
        spectatorSocket.roomId = null;
        spectatorSocket.playerToken = null;
        spectatorSocket.isSpectator = false;
        spectatorSocket.leave(roomId);
      }
    });
    rooms.delete(roomId);
    broadcastRoomList();
  } else {
    if (room.status === 'playing') {
      room.status = 'ended';
      const winner = room.players[0].color;
      io.to(roomId).emit('gameOver', { winner, result: '对方离开' });
    }
    io.to(roomId).emit('playerLeft', {
      players: room.players.map(p => ({ name: p.name, color: p.color }))
    });
    broadcastRoomList();
  }
}

// ===== 启动服务器 =====
const PORT = parseInt(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

// 正式包需带有 build-key
if (process.pkg) {
  try {
    const stamp = require('./build-key');
    if (!stamp || typeof stamp.key !== 'string' || !stamp.key.trim()) {
      console.error('  ✗  游戏文件无效，请重新打包');
      process.exit(1);
    }
  } catch (e) {
    console.error('  ✗  游戏文件无效，请重新打包');
    process.exit(1);
  }
}

server.listen(PORT, HOST, () => {
  const localIPs = getLocalIPs();
  const useColor = !!(process.stdout.isTTY) && !process.env.NO_COLOR;
  const dim = useColor ? '\x1b[2m' : '';
  const bold = useColor ? '\x1b[1m' : '';
  const cyan = useColor ? '\x1b[36m' : '';
  const green = useColor ? '\x1b[32m' : '';
  const yellow = useColor ? '\x1b[33m' : '';
  const magenta = useColor ? '\x1b[35m' : '';
  const reset = useColor ? '\x1b[0m' : '';

  const line = cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + reset;

  console.log('  ' + line);
  console.log('  ' + green + '■' + reset + '  ' + bold + '棋盘已就绪' + reset + dim + '  ·  请入座对弈' + reset);
  console.log('  ' + line);
  console.log('');
  console.log('  ' + yellow + '●' + reset + '  ' + bold + '本机对战' + reset);
  console.log('     ' + cyan + 'http://localhost:' + PORT + reset);
  console.log('');
  console.log('  ' + magenta + '●' + reset + '  ' + bold + '邀请好友' + reset + dim + '  ·  同一 WiFi' + reset);
  if (localIPs.length === 0) {
    console.log('     ' + dim + '暂未检测到局域网地址' + reset);
  } else {
    localIPs.forEach((ip) => {
      console.log('     ' + cyan + 'http://' + ip + ':' + PORT + reset);
    });
  }
  console.log('');
  console.log('  ' + line);
  console.log('  ' + green + '·' + reset + '  浏览器即将自动打开棋盘');
  console.log('  ' + dim + '·' + reset + '  把上方地址发给好友，用浏览器打开即可');
  console.log('  ' + dim + '·' + reset + '  关掉本窗口，本局结束');
  console.log('');

  try {
    const { enableLiveReload } = require('./live-reload');
    enableLiveReload(io, publicDir);
  } catch (e) {
    /* ignore in packaged builds */
  }

  const { exec } = require('child_process');
  const url = 'http://localhost:' + PORT;
  let cmd;
  switch (process.platform) {
    case 'win32': cmd = 'start "" "' + url + '"'; break;
    case 'darwin': cmd = 'open "' + url + '"'; break;
    default: cmd = 'xdg-open "' + url + '"'; break;
  }
  exec(cmd, (err) => {
    if (err) console.log('  ' + dim + '·  请手动打开：' + url + reset);
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('  ✖  游戏端口被占用了');
    console.error('  ·  请先关掉其他象棋窗口后再试');
    console.error('');
  } else {
    console.error('  ✖  启动失败：' + (err && err.message ? err.message : err));
  }
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n  ·  正在收官，结束对局…');
  server.close(() => {
    console.log('  ·  已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n  ·  正在收官，结束对局…');
  server.close(() => {
    console.log('  ·  已关闭');
    process.exit(0);
  });
});
