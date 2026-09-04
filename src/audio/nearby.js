/* Other cars in earshot: a light engine each, panned by where they sit. */
import { clamp, lerp } from '../core/util.js';
import { noiseSource } from './noise.js';

const MAX = 52;
const FIRINGS = 1; // same low note as the player engine

export class NearbyEngines {
  constructor(ctx, dest, buffers, n = 6) {
    this.ctx = ctx;
    this.nodes = [];
    this.sources = [];
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
    this.nodes.push(this.out);
    this.slots = [];
    for (let i = 0; i < n; i++) this.slots.push(new Slot(ctx, this.out, buffers, i, this));
  }

  /**
   * @param {number} t
   * @param {{x:number,z:number,yaw:number}} listener
   * @param {{id:*,x:number,z:number,rpm:number,speed:number,throttle:number}[]} cars
   */
  update(t, listener, cars) {
    const px = listener.x, pz = listener.z, yaw = listener.yaw || 0;
    const ranked = [];
    const list = cars || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dx = c.x - px, dz = c.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > MAX * MAX) continue;
      ranked.push({ c, dx, dz, d: Math.sqrt(d2) });
    }
    ranked.sort((a, b) => a.d - b.d);
    if (ranked.length > this.slots.length) ranked.length = this.slots.length;

    const want = new Set();
    for (let i = 0; i < ranked.length; i++) want.add(ranked[i].c.id);

    const kept = new Set();
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.id != null && want.has(s.id)) kept.add(s.id);
      else s.id = null;
    }
    let free = 0;
    for (let i = 0; i < ranked.length; i++) {
      const id = ranked[i].c.id;
      if (kept.has(id)) continue;
      while (free < this.slots.length && this.slots[free].id != null) free++;
      if (free >= this.slots.length) break;
      this.slots[free].id = id;
      kept.add(id);
    }

    const byId = new Map();
    for (let i = 0; i < ranked.length; i++) byId.set(ranked[i].c.id, ranked[i]);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s.set(t, s.id != null ? byId.get(s.id) : null, yaw);
    }
  }

  dispose() {
    for (const s of this.slots) s.dispose();
    for (const n of this.nodes) n.disconnect();
  }
}

class Slot {
  constructor(ctx, dest, buffers, i, host) {
    this.ctx = ctx;
    this.id = null;
    this.detune = 1 + (i - 2.5) * 0.018;
    this.nodes = [];
    this.sources = [];
    const node = (n) => { this.nodes.push(n); host.nodes.push(n); return n; };

    this.out = node(ctx.createGain());
    this.out.gain.value = 0.0001;
    this.pan = node(ctx.createStereoPanner());
    this.out.connect(this.pan);
    this.pan.connect(dest);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 28;
    const og = node(ctx.createGain());
    og.gain.value = 0.2;
    this.osc.connect(og);
    og.connect(this.out);
    this.osc.start(0);
    this.sources.push(this.osc);

    this.bp = node(ctx.createBiquadFilter());
    this.bp.type = 'lowpass';
    this.bp.frequency.value = 420;
    this.bp.Q.value = 0.7;
    const eg = node(ctx.createGain());
    eg.gain.value = 0.14;
    const ns = noiseSource(ctx, buffers.white, this.bp, { rate: 0.82 + i * 0.05, offset: 0.13 * i });
    this.sources.push(ns);
    this.bp.connect(eg);
    eg.connect(this.out);
  }

  set(t, row, yaw) {
    const set = (p, v, tau) => p.setTargetAtTime(v, t, tau);
    if (!row) {
      set(this.out.gain, 0.0001, 0.08);
      return;
    }
    const rpm = Math.max(900, row.c.rpm || 1050);
    const fire = (rpm / 60) * FIRINGS * this.detune;
    const thr = clamp(row.c.throttle || 0, 0, 1);
    const att = clamp(1 - row.d / MAX, 0, 1);
    const lvl = att * att * lerp(0.07, 0.2, thr) * lerp(0.55, 1, clamp((rpm - 900) / 6500, 0, 1));
    const ang = Math.atan2(row.dx, row.dz) - yaw;
    set(this.osc.frequency, clamp(fire, 12, 220), 0.03);
    set(this.bp.frequency, 280 + rpm * 0.06 + thr * 220, 0.05);
    set(this.pan.pan, clamp(Math.sin(ang) * clamp(row.d / 8, 0, 1), -1, 1), 0.05);
    set(this.out.gain, 0.0001 + lvl, 0.05);
  }

  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch { /* stopped */ } }
    for (const n of this.nodes) n.disconnect();
    for (const s of this.sources) { try { s.disconnect(); } catch { /* gone */ } }
  }
}
