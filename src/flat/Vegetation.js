/* Island vegetation — forest GLB props with physics colliders.
 *
 * Placement is a pure function of a seed and heightAt, so the same trees
 * always land in the same spots. Visuals load asynchronously from
 * assets/forest; colliders are available immediately so the car can crash
 * into a tree before its mesh finishes loading.
 *
 * Colliders are horizontal cylinders (x, z, radius) — arcade-simple and
 * enough to stop the vehicle on impact. Spawn pad and open beach stay clear.
 */
import * as THREE from 'three';
import { rng, rand } from '../core/rng.js';
import { clamp, smoothstep } from '../core/util.js';
import { celMaterial } from '../render/cel.js';
import {
  heightAt, normalAt, coastAt, mountainFactor, CENTER, WATER_LEVEL,
  FLAT_R, PLAZA_HALF, PEAKS, inCity, COAST_ROAD_INSET, ICE_AT,
} from './Island.js';

const SEED = 91;

/* Asset catalogue. Every tree/bush/trunk kind carries a list of VARIANT
   models from /assets/vegetation/ — each variant knows its base width (w),
   base height (h) and the uniform scale range that lands its final size in
   the band the rest of its kind sits in. Rocks keep the forest pack and a
   single model each. */
const V = (url, w, h, scale) => ({ url, w, h, scale });

const KINDS = {
  /* Leafy trees — three shapes, two colourways each (1/4, 2/5, 3/6 share
     geometry). Scale ranges are per model so every tree lands at
     roughly 3.5-13 m regardless of which one was picked. */
  tree: {
    tallBias: true,
    variants: [
      V('/assets/vegetation/tree_1.glb', 4.34, 6.85, [0.5, 1.9]),
      V('/assets/vegetation/tree_2.glb', 2.29, 5.24, [0.7, 2.5]),
      V('/assets/vegetation/tree_3.glb', 1.47, 2.26, [1.6, 5.8]),
      V('/assets/vegetation/tree_4.glb', 4.34, 6.85, [0.5, 1.9]),
      V('/assets/vegetation/tree_5.glb', 2.29, 5.24, [0.7, 2.5]),
      V('/assets/vegetation/tree_6.glb', 1.47, 2.26, [1.6, 5.8]),
    ],
  },
  /* Taller pines for the treeline and groves. */
  treeHigh: {
    tallBias: true,
    variants: [
      V('/assets/vegetation/tree_pine_1.glb', 2.91, 6.22, [0.55, 2.1]),
      V('/assets/vegetation/tree_pine_2.glb', 1.84, 5.0, [0.7, 2.6]),
      V('/assets/vegetation/tree_pine_3.glb', 1.18, 2.01, [1.7, 6.2]),
    ],
  },
  /* Bare dead trees — a third tree type, sparse in the flats. */
  dead: {
    tallBias: true,
    variants: [
      V('/assets/vegetation/dead_tree_1.glb', 2.57, 4.68, [0.7, 2.8]),
      V('/assets/vegetation/dead_tree_2.glb', 1.23, 4.06, [0.85, 3.2]),
      V('/assets/vegetation/dead_tree_3.glb', 0.7, 1.88, [1.8, 6.8]),
    ],
  },
  /* Low clumps, solid colliders like the old hedge. */
  bush: {
    variants: [
      V('/assets/vegetation/bush_1.glb', 1.45, 1.34, [0.9, 2.3]),
      V('/assets/vegetation/bush_2.glb', 0.99, 0.92, [1.3, 3.3]),
      V('/assets/vegetation/bush_3.glb', 1.52, 1.34, [0.9, 2.3]),
      V('/assets/vegetation/bush_4.glb', 0.99, 0.92, [1.3, 3.3]),
    ],
  },
  /* Stumps. Short, wide, random orientation. */
  trunk: {
    variants: [
      V('/assets/vegetation/trunk_1.glb', 0.34, 0.68, [0.8, 2.4]),
      V('/assets/vegetation/trunk_2.glb', 0.62, 0.52, [1.0, 3.1]),
      V('/assets/vegetation/trunk_3.glb', 0.9, 0.47, [1.1, 3.4]),
      V('/assets/vegetation/trunk_4.glb', 0.98, 0.52, [1.0, 3.1]),
    ],
  },
  rocksHigh: {
    url: '/assets/forest/rocks-high.glb',
    radius: 2.0,
    scale: [1.4, 5.1],
    rock: true,
  },
  rocksLow: {
    url: '/assets/forest/rocks-low.glb',
    radius: 1.4,
    scale: [1.1, 4.5],
    rock: true,
  },
  rocksRamp: {
    url: '/assets/forest/rocks-ramp.glb',
    radius: 1.6,
    scale: [1.3, 4.2],
    rock: true,
  },
  stones: {
    url: '/assets/forest/stones.glb',
    radius: 0.9,
    scale: [0.8, 3.8],
    rock: true,
  },
};

