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
  METRO_R, RESIDENTIAL_R, ISLAND_R, PEAKS, inCity,
} from './Island.js';

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
export const LANE1_W = 5.5;    // one car + margin
export const LANE2_W = 11;     // two-lane metro
export const METRO_STEP = 46;  // centreline spacing (fits 3× buildings)
export const RES_STEP = 40;    // residential street spacing (scaled for big houses)
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
/* The bush hedge asset — the same low wide clump the forest uses, planted
   shoulder-to-shoulder around house lots. */
const BUSH = '/assets/forest/plant.glb';
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

function addInst(list, url, x, z, yaw, sx, sy, sz, kind, banner = false) {
  list.push({
    url, x, y: sitY(x, z), z,
    yaw: yaw || 0, pitch: 0, roll: 0,
    sx, sy, sz, kind, banner,
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
      /* Towers taper from a dense downtown core out through the inner ring:
         ~85% of the core lots, ~50% of the next ring, then mid-rise. */
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
      /* Sy a bit taller for skyscraper massing. */
      const sy = kind === 'building' && url.includes('skyscraper')
        ? sc * R.f(1.15, 1.45)
        : sc;
      addInst(placements, url, x, z, yaw, sc, sy, sc, kind, true);
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
      addInst(placements, url, x, z, yaw, sc, sc, sc, 'house', true);
      addCollider(colliders, x, z, sc * MODEL_SPAN * 0.38, 'building');

      /* Bush hedge around the lot, one gap for the drive. A run of plant.glb
         clumps planted shoulder-to-shoulder on all four edges with the middle
         of one edge left open. Every bush is a solid collider, so the car
         bounces off the hedge and can only reach the house through the gap. */
      const off = sc * MODEL_SPAN * 0.55;
      const nPer = 5;
      const sp = (2 * off) / nPer;
      const open = R.i(0, 3);   /* edge with the drive gap */
      const inw = [             /* jitter inward keeps the street side clean */
        { x: 0, z: -1 }, { x: 0, z: 1 },
        { x: -1, z: 0 }, { x: 1, z: 0 },
      ];
      for (let e = 0; e < 4; e++) {
        const horiz = e < 2;
        const side = e % 2 === 0 ? 1 : -1;
        for (let k = 0; k < nPer; k++) {
          if (e === open && k >= 1 && k <= 3) continue;
          const t = -off + (k + 0.5) * sp + R.f(-0.3, 0.3);
          const bx = horiz ? x + t : x + side * off;
          const bz = horiz ? z + side * off : z + t;
          const d = R.f(0.1, 0.5);
          const bs = R.f(1.0, 1.4);
          addInst(placements, BUSH, bx + inw[e].x * d, bz + inw[e].z * d,
            R.f(0, Math.PI * 2), bs, bs * R.f(1.15, 1.35), bs, 'fence');
          addCollider(colliders, bx + inw[e].x * d, bz + inw[e].z * d, 0.9, 'fence');
        }
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
    const sc = HOUSE_SCALE * 1.2;
    const light = R.pick(LIGHTS);
    addInst(placements, light, n.x + 4, n.z + 4, 0, sc, sc, sc, 'light');
  }

  /* ---- Wild houses: beach cottages and mountain cabins ------------------ */
  /* A second stream so the city layout above stays byte-for-byte stable. */
  const W = rand(rng(seed * 7 + 3));
  const HOUSES_SHORT = HOUSES.slice(0, 14);   // cottages read small-scale

  /* Beach cottages: flat spots seaward of the coast road, above the waterline. */
  let beachHouses = 0;
  for (let a = 0; a < TAU && beachHouses < 16; a += 0.09) {
    const dirX = Math.cos(a), dirZ = Math.sin(a);
    /* Walk the beach band outward to find a dry, flat shelf. */
    let spot = null;
    for (let k = 0; k < 10; k++) {
      const r = ISLAND_R * 0.8 + k * 14;
      const x = CENTER.x + dirX * r;
      const z = CENTER.z + dirZ * r;
      const { rr, beachStart } = coastAt(x, z);
      if (rr < beachStart) continue;
      const y = heightAt(x, z);
      if (y < WATER_LEVEL + 1.2 || y > 4.5) continue;
      if (normalAt(x, z).y < 0.82) continue;
      spot = { x, z, y };
      break;
    }
    if (!spot) continue;
    if (!W.chance(0.45)) continue;

    const sc = HOUSE_SCALE * W.f(0.7, 0.95);
    const url = W.pick(HOUSES_SHORT);
    addInst(placements, url, spot.x, spot.z, W.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]),
      sc, sc, sc, 'house', true);
    addCollider(colliders, spot.x, spot.z, sc * MODEL_SPAN * 0.38, 'building');
    beachHouses++;
  }

  /* Mountain cabins: a few per peak on the driveable lower slopes. */
  let cabins = 0;
  for (const peak of PEAKS) {
    const want = 1 + W.i(0, 2);
    for (let k = 0; k < want && cabins < 12; k++) {
      const ang = W.f(0, TAU);
      const d = peak.r * W.f(0.42, 0.7);
      const x = peak.x + Math.cos(ang) * d;
      const z = peak.z + Math.sin(ang) * d;
      const y = heightAt(x, z);
      if (y < WATER_LEVEL + 2 || y > 44) continue;
      const m = mountainFactor(x, z);
      if (m < 0.3 || m > 0.85) continue;
      if (normalAt(x, z).y < 0.6) continue;
      if (!W.chance(0.6)) continue;

      const sc = HOUSE_SCALE * W.f(0.72, 0.92);
      addInst(placements, W.pick(HOUSES_SHORT), x, z,
        W.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), sc, sc, sc, 'house', true);
      addCollider(colliders, x, z, sc * MODEL_SPAN * 0.38, 'building');
      cabins++;
    }
  }

  /* ---- City + wild trees, random and big -------------------------------- */
  const TREES = [
    '/assets/house/tree-large.glb',
    '/assets/house/tree-small.glb',
  ];
  const treeScale = () => W.f(7, 20) * (W.chance(0.12) ? W.f(1.2, 1.5) : 1);
  const solidKinds = new Set(['building', 'house', 'fence']);
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
    const s = treeScale();
    addInst(placements, W.pick(TREES), x, z, W.f(0, TAU), s, s, s, kind);
    colliders.push({ x, z, radius: s * 0.12, kind: 'tree' });
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

  /* Beach trees: along the sand band between the coast road and the sea. */
  for (let a = 0; a < TAU; a += 0.03) {
    if (!W.chance(0.5)) continue;
    const x = CENTER.x + Math.cos(a) * ISLAND_R * W.f(0.79, 0.9);
    const z = CENTER.z + Math.sin(a) * ISLAND_R * W.f(0.79, 0.9);
    const { rr, beachStart } = coastAt(x, z);
    if (rr < beachStart) continue;
    plantTree(x, z);
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
