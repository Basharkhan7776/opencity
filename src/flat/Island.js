/* Island heightfield and mesh for the free-roam playground.
 *
 * One pure function — heightAt(x, z) — builds both the visible mesh and the
 * surface the car samples. That is the only way the tyres sit on what is
 * drawn rather than floating above or sinking into the hills.
 *
 * The island fills the same square as the old flat plaza (PLAZA_HALF * 2 on
 * each side), centred at (INTER_X, 0). Sea level is y = 0; land rises above
 * it with flats near the centre, ridges and mountains inland, and a beach
 * ring at the shore.
 *
 * Vertex colours paint biomes: green grass, yellow beach, white snow peaks.
 */
import * as THREE from 'three';
import { fbm2 } from '../core/rng.js';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { celMaterial } from '../render/cel.js';

/* Matches FlatTrack.LOOP / 2 so the island sits on the same square the old
   plaza used. Kept local to avoid a circular import with FlatTrack. */
export const PLAZA_HALF = 996;            // same footprint as the old square
export const INTER_X = 3000;              // LOOP * 0.5 — plaza centre on +X
export const CENTER = Object.freeze({ x: INTER_X, z: 0 });
export const WATER_LEVEL = 0;
export const SEAFLOOR = -6;

/* Grass palette — several greens so flats read as meadow, not a flat stamp. */
const GRASS_PALETTE = [
  new THREE.Color(0x5cb050),  // bright spring
  new THREE.Color(0x4a9a42),  // mid lawn
  new THREE.Color(0x3d7f36),  // deep meadow
  new THREE.Color(0x6aad3a),  // yellow-green
  new THREE.Color(0x2f6b32),  // dark pine shadow
  new THREE.Color(0x7ab84a),  // sunlit lime
  new THREE.Color(0x4f7a3c),  // olive
];
const BEACH = new THREE.Color(0xe8c96a);
/* Ice on the tallest peak's crown — a cooler, more glassy white than the
   old snow band, and only the one mountain crosses the line for it. */
const ICE = new THREE.Color(0xd8ecfc);
/* The ice line: land above this height turns white. No terrain reaches it
   any more (the peaks are cut flat), but the constant stays — vegetation
   uses it to cap the grove trees at the old snowline. */
export const ICE_AT = 84;
const WATER_COLOR = 0x2a6e9a;
const _cA = new THREE.Color();
const _cB = new THREE.Color();

const SEED = 17;
const landNoise = fbm2(SEED * 101 + 3, 4);
const ridgeNoise = fbm2(SEED * 107 + 19, 3);
const coastNoise = fbm2(SEED * 113 + 7, 3);
const detailNoise = fbm2(SEED * 131 + 41, 2);
const paintNoise = fbm2(SEED * 149 + 3, 2);
const patchNoise = fbm2(SEED * 163 + 11, 3);   // large grass patches
const grainNoise = fbm2(SEED * 181 + 7, 2);    // fine grass speckles
const spotNoise = fbm2(SEED * 197 + 23, 2);    // clumpy grass spots

/* Soft island radius. Beaches live near the edge; interior stays well above
   water so the spawn pad is dry and driveable. The +500 m extension is
   reverted, so the island is back to the original footprint. */
export const ISLAND_R = PLAZA_HALF * 0.92 + 60; // ~976 m
/* Metres of beach slope, 80 m wider than the original 70 so the strip from
   the coast ring road to the ocean line is ~174 m of sand. */
export const BEACH_IN = 150;
export const FLAT_R = 180;                      // central flats radius
/* Coast ring road sits this far inside the beach band; the beach itself
   starts there so the strip seaward of the road reads as sand, not grass. */
export const COAST_ROAD_INSET = 24;

/* City footprint — flattened plateau so continuous roads + buildings share
   height with free-roam physics. Radii sized for vehicle-relative buildings. */
