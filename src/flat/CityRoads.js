/* Continuous procedural roads — always interconnected.
 *
 * Built from a centerline graph (nodes + edges). Each edge becomes a raised
 * kerbed slab that follows the island heightfield. Junctions are OPEN in the
 * sense that the arms stop at the edge of the intersection and no kerb or
 * collider encloses it, but each intersection is filled with a flat road
 * plate so the grass does not show through, with a zebra crossing painted on
 * every approach. The deck faces up (front-side material) so the asphalt
 * renders, and the slab has real thickness: a top at DECK above the grass
 * with side walls down to BASE below it. The same strips feed a roadLift
 * lookup that lifts the physics heightfield onto the deck. Roads carry NO
 * colliders, so nothing stops the car at a crossing.
 */
import * as THREE from 'three';
import { heightAt } from './Island.js';
import { celMaterial } from '../render/cel.js';

const ROAD_COL = 0x3a3a40;      /* asphalt grey */
const MARK_COL = 0xe8e2d4;      /* warm asphalt paint */
const SHOULDER_COL = 0x6a635b;  /* kerb / verge stone */
const FOOT_COL = 0x9a9a9e;      /* concrete footpath grey */
export const FOOT_W = 2;        /* footpath width on each side of the kerb (m) */
export const DECK = 0.14;       /* deck top above the grass */
const BASE = 0.3;               /* slab hangs this far below ground */
const STEP = 6;                 /* station spacing along the centreline */
/* Zebra crossings at junctions: longitudinal stripes along the road direction
   (vertical relative to the road/driver view) strictly on the asphalt deck,
   staying clear of the kerbs and footpath. */
const ZEBRA_LEN = 3.0;          /* stripe length along the road direction (m) */
const ZEBRA_WIDTH = 0.5;        /* stripe width across the road (m) */
const ZEBRA_GAP = 0.5;          /* gap between stripes across the road (m) */
const ZEBRA_INSET = 0.6;        /* stripes stop short of asphalt road edge (m) */
const ZEBRA_START = 0.2;        /* offset from junction edge into the road arm (m) */
const ZEBRA_BAND = ZEBRA_START + ZEBRA_LEN + 0.3; /* clear zone for lane dashes (m) */

function makeGeo(pos, col, nor, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

function mergeGeos(list) {
  let vCount = 0, iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let v = 0, i = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, v * 3);
    col.set(g.attributes.color.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[i++] = gi[k] + v;
    v += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Per-node junction radius — how far each road arm stops short of the node so
 * intersections stay open (no connection pad). The widest incident road (half
 * width + shoulder) wins, so every arm clears the road it meets.
 */
function junctionRadius(graph) {
  const jr = new Map();
  for (const n of graph.nodes) jr.set(n.id, 0);
  for (const e of graph.edges) {
    const r = e.width * 0.5 + 0.45;
    jr.set(e.a, Math.max(jr.get(e.a) || 0, r));
    jr.set(e.b, Math.max(jr.get(e.b) || 0, r));
  }
  return jr;
}

/**
 * Spatial lookup: is a point inside any road slab? Returns metres above the
 * island surface (DECK) or 0. Query ~O(1) via a fixed cell hash.
 * @param {object} graph  road graph (nodes/edges)
 * @param {object[]} [placements]  city placements — platform podiums are
 *   lifted like the footpath so the car rides on them at deck height
 */
export function buildRoadLift(graph, placements) {
  const CELL = 48;
  const bins = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const put = (seg) => {
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / CELL) - 1;
    const x1 = Math.floor(Math.max(seg.ax, seg.bx) / CELL) + 1;
    const z0 = Math.floor(Math.min(seg.az, seg.bz) / CELL) - 1;
    const z1 = Math.floor(Math.max(seg.az, seg.bz) / CELL) + 1;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        const arr = bins.get(k);
        if (arr) arr.push(seg);
        else bins.set(k, [seg]);
      }
    }
  };
  const byId = new Map();
  for (const n of graph.nodes) byId.set(n.id, n);
  const jr = junctionRadius(graph);
  for (const e of graph.edges) {
    const na = byId.get(e.a), nb = byId.get(e.b);
    if (!na || !nb) continue;
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const tx = dx / len, tz = dz / len;
    /* Only real junctions (degree >= 3) open the road — straight-through
       nodes keep the arm continuous. */
    const da = graph.degree.get(e.a) || 0;
    const db = graph.degree.get(e.b) || 0;
    const ga = da >= 3 ? Math.min(jr.get(e.a) || 0, len * 0.45) : 0;
    const gb = db >= 3 ? Math.min(jr.get(e.b) || 0, len * 0.45) : 0;
    /* Same truncated spans the mesh uses, so the lift matches the deck —
       including the footpath, which is part of the slab. */
    put({
      ax: na.x + tx * ga, az: na.z + tz * ga,
      bx: nb.x - tx * gb, bz: nb.z - tz * gb,
      h: e.width * 0.5 + 0.45 + FOOT_W,
    });
  }
  /* Junction openings stay flat at deck height. The arm decks stop at the
     junction edge, and the climb budget in the car physics will not mount a
     0.14 m step, so the open intersection must be lifted too — the grass and
     zebra inside it are visual only. */
  for (const n of graph.nodes) {
    if ((graph.degree.get(n.id) || 0) < 3) continue;
    const r = jr.get(n.id) || 0;
    if (r > 0) put({ ax: n.x - r, az: n.z - r, bx: n.x + r, bz: n.z + r, box: true });
  }
  /* Building podiums: flat at deck height exactly like the footpath, so the
     car drives across them at the same level instead of hitting a step. */
  if (placements) {
    for (const p of placements) {
      if (p.kind !== 'platform') continue;
      const h = p.sx * 0.5;
      put({ ax: p.x - h, az: p.z - h, bx: p.x + h, bz: p.z + h, box: true });
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = bins.get(key(cx + i, cz + j));
        if (!arr) continue;
        for (const s of arr) {
          if (s.box) {
            if (x >= s.ax && x <= s.bx && z >= s.az && z <= s.bz) return DECK;
            continue;
          }
          const ex = s.bx - s.ax, ez = s.bz - s.az;
          const el = ex * ex + ez * ez;
          const t = el ? ((x - s.ax) * ex + (z - s.az) * ez) / el : 0;
          /* Points beyond either end are not on the slab — without this the
             rounded end cap of one arm reaches across the whole opening. */
          if (t < 0 || t > 1) continue;
          const px = s.ax + ex * t, pz = s.az + ez * t;
          const dx = x - px, dz = z - pz;
          if (dx * dx + dz * dz <= s.h * s.h) return DECK;
        }
      }
    }
    return 0;
  };
}

