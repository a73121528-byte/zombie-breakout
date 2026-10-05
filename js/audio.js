// Simple WebAudio synthesized SFX (no external files)
let ctx = null, master = null, noiseBuf = null;
export const Sfx = {
  enabled: true,
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
        const len = ctx.sampleRate * 1.0;
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  },
  _ok() { return this.enabled && ctx && ctx.state === 'running'; },
  _noise(dur, type, f0, f1, q, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },
  _tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  },
  swing(n = 0) { if (!this._ok()) return; this._noise(0.18 + n * 0.04, 'bandpass', 900 + n * 300, 3500, 1.2, 0.35); },
  hit(heavy = false) {
    if (!this._ok()) return;
    this._tone('sine', heavy ? 140 : 190, 45, heavy ? 0.25 : 0.15, heavy ? 0.7 : 0.5);
    this._noise(0.12, 'lowpass', 2500, 300, 0.8, 0.45);
  },
  hurt() { if (!this._ok()) return; this._tone('triangle', 320, 160, 0.18, 0.35); this._noise(0.15, 'lowpass', 1200, 200, 1, 0.4); },
  dodge() { if (!this._ok()) return; this._noise(0.28, 'bandpass', 500, 1800, 0.7, 0.3); },
  skill() { if (!this._ok()) return; for (let i = 0; i < 3; i++) this._noise(0.2, 'bandpass', 700, 4000, 1.5, 0.35, i * 0.12); this._tone('sawtooth', 110, 55, 0.5, 0.15); },
  groan(pitch = 1, vol = 0.18) {
    if (!this._ok()) return;
    const t = ctx.currentTime, dur = 0.7 + Math.random() * 0.6;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const base = (70 + Math.random() * 40) * pitch;
    o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6 + Math.random() * 5;
    const lg = ctx.createGain(); lg.gain.value = base * 0.08; lfo.connect(lg); lg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 * pitch; f.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  },
  spit() { if (!this._ok()) return; this._noise(0.25, 'bandpass', 300, 1200, 3, 0.35); },
  splash() { if (!this._ok()) return; this._noise(0.35, 'lowpass', 1800, 200, 2, 0.3); },
  roar() { if (!this._ok()) return; this.groan(0.45, 0.5); this._noise(1.0, 'lowpass', 600, 80, 1, 0.4); },
  slam() { if (!this._ok()) return; this._tone('sine', 90, 30, 0.6, 0.9); this._noise(0.5, 'lowpass', 800, 60, 1, 0.6); },
  pickup() { if (!this._ok()) return; this._tone('sine', 520, 1040, 0.18, 0.25); },
  wave() { if (!this._ok()) return; this._tone('sawtooth', 55, 50, 1.4, 0.18); this._tone('sine', 110, 100, 1.4, 0.2); },
  shot(kind = 'pistol', sup = 0) {
    if (!this._ok()) return;
    const q = sup ? 0.45 : 1;
    if (kind === 'shotgun') { this._noise(0.35, 'lowpass', sup ? 1800 : 4200, 120, 0.7, 0.75 * q); this._tone('sine', 120, 40, 0.25, 0.7 * q); }
    else if (kind === 'rifle') { this._noise(0.12, 'bandpass', sup ? 1500 : 3000, 500, 0.8, 0.55 * q); this._tone('square', 180, 60, 0.07, 0.25 * q); }
    else { this._noise(0.16, 'bandpass', sup ? 1400 : 2600, 400, 0.9, 0.6 * q); this._tone('triangle', 240, 70, 0.1, 0.35 * q); }
  },
  reload() { if (!this._ok()) return; this._noise(0.05, 'highpass', 3000, 2500, 2, 0.3); this._noise(0.06, 'highpass', 2200, 1800, 3, 0.35, 0.25); this._tone('square', 900, 700, 0.03, 0.08, 0.27); },
  reloadDone() { if (!this._ok()) return; this._noise(0.05, 'highpass', 2600, 2000, 3, 0.35); this._tone('square', 600, 500, 0.03, 0.1); },
  empty() { if (!this._ok()) return; this._tone('square', 1400, 1200, 0.025, 0.12); },
  swap() { if (!this._ok()) return; this._noise(0.08, 'bandpass', 1500, 900, 2, 0.25); this._tone('square', 500, 450, 0.03, 0.08, 0.06); },
  part() { if (!this._ok()) return; [660, 880, 1320].forEach((f, i) => this._tone('triangle', f, f, 0.14, 0.18, i * 0.07)); },
  ricochet() { if (!this._ok()) return; this._tone('sine', 2400 + Math.random() * 1200, 900, 0.12, 0.05); },
  clank() { if (!this._ok()) return; this._tone('square', 700, 500, 0.06, 0.12); this._noise(0.08, 'highpass', 3000, 2000, 2, 0.2); },
  win() { if (!this._ok()) return; [262, 330, 392, 523].forEach((f, i) => this._tone('triangle', f, f, 0.6, 0.25, i * 0.18)); },
};
