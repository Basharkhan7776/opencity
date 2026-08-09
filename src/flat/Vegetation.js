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
import { smoothstep } from '../core/util.js';
import { celMaterial } from '../render/cel.js';
import {
  heightAt, normalAt, coastAt, mountainFactor, CENTER, WATER_LEVEL,
  FLAT_R, PLAZA_HALF, inCity,
} from './Island.js';

const SEED = 91;

/* Asset catalogue: url, base collision radius, uniform scale range [min,max].
   Trees get a wide height span; rocks use non-uniform axes for random shapes. */
const KINDS = {
  tree: {
    url: '/assets/forest/tree.glb',
    radius: 1.15,
    scale: [0.55, 3.8],       // saplings → tall
    tallBias: true,
  },
  treeHigh: {
    url: '/assets/forest/tree-high.glb',
    radius: 1.35,
    scale: [0.7, 4.6],
    tallBias: true,
  },
  plant: {
    url: '/assets/forest/plant.glb',
    radius: 0.55,
    scale: [0.7, 2.4],
  },
  rocksHigh: {
    url: '/assets/forest/rocks-high.glb',
    radius: 2.0,
    scale: [0.9, 3.2],
    rock: true,
  },
  rocksLow: {
    url: '/assets/forest/rocks-low.glb',
    radius: 1.4,
    scale: [0.7, 2.8],
    rock: true,
  },
  rocksRamp: {
    url: '/assets/forest/rocks-ramp.glb',
    radius: 1.6,
    scale: [0.8, 2.6],
    rock: true,
  },
  stones: {
    url: '/assets/forest/stones.glb',
    radius: 0.9,
    scale: [0.5, 2.4],
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

const SPAWN_CLEAR = 55;     // metres kept empty around map centre
const MIN_LAND_Y = WATER_LEVEL + 0.6;
const MAX_SLOPE = 0.55;     // normal.y below this = too steep to plant

/**
 * Deterministic placement plan. Returns placements (for rendering) and
 * colliders (for physics). Safe to call before any GLB is loaded.
 *
 * @returns {{placements: object[], colliders: {x:number,z:number,radius:number,kind:string}[]}}
 */
export function planVegetation() {
  const R = rand(rng(SEED));
  const placements = [];
  const colliders = [];

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
      /* Keep beach open and the spawn pad clear. */
      if (rr > beachStart - 12) continue;
      if (Math.hypot(x - CENTER.x, z - CENTER.z) < SPAWN_CLEAR) continue;
      /* No forest through metro houses / roads. */
      if (inCity(x, z)) continue;

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
        else if (roll < 0.84) kind = 'treeHigh';
        else kind = 'tree';
        /* Fewer trees on snowy tops. */
        if (y > 48 && (kind === 'tree' || kind === 'treeHigh') && R.chance(0.65)) continue;
      } else {
        /* Flats: trees, bushes, and scattered field rocks. */
        const roll = R.f();
        if (roll < 0.32) kind = 'plant';
        else if (roll < 0.58) kind = 'tree';
        else if (roll < 0.78) kind = 'treeHigh';
        else if (roll < 0.88) kind = 'stones';
        else if (roll < 0.95) kind = 'rocksLow';
        else kind = 'rocksRamp';
      }

      const def = KINDS[kind];
      let placement;
      if (def.rock) {
        const t = rockTransform(R, def.scale[0], def.scale[1]);
        const radius = def.radius * Math.max(t.sx, t.sz) * 0.75;
        placement = {
          kind, x, y, z,
          sx: t.sx, sy: t.sy, sz: t.sz,
          yaw: t.yaw, pitch: t.pitch, roll: t.roll,
        };
        colliders.push({ x, z, radius, kind });
      } else if (def.tallBias) {
        /* Trees: wide random height + slight trunk thickness variation. */
        const h = treeScale(R, def.scale[0], def.scale[1]);
        const fat = R.f(0.82, 1.18);   // canopy/trunk width jitter
        placement = {
          kind, x, y, z,
          sx: h * fat, sy: h, sz: h * fat,
          yaw: R.f(0, Math.PI * 2), pitch: 0, roll: 0,
        };
        colliders.push({ x, z, radius: def.radius * h * fat * 0.85, kind });
      } else {
        /* Bushes — visual only. */
        const s = R.f(def.scale[0], def.scale[1]);
        placement = {
          kind, x, y, z,
          sx: s * R.f(0.9, 1.15), sy: s, sz: s * R.f(0.9, 1.15),
          yaw: R.f(0, Math.PI * 2), pitch: 0, roll: 0,
        };
      }
      placements.push(placement);
    }
  }

  /* Extra plant belt around the central flats for bush cover. */
  const bushStep = 14;
  for (let ix = -FLAT_R * 1.6; ix <= FLAT_R * 1.6; ix += bushStep) {
    for (let iz = -FLAT_R * 1.6; iz <= FLAT_R * 1.6; iz += bushStep) {
      const x = CENTER.x + ix + (R.f() - 0.5) * bushStep;
      const z = CENTER.z + iz + (R.f() - 0.5) * bushStep;
      const dist = Math.hypot(x - CENTER.x, z - CENTER.z);
      if (dist < SPAWN_CLEAR || dist > FLAT_R * 1.55) continue;
      if (inCity(x, z)) continue;
      const y = heightAt(x, z);
      if (y < MIN_LAND_Y) continue;
      if (normalAt(x, z).y < 0.7) continue;
      if (!R.chance(0.32)) continue;
      const s = R.f(0.7, 2.2);
      placements.push({
        kind: 'plant', x, y, z,
        sx: s * R.f(0.85, 1.2), sy: s * R.f(0.75, 1.25), sz: s * R.f(0.85, 1.2),
        yaw: R.f(0, Math.PI * 2), pitch: 0, roll: 0,
      });
    }
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
      if (rr > beachStart - 18) continue;
      if (normalAt(x, z).y < 0.5) continue;
      const kinds = ['stones', 'rocksLow', 'rocksHigh', 'rocksRamp'];
      const kind = kinds[R.i(0, kinds.length - 1)];
      const def = KINDS[kind];
      const t = rockTransform(R, def.scale[0], def.scale[1]);
      placements.push({
        kind, x, y, z,
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
 * Load forest GLBs and build instanced meshes for the placement plan.
 * @param {object[]} placements
 * @returns {Promise<THREE.Group>}
 */
export async function buildVegetationMeshes(placements) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const root = new THREE.Group();
  root.name = 'vegetation';

  /* Group placements by kind. */
  const byKind = new Map();
  for (const p of placements) {
    let list = byKind.get(p.kind);
    if (!list) { list = []; byKind.set(p.kind, list); }
    list.push(p);
  }

  const dummy = new THREE.Object3D();

  await Promise.all([...byKind.entries()].map(async ([kind, items]) => {
    const def = KINDS[kind];
    if (!def || !items.length) return;
    let gltf;
    try {
      gltf = await loader.loadAsync(def.url);
    } catch (err) {
      console.warn('vegetation load failed', def.url, err);
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
    mesh.name = `veg-${kind}`;
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
  }));

  return root;
}

/**
 * Plan + collider grid. Call once at world build; meshes load separately.
 */
export function createVegetationSystem() {
  const { placements, colliders } = planVegetation();
  const grid = new ObstacleGrid(colliders);
  return { placements, colliders, grid };
}
