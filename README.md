# 中国象棋 · 弈林

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![Release](https://img.shields.io/github/v/release/huke714/lan-xiangqi?label=release)](https://github.com/huke714/lan-xiangqi/releases/latest)

> 局域网实时对弈的中国象棋。本机起服务即可开玩，同一网络下电脑 / 手机用浏览器加入；也可打包为 Windows 单文件 exe。

---

## 目录

- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [使用说明](#使用说明)
- [HTTP API](#http-api)
- [Release](#release)
- [开发指南](#开发指南)
- [FAQ](#faq)
- [License](#license)

---

## 核心功能

| 能力 | 说明 |
|------|------|
| 房间 | 创建 / 加入 4 位房间号；大厅可刷新房间列表；满员可观战 |
| 对局 | 点击或拖拽走子；规则校验（含将军、应将等） |
| 用时 | 每方 `5 / 10 / 15 / 30` 分钟或不限时（默认 10 分钟） |
| 操作 | 悔棋（对方确认）、认输、求和、再来一局、局内聊天 |
| 棋谱 | 红黑分列着法；将 / 杀标注 |
| 沙盘 | 己方回合推演（对照实盘 + 推演盘） |
| 小窗 | 弹出专注行棋窗；主页暂停；可接回 |
| 主题 | 深色 / 浅色 |
| 断线重连 | 刷新或短暂断线后约 90 秒内可凭令牌重连占座 |
| 打包 | `pkg` 生成 Windows x64 单文件 `dist/中国象棋.exe` |

---

## 技术栈

| 层级 | 技术 | 版本（`package.json`） |
|------|------|------------------------|
| 运行时 | Node.js | `>=18` |
| HTTP | Express | `^4.18.2` |
| 实时通信 | Socket.IO | `^4.7.2` |
| 前端 | Canvas + 原生 JavaScript | — |
| 打包 | [pkg](https://github.com/vercel/pkg) | `^5.8.1`（dev） |
| 构建辅助 | javascript-obfuscator | `^4.2.2`（dev） |

Exe 目标：Windows x64（`node18-win-x64`）。

---

## 目录结构

```text
.
├── public/                 # 前端静态资源
│   ├── index.html
│   ├── css/style.css
│   ├── favicon.*
│   └── js/
│       ├── app.js
│       ├── board.js / game.js / rules.js / constants.js / audio.js
│       ├── core/NetworkService.js
│       ├── state/
│       ├── ui/
│       ├── utils/
│       └── vendor/socket.io.min.js
├── server.js               # Express + Socket.IO
├── start.js / start.bat
├── live-reload.js
├── build.js / build.bat
├── vault-lib.js
├── vault-public-key.js
├── scripts/
│   ├── generate-signing-keys.js
│   └── package-release.js
├── package.json
├── LICENSE
└── README.md
```

本地还可有 `.signing/`（私钥，勿提交）、`.gitignore` 等，不进入仓库。

---

## 环境要求

| 场景 | 要求 |
|------|------|
| 源码运行 | Node.js 18+、npm |
| Windows 单文件版 | Windows x64 |
| 局域网对战 | 同一局域网；房主防火墙放行端口（默认 `3000`） |

---

## 快速开始

### 下载与使用

| 产物 | 说明 |
|------|------|
| Windows 单文件版（exe） | 双击即可运行，无需安装 |
| 源码包（zip） | 解压后按下方「启动」步骤操作 |

> 📦 最新版本请前往 [Releases 页面](https://github.com/huke714/lan-xiangqi/releases/latest) 下载，所有历史版本也可在 Releases 中查找。

### 从源码启动

```bash
npm install
npm start
```

Windows 也可双击 `start.bat`（缺依赖时会自动 `npm install`）。

默认监听 `0.0.0.0:3000`。对手请用浏览器打开大厅「分享给对手」的地址，不要各自再开一份服务。

---

## 配置说明

| 变量 | 作用 | 默认 |
|------|------|------|
| `PORT` | 服务端口 | `3000` |
| `NO_COLOR` | 关闭控制台颜色 | 未设置则 TTY 下启用颜色 |
| `LIVE_RELOAD` | 设为 `0` 关闭开发热刷新 | 开发态开启；pkg 下关闭 |
| `PACK_KEY` / `BUILD_KEY` | 打包密钥 | 无门禁时可自动生成 |
| `PACK_KEY_HASH` | 打包密钥哈希 | 可选；或使用 `.pack-key-hash` |

```powershell
$env:PORT = 3080
npm start
```

---

## 使用说明

1. 输入昵称 → **创建房间** → 选用时与红 / 黑 → 把房间号或分享地址发给对手  
2. 或输入昵称 + 房间号 → **加入**；满员可观战  
3. 点选棋子再点目标格，或拖拽走子  
4. 可 **悔棋 / 认输 / 求和**；终局后可 **再来一局**  
5. 己方回合可进 **沙盘**；可用 **小窗** 专注行棋  

房间只存在于开房那一台的进程内存中。大厅应显示「已连接 · 可以创建或加入房间」。

---

## HTTP API

| 方法 | 路径 | 说明 | 响应要点 |
|------|------|------|----------|
| `GET` | `/api/health` | 连通性探测 | `{ ok: true, rooms, port }` |
| `GET` | `/api/lan-ips` | 局域网 IP 列表 | `{ ips, preferred, port }` |
| `GET` | `/` 及静态资源 | `public/` | 前端页面与脚本 |

无 REST 鉴权，面向受信局域网使用。

---

## Release

发行包与版本说明见 [Releases](https://github.com/huke714/lan-xiangqi/releases/latest)。当前版本号以 `package.json` 为准。

---

## 开发指南

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务 |
| `npm run build` / `build:exe` | 打包 Windows exe |
| `npm run keys:generate` | 生成签名密钥（首次打包前） |

```bash
npm run keys:generate
npm run build
```

私钥在 `.signing/`，勿提交。打包密钥可通过参数或 `PACK_KEY` / `BUILD_KEY` 提供。

开发态默认监视 `public/` 热刷新；关闭：

```powershell
$env:LIVE_RELOAD = "0"
npm start
```

---

## FAQ

**手机或另一台电脑看不到房间？**  
请打开房主分享的 `http://局域网IP:端口`，确认同一 Wi‑Fi 并放行端口；不要各自再开一份程序。

**提示缺少密钥？**  
执行 `npm run keys:generate`，再 `npm run build`。

**打包无法覆盖 exe？**  
关掉正在运行的象棋窗口后重试。

**刷新后座位丢了？**  
断线后约 90 秒内可重连；超时席位释放。

**有数据库或账号系统吗？**  
没有。房间与对局保存在房主进程内存中。

---

## License

[MIT](./LICENSE) · Copyright (c) 2026 中国象棋 · 弈林