/**
 * One road arm: footpath + deck + side walls + dashed lane marks.
 * The footpath is a grey strip outside the kerb on both sides, part of the
 * same slab — so it follows the arm's truncation and never crosses a
 * junction opening. All geometry is triangulated in world space (no plane,
 * no transform).
 */
function buildSlab(x0, z0, x1, z1, width, lanes, openA, openB) {
  const half = width * 0.5;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return {};
  const tx = dx / len, tz = dz / len;
  const rx = -tz, rz = tx;   /* lat direction — negative side is "left" */
  const lats = [
    -half - 0.45 - FOOT_W, -half - 0.45, -half, -half * 0.35, 0,
    half * 0.35, half, half + 0.45, half + 0.45 + FOOT_W,
  ];
  const n = Math.max(3, Math.round(len / STEP) + 1);

  const dp = [], dc = [], dn = [], di = [];
  const wp = [], wc = [], wn = [], wi = [];
  const marks = [];
  const road = new THREE.Color(ROAD_COL);
  const kerb = new THREE.Color(SHOULDER_COL);
  const foot = new THREE.Color(FOOT_COL);
  /* Left wall faces -(rx,rz); right wall faces +(rx,rz). */
  const lOut = [rz, 0, -rx], rOut = [-rz, 0, rx];

  /* Miter the footpath at junction ends: the outer edge is cut back
     diagonally (FOOT_W over FOOT_W), so the footpaths of two perpendicular
     arms meet at the plate corner instead of overlapping. Straight-through
     (non-junction) ends keep the strip rectangular. */
  const miterShift = (ux) => {
    const rampA = openA ? Math.max(0, FOOT_W - (ux - x0)) : 0;
    const rampB = openB ? Math.max(0, FOOT_W - (x1 - ux)) : 0;
    return Math.max(rampA, rampB);
  };

  for (let i = 0; i < n; i++) {
    const ux = x0 + dx * (i / (n - 1));
    const uz = z0 + dz * (i / (n - 1));
    const g = heightAt(ux, uz);
    const sh = miterShift(ux);
    for (let s = 0; s < 9; s++) {
      const l = lats[s];
      const cut = (s === 0 || s === 8) ? sh : 0;
      dp.push(ux + tx * cut + rx * l, g + DECK, uz + tz * cut + rz * l);
      const c = Math.abs(l) >= half + 0.45 ? foot
        : Math.abs(l) >= half - 0.01 ? kerb : road;
      dc.push(c.r, c.g, c.b);
      dn.push(0, 1, 0);
    }
    /* Outer wall at the footpath edge — the kerb wall is now buried inside
       the slab, so the visible side face is the footpath's. Follows the
       mitered edge at junction ends. */
    for (const sgn of [-1, 1]) {
      const l = sgn * (half + 0.45 + FOOT_W);
      const px = ux + tx * sh + rx * l, pz = uz + tz * sh + rz * l;
      wp.push(px, g + DECK, pz);
      wp.push(px, g - BASE, pz);
      wc.push(foot.r, foot.g, foot.b, foot.r, foot.g, foot.b);
      wn.push(sgn < 0 ? lOut[0] : rOut[0], 0, sgn < 0 ? lOut[2] : rOut[2]);
      wn.push(sgn < 0 ? lOut[0] : rOut[0], 0, sgn < 0 ? lOut[2] : rOut[2]);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const a = i * 9 + s, b = i * 9 + s + 1;
      const c = (i + 1) * 9 + s, d = (i + 1) * 9 + s + 1;
      di.push(a, b, c, b, d, c);
    }
    const w0 = i * 4, w1 = (i + 1) * 4;
    wi.push(w0, w1, w0 + 1, w0 + 1, w1, w1 + 1);
    wi.push(w0 + 2, w0 + 3, w1 + 2, w0 + 3, w1 + 3, w1 + 2);
  }

  /* Dashes along the lane centres (up-facing, so they read from the car). */
  const dashW = 0.18;
  const laneAt = lanes > 1 ? [-half * 0.35, half * 0.35] : [0];
  for (const lc of laneAt) {
    for (let i = 0; i < n - 1; i += 2) {
      const u0 = i / (n - 1), u1 = (i + 1) / (n - 1);
      /* Leave the zebra bands at both ends clear of lane dashes. */
      if (u0 * len < ZEBRA_BAND || (1 - u1) * len < ZEBRA_BAND) continue;
      const pts = [], nrm = [];
      for (const u of [u0, u1]) {
        const cx = x0 + dx * u, cz = z0 + dz * u;
        const gy = heightAt(cx, cz) + DECK + 0.02;
        pts.push(cx + rx * (lc - dashW / 2), gy, cz + rz * (lc - dashW / 2));
        pts.push(cx + rx * (lc + dashW / 2), gy, cz + rz * (lc + dashW / 2));
        nrm.push(0, 1, 0, 0, 1, 0);
      }
      marks.push({ positions: pts, normals: nrm, indices: [0, 1, 2, 1, 3, 2] });
    }
  }

  return { road: makeGeo(dp, dc, dn, di), walls: makeGeo(wp, wc, wn, wi), marks };
}

