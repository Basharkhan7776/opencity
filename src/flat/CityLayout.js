/* Procedural island city — scale matched to the vehicle, continuous roads.
 *
 * Vehicle ref (CAR): length 4.9 m, width 2.16 m.
 *   Houses    ≈ 1.5 × vehicle linear size
 *   Buildings ≈ 3.0 × vehicle linear size
 *   Skyscrapers a bit larger footprint, taller
 *
 * Roads are a continuous centerline graph extruded into ribbons (CityRoads),
 * so every link is interconnected — no floating Kenney tile seams.
 */
import { rng, rand } from '../core/rng.js';
import { clamp } from '../core/util.js';
import {
  heightAt, coastAt, mountainFactor, CENTER, WATER_LEVEL,
  METRO_R, RESIDENTIAL_R, ISLAND_R,
} from './Island.js';

export const CITY_SEED = 42;
export const SPAWN_CLEAR = 55;

/* Vehicle reference length (matches CAR.length). */
export const VEHICLE_LEN = 4.9;

/* Kenney models are ~2 units wide/deep in local space after bake. */
const MODEL_SPAN = 2;

/** Linear scale so mesh size ≈ k × vehicle length. */
export const HOUSE_SCALE = (1.5 * VEHICLE_LEN) / MODEL_SPAN;      // ~3.675 → ~7.4 m
export const BUILDING_SCALE = (3.0 * VEHICLE_LEN) / MODEL_SPAN;   // ~7.35  → ~14.7 m
export const SKY_SCALE = (3.6 * VEHICLE_LEN) / MODEL_SPAN;        // ~8.8   → ~17.6 m base
export const FENCE_SCALE = HOUSE_SCALE * 0.55;

/* Road widths and grid spacing (metres). */
export const LANE1_W = 5.5;    // one car + margin
export const LANE2_W = 11;     // two-lane metro
export const METRO_STEP = 36;  // centreline spacing (fits 3× buildings)
export const RES_STEP = 28;    // residential street spacing
export const HOUSE_LOT = 18;   // offset from road centre to house centre

const CITY_BUILDINGS = [
  '/assets/city/building-a.glb', '/assets/city/building-b.glb',
  '/assets/city/building-c.glb', '/assets/city/building-d.glb',
  '/assets/city/building-e.glb', '/assets/city/building-f.glb',
  '/assets/city/building-g.glb', '/assets/city/building-h.glb',
  '/assets/city/building-i.glb', '/assets/city/building-j.glb',
  '/assets/city/building-k.glb', '/assets/city/building-l.glb',
  '/assets/city/building-m.glb', '/assets/city/building-n.glb',
];
const SKYSCRAPERS = [
  '/assets/city/building-skyscraper-a.glb',
  '/assets/city/building-skyscraper-b.glb',
  '/assets/city/building-skyscraper-c.glb',
  '/assets/city/building-skyscraper-d.glb',
  '/assets/city/building-skyscraper-e.glb',
];
const LOW_CITY = [
  '/assets/city/low-detail-building-a.glb',
  '/assets/city/low-detail-building-b.glb',
  '/assets/city/low-detail-building-c.glb',
  '/assets/city/low-detail-building-d.glb',
  '/assets/city/low-detail-building-e.glb',
  '/assets/city/low-detail-building-f.glb',
  '/assets/city/low-detail-building-g.glb',
  '/assets/city/low-detail-building-h.glb',
  '/assets/city/low-detail-building-wide-a.glb',
  '/assets/city/low-detail-building-wide-b.glb',
];
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map(
  c => `/assets/house/building-type-${c}.glb`,
);
const FENCES = [
  '/assets/house/fence.glb',
  '/assets/house/fence-1x2.glb',
  '/assets/house/fence-1x3.glb',
  '/assets/house/fence-1x4.glb',
  '/assets/house/fence-low.glb',
];
const LIGHTS = [
  '/assets/road/light-square.glb',
  '/assets/road/light-square-cross.glb',
];

function sitY(x, z) {
  return heightAt(x, z);
}

