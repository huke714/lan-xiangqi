#!/usr/bin/env node
/**
 * 一键生成 Windows 单文件 exe
 */
const crypto = require('crypto');
const { execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = __dirname;
const distDir = path.join(cwd, 'dist');
const exeName = '中国象棋.exe';
const exePath = path.join(distDir, exeName);
const publicDest = path.join(distDir, 'public');
const tmpExePath = path.join(distDir, 'xiangqi.build.exe');
const buildKeyPath = path.join(cwd, 'build-key.js');
const packKeyHashPath = path.join(cwd, '.pack-key-hash');
const pkgVersion = (() => {
  try {
    return require(path.join(cwd, 'package.json')).version || '1.0.0';
  } catch (e) {
    return '1.0.0';
  }
})();

const isTTY = !!(process.stdout.isTTY);
const useColor = isTTY && !process.env.NO_COLOR;

const C = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  red: useColor ? '\x1b[31m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  white: useColor ? '\x1b[37m' : '',
  bright: useColor ? '\x1b[97m' : '',
};

/** 控制台无法改字号：加亮加粗 + 字距拉开，突出应用名 */
function appTitleLine() {
  return C.bold + C.bright + '中 国 象 棋  ·  弈 林' + C.reset;
}

function enableWinVT() {
  if (process.platform !== 'win32') return;
  try {
    execSync('chcp 65001 >nul', { stdio: 'ignore', windowsHide: true, shell: true });
  } catch (e) { /* ignore */ }
}

function hideCursor() {
  if (isTTY) process.stdout.write('\x1b[?25l');
}
function showCursor() {
  if (isTTY) process.stdout.write('\x1b[?25h');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printBanner() {
  const line = C.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + C.reset;
  console.log('');
  console.log(line);
  console.log(appTitleLine());
  console.log(line);
  console.log('');
}

function printDone(size) {
  const line = C.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + C.reset;
  console.log('');
  console.log('  ' + line);
  console.log('  ' + C.bold + C.green + '✔  打包完成' + C.reset);
  console.log('  ' + line);
  console.log('  ' + C.dim + '文件' + C.reset + '  dist/' + C.bold + exeName + C.reset);
  console.log('  ' + C.dim + '大小' + C.reset + '  ' + size);
  console.log('  ' + C.dim + '版本' + C.reset + '  v' + pkgVersion);
  console.log('  ' + C.cyan + '▸' + C.reset + '  可直接分享，双击即可开始');
  console.log('  ' + line);
  console.log('');
}

function printFail(msg, hint) {
  console.log('');
  console.log('  ' + C.red + C.bold + '✖  ' + msg + C.reset);
  if (hint) console.log('  ' + C.dim + '→  ' + hint + C.reset);
  console.log('');
}

/** 终端进度：按步骤输出一行，不做百分比动画刷屏 */
const Progress = (() => {
  let lastSpinText = '';

  function set() {
    /* 百分比仅作步骤标记，不再刷条 */
  }

  function startSpin(text) {
    if (!text || text === lastSpinText) return;
    lastSpinText = text;
    console.log('  ' + C.dim + '·' + C.reset + '  ' + text);
  }

  function stopSpin() {
    lastSpinText = '';
  }

  function done() {
    stopSpin();
  }

  function fail() {
    stopSpin();
  }

  function pauseForLog() {}
  function resume() {}
  function hide() {}

  return { set, startSpin, stopSpin, done, fail, pauseForLog, resume, hide };
})();

function stepOk(text) {
  console.log('  ' + C.green + '✔' + C.reset + '  ' + text);
}

function stepSkip(text) {
  console.log('  ' + C.dim + '·' + C.reset + '  ' + text);
}

function stepInfo(text) {
  console.log('  ' + C.cyan + '▸' + C.reset + '  ' + text);
}

/** 终端显示宽度：中文按 2，ASCII 按 1 */
function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      continue;
    }
    if (
      code > 0xff ||
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padLabel(label, cols) {
  const pad = Math.max(0, cols - displayWidth(label));
  return label + ' '.repeat(pad);
}

/** 标签与状态对齐，例如：电脑环境  正常（v24） */
const STEP_LABEL_COLS = 8;
function formatStep(label, detail) {
  if (detail == null || detail === '') return label;
  return padLabel(label, STEP_LABEL_COLS) + '  ' + detail;
}

function promptExit() {
  showCursor();
  try {
    if (!process.stdin.isTTY) {
      process.exit(process.exitCode || 0);
      return;
    }
    process.stdin.setRawMode(true);
  } catch (e) {
    process.exit(process.exitCode || 0);
    return;
  }
  process.stdout.write('  ' + C.dim + '按任意键关闭' + C.reset + '\n');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(process.exitCode || 0));
}

function runNpm(args) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, args, {
    cwd,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('npm failed');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function listJsFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    // 第三方库（如 socket.io.min.js）不可混淆
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) listJsFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function ensureObfuscator() {
  try {
    return require('javascript-obfuscator');
  } catch (e) {
    return null;
  }
}

/** 处理 public/js 后再参与打包 */
function obfuscatePublicJs() {
  const JavaScriptObfuscator = ensureObfuscator();
  if (!JavaScriptObfuscator) {
    throw new Error('javascript-obfuscator missing');
  }
  const jsRoot = path.join(cwd, 'public', 'js');
  const files = listJsFiles(jsRoot, []);
  const options = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.35,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    splitStrings: true,
    splitStringsChunkLength: 6,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    target: 'browser',
  };
  let count = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(source, options);
    fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
    count += 1;
  }
  return count;
}

