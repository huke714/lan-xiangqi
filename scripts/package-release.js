#!/usr/bin/env node
/**
 * 打包发行资产：干净源码 zip，并复制版本化 exe 到 dist/release/
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version || '1.0.0';
const releaseDir = path.join(root, 'dist', 'release');
const sourceZipName = `lan-xiangqi-${version}-source.zip`;
const sourceZipPath = path.join(releaseDir, sourceZipName);
const exeSrc = path.join(root, 'dist', '中国象棋.exe');
const exeDestName = `yilin-xiangqi-v${version}-win-x64.exe`;
const exeDest = path.join(releaseDir, exeDestName);

const EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.idea',
  '.vscode',
  '.cursor',
  '.claude',
  '.codex',
  'docs',
]);

const EXCLUDE_FILES = new Set([
  '.gitignore',
  'build-key.js',
  '.pack-key-hash',
  'asset-vault.bin',
  'Thumbs.db',
  'Desktop.ini',
  '.DS_Store',
]);

function shouldSkip(relPosix, baseName, isDir) {
  const parts = relPosix.split('/').filter(Boolean);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (EXCLUDE_FILES.has(baseName)) return true;
  // 根目录 .gitignore / .gitattributes / .signing 仅本地，不打进源码包
  if (baseName === '.gitignore' || baseName === '.gitattributes') return true;
  if (parts[0] === '.signing') return true;
  if (/\.(pem|key)$/i.test(baseName)) return true;
  if (baseName.startsWith('.env')) return true;
  if (baseName.endsWith('.log') || baseName.endsWith('.local')) return true;
  if (isDir && (baseName === '.public-src-backup' || baseName === '.public-aside' || baseName === '.js-src-backup')) {
    return true;
  }
  return false;
}

function listFiles(dir, baseRel) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (shouldSkip(rel.replace(/\\/g, '/'), ent.name, ent.isDirectory())) continue;
    if (ent.isDirectory()) {
      out.push(...listFiles(abs, rel));
    } else if (ent.isFile()) {
      out.push({ abs, rel: rel.replace(/\\/g, '/') });
    }
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function zipWithPowerShell(files, zipPath) {
  const staging = path.join(releaseDir, `_source_staging_${version}`);
  fs.rmSync(staging, { recursive: true, force: true });
  const rootName = `lan-xiangqi-${version}`;
  const stagedRoot = path.join(staging, rootName);
  ensureDir(stagedRoot);

  for (const f of files) {
    const dest = path.join(stagedRoot, f.rel.split('/').join(path.sep));
    ensureDir(path.dirname(dest));
    fs.copyFileSync(f.abs, dest);
  }

  fs.rmSync(zipPath, { force: true });
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${stagedRoot.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit', cwd: root }
  );
  fs.rmSync(staging, { recursive: true, force: true });
}

function main() {
  ensureDir(releaseDir);
  const files = listFiles(root, '');
  if (files.length === 0) {
    console.error('未找到可打包源码文件');
    process.exit(1);
  }

  console.log(`打包源码 ${files.length} 个文件 → ${sourceZipName}`);
  zipWithPowerShell(files, sourceZipPath);

  if (fs.existsSync(exeSrc)) {
    fs.copyFileSync(exeSrc, exeDest);
    const size = fs.statSync(exeDest).size;
    console.log(`已复制 exe → ${exeDestName} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.warn(`未找到 ${exeSrc}，请先执行 npm run build`);
  }

  console.log('');
  console.log('发行目录:', releaseDir);
  for (const name of fs.readdirSync(releaseDir)) {
    const p = path.join(releaseDir, name);
    if (!fs.statSync(p).isFile()) continue;
    console.log(' -', name, `(${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
  }
}

main();
