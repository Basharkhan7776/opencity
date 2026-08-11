/* The shared road helpers — the only pieces of the rally track (world/track.js)
 * the free-roam build still uses. Kept as a tiny module of their own so the
 * opencity runtime never loads the 2.5k-line rally track system; world/track.js
 * remains on disk for the tools that build it. Contents are byte-identical to
 * their origins there.
 */
import * as THREE from 'three';

export const STEP = 3;              // metres between centreline samples

export const EDGE_DROP = -0.5;

/** Slope of the last up-face segment. What the launch impulse is scaled by. */
const RAMP_PROFILE = [0, 0.007, 0.053, 0.178, 0.421, 0.822, 1.420, 0.710, 0];
const RAMP_LIP_I = 6;
export const RAMP_LIP_SLOPE =
  (RAMP_PROFILE[RAMP_LIP_I] - RAMP_PROFILE[RAMP_LIP_I - 1]) / STEP;

/** One sample of the stage: everything a car, a camera or a rock needs. */
export class Frame {
  constructor() {
    this.pos = new THREE.Vector3();
    this.tan = new THREE.Vector3();
    this.right = new THREE.Vector3();   // banked
    this.up = new THREE.Vector3();      // banked
    this.flatRight = new THREE.Vector3();
    this.s = 0; this.curv = 0; this.bank = 0; this.width = 0; this.grade = 0;
    this.bermL = 1; this.bermR = 1;     // berm height scale, per side
  }
}

export function mergeGeometries(list) {
  let total = 0, itotal = 0;
  for (const g of list) {
    total += g.attributes.position.count;
    itotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const hasCol = list.every(g => g.attributes.color);
  const col = hasCol ? new Float32Array(total * 3) : null;
  const idx = new Uint32Array(itotal);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nrm.set(n.array.subarray(0, n.count * 3), vo * 3);
    if (col && c) col.set(c.array.subarray(0, c.count * 3), vo * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo; }
    else { for (let i = 0; i < p.count; i++) idx[io++] = i + vo; }
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