/**
 * 打包前准备静态资源，结束后还原开发目录与 package.json
 */
async function withProtectedPublicAssets(packKey, work) {
  const Vault = require('./vault-lib');
  const publicRoot = path.join(cwd, 'public');
  const backupRoot = path.join(distDir, '.public-src-backup');
  const vaultFile = path.join(cwd, 'asset-vault.bin');
  const pkgJsonPath = path.join(cwd, 'package.json');
  const pkgJsonRaw = fs.readFileSync(pkgJsonPath, 'utf8');
  let pkgJson;
  try {
    pkgJson = JSON.parse(pkgJsonRaw);
  } catch (e) {
    throw new Error('package.json 无法解析');
  }

  rmDir(backupRoot);
  copyDir(publicRoot, backupRoot);
  if (fs.existsSync(vaultFile)) {
    try { fs.unlinkSync(vaultFile); } catch (e) { /* ignore */ }
  }

  let restored = false;
  const aside = path.join(distDir, '.public-aside');
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      fs.writeFileSync(pkgJsonPath, pkgJsonRaw, 'utf8');
    } catch (e) {
      console.error('  ·  还原 package.json 失败：' + (e && e.message ? e.message : e));
    }

    // 先拷到临时目录，成功后再替换，避免还原失败时把 public/ 删空
    try {
      const hasBackup = fs.existsSync(backupRoot);
      const hasAside = fs.existsSync(aside);
      if (hasBackup || hasAside) {
        const tmpRestore = path.join(distDir, '.public-restore-tmp');
        rmDir(tmpRestore);
        if (hasBackup) copyDir(backupRoot, tmpRestore);
        else copyDir(aside, tmpRestore);

        const doomed = path.join(distDir, '.public-doomed');
        rmDir(doomed);
        if (fs.existsSync(publicRoot)) {
          try {
            fs.renameSync(publicRoot, doomed);
          } catch (e) {
            rmDir(publicRoot);
          }
        }
        fs.renameSync(tmpRestore, publicRoot);
        rmDir(doomed);
      } else if (!fs.existsSync(publicRoot)) {
        throw new Error('备份与 aside 均不存在，无法还原 public/');
      }
      rmDir(aside);
      rmDir(backupRoot);
    } catch (e) {
      console.error('  ·  还原 public/ 失败：' + (e && e.message ? e.message : e));
      try {
        if (!fs.existsSync(publicRoot) && fs.existsSync(aside)) {
          fs.renameSync(aside, publicRoot);
        } else if (!fs.existsSync(publicRoot) && fs.existsSync(backupRoot)) {
          copyDir(backupRoot, publicRoot);
        }
      } catch (e2) {
        console.error('  ·  紧急还原 public/ 仍失败，请从 git 恢复 public 目录');
      }
    }

    // 开发态用 public/；vault 仅在本次 pkg 过程中需要，结束后可删
    try {
      if (fs.existsSync(vaultFile)) fs.unlinkSync(vaultFile);
    } catch (e) { /* ignore */ }
  };

  try {
    const jsCount = obfuscatePublicJs();
    const privateKeyPath = path.join(cwd, '.signing', 'ed25519-private.pem');
    if (!fs.existsSync(privateKeyPath)) {
      throw new Error(
        '缺少 .signing/ed25519-private.pem，请先执行：npm run keys:generate'
      );
    }
    const fileCount = Vault.packDirectory(publicRoot, vaultFile, packKey, privateKeyPath);

    pkgJson.pkg = pkgJson.pkg || {};
    pkgJson.pkg.assets = ['asset-vault.bin'];
    if (!Array.isArray(pkgJson.pkg.scripts)) pkgJson.pkg.scripts = [];
    for (const name of ['vault-lib.js', 'vault-public-key.js']) {
      if (!pkgJson.pkg.scripts.includes(name)) pkgJson.pkg.scripts.push(name);
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');

    rmDir(aside);
    fs.renameSync(publicRoot, aside);

    try {
      await work({ jsCount, fileCount });
    } finally {
      try {
        if (fs.existsSync(aside) && !fs.existsSync(publicRoot)) {
          fs.renameSync(aside, publicRoot);
        } else if (fs.existsSync(aside) && fs.existsSync(publicRoot)) {
          // work 期间若又生成了 public，保留备份源，aside 留给 restore
        }
      } catch (e) { /* ignore */ }
    }
  } finally {
    restore();
  }
}

