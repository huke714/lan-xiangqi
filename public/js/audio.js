// 音效系统 — Web Audio API 合成
const ChessAudio = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, delay) {
    try {
      const c = getCtx();
      const t = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol || 0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (e) {}
  }

  return {
    select() { tone(1200, 0.04, 'sine', 0.03); },
    move()   { tone(550, 0.07, 'triangle', 0.05); },
    capture() {
      tone(280, 0.09, 'square', 0.06);
      setTimeout(() => tone(480, 0.06, 'sine', 0.04), 40);
    },
    check() {
      tone(380, 0.13, 'sawtooth', 0.05);
      setTimeout(() => tone(580, 0.09, 'sine', 0.03), 80);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'sine', 0.05, i * 0.12));
    },
    lose() {
      [400, 350, 300, 250].forEach((f, i) => tone(f, 0.2, 'sine', 0.04, i * 0.15));
    },
    illegal() { tone(180, 0.08, 'square', 0.03); },
    // 时限提醒：轻柔短音，不打断思考
    timeWarn() {
      tone(880, 0.06, 'sine', 0.035);
      tone(660, 0.08, 'sine', 0.025, 0.07);
    },
    timeUrgent() {
      tone(720, 0.07, 'sine', 0.04);
      tone(540, 0.1, 'triangle', 0.03, 0.08);
    }
  };
})();