/**
 * Random tree height: more medium trees, some small, some huge.
 * Uses a power curve so extremes exist but most land mid-range.
 */
function treeScale(R, lo, hi) {
  const t = Math.pow(R.f(), 0.72);          // slight bias toward smaller
  const base = lo + (hi - lo) * t;
  /* Occasional oversized landmark tree. */
  if (R.chance(0.08)) return base * R.f(1.25, 1.55);
  return base;
}

/**
 * Random rock scale triad — different X/Y/Z so each boulder reads as a
 * different shape, plus a bit of lean.
 */
function rockTransform(R, lo, hi) {
  const mid = R.f(lo, hi);
  return {
    sx: mid * R.f(0.55, 1.55),
    sy: mid * R.f(0.4, 1.35),
    sz: mid * R.f(0.55, 1.6),
    yaw: R.f(0, Math.PI * 2),
    pitch: R.f(-0.35, 0.35),
    roll: R.f(-0.4, 0.4),
  };
}

/* Trees and dead trees: pick a variant, scale it inside the variant's own
   band so every model lands at the same final size, and size the collider
   off the model's real width. */
function placeTree(R, kind, x, y, z) {
  const v = R.pick(KINDS[kind].variants);
  const h = treeScale(R, v.scale[0], v.scale[1]);
  const fat = R.f(0.82, 1.18);   // canopy/trunk width jitter
  return {
    placement: {
      kind, url: v.url, x, y, z,
      sx: h * fat, sy: h, sz: h * fat,
      yaw: R.f(0, Math.PI * 2), pitch: 0, roll: 0,
    },
    radius: v.w * h * fat * 0.5,
  };
}

/* Bushes and stumps: uniform-ish clump with a per-axis jitter, collider from
   the model's real width. */
function placeClump(R, kind, x, y, z) {
  const v = R.pick(KINDS[kind].variants);
  const s = treeScale(R, v.scale[0], v.scale[1]);
  return {
    placement: {
      kind, url: v.url, x, y, z,
      sx: s * R.f(0.7, 1.4), sy: s * R.f(0.7, 1.45), sz: s * R.f(0.7, 1.4),
      yaw: R.f(0, Math.PI * 2), pitch: 0, roll: 0,
    },
    radius: v.w * s * 0.5,
  };
}

const SPAWN_CLEAR = 55;     // metres kept empty around map centre
const MIN_LAND_Y = WATER_LEVEL + 0.6;
const MAX_SLOPE = 0.55;     // normal.y below this = too steep to plant

/* How far outside the road slab vegetation must stay (kerb + footpath +
   a little margin), so no tree or rock ever grows on the asphalt. */
const ROAD_MARGIN = 3;

/**
 * Coarse spatial query: is a point inside any road slab (plus ROAD_MARGIN)?
 * Bins each edge segment into a fixed cell grid so the check is O(1) for a
 * typical point instead of scanning every edge.
 */