function runPkgAsync(args) {
  return new Promise((resolve, reject) => {
    const pkgBin = path.join(cwd, 'node_modules', 'pkg', 'lib-es5', 'bin.js');
    if (!fs.existsSync(pkgBin)) {
      reject(new Error('pkg binary not found'));
      return;
    }
    const child = spawn(process.execPath, [pkgBin, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let errBuf = '';
    child.stderr.on('data', (d) => { errBuf += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else {
        const err = new Error(errBuf.trim() || 'pkg failed');
        err.status = code;
        reject(err);
      }
    });
  });
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** 读取可选的 .pack-key-hash / PACK_KEY_HASH */
function loadPackKeyHash() {
  if (process.env.PACK_KEY_HASH) return String(process.env.PACK_KEY_HASH).trim();
  if (fs.existsSync(packKeyHashPath)) {
    const line = fs.readFileSync(packKeyHashPath, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#'));
    return line || '';
  }
  return '';
}

function isValidPackKey(value, expectedHash) {
  if (!value || !expectedHash) return false;
  return hashKey(String(value).trim()) === expectedHash;
}

function readKeyFromArgv() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--key' || a === '-k') {
      return args[i + 1] ? String(args[i + 1]).trim() : '';
    }
    if (a.startsWith('--key=')) return a.slice(6).trim();
    if (!a.startsWith('-')) return a.trim();
  }
  return '';
}

function promptPackKey() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdout.write('  ' + C.cyan + '▸' + C.reset + '  请输入密码: ');
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');
    try { stdin.setRawMode(true); } catch (e) { /* ignore */ }

    let buf = '';
    const finish = () => {
      try { stdin.setRawMode(false); } catch (e) { /* ignore */ }
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(buf.trim());
    };
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        finish();
        return;
      }
      if (ch === '\u0003') {
        try { stdin.setRawMode(false); } catch (e) { /* ignore */ }
        process.stdout.write('\n');
        process.exit(130);
      }
      if (ch === '\u007f' || ch === '\b') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (ch.length === 1 && ch >= ' ') {
        buf += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function requirePackKey() {
  const expectedHash = loadPackKeyHash();
  let key = process.env.BUILD_KEY || process.env.PACK_KEY || readKeyFromArgv();
  key = key ? String(key).trim() : '';

  if (!expectedHash) {
    if (key) {
      console.log('  ' + C.dim + '已使用提供的打包密钥' + C.reset);
      return key;
    }
    const generated = crypto.randomBytes(16).toString('hex');
    console.log('  ' + C.dim + '已自动生成打包密钥' + C.reset);
    return generated;
  }

  const maxTries = 5;
  let fromArg = !!key;

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    if (!key) {
      key = await promptPackKey();
    }

    if (isValidPackKey(key, expectedHash)) {
      return key;
    }

    const left = maxTries - attempt;
    if (left <= 0) {
      printFail('密码错误次数过多', '请稍后再试');
      return null;
    }

    console.log('  ' + C.red + '✖' + C.reset + '  密码不对，请重试（还可试 ' + left + ' 次）');
    if (fromArg) {
      console.log('  ' + C.dim + '命令行密码不正确，请重新输入' + C.reset);
      fromArg = false;
    }
    console.log('');
    key = '';
  }

  return null;
}

