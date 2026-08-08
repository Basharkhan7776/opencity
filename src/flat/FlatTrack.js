/* FlatTrack — an endless, straight, flat road.
 *
 * Satisfies the surface interface Car.physics.js reads off `this.track`
 * (frameAt, project, rampHeight, rampCrossed, padCrossed, boostWindow,
 * roadEnd, finishS) with a road that never turns and never ends. The car
 * drives along +X at y = 0; arc length `s` is wrapped modulo LOOP so the
 * simulation stays near the origin forever — invisible, because the world is
 * featureless. The crown cross-section is EDGE_DROP's, matching the visual
 * road built by buildFlatWorld, so the tyres sit on the mesh they are drawn
 * on.
 */
import * as THREE from 'three';
import { Frame, STEP, EDGE_DROP } from '../world/track.js';

export const ROAD_WIDTH = 11;     // metres of tarmac
export const LOOP = 6000;         // metres before s wraps — the "endless" part
/* The driven road is a two-lane avenue (a cross seen from above) with a
   footpath walking the centre line; the median divides the tarmac in two
   carriageways. LANE_LAT is the centre of one carriageway, where the car
   is spawned instead of on the kerb. */
export const MEDIAN = 2.2;        // metres of central footpath
export const LANE_LAT = (ROAD_WIDTH + MEDIAN) * 0.25;   // 3.3 — carriage centre

const wrap = s => ((s % LOOP) + LOOP) % LOOP;

export class FlatTrack {
  constructor() {
    this.freeRoam = true;         // no walls, no berm — the whole plaza is drivable
    this.ramps = [];
    this.finishS = Infinity;      // the road never ends, so the car never does
    this.roadEnd = LOOP;
    this.length = LOOP;
    this.gateS = Infinity;
    this.runoff = 0;
    this.crossings = [];
    this.count = Math.round(LOOP / STEP);
    this.startY = 0;
    this.endY = 0;
    /* A frames array in the same shape Track's has, for anything that reads
       `frames` directly. The physics never does — it goes through frameAt. */
    this.frames = [];
    for (let i = 0; i <= this.count; i++) {
      const f = new Frame();
      f.pos.set(i * STEP, 0, 0);
      f.tan.set(1, 0, 0);
      f.right.set(0, 0, 1);
      f.up.set(0, 1, 0);
      f.flatRight.set(0, 0, 1);
      f.s = i * STEP;
      f.curv = 0; f.bank = 0; f.width = ROAD_WIDTH; f.grade = 0;
      f.bermL = 0; f.bermR = 0;
      this.frames.push(f);
    }
  }

  /** Interpolated frame at arc length `s`. Hot path. */
  frameAt(s, out = null) {
    const w = wrap(s);
    const f = out || new Frame();
    f.pos.set(w, 0, 0);
    f.tan.set(1, 0, 0);
    f.right.set(0, 0, 1);
    f.up.set(0, 1, 0);
    f.flatRight.set(0, 0, 1);
    f.s = w;
    f.curv = 0; f.bank = 0; f.width = ROAD_WIDTH; f.grade = 0;
    f.bermL = 0; f.bermR = 0;
    return f;
  }

  pointAt(s, lat = 0, out = new THREE.Vector3()) {
    return out.set(wrap(s), 0, lat);
  }

  /** Where on the road `p` is, as (s, lat). The inverse of pointAt. */
  project(p, hint = -1) {
    const s = wrap(p.x);
    return {
      s,
      lat: p.z,
      height: p.y,
      width: ROAD_WIDTH,
      dist: Math.abs(p.x - s),
    };
  }

  /* No ramps, no pads, no boost windows — the whole featureless surface is
     tarmac, so every one of these is the neutral answer. */
  rampHeight() { return 0; }
  rampCrossed() { return null; }
  padCrossed() { return null; }
  boostWindow() { return false; }
}

export { EDGE_DROP };
