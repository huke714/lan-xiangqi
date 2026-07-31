'use strict';
/**
 * 静态资源打包与校验
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('YILN');
const VERSION = 2;
const ED25519_SIG_LEN = 64;
const KEY_SALT = 'yilin-assets-v1:';

function deriveKey(packKey) {
  return crypto.createHash('sha256').update(KEY_SALT + String(packKey || ''), 'utf8').digest();
}

function listFilesRecursive(dir, base, out) {
  if (!out) out = [];
  if (!base) base = dir;
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) listFilesRecursive(full, base, out);
    else out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') });
  }
  return out;
}

function encryptBuffer(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, enc };
}

function decryptBuffer(key, iv, tag, enc) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function loadPrivateKey(pemOrPath) {
  if (!pemOrPath) return null;
  let pem = pemOrPath;
  if (!String(pemOrPath).includes('BEGIN')) {
    pem = fs.readFileSync(pemOrPath, 'utf8');
  }
  return crypto.createPrivateKey(pem);
}

function loadPublicKey(pemOrPath) {
  if (!pemOrPath) return null;
  let pem = pemOrPath;
  if (!String(pemOrPath).includes('BEGIN')) {
    pem = fs.readFileSync(pemOrPath, 'utf8');
  }
  return crypto.createPublicKey(pem);
}

function embeddedPublicKey() {
  const meta = require('./vault-public-key');
  if (!meta || !meta.publicKeyPem) {
    throw new Error('vault-public-key.js missing publicKeyPem');
  }
  return crypto.createPublicKey(meta.publicKeyPem);
}

function buildVaultBody(srcDir, packKey) {
  const key = deriveKey(packKey);
  const files = listFilesRecursive(srcDir).sort((a, b) => a.rel.localeCompare(b.rel));
  const parts = [MAGIC, Buffer.from([VERSION])];
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32BE(files.length, 0);
  parts.push(countBuf);

  for (const f of files) {
    const plain = fs.readFileSync(f.full);
    const { iv, tag, enc } = encryptBuffer(key, plain);
    const relBuf = Buffer.from(f.rel, 'utf8');
    if (relBuf.length > 0xffff) throw new Error('path too long: ' + f.rel);
    const pathLen = Buffer.alloc(2);
    pathLen.writeUInt16BE(relBuf.length, 0);
    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32BE(enc.length, 0);
    parts.push(pathLen, relBuf, iv, tag, dataLen, enc);
  }
  return { body: Buffer.concat(parts), fileCount: files.length };
}

function packDirectory(srcDir, outFile, packKey, privateKeyPemOrPath) {
  const privateKey = loadPrivateKey(privateKeyPemOrPath);
  if (!privateKey) {
    throw new Error('private key required');
  }
  const { body, fileCount } = buildVaultBody(srcDir, packKey);
  const signature = crypto.sign(null, body, privateKey);
  if (signature.length !== ED25519_SIG_LEN) {
    throw new Error('unexpected signature length');
  }
  fs.writeFileSync(outFile, Buffer.concat([body, signature]));
  return fileCount;
}

function parseVaultBody(body, packKey) {
  if (body.length < 9 || body.slice(0, 4).compare(MAGIC) !== 0) {
    throw new Error('invalid asset vault');
  }
  const version = body[4];
  if (version !== VERSION) {
    throw new Error('unsupported vault version');
  }
  const key = deriveKey(packKey);
  const count = body.readUInt32BE(5);
  let o = 9;
  const map = new Map();
  for (let i = 0; i < count; i++) {
    const pathLen = body.readUInt16BE(o); o += 2;
    const rel = body.slice(o, o + pathLen).toString('utf8'); o += pathLen;
    const iv = body.slice(o, o + 12); o += 12;
    const tag = body.slice(o, o + 16); o += 16;
    const dataLen = body.readUInt32BE(o); o += 4;
    const enc = body.slice(o, o + dataLen); o += dataLen;
    map.set(rel.replace(/^\/+/, ''), decryptBuffer(key, iv, tag, enc));
  }
  if (o !== body.length) {
    throw new Error('vault body trailing garbage');
  }
  return map;
}

function unpackToMap(vaultFile, packKey, publicKeyPemOrPath) {
  const buf = fs.readFileSync(vaultFile);
  if (buf.length < 9 + ED25519_SIG_LEN) {
    throw new Error('invalid asset vault');
  }
  const body = buf.slice(0, buf.length - ED25519_SIG_LEN);
  const signature = buf.slice(buf.length - ED25519_SIG_LEN);
  const publicKey = publicKeyPemOrPath
    ? loadPublicKey(publicKeyPemOrPath)
    : embeddedPublicKey();

  const ok = crypto.verify(null, body, publicKey, signature);
  if (!ok) {
    throw new Error('vault signature verification failed');
  }
  return parseVaultBody(body, packKey);
}

function guessMime(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function createVaultStatic(assetMap) {
  return function vaultStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel = decodeURIComponent((req.path || '/').split('?')[0]);
    if (rel === '/' || rel === '') rel = 'index.html';
    else rel = rel.replace(/^\/+/, '');
    if (rel.includes('..') || path.isAbsolute(rel)) {
      res.status(400).end('Bad Request');
      return;
    }
    const data = assetMap.get(rel);
    if (!data) return next();
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Type', guessMime(rel));
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(data);
  };
}

module.exports = {
  VERSION,
  ED25519_SIG_LEN,
  deriveKey,
  packDirectory,
  unpackToMap,
  createVaultStatic,
  guessMime,
  loadPrivateKey,
  loadPublicKey,
  embeddedPublicKey,
};