export const METRO_R = 280;                     // 2-lane metro core
export const RESIDENTIAL_R = 520;               // 1-lane houses + fences
export const CITY_BASE_Y = 5.2;                 // plateau height (matches pad)
/* Legacy aliases (layout now uses METRO_STEP / RES_STEP in CityLayout). */
export const TILE = 18;
export const MESH_SCALE = 5;

/**
 * 0..1 how hard the terrain is flattened for the city.
 * Full in metro/residential, blends out before the wild hills / beach.
 */
export function cityFlatten(x, z) {
  const rr = Math.hypot(x - CENTER.x, z - CENTER.z);
  /* Solid plateau through residential; soft skirt so mountains still rise. */
  return 1 - smoothstep(RESIDENTIAL_R * 0.88, RESIDENTIAL_R * 1.12, rr);
}

/** True when a point is inside the built city (for vegetation skip, etc.). */
export function inCity(x, z) {
  return cityFlatten(x, z) > 0.35;
}

/** Former mountain peak sites — kept as anchors for the mountain-tree groves
 *  and scatter gates. The terrain no longer raises them: every summit is cut
 *  to road height, so the island is flat outside the city. */
export const PEAKS = Object.freeze([
  { x: CENTER.x + 480, z:  360, h: 72,  r: 210 },
  { x: CENTER.x - 460, z: -380, h: 120, r: 250 },
  { x: CENTER.x - 220, z:  560, h: 66,  r: 160 },
]);

/** Shoreline parameters at (x, z). */
export function coastAt(x, z) {
  const dx = x - CENTER.x;
  const dz = z - CENTER.z;
  const rr = Math.hypot(dx, dz);
  const coastWarp = (coastNoise(x / 220, z / 220) - 0.5) * 95;
  const edge = ISLAND_R + coastWarp;
  const beachStart = edge - BEACH_IN;
  return { rr, edge, beachStart, dx, dz };
}

/**
 * Sample land height at world (x, z). Below water outside the island mask.
 * Shared by mesh vertices and Car.surfaceAt — never diverge the two.
 */
export function heightAt(x, z) {
  const { rr, edge, beachStart } = coastAt(x, z);

  /* Outside the island: seafloor, gently sloping deeper. */
  if (rr >= edge + 40) {
    return SEAFLOOR - Math.min(8, (rr - edge - 40) * 0.02);
  }

  /* Base inland terrain: gentle rolls + ridge lines + a few mountain peaks. */
  const n = landNoise(x / 160, z / 160);
  const n2 = landNoise(x / 90 + 40, z / 90 - 20);
  const ridge = ridgeNoise(x / 280 + 5, z / 55);   // elongated in z → ridge runs
  const ridge2 = ridgeNoise(x / 60, z / 320 - 8);

  /* Flats near centre: damp high-frequency relief so the spawn is open ground. */
  const flatMask = 1 - smoothstep(FLAT_R * 0.4, FLAT_R * 1.3, rr);
  const roll = (n - 0.45) * lerp(1.2, 7.5, 1 - flatMask)
    + (n2 - 0.45) * lerp(0.4, 3.5, 1 - flatMask);

  /* Ridges — medium height, driveable crests. */
  const ridgeH = Math.max(0, ridge - 0.52) * 22
    + Math.max(0, ridge2 - 0.55) * 16;

  let inland = 4.5 + roll + ridgeH;
  /* Central pad slightly raised and very flat so spawn is clean. */
  inland = lerp(inland, 5.2 + roll * 0.15, flatMask);

  /* Remote ring: level the wild land at road height so no land stands above
     the roads out there — the plateau keeps spreading past the skirt instead
     of climbing into ridges. Hard cap, nothing spared (mountains included). */
  const remoteT = 1 - cityFlatten(x, z);
  if (remoteT > 0.001) {
    const micro = (detailNoise(x / 55, z / 55) - 0.45) * 0.3;
    const capY = CITY_BASE_Y + 0.5 + micro;
    inland = Math.min(inland, capY);
  }

  /* Beach: starts at the coast ring road and lerps down through sea level
     across BEACH_IN metres, so the whole strip between the road and the
     shore slopes like a real beach instead of staying flat grass. */
  const beach0 = beachStart - COAST_ROAD_INSET;
  if (rr > beach0) {
    const t = smoothstep(beach0, edge, rr);
    /* Beach shelf sits just above water at the inner edge of the band, then
       drops below for the last stretch so the waterline is legible. */
    const beachY = lerp(2.2, SEAFLOOR + 0.5, t);
    inland = lerp(inland, beachY, t);
  }

  /* Soft blend past the edge into seafloor. */
  if (rr > edge) {
    const t = smoothstep(edge, edge + 40, rr);
    return lerp(inland, SEAFLOOR - Math.min(4, (rr - edge) * 0.05), t);
  }

  /* City plateau: pull the footprint toward a common base so modular roads
     and buildings sit level with the car. Skirt still follows terrain. */
  const cf = cityFlatten(x, z);
  if (cf > 0.001 && inland > WATER_LEVEL - 0.5) {
    const micro = (detailNoise(x / 55, z / 55) - 0.45) * 0.2;
    const cityY = CITY_BASE_Y + micro;
    inland = lerp(inland, cityY, cf);
  }

  return inland;
}

