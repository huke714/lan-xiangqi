#!/usr/bin/env node
'use strict';
/**
 * 生成打包签名密钥对
 * 用法：npm run keys:generate
 * 覆盖：npm run keys:generate -- --force
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const signingDir = path.join(root, '.signing');
const privatePath = path.join(signingDir, 'ed25519-private.pem');
const publicModulePath = path.join(root, 'vault-public-key.js');
const force = process.argv.includes('--force');

if (fs.existsSync(privatePath) && !force) {
  console.error('Private key already exists: .signing/ed25519-private.pem');
  console.error('Re-run with --force to rotate keys.');
  process.exit(1);
}

fs.mkdirSync(signingDir, { recursive: true });

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync(privatePath, privatePem, { encoding: 'utf8', mode: 0o600 });

const moduleSource =
  "'use strict';\n" +
  'module.exports = Object.freeze({\n' +
  "  algorithm: 'ed25519',\n" +
  '  publicKeyPem: ' + JSON.stringify(publicPem) + ',\n' +
  "  generatedAt: '" + new Date().toISOString() + "',\n" +
  '});\n';

fs.writeFileSync(publicModulePath, moduleSource, 'utf8');

console.log('Generated:');
console.log('  .signing/ed25519-private.pem');
console.log('  vault-public-key.js');
console.log('');
console.log('Next: npm run build');
