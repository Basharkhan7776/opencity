/* Continuous procedural roads — always interconnected.
 *
 * Built from a centerline graph (nodes + edges). Each edge becomes a
 * heightfield-following ribbon; each junction gets a pad. No Kenney tile
 * seams, so every link is water-tight by construction.
 */
import * as THREE from 'three';
import { heightAt } from './Island.js';
import { celMaterial } from '../render/cel.js';

const ROAD_COL = 0x3a3a40;
const MARK_COL = 0xe8e2d4;
const SHOULDER_COL = 0x5a554c;
const DECK = 0.06;           // sit slightly above grass to avoid z-fight

/**
 * @param {{nodes: {id,x,z}[], edges: {a,b,width,lanes}[]}} graph
 * @returns {THREE.Group}
 */
export function buildRoadNetworkMesh(graph) {
  const root = new THREE.Group();
  root.name = 'city-roads';

  /* Edges store numeric node ids; nodeMap is keyed by string position keys. */
  const byId = new Map();
  for (const n of graph.nodes) byId.set(n.id, n);

  const roadParts = [];
  const markParts = [];

  for (const e of graph.edges) {
    const na = byId.get(e.a);
    const nb = byId.get(e.b);
    if (!na || !nb) continue;
    const built = buildEdgeStrip(na.x, na.z, nb.x, nb.z, e.width, e.lanes || 1);
    if (built.road) roadParts.push(built.road);
    if (built.marks && built.marks.length) markParts.push(...built.marks);
  }

  /* Junction pads so T / + crossings are continuous. */
  for (const n of graph.nodes) {
    const deg = graph.degree.get(n.id) || 0;
    if (deg < 2) continue;
    const w = graph.nodeWidth.get(n.id) || 8;
    roadParts.push(buildPad(n.x, n.z, w * (deg >= 3 ? 1.05 : 0.95)));
  }

  if (roadParts.length) {
    const roadGeo = mergeGeos(roadParts);
    roadParts.forEach(g => g.dispose?.());
    const mesh = new THREE.Mesh(
      roadGeo,
      celMaterial({ color: ROAD_COL, vertexColors: true }),
    );
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'road-deck';
    root.add(mesh);
  }

  if (markParts.length) {
    const markGeo = mergeGeos(markParts);
    markParts.forEach(g => g.dispose?.());
    const mesh = new THREE.Mesh(
      markGeo,
      celMaterial({ color: MARK_COL, side: THREE.DoubleSide }),
    );
    mesh.name = 'road-marks';
    mesh.renderOrder = 1;
    root.add(mesh);
  }

  return root;
}

function buildEdgeStrip(x0, z0, x1, z1, width, lanes) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.4) return {};

  const tx = dx / len, tz = dz / len;
  const rx = -tz, rz = tx;           // right
  const half = width * 0.5;
  const steps = Math.max(2, Math.ceil(len / 4));

  const verts = [];
  const cols = [];
  const idx = [];
  const cRoad = new THREE.Color(ROAD_COL);
  const cSh = new THREE.Color(SHOULDER_COL);

  /* Cross-section samples: outer shoulder, edge, mid, centre… */
  const lat = [-half - 0.45, -half, -half * 0.35, 0, half * 0.35, half, half + 0.45];

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + dx * t;
    const z = z0 + dz * t;
    const y = heightAt(x, z) + DECK;
    for (let li = 0; li < lat.length; li++) {
      const l = lat[li];
      verts.push(x + rx * l, y, z + rz * l);
      const edge = Math.abs(l) >= half - 0.01;
      const c = edge ? cSh : cRoad;
      cols.push(c.r, c.g, c.b);
    }
  }

  const P = lat.length;
  for (let s = 0; s < steps; s++) {
    for (let e = 0; e < P - 1; e++) {
      const a = s * P + e, b = a + 1, c = a + P, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  road.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  road.setIndex(idx);
  road.computeVertexNormals();

  /* Paint: edge lines + dashed centre for 2-lane. */
  const marks = [];
  const yLift = DECK + 0.025;
  const edgeInset = half - 0.18;
  for (const side of [-1, 1]) {
    marks.push(lineStrip(
      x0 + rx * side * edgeInset, z0 + rz * side * edgeInset,
      x1 + rx * side * edgeInset, z1 + rz * side * edgeInset,
      yLift, 0.12,
    ));
  }
  if (lanes >= 2) {
    /* Dashed centre line. */
    const dash = 2.2, gap = 1.6;
    let d = 0;
    while (d < len - 0.5) {
      const d1 = Math.min(d + dash, len);
      const t0 = d / len, t1 = d1 / len;
      marks.push(lineStrip(
        x0 + dx * t0, z0 + dz * t0,
        x0 + dx * t1, z0 + dz * t1,
        yLift, 0.1,
      ));
      d += dash + gap;
    }
  }

  return { road, marks };
}

function lineStrip(x0, z0, x1, z1, yOff, width) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 0.01;
  const tx = dx / len, tz = dz / len;
  const rx = -tz * width * 0.5, rz = tx * width * 0.5;
  const y0 = heightAt(x0, z0) + yOff;
  const y1 = heightAt(x1, z1) + yOff;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([
    x0 - rx, y0, z0 - rz,
    x0 + rx, y0, z0 + rz,
    x1 + rx, y1, z1 + rz,
    x1 - rx, y1, z1 - rz,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function buildPad(x, z, half) {
  const y = heightAt(x, z) + DECK;
  const g = new THREE.BufferGeometry();
  const h = half;
  const pos = new Float32Array([
    x - h, y, z - h,
    x + h, y, z - h,
    x + h, y, z + h,
    x - h, y, z + h,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = new THREE.Color(ROAD_COL);
  g.setAttribute('color', new THREE.Float32BufferAttribute([
    c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function mergeGeos(list) {
  let vCount = 0, iCount = 0;
  let hasCol = true;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
    if (!g.attributes.color) hasCol = false;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const col = hasCol ? new Float32Array(vCount * 3) : null;
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nrm.set(n.array.subarray(0, p.count * 3), vo * 3);
    if (col && g.attributes.color) {
      col.set(g.attributes.color.array.subarray(0, p.count * 3), vo * 3);
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
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