function sealPackKey(packKey) {
  const safeKey = String(packKey).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const builtAt = new Date().toISOString();
  const body =
    "'use strict';\n" +
    "/**\n" +
    " * 由 build.js 自动生成，请勿手改\n" +
    " * builtAt: " + builtAt + "\n" +
    " */\n" +
    "module.exports = Object.freeze({\n" +
    "  key: '" + safeKey + "',\n" +
    "  label: 'yilin-pack',\n" +
    "  builtAt: '" + builtAt + "',\n" +
    "});\n";
  fs.writeFileSync(buildKeyPath, body, 'utf8');

  let stamped;
  try {
    delete require.cache[require.resolve('./build-key')];
    stamped = require('./build-key');
  } catch (e) {
    return false;
  }
  return !!(stamped && stamped.key === packKey);
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/** 查找可能占用打包产物的进程（游戏 exe / 本项目开发态 node） */
function findPackBlockingPids() {
  if (process.platform !== 'win32') return [];
  const selfPid = process.pid;
  const names = [exeName, path.basename(tmpExePath)];

  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$dist='" + distDir.replace(/'/g, "''") + "'",
    "$root='" + cwd.replace(/'/g, "''") + "'",
    "$names=@(" + names.map((n) => "'" + n.replace(/'/g, "''") + "'").join(',') + ")",
    "$self=" + selfPid,
    "$list=@()",
    "Get-CimInstance Win32_Process | ForEach-Object {",
    "  $p=$_",
    "  if ($p.ProcessId -eq $self) { return }",
    "  $n=[string]$p.Name",
    "  $ep=[string]$p.ExecutablePath",
    "  $cl=[string]$p.CommandLine",
    "  $hit=$false",
    "  if ($names -contains $n) { $hit=$true }",
    "  if ($ep -and ($ep.StartsWith($dist, [System.StringComparison]::OrdinalIgnoreCase))) { $hit=$true }",
    "  if ($cl -and ($cl.IndexOf($dist, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) { $hit=$true }",
    "  foreach ($nm in $names) { if ($cl -and ($cl.IndexOf($nm, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) { $hit=$true } }",
    "  if ($n -match '^node(\\.exe)?$' -and $cl -and $cl.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and ($cl -match 'start\\.js|server\\.js')) { $hit=$true }",
    "  if ($hit) { $list += [string]$p.ProcessId }",
    "}",
    "$list -join ','",
  ].join('; ');

  try {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    const text = String((out && out.stdout) || '').trim();
    if (!text) return [];
    return text.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0 && n !== selfPid);
  } catch (e) {
    return [];
  }
}

