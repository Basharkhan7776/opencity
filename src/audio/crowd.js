/* Pedestrian audio: foot-scuffs, a shout, and a startled horn on a close pass. */
import { clamp, lerp } from '../core/util.js';
import { noiseSource } from './noise.js';

const NEAR = 3.5;
const HIT = 1.2;
const STEP_R = 28;
const SHOUT_CD = 1.4;

export class Crowd {
  constructor(ctx, dest, buffers) {
    this.ctx = ctx;
    this.buf = buffers.white;
    this.nodes = [];
    this.sources = [];
    const node = (n) => { this.nodes.push(n); return n; };

    this.out = node(ctx.createGain());
    this.out.gain.value = 1;
    this.out.connect(dest);

    this.stepPan = node(ctx.createStereoPanner());
    this.step = node(ctx.createGain());
    this.step.gain.value = 0.0001;
    const hp = node(ctx.createBiquadFilter());
    hp.type = 'highpass'; hp.frequency.value = 280; hp.Q.value = 0.7;
    const lp = node(ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.frequency.value = 1600; lp.Q.value = 0.8;
    this.sources.push(noiseSource(ctx, buffers.white, hp, { rate: 1.35, offset: 0.31 }));
    hp.connect(lp); lp.connect(this.step); this.step.connect(this.stepPan); this.stepPan.connect(this.out);

    this._stepT = 0;
    this._shoutT = -9;
  }

  /**
   * @param {{nearest:number, walking:number, hit:boolean, dx?:number, dz?:number}} ev
   */
  update(dt, t, ev) {
    const walking = ev.walking || 0;
    const nearest = ev.nearest == null ? 99 : ev.nearest;
    const pan = clamp((ev.dx || 0) / 6, -0.85, 0.85);
    this.stepPan.pan.setTargetAtTime(pan, t, 0.08);

    const stepLvl = walking > 0 && nearest < STEP_R
      ? 0.11 * clamp(1 - nearest / STEP_R, 0, 1) * Math.min(walking, 5)
      : 0;
    this.step.gain.setTargetAtTime(0.0001 + stepLvl * 0.35, t, 0.08);

    this._stepT -= dt;
    if (stepLvl > 0.006 && this._stepT <= 0) {
      this._stepT = lerp(0.42, 0.26, clamp(walking / 4, 0, 1));
      const g = this.step.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else { g.cancelScheduledValues(t); g.setValueAtTime(Math.max(g.value, 0.0001), t); }
      g.linearRampToValueAtTime(0.0001 + stepLvl * 2.4, t + 0.016);
      g.setTargetAtTime(0.0001 + stepLvl * 0.35, t + 0.06, 0.04);
    }

    const close = nearest < NEAR || ev.hit;
    if (close && t - this._shoutT > SHOUT_CD) {
      this._shoutT = t;
      const hit = !!(ev.hit || nearest < HIT);
      const level = clamp(1 - nearest / NEAR, 0.25, 1);
      this.shout(t, hit, level, pan);
      this.toot(t, hit ? 0.55 : 0.38, pan);
    }
  }

  shout(t, hit, level, pan) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = hit ? 2.0 : 3.2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = ctx.createStereoPanner();
    p.pan.value = pan || 0;
    osc.connect(bp); osc2.connect(bp); bp.connect(g); g.connect(p); p.connect(this.out);

    const f0 = hit ? 300 : 420;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * (hit ? 0.52 : 0.7), t + 0.24);
    osc2.frequency.setValueAtTime(f0 * 1.14, t);
    osc2.frequency.exponentialRampToValueAtTime(f0 * 0.68, t + 0.24);
    bp.frequency.setValueAtTime(f0 * 2.0, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.38 * level * (hit ? 1.4 : 1), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (hit ? 0.42 : 0.28));

    osc.start(t); osc2.start(t);
    const end = t + 0.5;
    osc.stop(end); osc2.stop(end);
    osc.onended = () => {
      osc.disconnect(); osc2.disconnect(); bp.disconnect(); g.disconnect(); p.disconnect();
    };
  }

  /** Short dual-tone beep — startled horn when a car cuts too close. */
  toot(t, level, pan) {
    const ctx = this.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = pan || 0;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(p); p.connect(this.out);
    for (const hz of [620, 784]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.16);
      o.onended = () => o.disconnect();
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    g.gain.setTargetAtTime(0.0001, t + 0.16, 0.02);
  }

  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch (_) {} }
    for (const n of this.nodes) n.disconnect();
    for (const s of this.sources) s.disconnect();
  }
}
