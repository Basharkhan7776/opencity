/* Procedural radio: two loopable beds plus OFF. Persistent voices only —
   allocating a kick/snare/hat every 16th note was the hitch in the mix. */
import { clamp } from '../core/util.js';
import { noiseSource } from './noise.js';

export const MUSIC_STYLES = ['chill', 'retro', 'off'];
export const MUSIC_STYLE_LABELS = ['CHILL DRIVE', 'RETRO SYNTH', 'OFF'];

export class Music {
  constructor(ctx, dest, seed = 19, noiseBuf = null) {
    this.ctx = ctx;
    this.nodes = [];
    this.sources = [];
    const node = (n) => { this.nodes.push(n); return n; };

    this.out = node(ctx.createGain());
    this.out.gain.value = 0.0001;
    this.out.connect(dest);

    this.lp = node(ctx.createBiquadFilter());
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 4200;
    this.lp.Q.value = 0.7;
    this.lp.connect(this.out);

    const osc = (type) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = node(ctx.createGain());
      g.gain.value = 0.0001;
      o.connect(g);
      o.start(0);
      this.sources.push(o);
      return { o, g };
    };

    this.kick = osc('sine');
    this.kick.g.connect(this.lp);

    this.bassLp = node(ctx.createBiquadFilter());
    this.bassLp.type = 'lowpass';
    this.bassLp.frequency.value = 280;
    this.bass = osc('sine');
    this.bass.g.disconnect();
    this.bass.o.disconnect();
    this.bass.o.connect(this.bassLp);
    this.bassLp.connect(this.bass.g);
    this.bass.g.connect(this.lp);

    this.arp = osc('square');
    this.arp.g.connect(this.lp);

    this.padG = node(ctx.createGain());
    this.padG.gain.value = 0.0001;
    this.padG.connect(this.lp);
    this.pads = [196, 246.94, 293.66].map((hz) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      o.connect(this.padG);
      o.start(0);
      this.sources.push(o);
      return o;
    });

    this.snareHp = node(ctx.createBiquadFilter());
    this.snareHp.type = 'highpass';
    this.snareHp.frequency.value = 1200;
    this.snareG = node(ctx.createGain());
    this.snareG.gain.value = 0.0001;
    this.snareHp.connect(this.snareG);
    this.snareG.connect(this.lp);

    this.hatHp = node(ctx.createBiquadFilter());
    this.hatHp.type = 'highpass';
    this.hatHp.frequency.value = 7000;
    this.hatG = node(ctx.createGain());
    this.hatG.gain.value = 0.0001;
    this.hatHp.connect(this.hatG);
    this.hatG.connect(this.lp);

    if (noiseBuf) {
      this.sources.push(noiseSource(ctx, noiseBuf, this.snareHp, { rate: 1.0, offset: 0.07 }));
      this.sources.push(noiseSource(ctx, noiseBuf, this.hatHp, { rate: 1.15, offset: 0.41 }));
    }

    this.style = 'off';
    this.volume = 0;
    this._next = 0;
    this._step = 0;
    this._bpm = 86;
  }

  setStyle(id) {
    const s = MUSIC_STYLES.includes(id) ? id : 'off';
    if (s === this.style) return;
    this.style = s;
    this._bpm = s === 'retro' ? 118 : 86;
    this._step = 0;
    this._next = this.ctx.currentTime + 0.04;
    this.bass.o.type = s === 'retro' ? 'sawtooth' : 'sine';
    this.bassLp.frequency.setTargetAtTime(s === 'retro' ? 520 : 280, this.ctx.currentTime, 0.08);
    const on = s !== 'off' && this.volume > 0.01;
    this.out.gain.setTargetAtTime(on ? this.volume * 0.42 : 0.0001, this.ctx.currentTime, 0.08);
    this.lp.frequency.setTargetAtTime(s === 'retro' ? 6200 : 3800, this.ctx.currentTime, 0.12);
    this.padG.gain.setTargetAtTime(on && s === 'chill' ? 0.028 : 0.0001, this.ctx.currentTime, 0.2);
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    const on = this.style !== 'off' && this.volume > 0.01;
    this.out.gain.setTargetAtTime(on ? this.volume * 0.42 : 0.0001, this.ctx.currentTime, 0.06);
  }

  update(now) {
    if (this.style === 'off' || this.volume < 0.01) return;
    const dt = 60 / this._bpm / 4;
    if (this._next < now - 0.2) this._next = now;
    if (this._next > now + 0.05) return;
    this._hit(Math.max(this._next, now), this._step);
    this._next += dt;
    this._step = (this._step + 1) & 31;
  }

  _hit(t, step) {
    const retro = this.style === 'retro';
    const bar = step & 15;
    if (retro) {
      if ((bar % 4) === 0) this._kick(t, 0.24);
      if (bar === 4 || bar === 12) this._snare(t, 0.18);
      this._hat(t, bar % 2 === 0 ? 0.055 : 0.03);
      if (bar % 2 === 0) this._bass(t, retroBass(bar), 0.12, 0.13);
      this._arp(t, retroArp(step), 0.055);
    } else {
      if (bar === 0 || bar === 8) this._kick(t, 0.18);
      if (bar === 4 || bar === 12) this._snare(t, 0.13);
      if (bar % 2 === 0) this._hat(t, 0.028);
      if (bar === 0 || bar === 6 || bar === 10) this._bass(t, chillBass(bar), 0.2, 0.11);
    }
  }

  _pulse(g, t, peak, attack, decay) {
    const p = g.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { p.cancelScheduledValues(t); p.setValueAtTime(Math.max(p.value, 0.0001), t); }
    p.linearRampToValueAtTime(Math.max(0.0001, peak), t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  _kick(t, lvl) {
    const f = this.kick.o.frequency;
    if (f.cancelAndHoldAtTime) f.cancelAndHoldAtTime(t);
    else f.cancelScheduledValues(t);
    f.setValueAtTime(160, t);
    f.exponentialRampToValueAtTime(46, t + 0.1);
    this._pulse(this.kick.g, t, lvl, 0.006, 0.16);
  }

  _snare(t, lvl) { this._pulse(this.snareG, t, lvl, 0.005, 0.11); }
  _hat(t, lvl) { this._pulse(this.hatG, t, lvl, 0.002, 0.045); }

  _bass(t, hz, dur, lvl) {
    this.bass.o.frequency.setTargetAtTime(hz, t, 0.008);
    this._pulse(this.bass.g, t, lvl, 0.016, dur);
  }

  _arp(t, hz, lvl) {
    this.arp.o.frequency.setValueAtTime(hz, t);
    this._pulse(this.arp.g, t, lvl, 0.006, 0.08);
  }

  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    for (const n of this.nodes) n.disconnect();
    for (const s of this.sources) { try { s.disconnect(); } catch { /* gone */ } }
  }
}

function chillBass(bar) {
  return [65.41, 65.41, 49.00, 73.42][Math.floor(bar / 4) % 4];
}
function retroBass(bar) {
  const n = [82.41, 82.41, 98.00, 73.42, 82.41, 110, 98.00, 73.42];
  return n[Math.floor(bar / 2) % n.length];
}
function retroArp(step) {
  const scale = [329.63, 392.00, 440.00, 493.88, 523.25, 493.88, 440.00, 392.00];
  return scale[step % scale.length];
}
