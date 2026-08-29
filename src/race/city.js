/* City street race: field of 6, checkpoints, standings, start/stop. */
import { Car } from '../car/physics.js';
import { clamp } from '../core/util.js';
import { Countdown } from './countdown.js';
import { projectOnRoute, pointAtS } from './path.js';
import { RivalDriver } from './rival.js';
import { RaceMarks } from './marks.js';

export const RACE_LENGTHS = [400, 800, 1500, 2500, 5000, 10000];
export const RACE_LENGTH_LABELS = ['400 M', '800 M', '1.5 KM', '2.5 KM', '5.0 KM', '10.0 KM'];
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
      car.setVehicleConfig(spec);
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
    this._settle();
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
      if (e.driver.stuckFor > 3.5 || e.car.strandedFor > 4.5 || e.car.pos.y < (this.track?.waterLevel ?? 0) - 0.5) {
        e.driver.recover(e.car);
      }
      this._progress(e);
    }
    this._progress(this.playerSlot);
    this._contacts(all);
    this._settle();

    if (this.playerSlot.finished && !this.over) this._finish();

    this.marks?.update(player, this.playerSlot.cp);
    this._applyViews(0);
  }

  hud() {
    const pos = this.positionOf(this.playerSlot);
    return {
      position: pos,
      fieldSize: this._order.length,
      lap: this.loop ? Math.min(this.laps, this.playerSlot.lap + 1) : 0,
      laps: this.loop ? this.laps : 0,
      time: this.playerSlot.finished ? this.playerSlot.time : this.clock,
      countdown: this.countdown.display(),
      results: this.results,
    };
  }

  positionOf(slot) {
    if (!slot) return 1;
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
    /* Standings crawl forward along the route smoothly. */
    e.pathS = advanceS(e.pathS, proj.s, route.length, route.loop, 40);
    e.progress = e.lap * route.length + e.pathS;

    const cps = route.checkpoints;
    if (!cps.length) return;
    const n = cps.length;
    let cp = e.cp % n;
    const gate = cps[cp];
    const fx = Math.cos(gate.yaw), fz = Math.sin(gate.yaw);
    const along = (e.car.pos.x - gate.x) * fx + (e.car.pos.z - gate.z) * fz;
    const lat = (e.car.pos.x - gate.x) * (-fz) + (e.car.pos.z - gate.z) * fx;
    const distToGate = Math.hypot(e.car.pos.x - gate.x, e.car.pos.z - gate.z);
    const gateRadius = Math.max(gate.radius * 1.6, 12.0);

    if (e._cpWatch !== cp) {
      e._cpWatch = cp;
      e._gateAlong = along;
    }
    const prevAlong = e._gateAlong;
    e._gateAlong = along;

    const inHoop = (distToGate < gateRadius && Math.abs(along) < 6.0) || (Math.abs(along) < 4.5 && Math.abs(lat) < gateRadius);
    const crossed = (prevAlong != null && prevAlong < 2.0 && along >= -0.5 && Math.abs(lat) < gateRadius);
    const isLastGate = route.loop ? (cp === 0) : (cp === n - 1);
    const passedS = !isLastGate && e.pathS >= gate.s && (e.pathS - gate.s) < 80;

    const hitGate = inHoop || crossed || passedS;
    const hitSprintFinish = !route.loop && cp === n - 1 && (hitGate || e.pathS >= route.length - 3.0 || distToGate < gateRadius);

    if (hitGate || hitSprintFinish) {
      if (route.loop && cp === 0 && e.cp > 0) {
        e.lap++;
        const lapT = this.clock - e.lapClock;
        if (e.bestLap == null || lapT < e.bestLap) e.bestLap = lapT;
        e.lapClock = this.clock;
        if (e.lap >= this.laps) {
          e.finished = true;
          e.time = this.clock;
          e.progress = this.laps * route.length + 10;
          return;
        }
      } else if (!route.loop && cp === n - 1) {
        e.finished = true;
        e.time = this.clock;
        e.progress = route.length + 10;
        return;
      }
      e.cp = e.cp + 1;
    }
  }

  _finish() {
    this.over = true;
    this._settle();
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

  _settle() {
    this._order.sort((a, b) => {
      // 1. Finished cars rank above unfinished cars by finish time
      if (a.finished && b.finished) {
        return a.time - b.time;
      }
      if (a.finished !== b.finished) {
        return a.finished ? -1 : 1;
      }
      // 2. Both still racing: rank by lap, then checkpoints passed, then progress
      if (a.lap !== b.lap) {
        return b.lap - a.lap;
      }
      if (a.cp !== b.cp) {
        return b.cp - a.cp;
      }
      return b.progress - a.progress;
    });
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