function addInst(list, url, x, z, yaw, sx, sy, sz, kind) {
  list.push({
    url, x, y: sitY(x, z), z,
    yaw: yaw || 0, pitch: 0, roll: 0,
    sx, sy, sz, kind,
  });
}

function addCollider(list, x, z, radius, kind = 'building') {
  if (Math.hypot(x - CENTER.x, z - CENTER.z) < SPAWN_CLEAR) return;
  list.push({ x, z, radius, kind });
}

/** Graph builder helpers. */
function makeGraph() {
  return {
    nodes: [],
    edges: [],
    nodeMap: new Map(),
    degree: new Map(),
    nodeWidth: new Map(),
    _nextId: 1,
  };
}

function addNode(g, x, z, key) {
  if (g.nodeMap.has(key)) return g.nodeMap.get(key).id;
  const id = g._nextId++;
  const n = { id, x, z, key };
  g.nodes.push(n);
  g.nodeMap.set(key, n);
  g.degree.set(id, 0);
  return id;
}

function addEdge(g, a, b, width, lanes) {
  if (a === b) return;
  const ka = `${Math.min(a, b)}:${Math.max(a, b)}`;
  if (g._edgeKeys?.has(ka)) return;
  if (!g._edgeKeys) g._edgeKeys = new Set();
  g._edgeKeys.add(ka);
  g.edges.push({ a, b, width, lanes });
  g.degree.set(a, (g.degree.get(a) || 0) + 1);
  g.degree.set(b, (g.degree.get(b) || 0) + 1);
  const prev = g.nodeWidth.get(a) || 0;
  g.nodeWidth.set(a, Math.max(prev, width));
  const prevB = g.nodeWidth.get(b) || 0;
  g.nodeWidth.set(b, Math.max(prevB, width));
}

function nk(x, z) {
  return `${Math.round(x * 10) / 10},${Math.round(z * 10) / 10}`;
}

/**
 * Orthogonal grid of interconnected roads inside a radius.
 * step = centreline spacing; width/lanes = ribbon size.
 */
function addGrid(g, step, radius, width, lanes, { ringMin = 0 } = {}) {
  const n = Math.floor(radius / step);
  /* Horizontal lines (constant z). */
  for (let j = -n; j <= n; j++) {
    const z = CENTER.z + j * step;
    let prev = null;
    for (let i = -n; i <= n; i++) {
      const x = CENTER.x + i * step;
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr < ringMin || rr > radius) { prev = null; continue; }
      if (heightAt(x, z) < WATER_LEVEL + 0.6) { prev = null; continue; }
      if (mountainFactor(x, z) > 0.62) { prev = null; continue; }
      const id = addNode(g, x, z, nk(x, z));
      if (prev != null) addEdge(g, prev, id, width, lanes);
      prev = id;
    }
  }
  /* Vertical lines (constant x). */
  for (let i = -n; i <= n; i++) {
    const x = CENTER.x + i * step;
    let prev = null;
    for (let j = -n; j <= n; j++) {
      const z = CENTER.z + j * step;
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr < ringMin || rr > radius) { prev = null; continue; }
      if (heightAt(x, z) < WATER_LEVEL + 0.6) { prev = null; continue; }
      if (mountainFactor(x, z) > 0.62) { prev = null; continue; }
      const id = addNode(g, x, z, nk(x, z));
      if (prev != null) addEdge(g, prev, id, width, lanes);
      prev = id;
    }
  }
}

/** Polyline path of connected edges. */
function addPolyline(g, points, width, lanes) {
  let prev = null;
  for (const p of points) {
    if (heightAt(p.x, p.z) < WATER_LEVEL + 0.4) { prev = null; continue; }
    const id = addNode(g, p.x, p.z, nk(p.x, p.z));
    if (prev != null) addEdge(g, prev, id, width, lanes);
    prev = id;
  }
}

/**
 * Full city plan: road graph + building/fence placements + colliders.
 */
