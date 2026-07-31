#!/usr/bin/env node
// 启动器：开发态拉起服务；正式 exe 直接开局
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3000;
const isPkg = !!process.pkg;
const useColor = !!(process.stdout.isTTY) && !process.env.NO_COLOR;

const C = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  red: useColor ? '\x1b[31m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  bright: useColor ? '\x1b[97m' : '',
};

/** 控制台无法改字号：加亮加粗 + 字距拉开，突出应用名 */
function appTitleLine() {
  return C.bold + C.bright + '中 国 象 棋  ·  弈 林' + C.reset;
}

function enableWinConsole() {
  if (process.platform !== 'win32') return;
  try {
    execSync('chcp 65001 >nul', { stdio: 'ignore', windowsHide: true, shell: true });
  } catch (e) { /* ignore */ }
}

function say(msg) {
  console.log('  ' + msg);
}

function blank() {
  console.log('');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function promptExit() {
  try {
    process.stdin.setRawMode(true);
  } catch (e) {
    process.exit(0);
    return;
  }
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(0));
}

async function bootSplash() {
  blank();
  console.log(C.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + C.reset);
  console.log(appTitleLine());
  console.log(C.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + C.reset);
  blank();

  if (!isPkg) {
    say(C.yellow + '●' + C.reset + '  开发模式');
    blank();
    return;
  }

  // Windows 控制台对 ✔ / 盲文转圈支持差：待办空心框，完成实心绿框
  // 正式版启动仪式约 15 秒，避免一闪而过
  const BOOT_TOTAL_MS = 15000;
  const boxTodo = C.dim + '□' + C.reset;
  const boxDone = C.green + '■' + C.reset;
  const frames = [
    C.dim + '□' + C.reset,
    C.cyan + '□' + C.reset,
    C.cyan + '■' + C.reset,
    C.cyan + '□' + C.reset,
  ];
  const steps = ['初始化运行环境', '装载棋盘资源', '开启对局服务'];
  const tickMs = 120;
  const ticksPerStep = Math.max(1, Math.floor(BOOT_TOTAL_MS / steps.length / tickMs));

  for (const step of steps) {
    say(boxTodo + '  ' + C.dim + step + C.reset);
  }

  for (let s = 0; s < steps.length; s++) {
    const linesBelow = steps.length - s;
    for (let i = 0; i < ticksPerStep; i++) {
      const mark = frames[i % frames.length];
      const pct = Math.min(99, Math.round(((i + 1) / ticksPerStep) * 100));
      process.stdout.write(
        '\x1b[' + linesBelow + 'A\r\x1b[2K  ' +
        mark + '  ' + steps[s] + '  ' + C.dim + pct + '%' + C.reset +
        '\x1b[' + linesBelow + 'B'
      );
      await sleep(tickMs);
    }
    process.stdout.write(
      '\x1b[' + linesBelow + 'A\r\x1b[2K  ' +
      boxDone + '  ' + steps[s] +
      '\x1b[' + linesBelow + 'B'
    );
  }
  blank();
}

try {
  process.stdout.write('');
} catch (e) {
  process.exit(1);
}

enableWinConsole();

const serverModulePath = path.join(__dirname, 'server.js');
const hasNodeModules = fs.existsSync(path.join(__dirname, 'node_modules', 'express', 'package.json'));

function killPort(port) {
  try {
    const result = execSync('netstat -ano', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const pids = new Set();
    for (const row of result.split('\n')) {
      if (row.includes(':' + port + ' ') && row.includes('LISTENING')) {
        const parts = row.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && /^\d+$/.test(pid)) pids.add(pid);
      }
    }
    for (const pid of pids) {
      try {
        execSync('taskkill //F //PID ' + pid, { stdio: 'ignore' });
      } catch (e) {}
    }
  } catch (e) {}
}

(async () => {
  await bootSplash();

  if (!isPkg && !hasNodeModules) {
    say(C.cyan + '▸' + C.reset + '  第一次启动，正在准备组件…');
    try {
      execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
      say(C.green + '■' + C.reset + '  组件准备完成');
      blank();
    } catch (e) {
      say(C.red + '✖' + C.reset + '  准备失败');
      say(C.dim + '请先安装 Node.js：https://nodejs.org' + C.reset);
      blank();
      promptExit();
      process.exit(1);
    }
  }

  killPort(PORT);

  if (isPkg) {
    require('./server.js');
  } else {
    const server = spawn(process.execPath, [serverModulePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: __dirname,
    });
    server.stdout.on('data', (data) => process.stdout.write(data));
    server.stderr.on('data', (data) => process.stderr.write(data));
    server.on('error', (err) => {
      say(C.red + '✖' + C.reset + '  无法启动：' + err.message);
      process.exit(1);
    });
    server.on('exit', () => {
      blank();
      say(C.dim + '对局已结束 · 按任意键关闭' + C.reset);
      promptExit();
    });
  }
})();
