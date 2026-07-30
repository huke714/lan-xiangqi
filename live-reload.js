// 开发态热刷新：监视 public/，变更后通知浏览器自动刷新
const fs = require('fs');
const path = require('path');

function enableLiveReload(io, watchDir) {
  if (process.pkg) return false;
  if (process.env.LIVE_RELOAD === '0') return false;

  let timer = null;
  let lastFile = '';

  const notify = (filename) => {
    lastFile = filename || lastFile;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const file = lastFile.replace(/\\/g, '/');
      console.log('  [live-reload] ' + file);
      io.emit('devReload', { file, t: Date.now() });
    }, 150);
  };

  try {
    fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const base = path.basename(filename);
      if (base.startsWith('.') || base.endsWith('~')) return;
      if (!/\.(css|js|html|png|svg|jpg|jpeg|webp|ico|json)$/i.test(filename)) return;
      notify(filename);
    });
    console.log('  Live reload: on  (edit public/ → auto refresh)');
    console.log('  Tip: set LIVE_RELOAD=0 to disable');
    return true;
  } catch (err) {
    console.log('  Live reload: off (' + err.message + ')');
    return false;
  }
}

module.exports = { enableLiveReload };