export function planCity(seed = CITY_SEED) {
  const R = rand(rng(seed));
  const placements = [];
  const colliders = [];
  const g = makeGraph();

  /* ---- 2-lane metro grid (connected +) -------------------------------- */
  addGrid(g, METRO_STEP, METRO_R, LANE2_W, 2);

  /* ---- 1-lane residential grid (ring around metro) -------------------- */
  addGrid(g, RES_STEP, RESIDENTIAL_R, LANE1_W, 1, { ringMin: METRO_R + 8 });

  /* ---- Radial feeders (ensure metro ↔ residential links) -------------- */
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const pts = [];
    for (let r = METRO_R - METRO_STEP; r <= RESIDENTIAL_R - 10; r += 14) {
      pts.push({
        x: CENTER.x + Math.cos(ang) * r,
        z: CENTER.z + Math.sin(ang) * r,
      });
    }
    const w = r => (r < METRO_R + 30 ? LANE2_W : LANE1_W);
    /* Polyline with width based on mid radius — use 2-lane near metro. */
    let prev = null;
    for (const p of pts) {
      const rr = Math.hypot(p.x - CENTER.x, p.z - CENTER.z);
      if (heightAt(p.x, p.z) < WATER_LEVEL + 0.5) { prev = null; continue; }
      const id = addNode(g, p.x, p.z, nk(p.x, p.z));
      if (prev != null) {
        addEdge(g, prev, id, rr < METRO_R + 40 ? LANE2_W : LANE1_W, rr < METRO_R + 40 ? 2 : 1);
      }
      prev = id;
    }
  }

  /* ---- Coast 1-lane ring (connected loop) ----------------------------- */
  const coastPts = [];
  const TAU = Math.PI * 2;
  for (let a = 0; a < TAU; a += 0.045) {
    let r = ISLAND_R * 0.78;
    let x = CENTER.x, z = CENTER.z;
    for (let it = 0; it < 20; it++) {
      x = CENTER.x + Math.cos(a) * r;
      z = CENTER.z + Math.sin(a) * r;
      const c = coastAt(x, z);
      const target = c.beachStart - 24;
      r += (target - Math.hypot(x - CENTER.x, z - CENTER.z)) * 0.55;
      r = clamp(r, 100, ISLAND_R * 0.97);
    }
    x = CENTER.x + Math.cos(a) * r;
    z = CENTER.z + Math.sin(a) * r;
    if (heightAt(x, z) < WATER_LEVEL + 0.5) continue;
    if (mountainFactor(x, z) > 0.72) continue;
    coastPts.push({ x, z });
  }
  if (coastPts.length > 4) {
    addPolyline(g, coastPts, LANE1_W, 1);
    /* Close the loop. */
    const a = coastPts[coastPts.length - 1];
    const b = coastPts[0];
    const ia = addNode(g, a.x, a.z, nk(a.x, a.z));
    const ib = addNode(g, b.x, b.z, nk(b.x, b.z));
    addEdge(g, ia, ib, LANE1_W, 1);
  }

  /* Coast ↔ residential feeders. */
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + 0.2;
    const pts = [];
    for (let r = RESIDENTIAL_R - 20; r < RESIDENTIAL_R + 120; r += 16) {
      const x = CENTER.x + Math.cos(ang) * r;
      const z = CENTER.z + Math.sin(ang) * r;
      const c = coastAt(x, z);
      if (c.rr > c.beachStart - 14) break;
      pts.push({ x, z });
    }
    addPolyline(g, pts, LANE1_W, 1);
  }

  /* ---- Buildings along metro streets ---------------------------------- */
  const metroN = Math.floor(METRO_R / METRO_STEP);
  for (let i = -metroN; i <= metroN; i++) {
    for (let j = -metroN; j <= metroN; j++) {
      /* Lot centres sit in the open block between roads. */
      const x = CENTER.x + (i + 0.5) * METRO_STEP;
      const z = CENTER.z + (j + 0.5) * METRO_STEP;
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr > METRO_R - 12) continue;
      if (rr < SPAWN_CLEAR * 0.85) continue;
      if (heightAt(x, z) < WATER_LEVEL + 1) continue;
      if (!R.chance(0.78)) continue;

      let url, sc, rad, kind;
      if (rr < 80 && R.chance(0.6)) {
        url = R.pick(SKYSCRAPERS);
        sc = SKY_SCALE * R.f(0.92, 1.12);
        rad = sc * MODEL_SPAN * 0.42;
        kind = 'building';
      } else if (rr < 150 && R.chance(0.75)) {
        url = R.pick(CITY_BUILDINGS);
        sc = BUILDING_SCALE * R.f(0.9, 1.1);
        rad = sc * MODEL_SPAN * 0.4;
        kind = 'building';
      } else {
        url = R.pick(LOW_CITY);
        sc = BUILDING_SCALE * R.f(0.85, 1.05);
        rad = sc * MODEL_SPAN * 0.38;
        kind = 'building';
      }
      const yaw = R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
      /* Sy a bit taller for skyscraper massing. */
      const sy = kind === 'building' && url.includes('skyscraper')
        ? sc * R.f(1.15, 1.45)
        : sc;
      addInst(placements, url, x, z, yaw, sc, sy, sc, kind);
      addCollider(colliders, x, z, rad, 'building');
    }
  }

  /* ---- Houses + fences along residential streets ---------------------- */
  const resN = Math.floor(RESIDENTIAL_R / RES_STEP);
  for (let i = -resN; i <= resN; i++) {
    for (let j = -resN; j <= resN; j++) {
      const x = CENTER.x + (i + 0.5) * RES_STEP;
      const z = CENTER.z + (j + 0.5) * RES_STEP;
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr < METRO_R + 16 || rr > RESIDENTIAL_R - 12) continue;
      if (heightAt(x, z) < WATER_LEVEL + 1) continue;
      if (mountainFactor(x, z) > 0.5) continue;
      if (!R.chance(0.7)) continue;

      const sc = HOUSE_SCALE * R.f(0.92, 1.12);
      const yaw = R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
      const url = R.pick(HOUSES);
      addInst(placements, url, x, z, yaw, sc, sc, sc, 'house');
      addCollider(colliders, x, z, sc * MODEL_SPAN * 0.38, 'building');

      /* Fences around lot — scaled to house. */
      const fsc = FENCE_SCALE * R.f(0.9, 1.1);
      const off = sc * MODEL_SPAN * 0.55;
      const fence = R.pick(FENCES);
      const edges = [
        { x: x, z: z + off, yaw: 0 },
        { x: x, z: z - off, yaw: 0 },
        { x: x + off, z: z, yaw: Math.PI / 2 },
        { x: x - off, z: z, yaw: Math.PI / 2 },
      ];
      for (const e of edges) {
        if (!R.chance(0.5)) continue;
        addInst(placements, fence, e.x, e.z, e.yaw, fsc, fsc * 0.95, fsc, 'fence');
        addCollider(colliders, e.x, e.z, fsc * 0.7, 'fence');
      }
    }
  }

  /* Street lights at high-degree junctions (metro). */
  for (const n of g.nodes) {
    const deg = g.degree.get(n.id) || 0;
    if (deg < 3) continue;
    const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
    if (rr > METRO_R + 20) continue;
    if (!R.chance(0.55)) continue;
    const sc = HOUSE_SCALE * 0.7;
    const light = R.pick(LIGHTS);
    addInst(placements, light, n.x + 4, n.z + 4, 0, sc, sc, sc, 'light');
  }

  return {
    placements,
    colliders,
    graph: g,
    stats: {
      nodes: g.nodes.length,
      edges: g.edges.length,
      placements: placements.length,
      colliders: colliders.length,
      houses: placements.filter(p => p.kind === 'house').length,
      buildings: placements.filter(p => p.kind === 'building').length,
      houseScale: HOUSE_SCALE,
      buildingScale: BUILDING_SCALE,
    },
  };
}

export function createCitySystem(seed = CITY_SEED) {
  return planCity(seed);
}