/**
 * Surface normal at (x, z) from finite differences on heightAt.
 * Points upward; used by free-roam physics so the car sits on slopes.
 */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.25;
  const hL = heightAt(x - e, z);
  const hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e);
  const hU = heightAt(x, z + e);
  return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

/** Pick a grass shade from the palette by a 0..1 index. */
function grassShade(t, out) {
  const n = GRASS_PALETTE.length;
  const u = clamp(t, 0, 0.999) * (n - 1);
  const i = Math.floor(u);
  const f = u - i;
  return out.copy(GRASS_PALETTE[i]).lerp(GRASS_PALETTE[Math.min(i + 1, n - 1)], f);
}

/**
 * Biome colour at (x, z): multi-shade green grass with grain/spots,
 * yellow beach, white snow on peaks.
 * Writes into `out` (THREE.Color) and returns it.
 */
export function landColorAt(x, z, out = new THREE.Color()) {
  const y = heightAt(x, z);
  const { rr, edge, beachStart } = coastAt(x, z);

  /* Underwater / seafloor — keep a dull wet sand so verts under the water
     plane do not flash bright green. */
  if (y < WATER_LEVEL - 0.5) {
    return out.copy(BEACH).multiplyScalar(0.45);
  }

  /* Beach band near the shore — sand starts just inside the coast road and
     is fully saturated a few metres seaward of it. */
  const beach0 = beachStart - COAST_ROAD_INSET;
  const beachT = smoothstep(beach0 - 8, beach0 + 12, rr)
    * (1 - smoothstep(edge - 5, edge + 25, rr));
  /* Ice on high ground — only the tallest peak crosses the ICE_AT line, so
     it carries the cap and the two lower mountains never see a flake. */
  const snowT = smoothstep(ICE_AT, ICE_AT + 16, y);

  /* ---- multi-shade grass ------------------------------------------------
     Large patches (meadow / olive / lime), medium mottling, and fine grain
     so the ground reads as grass rather than one solid green. */
  const large = patchNoise(x / 95, z / 95);
  const mid = paintNoise(x / 28, z / 28);
  const fine = grainNoise(x / 7.5, z / 7.5);
  const spots = spotNoise(x / 4.2 + 17, z / 4.2 - 9);

  /* Base shade from large-scale patches across the full palette. */
  grassShade(large * 0.85 + mid * 0.15, out);

  /* Blend toward a second shade for mottled fields. */
  grassShade(mid * 0.7 + large * 0.3, _cA);
  out.lerp(_cA, 0.35 + mid * 0.2);

  /* Fine grain: slight light/dark flecks like grass blades in a clump. */
  const grain = (fine - 0.45) * 0.22;
  out.offsetHSL(0, 0.02 * (fine - 0.5), grain);

  /* Spots: darker clumps (thicker grass) and occasional brighter tips. */
  if (spots > 0.62) {
    const k = smoothstep(0.62, 0.88, spots);
    out.offsetHSL(-0.02, 0.04, -0.08 * k);   // deep green tufts
  } else if (spots < 0.28) {
    const k = 1 - smoothstep(0.12, 0.28, spots);
    out.offsetHSL(0.03, -0.02, 0.06 * k);    // sunlit tips / thin grass
  }

  /* Elevation: lower flats a bit yellower-green, higher slopes cooler/darker. */
  if (y < 10) {
    grassShade(0.55 + large * 0.3, _cB);
    out.lerp(_cB, smoothstep(10, 4, y) * 0.25);
  } else if (y > 18) {
    grassShade(0.15 + mid * 0.2, _cB);
    out.lerp(_cB, smoothstep(18, 32, y) * 0.4);
  }

  if (beachT > 0.02) out.lerp(BEACH, clamp(beachT, 0, 1));
  if (snowT > 0.02) out.lerp(ICE, clamp(snowT, 0, 1));
  return out;
}

