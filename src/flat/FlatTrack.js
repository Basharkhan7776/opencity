/* FlatTrack — free-roam surface for the island playground.
 *
 * Satisfies the surface interface Car.physics.js reads off `this.track`
 * (frameAt, project, rampHeight, rampCrossed, padCrossed, boostWindow,
 * roadEnd, finishS) with a road that never turns and never ends. Arc length
 * `s` maps to world X (wrapped by LOOP for the endless sim), `lat` to world Z.
 *
 * Heights and normals come from Island.heightAt / normalAt — the same
 * functions that build the mesh — so the car drives on top of the island
 * rather than through it.
 */
import * as THREE from 'three';
import { Frame, STEP, EDGE_DROP } from '../core/frame.js';
import {
  heightAt, normalAt, CENTER, WATER_LEVEL, PLAZA_HALF, INTER_X,
} from './Island.js';

export const ROAD_WIDTH = 11;     // metres of tarmac (legacy interface width)
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
    this.freeRoam = true;         // no walls, no berm — the whole island is drivable
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

    /* Island surface — shared with the mesh. A roadLift (attached by
       setRoadLift once the city plan is ready) lifts the physics onto the
       raised road decks, so the car drives on the road mesh itself. */
    this.roadLift = null;
    this.heightAt = (x, z) => heightAt(x, z) + (this.roadLift ? this.roadLift(x, z) : 0);
    this.normalAt = normalAt;
    this.waterLevel = WATER_LEVEL;
    this.center = CENTER;
    this.plazaHalf = PLAZA_HALF;
    this.interX = INTER_X;

    /* Prop colliders (trees, rocks, bushes). Filled by setObstacles once the
       vegetation plan is ready — empty until then, so free-roam still works. */
    this.obstacles = null;
    this._obsHit = [];

    /* A frames array in the same shape Track's has, for anything that reads
       `frames` directly. The physics never does — it goes through frameAt. */
    this.frames = [];
    for (let i = 0; i <= this.count; i++) {
      const f = new Frame();
      const x = i * STEP;
      f.pos.set(x, heightAt(x, 0), 0);
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
    /* Frame sits at lat=0 on the X axis; free-roam physics re-samples height
       and normal under the car via surfaceAt / normalAt. */
    f.pos.set(w, heightAt(w, 0), 0);
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
    const x = wrap(s);
    return out.set(x, heightAt(x, lat), lat);
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

  /* No ramps, no pads, no boost windows — open island. */
  rampHeight() { return 0; }
  rampCrossed() { return null; }
  padCrossed() { return null; }
  boostWindow() { return false; }

  /**
   * Attach a spatial obstacle grid (from Vegetation.createVegetationSystem).
   * Physics queries this every free-roam substep for tree/rock hits.
   */
  setObstacles(grid) {
    this.obstacles = grid;
  }

  /**
   * Attach the road deck lift — a function (x, z) => metres above the island
   * surface for the city road slabs. The car then rides ON the road mesh
   * instead of clipping through it.
   */
  setRoadLift(fn) {
    this.roadLift = fn;
  }

  /**
   * Nearby colliders for a circle at (x,z). Returns a reused array.
   */
  queryObstacles(x, z, radius) {
    if (!this.obstacles) return null;
    return this.obstacles.query(x, z, radius, this._obsHit);
  }
}

export { EDGE_DROP, heightAt, normalAt, CENTER, WATER_LEVEL, PLAZA_HALF, INTER_X };