/* Zebra crossing — painted longitudinal stripes across a road arm approach at a junction.
   Stripes run parallel to the road tangent (tx, tz) (vertical to the junction boundary /
   in the direction of traffic flow), flat on the deck (DECK + 0.02).
   They are laid across the road width within [-span, span] and stop safely short of the
   kerb and footpath (ZEBRA_INSET), ensuring no markings touch the footpath. */
function buildZebra(cx, cz, tx, tz, width) {
  const rx = -tz, rz = tx;
  const half = width * 0.5;
  const span = half - ZEBRA_INSET;
  const pos = [], nor = [], idx = [];
  let v = 0;

  const stride = ZEBRA_WIDTH + ZEBRA_GAP;
  const mMax = Math.floor((span - ZEBRA_WIDTH * 0.5) / stride);
  const s0 = ZEBRA_START;
  const s1 = ZEBRA_START + ZEBRA_LEN;

  for (let m = -mMax; m <= mMax; m++) {
    const lCenter = m * stride;
    const l0 = lCenter - ZEBRA_WIDTH * 0.5;
    const l1 = lCenter + ZEBRA_WIDTH * 0.5;

    const p00x = cx + tx * s0 + rx * l0, p00z = cz + tz * s0 + rz * l0;
    const p01x = cx + tx * s0 + rx * l1, p01z = cz + tz * s0 + rz * l1;
    const p10x = cx + tx * s1 + rx * l0, p10z = cz + tz * s1 + rz * l0;
    const p11x = cx + tx * s1 + rx * l1, p11z = cz + tz * s1 + rz * l1;

    const y00 = heightAt(p00x, p00z) + DECK + 0.02;
    const y01 = heightAt(p01x, p01z) + DECK + 0.02;
    const y10 = heightAt(p10x, p10z) + DECK + 0.02;
    const y11 = heightAt(p11x, p11z) + DECK + 0.02;

    pos.push(
      p00x, y00, p00z,
      p01x, y01, p01z,
      p10x, y10, p10z,
      p11x, y11, p11z,
    );
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    v += 4;
  }
  return { positions: pos, normals: nor, indices: idx };
}

