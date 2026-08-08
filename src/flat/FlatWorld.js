/* The flat world: a square playground, a cross of two-lane avenues, a few
 * markings, and the same light rig the rally stage used, so the cel look
 * carries over.
 *
 * The layout is a plus seen from above. A horizontal avenue runs the length
 * of the endless road (+X, the one Car.physics.js drives); a vertical avenue
 * crosses it at the far side of the loop. Each avenue is split down its
 * middle by a footpath median, which stops short of the meeting square so
 * the intersection is open tarmac. Everything sits inside a recessed square
 * plaza that reads as the playground.
 *
 * Every strip uses the physics' own crown term — y = -0.5·u³ across the
 * tarmac (u = |lat| / halfWidth), flat at -0.5 m past the edge — exactly
 * what Car.surfaceAt returns, so the tyres sit on the mesh they are drawn
 * on. The plaza is sunk below the crown's lowest point so no road is
 * clipped by it.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../world/track.js';
import { celMaterial, unlitCelMaterial } from '../render/cel.js';
import { ROAD_WIDTH, LOOP, MEDIAN } from './FlatTrack.js';

const ROAD = new THREE.Color(0x514c47);      // tarmac
const SHOULDER = new THREE.Color(0x7a6f5e);  // dirt verge
const GROUND = 0xb98d5f;                     // desert floor
const PLAZA = 0x5f9e5f;                      // square playground
const FOOTPATH = new THREE.Color(0xa99a8f);  // concrete footpath
const CURB = new THREE.Color(0x7f7669);      // kerb beside the footpath
const LINE = 0xe9e2d4;                       // markings
const EDGE_DROP = -0.5;

/* Cross-section geometry. The tarmac is ROAD_WIDTH wide, crowned to
   EDGE_DROP at its edges; the shoulders carry the crown out to the floor at
   EDGE_DROP; and the central MEDIAN band is a footpath with a kerb on each
   side. Samples sit exactly on every colour boundary so the bands are
   crisp. */
const HALF = ROAD_WIDTH * 0.5;      // 5.5
const MB = MEDIAN * 0.5;            // 1.1  — halfway to the median
const MC = 0.18;                    // kerb band width
const MCI = MB - MC;                // 0.92 — footpath reach
const MCO = MB + MC;                // 1.28 — kerb reach
const CROWN = (lat => {
  const u = Math.min(Math.abs(lat) / HALF, 1);
  return EDGE_DROP * u * u * u;
});
const XS = [-8.5, -HALF, -3.9, -2.3, -MCO, -MB, -MCI, -0.45, 0, 0.45, MCI, MB, MCO, 2.3, 3.9, HALF, 8.5];

/* Where the two avenues meet — the far side of the endless loop — and the
   half-size of the meeting square. The footpath median is cut open there. */
const INTER_X = LOOP * 0.5;
const BOX = HALF + 0.3;             // 5.8 — half the intersection square

const PLAZA_HALF = 996;             // half-side of the square playground
const EDGE = 6;                     // kerb-line inset from the tarmac edge

function stripColor(lat) {
  const a = Math.abs(lat);
  if (a <= MCI) return FOOTPATH;
  if (a <= MCO) return CURB;
  if (a <= HALF) return ROAD;
  return SHOULDER;
}

/* Builds one crowned strip. `stations` is a list of positions along the
   strip's travel axis; `at(s, lat)` yields the world x and z of a sample,
   and `colour(lat, s)` picks the vertex colour so the median can be cut open
   at the crossing. Consecutive stations are always joined, so dropping a
   station leaves a clean gap (the crossing square is built that way). */