function killPidList(pids) {
  let killed = 0;
  for (const pid of pids) {
    try {
      const r = spawnSync('powershell.exe', [
        '-NoProfile', '-Command',
        "Stop-Process -Id " + pid + " -Force -ErrorAction SilentlyContinue",
      ], { windowsHide: true, timeout: 8000 });
      if (!r.error) killed += 1;
    } catch (e) { /* ignore */ }
    try {
      spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (e) { /* ignore */ }
  }
  // 按镜像名再扫一遍，兜底（含中文文件名）
  for (const name of [exeName, path.basename(tmpExePath)]) {
    try {
      spawnSync('powershell.exe', [
        '-NoProfile', '-Command',
        "$n='" + name.replace(/'/g, "''") + "'; Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName + '.exe' -eq $n -or $_.Name -eq $n } | Stop-Process -Force -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $n } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ], { windowsHide: true, timeout: 12000 });
    } catch (e) { /* ignore */ }
    try {
      spawnSync('taskkill', ['/F', '/IM', name, '/T'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (e) { /* ignore */ }
  }
  return killed;
}

function tryRemoveFile(filePath) {
  if (!fs.existsSync(filePath)) return true;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 自动检测并关闭占用 dist 产物的相关进程，再清理目标文件。
 * @param {{ clearTmp?: boolean }} [opts] clearTmp=false 时保留刚打好的临时 exe（最终落盘前必用）
 * @returns {{ ok: boolean, closed: number }}
 */
function ensurePackOutputsFree(opts) {
  const clearTmp = !(opts && opts.clearTmp === false);
  let closed = 0;
  const maxRounds = 5;

  for (let round = 0; round < maxRounds; round++) {
    const pids = findPackBlockingPids();
    if (pids.length) {
      closed += killPidList(pids);
      sleepSync(500 + round * 250);
    } else if (round === 0) {
      // 即使列表为空也按名称尝试一次（部分环境拿不到 ExecutablePath）
      closed += killPidList([]);
      sleepSync(400);
    }

    const exeOk = tryRemoveFile(exePath);
    const tmpOk = clearTmp ? tryRemoveFile(tmpExePath) : true;
    if (exeOk && tmpOk) {
      return { ok: true, closed };
    }
    sleepSync(600);
  }

  return {
    ok: tryRemoveFile(exePath) && (clearTmp ? tryRemoveFile(tmpExePath) : true),
    closed,
  };
}

/** 把临时产物替换为最终 exe：先腾出目标文件，再 rename，失败则 copy */
function publishFinalExe() {
  const free = ensurePackOutputsFree({ clearTmp: false });
  if (!free.ok && fs.existsSync(exePath)) {
    throw new Error('final exe locked');
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      ensurePackOutputsFree({ clearTmp: false });
      sleepSync(400 + attempt * 300);
    }

    if (fs.existsSync(exePath)) {
      if (!tryRemoveFile(exePath)) continue;
    }

    try {
      fs.renameSync(tmpExePath, exePath);
      return;
    } catch (e) {
      // 杀软/资源管理器偶发拦 rename：改用复制再删临时文件
      try {
        fs.copyFileSync(tmpExePath, exePath);
        tryRemoveFile(tmpExePath);
        if (fs.existsSync(exePath)) return;
      } catch (e2) { /* retry */ }
    }
  }

  throw new Error('publish failed');
}

async function main() {
  enableWinVT();
  printBanner();

  const packKey = await requirePackKey();
  if (!packKey) {
    process.exitCode = 1;
    promptExit();
    return;
  }
  if (loadPackKeyHash()) {
    console.log('  ' + C.green + '✔' + C.reset + '  密码正确');
    console.log('');
  } else {
    console.log('');
  }

  Progress.set(4, '正在检查电脑环境…');
  await sleep(180);
  let nodeVer = '';
  try {
    nodeVer = execSync('node -v', { encoding: 'utf8' }).trim();
  } catch (e) {
    Progress.fail();
    printFail('还缺少运行环境', '请先安装 Node.js：https://nodejs.org/');
    process.exitCode = 1;
    promptExit();
    return;
  }
  Progress.set(12, '环境正常');
  stepOk(formatStep('电脑环境', '正常（' + nodeVer + '）'));
  await sleep(120);

  if (!fs.existsSync(path.join(cwd, 'node_modules', 'express', 'package.json'))) {
    Progress.set(18, '正在准备游戏组件…');
    Progress.startSpin('正在下载需要的组件，请稍候');
    try {
      runNpm(['install']);
    } catch (e) {
      Progress.fail();
      printFail('组件准备失败', '请检查网络后重试');
      process.exitCode = 1;
      promptExit();
      return;
    }
    Progress.stopSpin();
    Progress.set(28, '组件就绪');
    stepOk(formatStep('游戏组件', '已准备好'));
  } else {
    Progress.set(28, '组件就绪');
    stepSkip(formatStep('游戏组件', '已准备好，跳过'));
  }
  await sleep(100);

  if (!fs.existsSync(path.join(cwd, 'node_modules', 'pkg', 'package.json'))) {
    Progress.set(32, '正在准备生成工具…');
    Progress.startSpin('正在准备生成工具，请稍候');
    try {
      runNpm(['install', 'pkg', '--save-dev']);
    } catch (e) {
      Progress.fail();
      printFail('生成工具准备失败', '请检查网络后重试');
      process.exitCode = 1;
      promptExit();
      return;
    }
    Progress.stopSpin();
    Progress.set(38, '工具就绪');
    stepOk(formatStep('生成工具', '已准备好'));
  } else {
    Progress.set(38, '工具就绪');
    stepSkip(formatStep('生成工具', '已准备好，跳过'));
  }
  await sleep(100);

  fs.mkdirSync(distDir, { recursive: true });
  Progress.set(42, '正在检查占用进程…');
  stepInfo(formatStep('占用检查', '检测并关闭相关进程'));
  const unlock = ensurePackOutputsFree();
  if (!unlock.ok) {
    Progress.fail();
    printFail(
      '无法清理旧的游戏文件',
      '请手动关掉「中国象棋.exe」及相关窗口后重试'
    );
    process.exitCode = 1;
    promptExit();
    return;
  }
  if (unlock.closed > 0) {
    stepOk(formatStep('占用检查', '已关闭相关进程并清理旧文件'));
  } else {
    stepOk(formatStep('占用检查', '输出目录可用'));
  }
  Progress.set(46, '正在写入授权信息…');
  await sleep(100);
  if (!sealPackKey(packKey)) {
    Progress.fail();
    printFail('授权信息写入失败', '请确认文件夹未被占用后重试');
    process.exitCode = 1;
    promptExit();
    return;
  }
  stepOk(formatStep('授权信息', '已写入'));
  await sleep(80);

  Progress.set(48, '正在准备打包组件…');
  if (!ensureObfuscator()) {
    Progress.startSpin('正在安装打包组件');
    try {
      runNpm(['install', 'javascript-obfuscator', '--save-dev']);
    } catch (e) {
      Progress.fail();
      printFail('打包组件安装失败', '请检查网络后重试');
      process.exitCode = 1;
      promptExit();
      return;
    }
    Progress.stopSpin();
  }
  if (!ensureObfuscator()) {
    Progress.fail();
    printFail('打包组件不可用', '请手动执行 npm install 后重试');
    process.exitCode = 1;
    promptExit();
    return;
  }
  stepOk(formatStep('打包组件', '已就绪'));
  await sleep(80);

  Progress.set(52, '正在生成游戏文件…');
  Progress.startSpin('正在整理资源…');
  try {
    await withProtectedPublicAssets(packKey, async (stats) => {
      Progress.stopSpin();
      stepOk(formatStep('资源整理', '已处理 ' + stats.fileCount + ' 个文件'));
      Progress.startSpin('正在打包游戏…');
      await runPkgAsync([
        '.',
        '--targets', 'node18-win-x64',
        '--output', tmpExePath,
      ]);
    });
  } catch (e) {
    Progress.fail();
    const msg = String((e && e.message) || e || '');
    if (/EPERM|EACCES|operation not permitted|busy|locked/i.test(msg)) {
      ensurePackOutputsFree();
      printFail(
        '无法保存游戏文件',
        '已尝试关闭占用进程，请重试打包'
      );
    } else if (/obfuscator|vault|private key|signature|ed25519|\.signing/i.test(msg)) {
      printFail('打包准备失败', msg.slice(0, 200) || '请稍后重试');
    } else if (/pkg failed|ENOENT|not found/i.test(msg) || (e && e.status)) {
      printFail('生成失败', (msg.slice(0, 180) || 'pkg 退出异常') + '；可删除 dist 后重试');
    } else {
      printFail('生成失败', (msg.slice(0, 180) || '请稍后重试') + '；若反复失败可联系作者');
    }
    process.exitCode = 1;
    promptExit();
    return;
  }

  if (!fs.existsSync(tmpExePath)) {
    Progress.fail();
    printFail('没有生成出游戏文件', '请稍后重试');
    process.exitCode = 1;
    promptExit();
    return;
  }

  Progress.stopSpin();
  Progress.set(92, '正在保存最终文件…');
  await sleep(120);

  try {
    // 切勿 clearTmp：上一版会在此处删掉刚打好的 .build.exe
    publishFinalExe();
  } catch (e) {
    Progress.fail();
    printFail(
      '无法保存到最终位置',
      '请手动关掉「中国象棋.exe」后重试'
    );
    process.exitCode = 1;
    promptExit();
    return;
  }

  if (fs.existsSync(publicDest)) {
    Progress.set(96, '正在打扫临时文件…');
    rmDir(publicDest);
  }

  const exeSize = formatSize(fs.statSync(exePath).size);
  Progress.done();
  stepOk(formatStep('游戏文件', '已生成'));
  printDone(exeSize);

  process.exitCode = 0;
  promptExit();
}

process.on('exit', showCursor);
process.on('SIGINT', () => {
  showCursor();
  process.exit(130);
});

main().catch(() => {
  Progress.fail();
  printFail('生成过程出了点问题', '请关闭后重试；若仍失败可联系作者');
  process.exitCode = 1;
  promptExit();
});
