/* City street race: field of 6, checkpoints, standings, start/stop. */
import { Car } from '../car/physics.js';
import { clamp } from '../core/util.js';
import { Countdown } from './countdown.js';
import { projectOnRoute, pointAtS } from './path.js';
import { RivalDriver } from './rival.js';
import { RaceMarks } from './marks.js';

export const RACE_LENGTHS = [400, 800, 1500, 2500];
export const RACE_LENGTH_LABELS = ['400 M', '800 M', '1.5 KM', '2.5 KM'];
export const RACE_DIFFS = ['easy', 'medium', 'hard'];
export const RACE_DIFF_LABELS = ['EASY', 'MEDIUM', 'HARD'];
export const RACE_MAX_LAPS = 8;
export const RACE_FIELD = 4;

const ROW = 7.0;
const LAT = 2.3;
const HYST = 1.0;
const CONTACT_R = 2.35;

/* 3 AI ahead of the player, two abreast. Last slot is the player (3 rivals + player = 4). */
const GRID = [
  [ROW, LAT],
  [ROW, -LAT],
  [0, LAT],
  [0, -LAT],
];

function ordinal(n) {
  const t = n % 10, h = n % 100;
  if (h >= 11 && h <= 13) return n + 'TH';
  return n + (t === 1 ? 'ST' : t === 2 ? 'ND' : t === 3 ? 'RD' : 'TH');
}

export class CityRace {
  /**
   * @param {{
   *   track: object,
   *   scene: import('three').Scene,
   *   route: object,
   *   laps: number,
   *   difficulty: string,
   *   vehicles: object[],
   *   playerVehicle: number,
   *   heightAt: (x:number,z:number)=>number,
   *   loadView: (idx:number)=>Promise<object>,
   * }} opts
   */
  constructor(opts) {
    this.track = opts.track;
    this.scene = opts.scene;
    this.route = opts.route;
    this.laps = Math.max(0, opts.laps | 0);
    this.loop = !!opts.route.loop && this.laps > 0;
    this.difficulty = opts.difficulty || 'medium';
    this.vehicles = opts.vehicles;
    this.playerVehicle = opts.playerVehicle | 0;
    this.heightAt = opts.heightAt;
    this.loadView = opts.loadView;

    this.countdown = new Countdown();
    this.marks = null;
    this.entries = [];
    this.playerSlot = null;
    this._order = [];
    this.clock = 0;
    this.live = false;
    this.over = false;
    this.results = null;
  }

  get holding() { return this.countdown.holding; }

  async begin(player) {
    const picks = this._pickRivals();
    const views = await Promise.all(picks.map(idx => this.loadView(idx)));

    this.marks = new RaceMarks(this.scene, this.route, this.heightAt);
    this._place(player, GRID[GRID.length - 1]);
    this.playerSlot = this._slot(player, {
      isPlayer: true,
      name: 'YOU',
      view: null,
      driver: null,
    });

    for (let i = 0; i < picks.length; i++) {
      const idx = picks[i];
      const spec = this.vehicles[idx];
      const view = views[i];
      this.scene.add(view.root);
      const car = new Car(this.track, { palette: i + 1, ai: true, perf: spec.perf });
      const lane = (i % 2 === 0 ? 1 : -1) * (0.6 + i * 0.12);
      const driver = new RivalDriver(this.route, {
        difficulty: this.difficulty,
        lane,
        seed: i + 1,
      });
      const e = this._slot(car, {
        isPlayer: false,
        name: (spec.name || 'RIVAL').toUpperCase(),
        view,
        driver,
        vehicle: idx,
      });
      this._place(car, GRID[i]);
      car.applyTo(view, 0);
      this.entries.push(e);
    }

    this._order = [...this.entries, this.playerSlot];
    this._settle(this._order.length);
    this.countdown.arm();
    this.live = true;
    this.over = false;
    this.clock = 0;
  }