function buildRoadClearance(graph) {
  const CELL = 64;
  const bins = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  if (graph) {
    const byId = new Map();
    for (const n of graph.nodes) byId.set(n.id, n);
    for (const e of graph.edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const h = e.width * 0.5 + ROAD_MARGIN;
      const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, h };
      const x0 = Math.floor(Math.min(a.x, b.x) / CELL) - 1;
      const x1 = Math.floor(Math.max(a.x, b.x) / CELL) + 1;
      const z0 = Math.floor(Math.min(a.z, b.z) / CELL) - 1;
      const z1 = Math.floor(Math.max(a.z, b.z) / CELL) + 1;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = key(cx, cz);
          const arr = bins.get(k);
          if (arr) arr.push(seg);
          else bins.set(k, [seg]);
        }
      }
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = bins.get(key(cx + i, cz + j));
        if (!arr) continue;
        for (const s of arr) {
          const ex = s.bx - s.ax, ez = s.bz - s.az;
          const el = ex * ex + ez * ez;
          const t = el ? clamp(((x - s.ax) * ex + (z - s.az) * ez) / el, 0, 1) : 0;
          const dx = x - (s.ax + ex * t), dz = z - (s.az + ez * t);
          if (dx * dx + dz * dz <= s.h * s.h) return true;
        }
      }
    }
    return false;
  };
}

/**
 * Deterministic placement plan. Returns placements (for rendering) and
 * colliders (for physics). Safe to call before any GLB is loaded.
 *
 * @param {object} [graph]  road graph (nodes/edges) so nothing grows on roads
 * @returns {{placements: object[], colliders: {x:number,z:number,radius:number,kind:string}[]}}
 */
