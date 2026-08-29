/* The car.
 *
 * Lofted from cross-sections along its length rather than assembled from
 * boxes. A box car is instantly readable as a box car, and no amount of
 * shading rescues it; lofting costs about the same and gives real shoulders,
 * a tapering nose and a tucked-in sill — the shapes an outline pass has
 * something to draw around.
 *
 * Everything is one geometry with vertex colours, so the whole car is a single
 * draw call under a single cel material. The wheels are separate because they
 * spin, and the body is separate from the chassis root because the suspension
 * leans it.
 *
 * This car is a Range Rover-style luxury SUV: a tall, boxy two-box body with a
 * flat roof, a nearly vertical nose and tailgate, short overhangs, big wheels
 * and a high ride.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../core/frame.js';

/** A chamfered hexagonal section: flat floor, kicked-out shoulders, narrower roof. */
function section(hw, yBot, yTop, shoulder = 0.86, tuck = 0.9, shoulderY = 0.38) {
  const yMid = yBot + (yTop - yBot) * shoulderY;
  return [
    [-hw * tuck, yBot], [hw * tuck, yBot],
    [hw, yMid], [hw * shoulder, yTop],
    [-hw * shoulder, yTop], [-hw, yMid],
  ];
}

/**
 * Loft a closed profile along z.
 * @param {{z:number, pts:number[][], col:THREE.Color}[]} stations
 */