function buildStrip(stations, at, colour) {
  const verts = [], cols = [], idx = [];
  const rows = [];
  for (const s of stations) {
    const v = [];
    for (const lat of XS) {
      const p = at(s, lat);
      v.push([p.x, CROWN(lat), p.z]);
      const c = colour(lat, s);
      cols.push(c.r, c.g, c.b);
    }
    rows.push(v);
  }
  for (const row of rows) for (const [x, y, z] of row) verts.push(x, y, z);
  const P = XS.length;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let e = 0; e < P - 1; e++) {
      const a = i * P + e, b = a + 1, c = a + P, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Horizontal road: the whole loop, one pass every 12 m. */
function horizontalStations() {
  const s = [];
  for (let i = 0; i <= LOOP / 12; i++) s.push(Math.min(i * 12, LOOP));
  return s;
}
/* Vertical road: two clean segments beyond the intersection — the cross is
   left open — one pass every 6 m so the arm reaches right up to the square. */
function verticalStations() {
  const s = [];
  for (let z = -PLAZA_HALF; z <= -EDGE + 1; z += 6) s.push(z);
  for (let z = EDGE; z <= PLAZA_HALF; z += 6) s.push(z);
  return s;
}

function buildHorizontal() {
  return buildStrip(horizontalStations(),
    (s, lat) => ({ x: s, z: lat }),
    (lat, s) =>
      Math.abs(s - INTER_X) <= BOX && Math.abs(lat) <= MCO ? ROAD : stripColor(lat));
}
function buildVertical() {
  return buildStrip(verticalStations(),
    (s, lat) => ({ x: INTER_X + lat, z: s }),
    (lat) => stripColor(lat));
}

function buildRoadMesh() {
  const merged = mergeGeometries([buildVertical(), buildHorizontal()]);
  return merged;
}

/* Markings: solid kerb-edge lines down both avenues plus a zebra crosswalk
   across each carriageway where the footpath median stops at the square. */
function buildMarkings() {
  const parts = [];
  const edge = HALF - 0.45;   // solid line just inside the tarmac edge
  const kerb = MB + 0.24;    // solid line just outside the median kerb

  /* Horizontal avenue: full-loop edge and kerb lines, cut at the box. */
  for (const [a, b] of [[0, INTER_X - BOX], [INTER_X + BOX, LOOP]]) {
    for (const lat of [-edge, -kerb, kerb, edge]) {
      const line = new THREE.PlaneGeometry(Math.max(0, b - a), 0.16);
      line.rotateX(-Math.PI / 2);
      line.translate((a + b) * 0.5, 0.02, lat);
      parts.push(line);
    }
  }
  /* Vertical road: the two arms reaching the box, same four lines, each
     line centred on its own arm segment. */
  for (const [a, b] of [[-PLAZA_HALF + 1, -EDGE], [EDGE, PLAZA_HALF]]) {
    for (const lat of [-edge, -kerb, kerb, edge]) {
      const line = new THREE.PlaneGeometry(0.16, Math.max(0, b - a));
      line.rotateX(-Math.PI / 2);
      line.translate(INTER_X + lat, 0.02, (a + b) * 0.5);
      parts.push(line);
    }
  }

    /* Zebra crosswalk across each approach, just inside the intersection's
     open tarmac (the median is cut here, so nothing is painted over the
     footpath). Five bars, thin in the travel direction, long across the
     road. */
  const WIDE = 2 * (HALF - 0.8);   // road width less a shoulder margin
  const addZebraX = x0 => {
    for (let k = 0; k < 5; k++) {
      const bar = new THREE.PlaneGeometry(0.5, WIDE);
      bar.rotateX(-Math.PI / 2);
      bar.translate(x0 + k * 0.7, 0.03, 0);
      parts.push(bar);
    }
  };
  for (const d of [-1, 1]) addZebraX(INTER_X + d * (BOX - 1.0));
  const addZebraZ = z0 => {
    for (let k = 0; k < 5; k++) {
      const bar = new THREE.PlaneGeometry(WIDE, 0.5);
      bar.rotateX(-Math.PI / 2);
      bar.translate(INTER_X, 0.03, z0 + k * 0.7);
      parts.push(bar);
    }
  };
  for (const d of [-1, 1]) addZebraZ(d * (EDGE - 1.0));

  const merged = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return merged;
}

/**
 * @returns {{root:THREE.Group, sun:THREE.DirectionalLight,
 *            fill:THREE.DirectionalLight}}
 */
export function buildFlatWorld({ shadowSize = 4096, shadowDist = 46 } = {}) {
  const root = new THREE.Group();
  root.name = 'flatworld';

  const roadMat = celMaterial({ vertexColors: true });
  const road = new THREE.Mesh(buildRoadMesh(), roadMat);
  road.receiveShadow = true;
  road.name = 'road';
  root.add(road);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(180000, 180000),
    celMaterial({ color: GROUND }),
  );
  ground.rotateX(-Math.PI / 2);
  ground.position.set(INTER_X, EDGE_DROP, 0); // floor meets the road shoulder
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);

  /* The square playground: a recessed court the cross of roads sits in.
     Its floor sits a hair below the physics surface, so driving off the
     tarmac is seamless — just clear of the ground plane to avoid coplanar
     z-fighting. */
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(PLAZA_HALF * 2, PLAZA_HALF * 2),
    celMaterial({ color: PLAZA }),
  );
  plaza.rotateX(-Math.PI / 2);
  plaza.position.set(INTER_X, EDGE_DROP - 0.05, 0);
  plaza.receiveShadow = true;
  plaza.name = 'plaza';
  root.add(plaza);

  const lines = new THREE.Mesh(
    buildMarkings(),
    unlitCelMaterial({ color: LINE, side: THREE.DoubleSide }),
  );
  lines.name = 'line';
  root.add(lines);

  /* ---- the light rig, copied from the rally stage -------------------- */
  const sun = new THREE.DirectionalLight(0xffe6bd, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const cam = sun.shadow.camera;
  cam.left = -shadowDist; cam.right = shadowDist;
  cam.top = shadowDist; cam.bottom = -shadowDist;
  cam.near = 40; cam.far = 520;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.085;
  root.add(sun);
  root.add(sun.target);

  const fill = new THREE.DirectionalLight(0x93a9e6, 0.45);
  fill.position.set(150, 56, -165);
  root.add(fill);
  root.add(fill.target);

  const fillB = new THREE.DirectionalLight(0x8fb0cf, 0.26);
  fillB.position.set(-165, 74, -150);
  root.add(fillB);
  root.add(fillB.target);

  root.add(new THREE.HemisphereLight(0xa9d2ff, 0x3d5058, 2.4));

  return { root, sun, fill };
}