export function planVegetation(graph) {
  const R = rand(rng(SEED));
  const placements = [];
  const colliders = [];
  const nearRoad = buildRoadClearance(graph);
  /* Beach sand starts at the coast ring road; nothing may grow seaward of it
     (the beach and the road corridor both stay open). */
  const beachGate = beachStart => beachStart - COAST_ROAD_INSET - 6;

  /* Jittered grid over the plaza square. */
  const half = PLAZA_HALF * 0.96;
  const step = 24;   // base cell size; density varies by zone

  for (let ix = -half; ix <= half; ix += step) {
    for (let iz = -half; iz <= half; iz += step) {
      const jx = (R.f() - 0.5) * step * 0.85;
      const jz = (R.f() - 0.5) * step * 0.85;
      const x = CENTER.x + ix + jx;
      const z = CENTER.z + iz + jz;

      const y = heightAt(x, z);
      if (y < MIN_LAND_Y) continue;

      const { rr, beachStart } = coastAt(x, z);
      /* Keep the beach and coast road open, and the spawn pad clear. */
      if (rr > beachGate(beachStart)) continue;
      if (Math.hypot(x - CENTER.x, z - CENTER.z) < SPAWN_CLEAR) continue;
      /* No forest through metro houses / roads. */
      if (inCity(x, z)) continue;
      if (nearRoad(x, z)) continue;

      const n = normalAt(x, z);
      if (n.y < MAX_SLOPE) continue;

      const mtn = mountainFactor(x, z);
      const flatness = 1 - smoothstep(FLAT_R * 0.5, FLAT_R * 2.2, rr);
      /* Density: denser on flats and mountain shoulders, thinner mid-slopes. */
      const dens = mtn > 0.35
        ? 0.42 + mtn * 0.28
        : 0.16 + flatness * 0.42;
      if (!R.chance(dens)) continue;

      let kind;
      if (mtn > 0.4) {
        /* Mountains: mixed rock shapes and trees of varied height. */
        const roll = R.f();
        if (roll < 0.22) kind = 'rocksHigh';
        else if (roll < 0.40) kind = 'rocksLow';
        else if (roll < 0.52) kind = 'rocksRamp';
        else if (roll < 0.64) kind = 'stones';
        else if (roll < 0.76) kind = 'treeHigh';
        else if (roll < 0.90) kind = 'tree';
        else kind = 'dead';
        /* Fewer trees high on the slopes, and none on the iced crown. */
        if (y > 58 && (kind === 'tree' || kind === 'treeHigh' || kind === 'dead')) {
          if (y > ICE_AT - 2) continue;
          if (R.chance(0.5)) continue;
        }
      } else {
        /* Flats: trees of every type, bushes, trunks, and scattered rocks. */
        const roll = R.f();
        if (roll < 0.30) kind = 'tree';
        else if (roll < 0.52) kind = 'treeHigh';
        else if (roll < 0.62) kind = 'dead';
        else if (roll < 0.76) kind = 'bush';
        else if (roll < 0.84) kind = 'trunk';
        else if (roll < 0.90) kind = 'stones';
        else if (roll < 0.95) kind = 'rocksLow';
        else kind = 'rocksRamp';
      }

      const def = KINDS[kind];
      let placement;
      let radius;
      if (def.rock) {
        const t = rockTransform(R, def.scale[0], def.scale[1]);
        radius = def.radius * Math.max(t.sx, t.sz) * 0.75;
        placement = {
          kind, url: def.url, x, y, z,
          sx: t.sx, sy: t.sy, sz: t.sz,
          yaw: t.yaw, pitch: t.pitch, roll: t.roll,
        };
      } else if (def.tallBias) {
        const t = placeTree(R, kind, x, y, z);
        placement = t.placement;
        radius = t.radius;
      } else {
        const t = placeClump(R, kind, x, y, z);
        placement = t.placement;
        radius = t.radius;
      }
      colliders.push({ x, z, radius, kind });
      placements.push(placement);
    }
  }

  /* Plant belt around the central flats — bushes and stumps, so the open
     ground between town and the treeline has low cover. */
  const beltStep = 14;
  for (let ix = -FLAT_R * 1.6; ix <= FLAT_R * 1.6; ix += beltStep) {
    for (let iz = -FLAT_R * 1.6; iz <= FLAT_R * 1.6; iz += beltStep) {
      const x = CENTER.x + ix + (R.f() - 0.5) * beltStep;
      const z = CENTER.z + iz + (R.f() - 0.5) * beltStep;
      const dist = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (dist < SPAWN_CLEAR || dist > FLAT_R * 1.55) continue;
      if (inCity(x, z)) continue;
      const y = heightAt(x, z);
      if (y < MIN_LAND_Y) continue;
      if (normalAt(x, z).y < 0.7) continue;
      if (nearRoad(x, z)) continue;
      if (!R.chance(0.3)) continue;
      const kind = R.chance(0.8) ? 'bush' : 'trunk';
      const t = placeClump(R, kind, x, y, z);
      placements.push(t.placement);
      colliders.push({ x, z, radius: t.radius, kind });
    }
  }

  /* Mountain tree groves — a fixed set of distinct clusters (8 per peak,
     ~24 total) alternating between the treeline shoulders and the crown, so
     the peaks read as forested clumps right up to the summit. */
  const GROVES_PER_PEAK = 8;
  for (const peak of PEAKS) {
    for (let k = 0; k < GROVES_PER_PEAK; k++) {
      const ang = R.f(0, Math.PI * 2);
      /* Alternating bands: shoulder groves and summit groves. */
      const d = peak.r * (k % 2 ? R.f(0.38, 0.72) : R.f(0.04, 0.3));
      const cx = peak.x + Math.cos(ang) * d;
      const cz = peak.z + Math.sin(ang) * d;
      const cy = heightAt(cx, cz);
      /* Trees stop at the ice line so the tallest peak's iced crown stays
         clear; the two lower peaks never reach it. */
      const ceil = Math.min(peak.h - 3, ICE_AT - 2);
      if (cy < MIN_LAND_Y || cy > ceil) continue;
      if (mountainFactor(cx, cz) < 0.35) continue;
      if (inCity(cx, cz)) continue;
      if (normalAt(cx, cz).y < 0.45) continue;
      const nTrees = R.i(7, 13);
      for (let kk = 0; kk < nTrees; kk++) {
        const a = R.f(0, Math.PI * 2);
        const dd = Math.sqrt(R.f()) * R.f(10, 20);
        const tx = cx + Math.cos(a) * dd;
        const tz = cz + Math.sin(a) * dd;
        const ty = heightAt(tx, tz);
        if (ty < MIN_LAND_Y || ty > ceil + 1) continue;
        if (inCity(tx, tz)) continue;
        if (normalAt(tx, tz).y < 0.4) continue;
        const kind = R.chance(0.7) ? 'treeHigh' : 'tree';
        const t = placeTree(R, kind, tx, ty, tz);
        placements.push(t.placement);
        colliders.push({ x: tx, z: tz, radius: t.radius, kind });
      }
    }
  }

  /* Countryside groves — distinct tree clusters in the wilds between the
     city skirt and the beach, well away from the mountains, so the drive
     out of town passes forested stands. */
  const WILD_R0 = 620, WILD_R1 = 800;
  const wildCentres = [];
  let wildGuard = 0;
  while (wildCentres.length < 12 && wildGuard++ < 500) {
    const a = R.f(0, Math.PI * 2);
    const r = R.f(WILD_R0, WILD_R1);
    const wx = CENTER.x + Math.cos(a) * r;
    const wz = CENTER.z + Math.sin(a) * r;
    const { rr, beachStart } = coastAt(wx, wz);
    if (rr > beachGate(beachStart)) continue;
    if (rr < WILD_R0) continue;
    if (mountainFactor(wx, wz) > 0.3) continue;
    if (inCity(wx, wz)) continue;
    if (nearRoad(wx, wz)) continue;
    const wy = heightAt(wx, wz);
    if (wy < MIN_LAND_Y) continue;
    if (normalAt(wx, wz).y < 0.6) continue;
    /* Keep groves separated so each reads as its own group. */
    let far = true;
    for (const c of wildCentres) {
      if (Math.hypot(wx - c.x, wz - c.z) < 130) { far = false; break; }
    }
    if (!far) continue;
    const nTrees = R.i(6, 11);
    for (let k = 0; k < nTrees; k++) {
      const a2 = R.f(0, Math.PI * 2);
      const dd = Math.sqrt(R.f()) * R.f(9, 18);
      const tx = wx + Math.cos(a2) * dd;
      const tz = wz + Math.sin(a2) * dd;
      const ty = heightAt(tx, tz);
      if (ty < MIN_LAND_Y || ty > 30) continue;
      if (normalAt(tx, tz).y < 0.5) continue;
      if (nearRoad(tx, tz)) continue;
      const kind = R.chance(0.55) ? 'tree' : 'treeHigh';
      const t = placeTree(R, kind, tx, ty, tz);
      placements.push(t.placement);
      colliders.push({ x: tx, z: tz, radius: t.radius, kind });
    }
    wildCentres.push({ x: wx, z: wz });
  }

  /* Extra rock scatter on flats and ridges — irregular shapes. */
  const rockStep = 32;
  for (let ix = -half; ix <= half; ix += rockStep) {
    for (let iz = -half; iz <= half; iz += rockStep) {
      if (!R.chance(0.45)) continue;
      const x = CENTER.x + ix + (R.f() - 0.5) * rockStep;
      const z = CENTER.z + iz + (R.f() - 0.5) * rockStep;
      if (Math.hypot(x - CENTER.x, z - CENTER.z) < SPAWN_CLEAR) continue;
      if (inCity(x, z)) continue;
      const y = heightAt(x, z);
      if (y < MIN_LAND_Y || y > 50) continue;
      const { rr, beachStart } = coastAt(x, z);
      if (rr > beachGate(beachStart)) continue;
      if (normalAt(x, z).y < 0.5) continue;
      if (nearRoad(x, z)) continue;
      const kinds = ['stones', 'rocksLow', 'rocksHigh', 'rocksRamp'];
      const kind = kinds[R.i(0, kinds.length - 1)];
      const def = KINDS[kind];
      const t = rockTransform(R, def.scale[0], def.scale[1]);
      placements.push({
        kind, url: def.url, x, y, z,
        sx: t.sx, sy: t.sy, sz: t.sz,
        yaw: t.yaw, pitch: t.pitch, roll: t.roll,
      });
      colliders.push({
        x, z,
        radius: def.radius * Math.max(t.sx, t.sz) * 0.75,
        kind,
      });
    }
  }

  return { placements, colliders };
}