/* Junction plate — flat road-colored square filling the open intersection so
   the grass does not show through. Visual only: no colliders (the physics
   lift already covers the opening), no kerb rim to catch the car. A
   shoulder-coloured ring matches the kerb strip of the arm decks. */
function buildJunctionPlate(cx, cz, r) {
  const xs = [-r, -r + 0.45, 0, r - 0.45, r];
  const n = xs.length;
  const pos = [], col = [], nor = [], idx = [];
  const road = new THREE.Color(ROAD_COL);
  const kerb = new THREE.Color(SHOULDER_COL);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos.push(cx + xs[i], heightAt(cx + xs[i], cz + xs[j]) + DECK, cz + xs[j]);
      c.copy(i === 0 || j === 0 || i === n - 1 || j === n - 1 ? kerb : road);
      col.push(c.r, c.g, c.b);
      nor.push(0, 1, 0);
    }
  }
  let v = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, c, d, b);
      v += 6;
    }
  }
  return makeGeo(pos, col, nor, idx);
}

/**
 * @param {{nodes: {id,x,z}[], edges: {a,b,width,lanes}[],
 *          degree: Map, nodeWidth: Map}} graph
 * @returns {{root: THREE.Group}}
 */
export function buildRoadNetworkMesh(graph) {
  const root = new THREE.Group();
  root.name = 'city-roads';

  const byId = new Map();
  for (const n of graph.nodes) byId.set(n.id, n);

  const mat = celMaterial({ color: ROAD_COL, vertexColors: true });
  const wallMat = celMaterial({ color: SHOULDER_COL, vertexColors: true });
  wallMat.side = THREE.DoubleSide;
  const markMat = new THREE.MeshBasicMaterial({
    color: MARK_COL,
    toneMapped: false,
    depthWrite: false,
  });

  const roadParts = [], wallParts = [], markParts = [];
  const jr = junctionRadius(graph);

  /* Road-colored plates fill every open intersection (the grass would
     otherwise show through). Visual only — no colliders, no kerb rim. */
  for (const n of graph.nodes) {
    if ((graph.degree.get(n.id) || 0) < 3) continue;
    const r = jr.get(n.id) || 0;
    if (r > 0) roadParts.push(buildJunctionPlate(n.x, n.z, r));
  }

  for (const e of graph.edges) {
    const na = byId.get(e.a), nb = byId.get(e.b);
    if (!na || !nb) continue;
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const tx = dx / len, tz = dz / len;
    /* Arms stop at the junction edge — each intersection is filled by a flat
       road plate rather than a kerbed connection pad. Only real junctions
       (degree >= 3) open the road; straight-through nodes keep the arm
       continuous. */
    const da = graph.degree.get(e.a) || 0;
    const db = graph.degree.get(e.b) || 0;
    const ga = da >= 3 ? Math.min(jr.get(e.a) || 0, len * 0.45) : 0;
    const gb = db >= 3 ? Math.min(jr.get(e.b) || 0, len * 0.45) : 0;
    const x0 = na.x + tx * ga, z0 = na.z + tz * ga;
    const x1 = nb.x - tx * gb, z1 = nb.z - tz * gb;
    const built = buildSlab(x0, z0, x1, z1, e.width, e.lanes || 1, ga > 0, gb > 0);
    if (built.road) roadParts.push(built.road);
    if (built.walls) wallParts.push(built.walls);
    if (built.marks && built.marks.length) markParts.push(...built.marks);
    /* Zebra crossing on each junction approach. */
    if (ga > 0) markParts.push(buildZebra(x0, z0, tx, tz, e.width));
    if (gb > 0) markParts.push(buildZebra(x1, z1, -tx, -tz, e.width));
  }

  if (roadParts.length) {
    const mesh = new THREE.Mesh(mergeGeos(roadParts), mat);
    mesh.name = 'road-deck';
    root.add(mesh);
    roadParts.forEach(g => g.dispose?.());
  }
  if (wallParts.length) {
    const mesh = new THREE.Mesh(mergeGeos(wallParts), wallMat);
    mesh.name = 'road-walls';
    root.add(mesh);
    wallParts.forEach(g => g.dispose?.());
  }
  if (markParts.length) {
    const markCol = new THREE.Color(MARK_COL);
    const geos = markParts.map(m => {
      const cols = [];
      for (let i = 0; i < m.positions.length / 3; i++) cols.push(markCol.r, markCol.g, markCol.b);
      return makeGeo(m.positions, cols, m.normals, m.indices);
    });
    const mesh = new THREE.Mesh(mergeGeos(geos), markMat);
    mesh.name = 'road-marks';
    root.add(mesh);
    geos.forEach(g => g.dispose?.());
  }
  return { root };
}
