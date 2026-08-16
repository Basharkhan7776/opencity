/* Procedural island city — scale matched to the vehicle, continuous roads.
 *
 * Vehicle ref (CAR): length 4.9 m, width 2.16 m.
 *   Houses    ≈ 3.75 × vehicle linear size
 *   Buildings ≈ 7.5  × vehicle linear size
 *   Skyscrapers a bit larger footprint, taller
 *
 * Roads are a continuous centerline graph extruded into ribbons (CityRoads),
 * so every link is interconnected — no floating Kenney tile seams.
 */
import { rng, rand } from '../core/rng.js';
import { clamp } from '../core/util.js';
import {
  heightAt, normalAt, coastAt, mountainFactor, CENTER, WATER_LEVEL,
  METRO_R, RESIDENTIAL_R, ISLAND_R, PEAKS, inCity, COAST_ROAD_INSET,
} from './Island.js';
import { FOOT_W, DECK } from './CityRoads.js';

export const CITY_SEED = 42;
export const SPAWN_CLEAR = 55;

/* Vehicle reference length (matches CAR.length). */
export const VEHICLE_LEN = 4.9;

/* Kenney models are ~2 units wide/deep in local space after bake. */
export const MODEL_SPAN = 2;

/** Linear scale so mesh size ≈ k × vehicle length. */
export const HOUSE_SCALE = (1.5 * VEHICLE_LEN * 3) / MODEL_SPAN;        // ~3.675 ×3 → ~22 m
export const BUILDING_SCALE = (3.0 * VEHICLE_LEN * 1.4) / MODEL_SPAN;   // ~7.35  ×1.4 → ~20.6 m
export const SKY_SCALE = (3.6 * VEHICLE_LEN * 1.4) / MODEL_SPAN;        // ~8.8   ×1.4 → ~24.7 m base

/* Road widths and grid spacing (metres). */
export const LANE1_W = 7;    // one car + margin
export const LANE2_W = 14;     // two-lane metro
export const METRO_STEP = 46;  // centreline spacing (fits 3× buildings)
export const RES_STEP = 40;    // residential street spacing (scaled for big houses)
export const HOUSE_LOT = 18;   // offset from road centre to house centre

/* Metro block podiums: a grey plaza under each building, level with the
   road footpath (deck height), with the building lifted a few cm above it. */
export const PLATFORM_H = DECK;       // podium top = footpath top
/* Podium footprint fits between the two footpaths of the surrounding roads
   (46 − 2·9.45 m slab half) so it never sits on top of a footpath. */
export const PLATFORM_SZ = METRO_STEP * 0.58;   // podium footprint per square
export const BUILD_UPLIFT = 0.05;     // cm the building floats above the podium

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
  '/assets/city/building-a.glb', '/assets/city/building-b.glb',
  '/assets/city/building-c.glb', '/assets/city/building-d.glb',
  '/assets/city/building-e.glb', '/assets/city/building-f.glb',
  '/assets/city/building-g.glb', '/assets/city/building-h.glb',
  '/assets/city/building-i.glb', '/assets/city/building-j.glb',
  '/assets/city/building-k.glb', '/assets/city/building-l.glb',
  '/assets/city/building-m.glb', '/assets/city/building-n.glb',
];
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map(
  c => `/assets/house/building-type-${c}.glb`,
);
const LIGHTS = [
  '/assets/road/light-square.glb',
  '/assets/road/light-square-cross.glb',
];

/* Per-model size boost for select metro buildings — these read small against
   their neighbours, so they get a taller/wider footprint multiplier. */
const BUILDING_BOOST = {
  '/assets/city/building-c.glb': 1.4,
  '/assets/city/building-e.glb': 1.35,
  '/assets/city/building-j.glb': 1.5,
  '/assets/city/building-k.glb': 1.4,
  '/assets/city/building-l.glb': 1.35,
  '/assets/city/building-m.glb': 1.25,
  '/assets/city/building-n.glb': 1.5,
};
function buildingBoost(url) {
  return BUILDING_BOOST[url] || 1;
}

function sitY(x, z) {
  return heightAt(x, z);
}