/**
 * Spatial hash of colliders for cheap near-queries at 120 Hz.
 * Cell size ~ 8 m — car queries a few cells per substep.
 */
export class ObstacleGrid {
  constructor(colliders, cellSize = 8) {
    this.cell = cellSize;
    this.map = new Map();
    this.colliders = colliders;
    for (let i = 0; i < colliders.length; i++) {
      const o = colliders[i];
      const key = this._key(o.x, o.z);
      let bin = this.map.get(key);
      if (!bin) { bin = []; this.map.set(key, bin); }
      bin.push(o);
    }
  }

  _key(x, z) {
    const c = this.cell;
    return `${Math.floor(x / c)},${Math.floor(z / c)}`;
  }

  /**
   * Push every collider that could touch a circle at (x,z) with radius r
   * into `out` (cleared first). Returns out.
   */
  query(x, z, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const pad = r + 3;
    const i0 = Math.floor((x - pad) / c);
    const i1 = Math.floor((x + pad) / c);
    const j0 = Math.floor((z - pad) / c);
    const j1 = Math.floor((z + pad) / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const bin = this.map.get(`${i},${j}`);
        if (!bin) continue;
        for (const o of bin) out.push(o);
      }
    }
    return out;
  }
}

/** Merge mesh geometries from a GLTF scene into one, with UVs when present. */
function bakeSceneGeometry(scene) {
  scene.updateMatrixWorld(true);
  const geos = [];
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    geos.push(g);
  });
  if (!geos.length) return null;
  return mergeGeometriesUV(geos);
}

