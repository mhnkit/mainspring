// All sounds are synthesized with Web Audio, so there are no files to load.
// Mechanisms: 'tick8' (mechanical watch, 8 beats/s), 'tick1' (quartz), 'tock' (pendulum clocks), 'beep' (digital).
export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.mech = null;
    this.beat = 0;
    this.nextTime = 0;
    this.timer = null;
    this.lastClick = 0;
  }

  async setEnabled(on) {
    this.enabled = on;
    if (on) {
      if (!this.ctx) this._init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } }
      this.master.gain.setTargetAtTime(0.6, this.ctx.currentTime, 0.05);
      this._start();
      if (this.mech === 'beep') this.beep();
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
      this._stop();
    }
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // rate = beats per second (optional). Mechanical watches: 6 or 8; pendulum clocks: 2 / period.
  setMechanism(kind, rate = 0) {
    if (this.mech === kind && this.rate === rate) return;
    this.mech = kind;
    this.rate = rate;
    this.beat = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.06;
    if (kind === 'beep' && this.enabled) this.beep();
  }

  _start() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  _stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  _schedule() {
    if (!this.enabled || !this.ctx || !this.mech || document.hidden) return;
    const base = { tick8: 0.125, tick1: 1, tock: 1 }[this.mech];
    if (!base) return;
    const interval = this.rate > 0 ? 1 / this.rate : base;
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.02;
    while (this.nextTime < now + 0.12) {
      const t = this.nextTime;
      if (this.mech === 'tick8') this._tick(t, this.beat % 2 ? 5400 : 4700, 0.13, 0.011);
      else if (this.mech === 'tick1') this._tick(t, 3300, 0.2, 0.018);
      else this._tock(t, this.beat % 2 === 1);
      this.beat++;
      this.nextTime += interval;
    }
  }

  _burst(t, freq, q, gain, decay, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.8, decay + 0.05);
  }

  _ping(t, freq, gain, decay) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  _tick(t, freq, gain, decay) {
    this._burst(t, freq, 2.5, gain, decay);
    this._ping(t, freq * 0.62, gain * 0.18, decay * 2.2);
  }

  _tock(t, low) {
    this._burst(t, low ? 950 : 1500, 4, 0.32, low ? 0.09 : 0.06);
    this._ping(t, low ? 210 : 260, 0.08, 0.08);
  }

  beep() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 3150;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
    g.gain.setValueAtTime(0.045, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  whoosh(duration = 1.6) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(1300, t + duration * 0.5);
    f.frequency.exponentialRampToValueAtTime(300, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + duration * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  click() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClick < 0.045) return;
    this.lastClick = now;
    this._burst(now + 0.005, 3200, 1.6, 0.22, 0.016, 'highpass');
    this._ping(now + 0.005, 1850, 0.05, 0.05);
  }
}