function addInst(list, url, x, z, yaw, sx, sy, sz, kind, yAt) {
  list.push({
    url, x, y: yAt ?? sitY(x, z), z,
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
 * Orthogonal grid of interconnected roads with neighboring empty cells merged
 * into larger empty super-cells (plazas, open superblocks, park blocks).
 * step = centreline spacing; width/lanes = ribbon size.
 */
function addMergedGrid(g, step, radius, width, lanes, { ringMin = 0, occupiedCells = new Set(), mergedPlacements = [] } = {}) {
  const n = Math.floor(radius / step);

  const isValidCell = (i, j) => {
    const xc = CENTER.x + (i + 0.5) * step;
    const zc = CENTER.z + (j + 0.5) * step;
    const rr = Math.hypot(xc - CENTER.x, zc - CENTER.z);
    if (rr < ringMin || rr > radius - 8) return false;
    if (heightAt(xc, zc) < WATER_LEVEL + 0.6) return false;
    if (mountainFactor(xc, zc) > 0.55) return false;
    return true;
  };

  const ck = (i, j) => `${i},${j}`;
  const validCells = new Set();
  const emptyCells = new Set();

  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (isValidCell(i, j)) {
        validCells.add(ck(i, j));
        if (!occupiedCells.has(ck(i, j))) {
          emptyCells.add(ck(i, j));
        }
      }
    }
  }

  /* Merge neighboring empty cells into larger compound empty cells */
  const merged = new Set();
  const suppressedH = new Set(); /* Horizontal interior edges between (i, j+1) and (i+1, j+1) */
  const suppressedV = new Set(); /* Vertical interior edges between (i+1, j) and (i+1, j+1) */

  const hKey = (i, j) => `${i},${j}`;
  const vKey = (i, j) => `${i},${j}`;

  /* Pass 1: 2x2 superblocks */
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const c00 = ck(i, j), c10 = ck(i + 1, j), c01 = ck(i, j + 1), c11 = ck(i + 1, j + 1);
      if (emptyCells.has(c00) && emptyCells.has(c10) && emptyCells.has(c01) && emptyCells.has(c11)) {
        if (!merged.has(c00) && !merged.has(c10) && !merged.has(c01) && !merged.has(c11)) {
          merged.add(c00); merged.add(c10); merged.add(c01); merged.add(c11);
          suppressedH.add(hKey(i, j + 1));
          suppressedH.add(hKey(i + 1, j + 1));
          suppressedV.add(vKey(i + 1, j));
          suppressedV.add(vKey(i + 1, j + 1));
          mergedPlacements.push({
            x: CENTER.x + (i + 1) * step,
            z: CENTER.z + (j + 1) * step,
            size: step * 2,
            type: '2x2',
          });
        }
      }
    }
  }

  /* Pass 2: 2x1 horizontal pairs */
  for (let i = -n; i < n; i++) {
    for (let j = -n; j <= n; j++) {
      const c00 = ck(i, j), c10 = ck(i + 1, j);
      if (emptyCells.has(c00) && emptyCells.has(c10)) {
        if (!merged.has(c00) && !merged.has(c10)) {
          merged.add(c00); merged.add(c10);
          suppressedV.add(vKey(i + 1, j));
          mergedPlacements.push({
            x: CENTER.x + (i + 1) * step,
            z: CENTER.z + (j + 0.5) * step,
            w: step * 2, h: step,
            type: '2x1',
          });
        }
      }
    }
  }

  /* Pass 3: 1x2 vertical pairs */
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j < n; j++) {
      const c00 = ck(i, j), c01 = ck(i, j + 1);
      if (emptyCells.has(c00) && emptyCells.has(c01)) {
        if (!merged.has(c00) && !merged.has(c01)) {
          merged.add(c00); merged.add(c01);
          suppressedH.add(hKey(i, j + 1));
          mergedPlacements.push({
            x: CENTER.x + (i + 0.5) * step,
            z: CENTER.z + (j + 1) * step,
            w: step, h: step * 2,
            type: '1x2',
          });
        }
      }
    }
  }

  const isNodeValid = (i, j) => {
    const x = CENTER.x + i * step;
    const z = CENTER.z + j * step;
    const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
    if (rr < ringMin || rr > radius) return false;
    if (heightAt(x, z) < WATER_LEVEL + 0.6) return false;
    if (mountainFactor(x, z) > 0.62) return false;
    return true;
  };

  const nodeId = (i, j) => {
    const x = CENTER.x + i * step;
    const z = CENTER.z + j * step;
    return addNode(g, x, z, nk(x, z));
  };

  /* Horizontal edges: connecting (i, j) to (i+1, j) */
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i < n; i++) {
      if (suppressedH.has(hKey(i, j))) continue;
      if (isNodeValid(i, j) && isNodeValid(i + 1, j)) {
        const idA = nodeId(i, j);
        const idB = nodeId(i + 1, j);
        addEdge(g, idA, idB, width, lanes);
      }
    }
  }

  /* Vertical edges: connecting (i, j) to (i, j+1) */
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j < n; j++) {
      if (suppressedV.has(vKey(i, j))) continue;
      if (isNodeValid(i, j) && isNodeValid(i, j + 1)) {
        const idA = nodeId(i, j);
        const idB = nodeId(i, j + 1);
        addEdge(g, idA, idB, width, lanes);
      }
    }
  }

  /* Prune isolated degree-0 nodes */
  g.nodes = g.nodes.filter(node => (g.degree.get(node.id) || 0) > 0);
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

  /* ---- 1. Metro grid planning with neighbor empty cell combining --------- */
  const metroN = Math.floor(METRO_R / METRO_STEP);
  const metroOccupied = new Set();
  const metroBuildings = [];

  for (let i = -metroN; i <= metroN; i++) {
    for (let j = -metroN; j <= metroN; j++) {
      const x = CENTER.x + (i + 0.5) * METRO_STEP;
      const z = CENTER.z + (j + 0.5) * METRO_STEP;
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr > METRO_R - 12) continue;
      if (rr < SPAWN_CLEAR * 0.85) continue;
      if (heightAt(x, z) < WATER_LEVEL + 1) continue;
      if (!R.chance(0.52)) continue;

      metroOccupied.add(`${i},${j}`);
      metroBuildings.push({ i, j, x, z, rr });
    }
  }

  const metroMerged = [];
  addMergedGrid(g, METRO_STEP, METRO_R, LANE2_W, 2, {
    occupiedCells: metroOccupied,
    mergedPlacements: metroMerged,
  });

  /* ---- 2. Residential grid planning with neighbor empty cell combining ---- */
  const resN = Math.floor(RESIDENTIAL_R / RES_STEP);
  const resOccupied = new Set();
  const resHouses = [];

  for (let i = -resN; i <= resN; i++) {
    for (let j = -resN; j <= resN; j++) {
      const x = CENTER.x + (i + 0.5) * RES_STEP;
      const z = CENTER.z + (j + 0.5) * RES_STEP;
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr < METRO_R + 16 || rr > RESIDENTIAL_R - 12) continue;
      if (heightAt(x, z) < WATER_LEVEL + 1) continue;
      if (mountainFactor(x, z) > 0.25 || heightAt(x, z) > 14) continue;
      if (!R.chance(0.45)) continue;

      resOccupied.add(`${i},${j}`);
      resHouses.push({ i, j, x, z });
    }
  }

  const resMerged = [];
  addMergedGrid(g, RES_STEP, RESIDENTIAL_R, LANE1_W, 1, {
    ringMin: METRO_R + 8,
    occupiedCells: resOccupied,
    mergedPlacements: resMerged,
  });

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
      const target = c.beachStart - COAST_ROAD_INSET;
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
    const a = coastPts[coastPts.length - 1];
    const b = coastPts[0];
    const ia = addNode(g, a.x, a.z, nk(a.x, a.z));
    const ib = addNode(g, b.x, b.z, nk(b.x, b.z));
    addEdge(g, ia, ib, LANE1_W, 1);
  }

  /* Coast ↔ residential feeders: from the residential ring to the beach. */
  const ringNodes = g.nodes.filter(n => {
    const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
    return rr >= RESIDENTIAL_R - RES_STEP && rr <= RESIDENTIAL_R;
  });
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + 0.2;
    const dirX = Math.cos(ang), dirZ = Math.sin(ang);
    let start = null, best = Infinity;
    for (const rn of ringNodes) {
      const d = Math.hypot(
        rn.x - CENTER.x - dirX * RESIDENTIAL_R,
        rn.z - CENTER.z - dirZ * RESIDENTIAL_R,
      );
      if (d < best) { best = d; start = rn; }
    }
    if (!start) continue;
    const pts = [];
    for (let r = RESIDENTIAL_R - RES_STEP + 16; r < ISLAND_R; r += 16) {
      const x = CENTER.x + Math.cos(ang) * r;
      const z = CENTER.z + Math.sin(ang) * r;
      const c = coastAt(x, z);
      if (c.rr > c.beachStart - 14) break;
      if (heightAt(x, z) > WATER_LEVEL + 11) break;
      pts.push({ x, z });
    }
    if (pts.length < 2) continue;
    let prev = start.id;
    for (const p of pts) {
      const id = addNode(g, p.x, p.z, nk(p.x, p.z));
      addEdge(g, prev, id, LANE1_W, 1);
      prev = id;
    }
  }

  /* ---- Metro building placements -------------------------------------- */
  for (const b of metroBuildings) {
    const { x, z, rr } = b;
    let url, sc, rad, kind;
    const skyChance = rr < 90 ? 0.85 : rr < 160 ? 0.5 : 0;
    if (skyChance > 0 && R.chance(skyChance)) {
      url = R.pick(SKYSCRAPERS);
      sc = SKY_SCALE * R.f(0.92, 1.12);
      rad = sc * MODEL_SPAN * 0.42;
      kind = 'building';
    } else if (rr < 150 && R.chance(0.75)) {
      url = R.pick(CITY_BUILDINGS);
      sc = BUILDING_SCALE * R.f(0.9, 1.1) * buildingBoost(url);
      rad = sc * MODEL_SPAN * 0.4;
      kind = 'building';
    } else {
      url = R.pick(LOW_CITY);
      sc = BUILDING_SCALE * R.f(0.85, 1.05) * buildingBoost(url);
      rad = sc * MODEL_SPAN * 0.38;
      kind = 'building';
    }
    const yaw = R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    const sy = kind === 'building' && url.includes('skyscraper')
      ? sc * R.f(1.15, 1.45)
      : sc;
    const ground = heightAt(x, z);
    addInst(placements, url, x, z, yaw, sc, sy, sc, kind,
      ground + PLATFORM_H + BUILD_UPLIFT);
    addInst(placements, '', x, z, 0, PLATFORM_SZ, PLATFORM_H, PLATFORM_SZ,
      'platform', ground);
    addCollider(colliders, x, z, rad, 'building');
  }

  /* ---- Residential house placements ----------------------------------- */
  for (const h of resHouses) {
    const { x, z } = h;
    const sc = HOUSE_SCALE * R.f(0.92, 1.12);
    const yaw = R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    const url = R.pick(HOUSES);
    addInst(placements, url, x, z, yaw, sc, sc, sc, 'house');
    addCollider(colliders, x, z, sc * MODEL_SPAN * 0.38, 'building');
  }

  /* Street lights at high-degree junctions (metro), sitting on the footpath
     corner diagonally off the intersection — kerb + halfway out the slab. */
  for (const n of g.nodes) {
    const deg = g.degree.get(n.id) || 0;
    if (deg < 3) continue;
    const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
    if (rr > METRO_R + 20) continue;
    if (!R.chance(0.55)) continue;
    const sc = HOUSE_SCALE * 1.2;
    const light = R.pick(LIGHTS);
    const half = (g.nodeWidth.get(n.id) || 0) * 0.5;
    const d = half + 0.45 + FOOT_W * 0.5;
    addInst(placements, light, n.x + d, n.z + d, 0, sc, sc, sc, 'light');
  }

  /* ---- Wild houses: beach cottages -------------------------------------- */
  /* A second stream so the city layout above stays byte-for-byte stable. */
  const W = rand(rng(seed * 7 + 3));
  const HOUSES_SHORT = HOUSES.slice(0, 14);   // cottages read small-scale

  /* Cottages on the flat strip just INSIDE the coast ring road. Nothing
     sits seaward of the road any more — every house faces the shore from
     the land side, so the beach band itself stays clear. */
  let beachHouses = 0;
  for (let a = 0; a < TAU && beachHouses < 16; a += 0.09) {
    const dirX = Math.cos(a), dirZ = Math.sin(a);
    /* Walk the flat strip inward from the ring road. The road position is
       read from the LOCAL coast sample — the shoreline warp shifts it by
       several metres across the island, and a house placed against a
       sampled ring road can sit on the actual tarmac. */
    let spot = null;
    for (let k = 0; k < 10; k++) {
      const r = ISLAND_R * 0.75 - k * 14;
      const x = CENTER.x + dirX * r;
      const z = CENTER.z + dirZ * r;
      const { rr, beachStart } = coastAt(x, z);
      const roadR = beachStart - COAST_ROAD_INSET;
      if (rr > roadR - 12) continue;         // inward of the road, with a gap
      const y = heightAt(x, z);
      if (y < WATER_LEVEL + 3 || y > 6.5) continue;
      if (normalAt(x, z).y < 0.9) continue;
      spot = { x, z, y };
      break;
    }
    if (!spot) continue;
    if (!W.chance(0.28)) continue;

    const sc = HOUSE_SCALE * W.f(0.7, 0.95);
    const url = W.pick(HOUSES_SHORT);
    addInst(placements, url, spot.x, spot.z, W.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]),
      sc, sc, sc, 'house');
    addCollider(colliders, spot.x, spot.z, sc * MODEL_SPAN * 0.38, 'building');
    beachHouses++;
  }

  /* ---- City + wild trees, random and big -------------------------------- */
  /* The vegetation pack, one entry per model with its base height (h) and
     width (w), so the scale can land every variant in the same size band. */
  const TREES = [
    { url: '/assets/vegetation/tree_1.glb', h: 6.85, w: 4.34 },
    { url: '/assets/vegetation/tree_2.glb', h: 5.24, w: 2.29 },
    { url: '/assets/vegetation/tree_3.glb', h: 2.26, w: 1.47 },
    { url: '/assets/vegetation/tree_4.glb', h: 6.85, w: 4.34 },
    { url: '/assets/vegetation/tree_5.glb', h: 5.24, w: 2.29 },
    { url: '/assets/vegetation/tree_6.glb', h: 2.26, w: 1.47 },
    { url: '/assets/vegetation/tree_pine_1.glb', h: 6.22, w: 2.91 },
    { url: '/assets/vegetation/tree_pine_2.glb', h: 5.0, w: 1.84 },
    { url: '/assets/vegetation/tree_pine_3.glb', h: 2.01, w: 1.18 },
  ];
  const solidKinds = new Set(['building', 'house']);
  const nearSolid = (x, z, pad) => {
    for (const c of colliders) {
      if (!solidKinds.has(c.kind)) continue;
      if (Math.hypot(x - c.x, z - c.z) < c.radius + pad) return true;
    }
    return false;
  };
  const plantTree = (x, z, kind = 'tree') => {
    const y = heightAt(x, z);
    if (y < WATER_LEVEL + 0.6) return;
    if (normalAt(x, z).y < 0.55) return;
    if (nearSolid(x, z, 3)) return;
    const v = W.pick(TREES);
    /* 6-15 m of final height, whichever model was drawn. */
    const s = (W.f(6, 15) * (W.chance(0.12) ? W.f(1.2, 1.5) : 1)) / v.h;
    addInst(placements, v.url, x, z, W.f(0, TAU), s, s, s, kind);
    colliders.push({ x, z, radius: v.w * s * 0.5, kind: 'tree' });
  };

  /* Scattered yard trees in the residential ring (roads stay clear).
     Quarter-step offsets so trees sit between house lots, not on top. */
  const tN = Math.floor(RESIDENTIAL_R / RES_STEP);
  for (let i = -tN; i <= tN; i++) {
    for (let j = -tN; j <= tN; j++) {
      const x = CENTER.x + (i + 0.75) * RES_STEP + W.f(-4, 4);
      const z = CENTER.z + (j + 0.75) * RES_STEP + W.f(-4, 4);
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr < METRO_R + 10 || rr > RESIDENTIAL_R - 16) continue;
      if (mountainFactor(x, z) > 0.4) continue;
      if (!W.chance(0.5)) continue;
      plantTree(x, z);
    }
  }

  /* Sparse street trees in metro blocks, quarter-step between buildings. */
  const mN = Math.floor(METRO_R / METRO_STEP);
  for (let i = -mN; i <= mN; i++) {
    for (let j = -mN; j <= mN; j++) {
      const x = CENTER.x + (i + 0.75) * METRO_STEP + W.f(-3, 3);
      const z = CENTER.z + (j + 0.75) * METRO_STEP + W.f(-3, 3);
      const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (rr > METRO_R - 20 || rr < 70) continue;
      if (!W.chance(0.3)) continue;
      plantTree(x, z);
    }
  }

  /* Mountain trees: scattered around each peak below the snow line. */
  for (const peak of PEAKS) {
    for (let k = 0; k < 26; k++) {
      const ang = W.f(0, TAU);
      const d = peak.r * Math.sqrt(W.f());
      const x = peak.x + Math.cos(ang) * d;
      const z = peak.z + Math.sin(ang) * d;
      const y = heightAt(x, z);
      if (y < WATER_LEVEL + 2 || y > 42) continue;
      if (mountainFactor(x, z) < 0.35) continue;
      if (!W.chance(0.5)) continue;
      plantTree(x, z);
    }
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