  step(dt, player) {
    if (!this.live) return;
    this.countdown.update(dt);
    this._syncPlayer(player);

    if (this.over) {
      this.marks?.update(player, this.playerSlot.cp);
      this._applyViews(0);
      return;
    }

    if (this.countdown.holding) {
      this.marks?.update(player, this.playerSlot.cp);
      this._applyViews(0);
      return;
    }

    this.clock += dt;
    const all = [this.playerSlot, ...this.entries];

    for (const e of this.entries) {
      if (e.finished) {
        e.car.step(dt, { steer: 0, throttle: 0, brake: 0.4, handbrake: 0 });
        continue;
      }
      const input = e.driver.drive(e.car, dt);
      const sub = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 120))));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) e.car.step(h, input);
      if (e.driver.stuckFor > 3.2 || e.car.strandedFor > 4) e.driver.recover(e.car);
      this._progress(e);
    }
    this._progress(this.playerSlot);
    this._contacts(all);
    this._settle(1);

    if (this.playerSlot.finished && !this.over) this._finish();

    this.marks?.update(player, this.playerSlot.cp);
    this._applyViews(0);
  }

  hud() {
    const pos = this.positionOf(this.playerSlot);
    return {
      position: pos,
      fieldSize: this._order.length,
      lap: this.loop ? this.playerSlot.lap + 1 : 0,
      laps: this.loop ? this.laps : 0,
      time: this.playerSlot.finished ? this.playerSlot.time : this.clock,
      countdown: this.countdown.display(),
      results: this.results,
    };
  }

  positionOf(slot) {
    const i = this._order.indexOf(slot);
    return i < 0 ? this._order.length : i + 1;
  }

  skipCountdown() { this.countdown.skip(); }

  /** Put a car back on the route at its last progress (water, stranded). */
  rescue(car) {
    const slot = car === this.playerSlot?.car ? this.playerSlot
      : this.entries.find(e => e.car === car);
    const s = slot ? slot.pathS : 0;
    const p = pointAtS(this.route, s);
    const yaw = Math.atan2(p.tz, p.tx);
    car.placeAtWorld(p.x, p.z, yaw);
    car.vx = 4;
    car.vy = 0;
    car.r = 0;
    car.vertVel = 0;
    car.height = 0;
  }

  dispose() {
    this.live = false;
    this.marks?.dispose();
    this.marks = null;
    for (const e of this.entries) {
      if (e.view?.root) {
        this.scene.remove(e.view.root);
        e.view.root.traverse(o => {
          o.geometry?.dispose?.();
          o.material?.dispose?.();
        });
      }
    }
    this.entries.length = 0;
    this._order.length = 0;
    this.playerSlot = null;
  }

  /* ---- internals ---------------------------------------------------- */

  _slot(car, extra) {
    return {
      car,
      pathS: 0,
      lap: 0,
      cp: this.loop ? 1 : 0,
      progress: 0,
      finished: false,
      time: 0,
      bestLap: null,
      lapClock: 0,
      _gateAlong: null,
      _cpWatch: -1,
      ...extra,
    };
  }

  _place(car, [ds, lat]) {
    const p0 = this.route.points[0];
    const yaw = this.route.startYaw;
    const tx = Math.cos(yaw), tz = Math.sin(yaw);
    const nx = -tz, nz = tx;
    const x = p0.x + tx * ds + nx * lat;
    const z = p0.z + tz * ds + nz * lat;
    car.placeAtWorld(x, z, yaw);
    car.finished = false;
    car.raceTime = 0;
  }

  _pickRivals() {
    return Array(RACE_FIELD - 1).fill(this.playerVehicle);
  }

  _syncPlayer(player) {
    if (this.playerSlot) this.playerSlot.car = player;
  }

  _progress(e) {
    if (e.finished) return;
    const route = this.route;
    const proj = projectOnRoute(route, e.car.pos.x, e.car.pos.z);
    /* Standings only crawl forward along the route. A car on a parallel
       street must not snap to a later segment and steal a place. */
    e.pathS = advanceS(e.pathS, proj.s, route.length, route.loop, 8);
    e.progress = e.lap * route.length + e.pathS;

    const cps = route.checkpoints;
    if (!cps.length) return;
    const n = cps.length;
    let cp = e.cp % n;
    const gate = cps[cp];
    const fx = Math.cos(gate.yaw), fz = Math.sin(gate.yaw);
    const along = (e.car.pos.x - gate.x) * fx + (e.car.pos.z - gate.z) * fz;
    const lat = (e.car.pos.x - gate.x) * (-fz) + (e.car.pos.z - gate.z) * fx;
    if (e._cpWatch !== cp) {
      e._cpWatch = cp;
      e._gateAlong = along;
    }
    const prevAlong = e._gateAlong;
    e._gateAlong = along;
    const inHoop = Math.abs(along) < 3.4 && Math.abs(lat) < gate.radius * 1.08;
    const crossed = prevAlong != null
      && prevAlong < 0.8 && along >= 0
      && Math.abs(lat) < gate.radius * 1.08;
    if (inHoop || crossed) {
      if (route.loop && cp === 0 && e.cp > 0) {
        e.lap++;
        const lapT = this.clock - e.lapClock;
        if (e.bestLap == null || lapT < e.bestLap) e.bestLap = lapT;
        e.lapClock = this.clock;
        if (e.lap >= this.laps) {
          e.finished = true;
          e.time = this.clock;
          return;
        }
      } else if (!route.loop && cp === n - 1) {
        e.finished = true;
        e.time = this.clock;
        return;
      }
      e.cp = e.cp + 1;
      if (route.loop && e.cp % n === 0) {
        /* next is the start/finish; handled above on the subsequent pass */
      }
    }
  }

  _finish() {
    this.over = true;
    const pos = this.positionOf(this.playerSlot);
    this.results = {
      pos,
      label: ordinal(pos),
      time: this.playerSlot.time,
      bestLap: this.playerSlot.bestLap,
      laps: this.laps,
      field: this._order.length,
    };
  }

  _settle(passes) {
    const beats = (b, a) => {
      if (b.finished && a.finished) return b.time < a.time;
      if (b.finished !== a.finished) return b.finished;
      return b.progress > a.progress + HYST;
    };
    for (let p = 0; p < passes; p++) {
      let moved = false;
      for (let i = 0; i < this._order.length - 1; i++) {
        if (beats(this._order[i + 1], this._order[i])) {
          const t = this._order[i];
          this._order[i] = this._order[i + 1];
          this._order[i + 1] = t;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  _contacts(all) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i].car, b = all[j].car;
        const dx = a.pos.x - b.pos.x;
        const dz = a.pos.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= CONTACT_R * 2 || d < 1e-4) continue;
        const push = (CONTACT_R * 2 - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        a.pos.x += nx * push; a.pos.z += nz * push;
        b.pos.x -= nx * push; b.pos.z -= nz * push;
        a._prevPos.x += nx * push; a._prevPos.z += nz * push;
        b._prevPos.x -= nx * push; b._prevPos.z -= nz * push;
        const rel = (a.vx - b.vx) * nx + ((a.vy) - (b.vy)) * nz;
        if (rel < 0) {
          a.vx -= rel * 0.35 * nx;
          b.vx += rel * 0.35 * nx;
        }
        const hit = clamp((CONTACT_R * 2 - d) * 0.4, 0.04, 0.5);
        a.lastImpact = Math.max(a.lastImpact, hit);
        b.lastImpact = Math.max(b.lastImpact, hit);
      }
    }
  }

  _applyViews(alpha) {
    for (const e of this.entries) {
      if (e.view) e.car.applyTo(e.view, alpha);
    }
  }
}

function advanceS(prev, next, length, loop, maxStep) {
  if (!loop) {
    const ds = next - prev;
    if (ds > maxStep) return prev + maxStep;
    if (ds < -maxStep) return Math.max(0, prev + ds);
    return Math.max(0, next);
  }
  if (!(length > 0)) return next;
  let ds = next - prev;
  if (ds > length * 0.5) ds -= length;
  if (ds < -length * 0.5) ds += length;
  if (ds > maxStep) ds = maxStep;
  if (ds < -maxStep) ds = -maxStep;
  let s = prev + ds;
  if (s < 0) s += length;
  if (s >= length) s -= length;
  return s;
}

export { ordinal };
