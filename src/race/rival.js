/* Waypoint AI for a city race. Follows a generateRoute() centreline.
 *
 * Free-roam cars store world X in `car.s`, so the rally Driver cannot be
 * pointed at FlatTrack. This one pursues a lookahead on the race polyline.
 */
import { clamp, approach } from '../core/util.js';
import { pointAtS, projectOnRoute, wrapS } from './path.js';

export const DIFFICULTY = {
  easy:   { speedScale: 0.72, lookahead: 14, wander: 1.8, steerRate: 4.2, brakeEarly: 1.35 },
  medium: { speedScale: 0.90, lookahead: 22, wander: 0.8, steerRate: 8.0, brakeEarly: 1.00 },
  hard:   { speedScale: 1.00, lookahead: 28, wander: 0.25, steerRate: 13.5, brakeEarly: 0.85 },
};

const GRIP = 0.78;
const G = 9.81;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function curvatureAt(route, s) {
  const a = pointAtS(route, s - 8);
  const b = pointAtS(route, s);
  const c = pointAtS(route, s + 8);
  const a1 = Math.atan2(b.z - a.z, b.x - a.x);
  const a2 = Math.atan2(c.z - b.z, c.x - b.x);
  return Math.abs(wrapAngle(a2 - a1)) / 8;
}

export class RivalDriver {
  /**
   * @param {object} route
   * @param {{difficulty?:string, lane?:number, seed?:number}} opts
   */
  constructor(route, opts = {}) {
    this.route = route;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.medium;
    this.lane = opts.lane || 0;
    this.phase = (opts.seed || 1) * 0.37;
    this.steerSmooth = 0;
    this.throttleSmooth = 0;
    this.stuckFor = 0;
    this._lastS = 0;
  }

  targetSpeed(s) {
    const d = this.diff;
    let v = 38;
    for (const [ds, w] of [[6, 1], [24, 0.85], [50, 0.7]]) {
      const k = curvatureAt(this.route, s + ds * d.brakeEarly);
      const R = 1 / Math.max(k, 1e-4);
      const limit = Math.sqrt(GRIP * G * Math.min(R, 700));
      v = Math.min(v, limit * w);
    }
    return clamp(v * d.speedScale, 6, 42);
  }

  drive(car, dt) {
    const route = this.route;
    const proj = projectOnRoute(route, car.pos.x, car.pos.z);
    const s = proj.s;
    const wander = Math.sin(s * 0.045 + this.phase) * this.diff.wander;
    const lat = this.lane + wander;
    const look = pointAtS(route, s + this.diff.lookahead);
    const nx = -look.tz, nz = look.tx;
    const tx = look.x + nx * lat;
    const tz = look.z + nz * lat;
    const want = Math.atan2(tz - car.pos.z, tx - car.pos.x);
    const err = wrapAngle(want - car.yaw);
    const steer = clamp(err / 0.5, -1, 1);
    this.steerSmooth = approach(this.steerSmooth, steer, this.diff.steerRate, dt);

    const plan = this.targetSpeed(s);
    const speed = car.speed;
    let throttle = 0, brake = 0, handbrake = 0;
    if (speed > plan + 2.4) {
      brake = clamp((speed - plan) / 10, 0.2, 1);
    } else if (Math.abs(err) > 0.95 && speed > 12) {
      brake = 0.45;
      throttle = 0.15;
    } else {
      throttle = clamp((plan - speed) / 8 + 0.55, 0.2, 1);
    }
    if (Math.abs(err) > 1.6 && speed > 8) handbrake = 0.55;
    this.throttleSmooth = approach(this.throttleSmooth, throttle, 6, dt);

    if (Math.abs(s - this._lastS) < 0.15) this.stuckFor += dt;
    else this.stuckFor = 0;
    this._lastS = s;

    return {
      steer: this.steerSmooth,
      throttle: this.throttleSmooth,
      brake,
      handbrake,
      pathS: s,
      headingErr: err,
    };
  }

  /** Snap the car back onto the route, 8 m behind its projection. */
  recover(car) {
    const proj = projectOnRoute(this.route, car.pos.x, car.pos.z);
    const back = pointAtS(this.route, wrapS(this.route, proj.s - 8));
    const yaw = Math.atan2(back.tz, back.tx);
    car.placeAtWorld(back.x, back.z, yaw);
    car.vx = 6;
    car.vy = 0;
    car.r = 0;
    car.vertVel = 0;
    car.height = 0;
    car.strandedFor = 0;
    this.stuckFor = 0;
    this.steerSmooth = 0;
  }
}