function loft(stations, { capFront = true, capBack = true } = {}) {
  const P = stations[0].pts.length;
  const verts = [], cols = [], idx = [];
  for (const st of stations) {
    for (const [x, y] of st.pts) {
      verts.push(x, y, st.z);
      cols.push(st.col.r, st.col.g, st.col.b);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let e = 0; e < P; e++) {
      const a = i * P + e, b = i * P + ((e + 1) % P);
      const c = a + P, d = b + P;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capFront) for (let e = 1; e < P - 1; e++) idx.push(0, e + 1, e);
  if (capBack) {
    const o = (stations.length - 1) * P;
    for (let e = 1; e < P - 1; e++) idx.push(o, o + e, o + e + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Bake a flat colour into every vertex of a geometry. */
function tint(g, col) {
  const c = col.isColor ? col : new THREE.Color(col);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A box with a colour baked into its vertices, positioned and rotated. */
function box(w, h, d, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return place(tint(new THREE.BoxGeometry(w, h, d), col), x, y, z, rx, ry, rz);
}

/** A short cylinder lying along z — lamps, hubs. */
function disc(r, depth, col, x, y, z, sides = 10) {
  const g = new THREE.CylinderGeometry(r, r, depth, sides, 1);
  g.rotateX(Math.PI / 2);
  return place(tint(g, col), x, y, z);
}

const PALETTES = [
  { body: 0x17171d, trim: 0x0e0e12, accent: 0x9aa0a8 },   // 0: Santorini Black SUV
  { body: 0x2f7fbd, trim: 0x22262b, accent: 0xe8e2d4 },   // 1: Byron Blue
  { body: 0xe0d24a, trim: 0x2b2620, accent: 0x37312c },   // 2: Ochre Gold
  { body: 0x63b562, trim: 0x232a24, accent: 0xf2efe4 },   // 3: Sage Green
  { body: 0xb9b4ad, trim: 0x2a2726, accent: 0xcf3f2f },   // 4: Yulong White
];

export const CAR = {
  length: 4.9, width: 2.16, wheelBase: 2.9,
  track: 1.62, wheelR: 0.50, wheelW: 0.38,
  rideHeight: 0.38,
};

/**
 * Build one car.
 * @returns {{root:THREE.Group, body:THREE.Group, wheels:THREE.Object3D[], steerWheels:THREE.Object3D[]}}
 */
export function buildCar(paletteIndex = 0) {
  const pal = PALETTES[paletteIndex % PALETTES.length];
  const body = new THREE.Color(pal.body);
  const shade = new THREE.Color(pal.body).multiplyScalar(0.72);
  const trim = new THREE.Color(pal.trim);
  const glass = new THREE.Color(0x41637f);
  const accent = new THREE.Color(pal.accent);

  const parts = [];

  /* ---- main shell -------------------------------------------------- */
  const S = (z, hw, yb, yt, sh, tk, col, shy) =>
    ({ z, pts: section(hw, yb, yt, sh, tk, shy), col: col || body });

  parts.push(loft([
    S(-2.42, 0.84, -0.26, 0.98, 0.97, 0.97, trim),     // front face
    S(-2.32, 0.88, -0.26, 0.98, 0.97, 0.97, trim),
    S(-2.10, 0.98, -0.26, 0.98, 0.97, 0.97, trim),
    S(-2.10, 0.98, -0.26, 0.98, 0.97, 0.97),            // hard break into body
    S(-1.45, 1.07, -0.26, 0.98, 0.97, 0.97),            // front axle
    S(0.00, 1.04, -0.26, 0.98, 0.97, 0.97),             // doors
    S(1.45, 1.07, -0.26, 0.98, 0.97, 0.97),             // rear axle
    S(2.10, 0.98, -0.26, 0.98, 0.97, 0.97),
    S(2.10, 0.98, -0.26, 0.98, 0.97, 0.97, trim),       // hard break into trim
    S(2.32, 0.88, -0.26, 1.00, 0.97, 0.97, trim),
    S(2.44, 0.84, -0.26, 1.00, 0.97, 0.97, trim),       // tail face
  ]));

  /* ---- greenhouse --------------------------------------------------- */
  const G = (z, hw, yb, yt, sh, col) => ({ z, pts: section(hw, yb, yt, sh, 0.98, 0.5), col: col || glass });
  parts.push(loft([
    G(-1.10, 0.62, 0.98, 1.10, 0.90, shade),           // cowl
    G(-0.95, 0.68, 0.98, 1.24, 0.90, shade),
    G(-0.95, 0.68, 0.98, 1.24, 0.90),                  // windshield bottom
    G(-0.25, 0.74, 0.98, 1.58, 0.92),                  // top of the screen
    G(1.70, 0.74, 0.98, 1.58, 0.92),                   // flat roof
    G(2.18, 0.66, 0.98, 1.28, 0.92),                   // rear screen
    G(2.18, 0.66, 0.98, 1.28, 0.92, shade),            // D-pillar seat
    G(2.30, 0.60, 0.98, 1.10, 0.92, shade),
  ]));

  /* Tailgate upper block */
  parts.push(box(1.28, 0.60, 0.14, body, 0, 1.31, 2.37));

  /* ---- Range Rover Front Nose & Grille ----------------------------- */
  // Dark Matrix Grille
  parts.push(box(0.84, 0.30, 0.06, 0x14100f, 0, 0.50, -2.44));
  // Vertical Grille Slats
  for (let i = 0; i < 5; i++) {
    const x = -0.34 + i * 0.17;
    parts.push(box(0.045, 0.28, 0.02, trim, x, 0.50, -2.47));
  }
  // Headlights & LED DRLs
  for (const sx of [-1, 1]) {
    parts.push(box(0.42, 0.14, 0.03, 0x161214, sx * 0.52, 0.78, -2.44));
    parts.push(box(0.38, 0.10, 0.05, accent, sx * 0.52, 0.78, -2.455));
  }
  // Front Bumper & Skid Plate
  parts.push(box(1.00, 0.32, 0.26, trim, 0, 0.05, -2.46));
  parts.push(box(0.72, 0.10, 0.05, 0x8a8f98, 0, -0.09, -2.47));

  /* ---- Side Range Rover Details ------------------------------------- */
  for (const sx of [-1, 1]) {
    // Signature Vertical Front Door Vent Blade
    parts.push(box(0.025, 0.30, 0.14, accent, sx * 1.05, 0.48, -0.80));
    // Flush Door Handles
    parts.push(box(0.02, 0.04, 0.14, accent, sx * 1.05, 0.68, -0.20));
    parts.push(box(0.02, 0.04, 0.14, accent, sx * 1.05, 0.68, 0.70));
    // Side Mirrors at A-pillar base
    parts.push(box(0.20, 0.12, 0.12, body, sx * 0.95, 0.82, -0.90));
  }

  /* ---- Rear Tailgate & Light Details -------------------------------- */
  // Tailgate Accent Bar
  parts.push(box(1.24, 0.04, 0.04, accent, 0, 0.88, 2.44));
  // 3D Taillights
  for (const sx of [-1, 1]) {
    parts.push(box(0.30, 0.14, 0.04, 0x161214, sx * 0.58, 0.86, 2.44));
    parts.push(box(0.26, 0.10, 0.06, 0xf04a2a, sx * 0.58, 0.86, 2.455));
  }
  // License Plate
  parts.push(box(0.40, 0.14, 0.04, 0xf0f2f5, 0, 0.48, 2.455));
  // Rear Bumper
  parts.push(box(1.00, 0.32, 0.26, trim, 0, 0.05, 2.46));
  // Dual Exhaust Outlets
  for (const sx of [-1, 1]) {
    parts.push(disc(0.085, 0.14, 0x5a5a5e, sx * 0.32, -0.04, 2.66));
  }

  const shell = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  shell.computeVertexNormals();

  const bodyGroup = new THREE.Group();
  bodyGroup.add(new THREE.Mesh(shell));   // material assigned by the caller
  bodyGroup.children[0].castShadow = true;
  bodyGroup.children[0].name = 'shell';

  /* ---- wheels ---------------------------------------------------------
     Sixteen-sided cylinder with 5 radial spokes and inset silver rim face. */
  const wheels = [], steerWheels = [];
  const R = CAR.wheelR, W = CAR.wheelW;

  const axle = g => { g.rotateZ(Math.PI / 2); return g; };
  const tyreGeo = tint(axle(new THREE.CylinderGeometry(R, R, W, 16, 1)), 0x1d1a1c);
  const rimGeo = tint(axle(new THREE.CylinderGeometry(R * 0.64, R * 0.64, W * 1.04, 16, 1)),
    new THREE.Color(pal.accent).multiplyScalar(0.35));
  const faceGeo = tint(axle(new THREE.CylinderGeometry(R * 0.56, R * 0.56, W * 1.08, 16, 1)), pal.accent);
  const hubGeo = tint(axle(new THREE.CylinderGeometry(R * 0.17, R * 0.17, W * 1.16, 8, 1)), 0x201d1e);

  const wheelParts = [tyreGeo, rimGeo, faceGeo, hubGeo];
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2;
    const spoke = tint(new THREE.BoxGeometry(0.10, R * 0.56, 0.12), 0x201d1e);
    spoke.rotateX(a);
    spoke.translate(0, Math.cos(a) * R * 0.20, Math.sin(a) * R * 0.20);
    wheelParts.push(spoke);
  }

  for (let i = 0; i < 4; i++) {
    const front = i < 2, left = i % 2 === 0;
    const wheelGeo = mergeGeometries(wheelParts.map(g => g.clone()));
    wheelGeo.computeVertexNormals();
    const mesh = new THREE.Mesh(wheelGeo);
    mesh.castShadow = true;
    mesh.name = `wheel${i}`;

    const hub = new THREE.Group();
    hub.position.set(
      (left ? -1 : 1) * CAR.track * 0.44,
      CAR.wheelR,
      front ? -CAR.wheelBase * 0.5 : CAR.wheelBase * 0.5);
    const spin = new THREE.Group();
    spin.add(mesh);
    hub.add(spin);
    hub.userData.spin = spin;
    hub.userData.front = front;
    wheels.push(hub);
    if (front) steerWheels.push(hub);
  }
  wheelParts.forEach(g => g.dispose());

  const root = new THREE.Group();
  root.add(bodyGroup);
  for (const w of wheels) root.add(w);

  return { root, body: bodyGroup, wheels, steerWheels, palette: pal };
}

/**
 * Construct a car view hierarchy from a loaded GLTF scene and wheel assets with JSON configuration.
 * @param {object} gltf - Loaded GLTF object from GLTFLoader
 * @param {object|THREE.Group} [wheelGltfOrMap=null] - Optional separate wheel GLTF or { front, back } map
 * @param {object} [config={}] - Vehicle configuration object from JSON
 * @returns {{root:THREE.Group, body:THREE.Group, wheels:THREE.Object3D[], steerWheels:THREE.Object3D[], palette:object, groundLift:number, rideHeight:number, wheelRadius:number, wheelBase:number, config:object}}
 */
export function buildCarFromGLTF(gltf, wheelGltfOrMap = null, config = {}) {
  const scene = gltf.scene.clone(true);
  scene.updateMatrixWorld(true);
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();

  let bodyNode = null;
  const wheelNodes = {
    'wheel-front-left': null,
    'wheel-front-right': null,
    'wheel-back-left': null,
    'wheel-back-right': null,
  };

  scene.traverse(child => {
    const name = (child.name || '').toLowerCase();
    if (name.includes('body') || name.includes('chassis')) {
      bodyNode = child;
    } else if (name.includes('wheel')) {
      if (name.includes('front') && name.includes('left')) wheelNodes['wheel-front-left'] = child;
      else if (name.includes('front') && name.includes('right')) wheelNodes['wheel-front-right'] = child;
      else if (name.includes('back') && name.includes('left')) wheelNodes['wheel-back-left'] = child;
      else if (name.includes('back') && name.includes('right')) wheelNodes['wheel-back-right'] = child;
    }
  });

  const wp = key => {
    const w = wheelNodes[key];
    return w ? w.getWorldPosition(new THREE.Vector3()) : null;
  };
  const fz = ((wp('wheel-front-left')?.z || 0) + (wp('wheel-front-right')?.z || 0)) / 2;
  const bz = ((wp('wheel-back-left')?.z || 0) + (wp('wheel-back-right')?.z || 0)) / 2;
  const bakedWheelbase = Math.abs(fz - bz) || 1;

  const targetWheelbase = config.wheelbase || CAR.wheelBase;
  const k = targetWheelbase / bakedWheelbase;

  const bakedHalfTrack = (() => {
    let s = 0, n = 0;
    for (const key of Object.keys(wheelNodes)) {
      const p = wp(key);
      if (p) { s += Math.abs(p.x); n++; }
    }
    return n ? s / n : 0;
  })();

  const outwardF = config.wheelOutwardOffsetFront ?? config.wheelOutwardOffset ?? 0;
  const outwardR = config.wheelOutwardOffsetRear ?? config.wheelOutwardOffset ?? 0;

  const halfTrackF = (config.trackFront ? config.trackFront * 0.5 : (config.track ? config.track * 0.5 : (bakedHalfTrack * k * TRACK_GAIN || CAR.track * 0.5))) + outwardF;
  const halfTrackR = (config.trackRear ? config.trackRear * 0.5 : (config.track ? config.track * 0.5 : (bakedHalfTrack * k * TRACK_GAIN || CAR.track * 0.5))) + outwardR;

  for (const key of Object.keys(wheelNodes)) {
    if (wheelNodes[key]) wheelNodes[key].removeFromParent();
  }

  const bodyScale = config.bodyScale !== undefined ? (typeof config.bodyScale === 'number' ? config.bodyScale : 1.0) : 1.0;
  if (bodyNode) bodyNode.scale.multiplyScalar(k * bodyScale);

  const shellWrap = new THREE.Group();
  const bodyOffset = config.bodyOffset || { x: 0, y: 0, z: 0 };

  if (bodyNode) {
    const bottom = new THREE.Box3().setFromObject(bodyNode).min.y;
    shellWrap.position.set(bodyOffset.x || 0, -0.26 - bottom + (bodyOffset.y || 0), bodyOffset.z || 0);
    if (fz > bz) shellWrap.rotation.y = Math.PI;
    if (config.bodyRotationY) shellWrap.rotation.y += config.bodyRotationY;
    shellWrap.add(bodyNode);
    bodyGroup.add(shellWrap);
  } else {
    shellWrap.position.set(bodyOffset.x || 0, bodyOffset.y || 0, bodyOffset.z || 0);
    shellWrap.add(scene);
    bodyGroup.add(shellWrap);
  }

  root.add(bodyGroup);

  const wheelRadiusF = config.wheelRadiusFront || config.wheelRadius || CAR.wheelR;
  const wheelRadiusR = config.wheelRadiusRear || config.wheelRadius || CAR.wheelR;
  const wheelScaleF = config.wheelScaleFront || config.wheelScale || 1.0;
  const wheelScaleR = config.wheelScaleRear || config.wheelScale || 1.0;

  const wheels = [];
  const steerWheels = [];
  const positions = [
    { front: true, left: true, key: 'wheel-front-left' },
    { front: true, left: false, key: 'wheel-front-right' },
    { front: false, left: true, key: 'wheel-back-left' },
    { front: false, left: false, key: 'wheel-back-right' },
  ];

  positions.forEach(({ front, left, key }) => {
    const hub = new THREE.Group();
    const halfTrack = front ? halfTrackF : halfTrackR;
    const wheelR = front ? wheelRadiusF : wheelRadiusR;
    const wheelScale = front ? wheelScaleF : wheelScaleR;

    hub.position.set(
      (left ? -1 : 1) * halfTrack,
      wheelR,
      front ? -targetWheelbase * 0.5 : targetWheelbase * 0.5
    );

    const spin = new THREE.Group();
    let wheelMesh = null;

    if (wheelGltfOrMap) {
      const srcGltf = (front && wheelGltfOrMap.front) ? wheelGltfOrMap.front
        : (!front && wheelGltfOrMap.back) ? wheelGltfOrMap.back
        : (wheelGltfOrMap.scene ? wheelGltfOrMap : null);
      if (srcGltf?.scene) {
        wheelMesh = srcGltf.scene.clone(true);
        wheelMesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(wheelMesh);
        const center = box.getCenter(new THREE.Vector3());
        wheelMesh.position.sub(center);
        wheelMesh.scale.setScalar(wheelScale);
        // Outer wheel face is on +X in raw GLB:
        // Left wheel (at -X) rotates 180° around Y (Math.PI) to face outward (-X).
        // Right wheel (at +X) rotates 0° to face outward (+X).
        wheelMesh.rotation.y = left ? Math.PI : 0;
      }
    }

    if (!wheelMesh) {
      const rawWheel = wheelNodes[key];
      if (rawWheel) {
        rawWheel.position.set(0, 0, 0);
        rawWheel.scale.multiplyScalar(k * wheelScale);
        rawWheel.rotation.y = left ? Math.PI : 0;
        const box = new THREE.Box3().setFromObject(rawWheel);
        spin.position.y = -box.min.y - wheelR;
        wheelMesh = rawWheel;
      }
    }

    if (wheelMesh) {
      spin.add(wheelMesh);
    }

    hub.add(spin);
    hub.userData.spin = spin;
    hub.userData.front = front;
    hub.userData.left = left;
    hub.userData.wheelRadius = wheelR;

    wheels.push(hub);
    if (front) steerWheels.push(hub);
    root.add(hub);
  });

  const groundLift = config.groundLift !== undefined ? config.groundLift : 0.15;
  const rideHeight = config.groundClearance || config.rideHeight || CAR.rideHeight;

  return {
    root,
    body: bodyGroup,
    wheels,
    steerWheels,
    palette: PALETTES[0],
    groundLift,
    rideHeight,
    wheelRadius: config.wheelRadius || CAR.wheelR,
    wheelBase: targetWheelbase,
    config,
  };
}

/**
 * Asynchronously load a car GLB asset and its wheels with JSON configuration.
 * @param {string|object} configOrUrl - Path to GLB file or vehicle JSON configuration object
 * @param {string|object} [wheelOpt=null] - Optional path to wheel GLB or { front, back }
 * @returns {Promise<{root:THREE.Group, body:THREE.Group, wheels:THREE.Object3D[], steerWheels:THREE.Object3D[], palette:object, groundLift:number, rideHeight:number, wheelRadius:number, wheelBase:number, config:object}>}
 */
export async function loadCarGLB(configOrUrl = '/assets/vehicle/race.glb', wheelOpt = null) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  const config = typeof configOrUrl === 'string'
    ? { url: configOrUrl, wheel: wheelOpt }
    : { ...configOrUrl };

  const bodyPromise = loader.loadAsync(config.url || '/assets/vehicle/race.glb');

  let wheelPromise = null;
  if (config.wheel) {
    if (typeof config.wheel === 'string') {
      wheelPromise = loader.loadAsync(config.wheel).catch(() => null);
    } else if (typeof config.wheel === 'object') {
      const pFront = config.wheel.front ? loader.loadAsync(config.wheel.front).catch(() => null) : null;
      const pBack = config.wheel.back ? loader.loadAsync(config.wheel.back).catch(() => null) : null;
      wheelPromise = Promise.all([pFront, pBack]).then(([front, back]) => ({ front, back }));
    }
  }

  const [bodyGltf, wheelGltfOrMap] = await Promise.all([bodyPromise, wheelPromise]);
  return buildCarFromGLTF(bodyGltf, wheelGltfOrMap, config);
}