function mergeGeometriesUV(list) {
  let vCount = 0, iCount = 0;
  let hasUv = true, hasN = true;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
    if (!g.attributes.uv) hasUv = false;
    if (!g.attributes.normal) hasN = false;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = hasN ? new Float32Array(vCount * 3) : null;
  const uvs = hasUv ? new Float32Array(vCount * 2) : null;
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (nrm && g.attributes.normal) {
      nrm.set(g.attributes.normal.array.subarray(0, p.count * 3), vo * 3);
    }
    if (uvs && g.attributes.uv) {
      uvs.set(g.attributes.uv.array.subarray(0, p.count * 2), vo * 2);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    } else {
      for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nrm) out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  else out.computeVertexNormals();
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * Load vegetation GLBs and build instanced meshes for the placement plan.
 * Grouped by URL, so every variant model in /assets/vegetation becomes its
 * own instanced mesh.
 * @param {object[]} placements
 * @param {(frac:number)=>void} [onProgress]  called with 0..1 per model loaded
 * @returns {Promise<THREE.Group>}
 */
export async function buildVegetationMeshes(placements, onProgress) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const root = new THREE.Group();
  root.name = 'vegetation';

  /* Group placements by URL. */
  const byUrl = new Map();
  for (const p of placements) {
    if (!p.url) continue;
    let list = byUrl.get(p.url);
    if (!list) { list = []; byUrl.set(p.url, list); }
    list.push(p);
  }

  const urls = [...byUrl.keys()];
  const total = Math.max(1, urls.length);
  let done = 0;
  const bump = () => onProgress?.(done / total);

  const dummy = new THREE.Object3D();

  await Promise.all(urls.map(async (url) => {
    const items = byUrl.get(url);
    let gltf;
    try {
      gltf = await loader.loadAsync(url);
    } catch (err) {
      console.warn('vegetation load failed', url, err);
      done++; bump();
      return;
    }

    /* First textured material map, if any, for the cel ramp. */
    let map = null;
    gltf.scene.traverse(o => {
      if (o.isMesh && o.material) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.map && !map) map = m.map;
      }
    });

    const geo = bakeSceneGeometry(gltf.scene);
    if (!geo) return;

    /* Centre the prototype on its base so scale grows upward from the ground. */
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const midX = (bb.min.x + bb.max.x) * 0.5;
    const midZ = (bb.min.z + bb.max.z) * 0.5;
    const baseY = bb.min.y;
    geo.translate(-midX, -baseY, -midZ);
    geo.computeBoundingSphere();

    const mat = celMaterial({ map: map || undefined, color: map ? 0xffffff : 0x5a8f4a });
    /* Forest colormaps often carry alpha; force fully opaque so trees are solid. */
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.alphaTest = 0.5;   // cut out empty texels without soft see-through
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
    }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.name = `veg-${url.split('/').pop().replace('.glb', '')}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.pitch || 0, it.yaw || 0, it.roll || 0);
      /* Prefer per-axis scale (random tree height / rock shape); fall back
         to legacy uniform `scale` if present. */
      if (it.sx != null) dummy.scale.set(it.sx, it.sy, it.sz);
      else dummy.scale.setScalar(it.scale ?? 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
    done++; bump();
  }));

  return root;
}

/**
 * Plan + collider grid. Call once at world build; meshes load separately.
 * @param {object} [graph]  road graph so nothing grows on road slabs
 */
export function createVegetationSystem(graph) {
  const { placements, colliders } = planVegetation(graph);
  const grid = new ObstacleGrid(colliders);
  return { placements, colliders, grid };
}
