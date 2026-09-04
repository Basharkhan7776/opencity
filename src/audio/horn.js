/* Dual-tone car horn. 440 Hz + 554 Hz (A4 + C#5), held while the key is down. */
export class Horn {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.nodes = [];
    this.sources = [];
    const node = (n) => { this.nodes.push(n); return n; };

    this.out = node(ctx.createGain());
    this.out.gain.value = 0.0001;
    this.out.connect(dest);

    const bp = node(ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 1.6;
    bp.connect(this.out);

    for (const hz of [440, 554.37]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      const g = node(ctx.createGain());
      g.gain.value = hz === 440 ? 0.55 : 0.42;
      o.connect(g);
      g.connect(bp);
      o.start(0);
      this.sources.push(o);
    }
    this._on = false;
  }

  /** `on` is a level, not an edge. */
  set(on, t) {
    const want = !!on;
    if (want === this._on) return;
    this._on = want;
    this.out.gain.setTargetAtTime(want ? 0.55 : 0.0001, t, want ? 0.018 : 0.07);
  }

  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch (_) {} }
    for (const n of this.nodes) n.disconnect();
    for (const s of this.sources) s.disconnect();
  }
}