/**
 * Tileable grass-grain texture — multiplies with vertex colours so close-up
 * ground has a speckled meadow look without denser terrain geometry.
 */
function makeGrassGrainMap(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const n = fbm2(SEED * 211 + 5, 3);
  const n2 = fbm2(SEED * 223 + 13, 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      /* Soft base + hard speckles for grass blade / clump feel. */
      const base = 0.78 + n(u * 6.0, v * 6.0) * 0.22;
      const fleck = n2(u * 28, v * 28);
      const blade = fleck > 0.58 ? 1.08 : fleck < 0.32 ? 0.82 : 1.0;
      const g = clamp(base * blade, 0.55, 1.15);
      const i = (y * size + x) * 4;
      /* Slight yellow-green bias in the grain so it does not grey the grass. */
      data[i] = Math.min(255, Math.round(g * 235));
      data[i + 1] = Math.min(255, Math.round(g * 255));
      data[i + 2] = Math.min(255, Math.round(g * 200));
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  /* Many tiles across the island so grain is visible from the car. */
  tex.repeat.set(90, 90);
  return tex;
}

/**
 * How "mountainous" a point is (0..1) — used to place rocks / high trees.
 */
export function mountainFactor(x, z) {
  let m = 0;
  for (const p of PEAKS) {
    const d = Math.hypot(x - p.x, z - p.z);
    m = Math.max(m, 1 - smoothstep(p.r * 0.2, p.r * 0.95, d));
  }
  const y = heightAt(x, z);
  return clamp(Math.max(m, smoothstep(18, 40, y)), 0, 1);
}

/**
 * Build the island land mesh and a water plane. Same square size as the old
 * plaza; land uses multi-shade grass vertex colours plus a grain texture.
 *
 * @returns {{land: THREE.Mesh, water: THREE.Mesh}}
 */
export function buildIslandMeshes({ segments = 220 } = {}) {
  /* Slightly larger than the island so warped shoreline verts (edge +
     coastWarp) never fall off the mesh. */
  const size = (ISLAND_R + 80) * 2;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + CENTER.x;
    const z = pos.getZ(i) + CENTER.z;
    const y = heightAt(x, z);
    pos.setXYZ(i, x, y, z);
    landColorAt(x, z, c);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const grain = makeGrassGrainMap(256);
  const land = new THREE.Mesh(
    geo,
    celMaterial({ vertexColors: true, map: grain }),
  );
  land.receiveShadow = true;
  land.castShadow = false;
  land.name = 'island';

  /* Water: larger than the plaza so the horizon reads as open sea. Slightly
     below WATER_LEVEL so coplanar beach verts do not z-fight. */
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 4, size * 4),
    celMaterial({ color: WATER_COLOR }),
  );
  water.rotateX(-Math.PI / 2);
  water.position.set(CENTER.x, WATER_LEVEL - 0.08, CENTER.z);
  water.receiveShadow = true;
  water.name = 'water';

  return { land, water };
}
