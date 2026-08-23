/* The flat world: island terrain, continuous city roads, houses/metro buildings,
 * forest props, water, and the rally light rig.
 */
import * as THREE from 'three';
import { buildIslandMeshes, CENTER } from './Island.js';
import { createVegetationSystem, buildVegetationMeshes, ObstacleGrid } from './Vegetation.js';
import { createCitySystem } from './CityLayout.js';
import { buildCityMeshes } from './CityTiles.js';
import { buildRoadNetworkMesh, buildRoadLift } from './CityRoads.js';
import { CelestialSky } from './CelestialSky.js';
import { OceanWaves } from './OceanWaves.js';

/**
 * Keyframes for 24-hour atmosphere, sky, lighting, and fog interpolation.
 */
const SKY_KEYFRAMES = [
  // t: 0.0 - 1.0 (Dawn -> Noon -> Sunset -> Dusk -> Night -> Dawn)
  { t: 0.00, sky: 0x28324e, fog: 0x28324e, sunCol: 0xffb088, sunInt: 1.2, hemiSky: 0x584c68, hemiGnd: 0x221e2a, hemiInt: 1.5, isNight: true },
  { t: 0.08, sky: 0xd67a58, fog: 0xd67a58, sunCol: 0xffb880, sunInt: 1.8, hemiSky: 0xf09868, hemiGnd: 0x2e1c18, hemiInt: 1.8, isNight: false },
  { t: 0.18, sky: 0xa0cce8, fog: 0xa0cce8, sunCol: 0xffe2b0, sunInt: 2.3, hemiSky: 0xbad8ff, hemiGnd: 0x364850, hemiInt: 2.2, isNight: false },
  { t: 0.30, sky: 0x8cc8e8, fog: 0x8cc8e8, sunCol: 0xffe6bd, sunInt: 2.5, hemiSky: 0xa9d2ff, hemiGnd: 0x3d5058, hemiInt: 2.4, isNight: false },
  { t: 0.44, sky: 0xc89260, fog: 0xc89260, sunCol: 0xffa040, sunInt: 2.4, hemiSky: 0xf09855, hemiGnd: 0x3d2822, hemiInt: 2.2, isNight: false },
  { t: 0.50, sky: 0xe86b36, fog: 0xe86b36, sunCol: 0xff5a18, sunInt: 2.2, hemiSky: 0xff8040, hemiGnd: 0x3a1c18, hemiInt: 2.0, isNight: false },
  { t: 0.56, sky: 0x4b2644, fog: 0x4b2644, sunCol: 0xd04828, sunInt: 1.2, hemiSky: 0x6a3058, hemiGnd: 0x1c1220, hemiInt: 1.3, isNight: false },
  { t: 0.62, sky: 0x242848, fog: 0x242848, sunCol: 0xb0c8f0, sunInt: 1.0, hemiSky: 0x425880, hemiGnd: 0x1e2c40, hemiInt: 1.4, isNight: true },
  { t: 0.70, sky: 0x1a263c, fog: 0x1a263c, sunCol: 0xe8f4ff, sunInt: 1.6, hemiSky: 0x38527a, hemiGnd: 0x1a283c, hemiInt: 1.45, isNight: true },
  { t: 0.85, sky: 0x182438, fog: 0x182438, sunCol: 0xecf6ff, sunInt: 1.65, hemiSky: 0x344e74, hemiGnd: 0x182638, hemiInt: 1.40, isNight: true },
  { t: 0.94, sky: 0x202c44, fog: 0x202c44, sunCol: 0xd8ecff, sunInt: 1.3, hemiSky: 0x3e5682, hemiGnd: 0x1c2a3e, hemiInt: 1.45, isNight: true },
  { t: 1.00, sky: 0x28324e, fog: 0x28324e, sunCol: 0xffb088, sunInt: 1.2, hemiSky: 0x584c68, hemiGnd: 0x221e2a, hemiInt: 1.5, isNight: true },
];

function sampleAtmosphere(timeOfDay) {
  const t = ((timeOfDay % 1) + 1) % 1;
  let k0 = SKY_KEYFRAMES[0], k1 = SKY_KEYFRAMES[1];
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    if (t >= SKY_KEYFRAMES[i].t && t <= SKY_KEYFRAMES[i + 1].t) {
      k0 = SKY_KEYFRAMES[i];
      k1 = SKY_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = k1.t - k0.t || 1e-4;
  const alpha = (t - k0.t) / span;

  const cSky = new THREE.Color(k0.sky).lerp(new THREE.Color(k1.sky), alpha);
  const cFog = new THREE.Color(k0.fog).lerp(new THREE.Color(k1.fog), alpha);
  const cSun = new THREE.Color(k0.sunCol).lerp(new THREE.Color(k1.sunCol), alpha);
  const sunInt = THREE.MathUtils.lerp(k0.sunInt, k1.sunInt, alpha);
  const cHemiSky = new THREE.Color(k0.hemiSky).lerp(new THREE.Color(k1.hemiSky), alpha);
  const cHemiGnd = new THREE.Color(k0.hemiGnd).lerp(new THREE.Color(k1.hemiGnd), alpha);
  const hemiInt = THREE.MathUtils.lerp(k0.hemiInt, k1.hemiInt, alpha);

  // Night factor for street lights: 0.0 during day, ramping to 1.0 from sunset to night
  let nightFactor = 0;
  if (t >= 0.48 && t <= 0.58) {
    nightFactor = (t - 0.48) / 0.10;
  } else if (t > 0.58 && t < 0.94) {
    nightFactor = 1.0;
  } else if (t >= 0.94 && t <= 1.0) {
    nightFactor = 1.0 - (t - 0.94) / 0.06;
  } else if (t < 0.06) {
    nightFactor = 1.0 - (t / 0.06);
  }

  return {
    t,
    cSky, cFog, cSun, sunInt,
    cHemiSky, cHemiGnd, hemiInt,
    nightFactor,
    isNight: t > 0.58 && t < 0.96,
  };
}

/**
 * @returns {{root:THREE.Group, sun:THREE.DirectionalLight,
 *            fill:THREE.DirectionalLight,
 *            fillB:THREE.DirectionalLight,
 *            hemi:THREE.HemisphereLight,
 *            vegetation: object,
 *            city: object,
 *            cityGroup: THREE.Group|null,
 *            obstacles: ObstacleGrid,
 *            roadLift: ((x:number,z:number)=>number)|null,
 *            updateEnvironment: (timeOfDay:number, targetPos:THREE.Vector3, scene:THREE.Scene)=>object,
 *            loadVegetation: ({onProgress}?) => Promise<void>,
 *            loadCity: ({onProgress}?) => Promise<void>}}
 */
export function buildFlatWorld({ shadowSize = 4096, shadowDist = 46 } = {}) {
  const root = new THREE.Group();
  root.name = 'flatworld';

  /* City plan first (roads + buildings). Continuous roads are sync meshes. */
  const city = createCitySystem();
  let roadLift = null;
  if (city.graph) {
    roadLift = buildRoadLift(city.graph, city.placements);
  }

  const { land } = buildIslandMeshes({ roadLift });
  root.add(land);

  /* Dynamic Cel-Shaded Ocean Waves and Beach Surf Foam System */
  const oceanWaves = new OceanWaves();
  root.add(oceanWaves.mesh);

  /* Celestial sky system: Sun, Moon, Stars, and drifting Clouds */
  const celestialSky = new CelestialSky(root);

  if (city.graph) {
    const roads = buildRoadNetworkMesh(city.graph);
    root.add(roads.root);
  }

  const vegetation = createVegetationSystem(city.graph);

  const obstacles = new ObstacleGrid([
    ...vegetation.colliders,
    ...city.colliders,
  ]);

  let vegLoaded = false;
  const loadVegetation = async ({ onProgress } = {}) => {
    if (vegLoaded) return;
    vegLoaded = true;
    const group = await buildVegetationMeshes(vegetation.placements, onProgress);
    root.add(group);
  };

  let cityLoaded = false;
  let cityGroup = null;
  const loadCity = async ({ onProgress } = {}) => {
    if (cityLoaded) return;
    cityLoaded = true;
    /* Buildings / houses / fences / lights only — roads already in scene. */
    cityGroup = await buildCityMeshes(city.placements, onProgress);
    root.add(cityGroup);
  };

  /* Main celestial directional light (Sun by day, Moon by night) */
  const sun = new THREE.DirectionalLight(0xffe6bd, 2.5);
  sun.name = 'celestialLight';
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const cam = sun.shadow.camera;
  cam.left = -shadowDist; cam.right = shadowDist;
  cam.top = shadowDist; cam.bottom = -shadowDist;
  cam.near = 40; cam.far = 520;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.085;
  sun.target.position.set(CENTER.x, 0, CENTER.z);
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

  const hemi = new THREE.HemisphereLight(0xa9d2ff, 0x3d5058, 2.4);
  root.add(hemi);

  /* Extract street lamp positions for dynamic night-time shadow casting */
  const lightPlacements = (city.placements || []).filter(p => p.kind === 'light');
  const lightPoints = lightPlacements.map(lp => {
    const yaw = lp.yaw || 0;
    const offX = -Math.sin(yaw) * 1.8;
    const offZ = -Math.cos(yaw) * 1.8;
    return {
      x: lp.x + offX,
      y: lp.y + 5.6, // height of lamp head above ground
      z: lp.z + offZ,
      groundX: lp.x + offX,
      groundZ: lp.z + offZ,
    };
  });

  /* Dynamic Street Lamp SpotLight casting crisp local shadows from vehicles & pedestrians under street lights */
  const streetSpot = new THREE.SpotLight(0xffffff, 0);
  streetSpot.name = 'streetLightShadow';
  streetSpot.castShadow = true;
  streetSpot.angle = Math.PI / 2.8;
  streetSpot.penumbra = 0.65;
  streetSpot.decay = 1.0;
  streetSpot.distance = 70;
  streetSpot.shadow.mapSize.set(1024, 1024);
  streetSpot.shadow.camera.near = 0.5;
  streetSpot.shadow.camera.far = 75;
  streetSpot.shadow.bias = -0.0003;
  streetSpot.shadow.normalBias = 0.08;
  root.add(streetSpot);
  root.add(streetSpot.target);

  /**
   * Updates celestial orbits, active Sun/Moon directional light, shadow frustum,
   * street light shadow spotlight, hemisphere ambient light, and sky/fog color.
   */
  const updateEnvironment = (timeOfDay, targetPos, scene, camera = null, dt = 1 / 60) => {
    const atmo = sampleAtmosphere(timeOfDay);

    // Celestial solar orbit angle: t=0.0 (dawn), t=0.25 (noon zenith), t=0.50 (sunset), t=0.75 (midnight)
    const theta = atmo.t * Math.PI * 2;
    const sinElev = Math.sin(theta);
    const cosAzim = Math.cos(theta);

    let lightOffsetX, lightOffsetY, lightOffsetZ;

    if (!atmo.isNight) {
      // Sun orbit vector
      lightOffsetX = cosAzim * 165;
      lightOffsetY = Math.max(25, sinElev * 145);
      lightOffsetZ = cosAzim * 35 + 25;
    } else {
      // Moon orbit vector on opposite hemisphere
      lightOffsetX = -cosAzim * 160;
      lightOffsetY = Math.max(35, -sinElev * 140);
      lightOffsetZ = -cosAzim * 30 - 25;
    }

    // Position active celestial shadow light over current focus position (player or camera)
    const px = targetPos ? targetPos.x : CENTER.x;
    const py = targetPos ? targetPos.y : 0;
    const pz = targetPos ? targetPos.z : CENTER.z;

    sun.position.set(px + lightOffsetX, py + lightOffsetY, pz + lightOffsetZ);
    sun.target.position.set(px, py, pz);
    sun.target.updateMatrixWorld();

    sun.color.copy(atmo.cSun);
    sun.intensity = atmo.sunInt;

    hemi.color.copy(atmo.cHemiSky);
    hemi.groundColor.copy(atmo.cHemiGnd);
    hemi.intensity = atmo.hemiInt;

    // Dynamic street lamp shadow casting on nearby vehicles and pedestrians
    if (atmo.nightFactor > 0.02 && targetPos && lightPoints.length > 0) {
      let nearestLamp = null;
      let minD2 = Infinity;
      for (let i = 0; i < lightPoints.length; i++) {
        const lp = lightPoints[i];
        const dx = lp.groundX - px;
        const dz = lp.groundZ - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD2) {
          minD2 = d2;
          nearestLamp = lp;
        }
      }

      if (nearestLamp && minD2 < 2304) { // within 48 meters
        const dist = Math.sqrt(minD2);
        const prox = Math.max(0, 1.0 - dist / 48.0);
        streetSpot.position.set(nearestLamp.x, nearestLamp.y, nearestLamp.z);
        streetSpot.target.position.set(px, py, pz);
        streetSpot.target.updateMatrixWorld();
        streetSpot.intensity = atmo.nightFactor * prox * 3.8;
        streetSpot.visible = true;
        streetSpot.castShadow = true;
      } else {
        streetSpot.intensity = 0;
        streetSpot.visible = false;
      }
    } else {
      streetSpot.intensity = 0;
      streetSpot.visible = false;
    }

    // Fill light modulation
    if (!atmo.isNight) {
      fill.intensity = 0.40;
      fill.color.setHex(0x93a9e6);
      fillB.intensity = 0.25;
      fillB.color.setHex(0x8fb0cf);
    } else {
      fill.intensity = 0.45;
      fill.color.setHex(0x6080b0);
      fillB.intensity = 0.35;
      fillB.color.setHex(0x5070a0);
    }

    // Update scene sky background and fog
    if (scene) {
      if (scene.background?.isColor) {
        scene.background.copy(atmo.cSky);
      }
      if (scene.fog?.color?.isColor) {
        scene.fog.color.copy(atmo.cFog);
      }
    }

    // Update street light glow
    if (cityGroup?.updateCityLighting) {
      cityGroup.updateCityLighting(atmo.nightFactor);
    }

    // Update dynamic celestial sky (Sun, Moon, Stars, drifting Clouds)
    celestialSky.update(dt, timeOfDay, targetPos, atmo, camera);

    // Update dynamic ocean waves and beach surf foam
    oceanWaves.update(dt, atmo);

    return atmo;
  };

  return {
    root, sun, streetSpot, fill, fillB, hemi,
    vegetation, city, celestialSky, oceanWaves, get cityGroup() { return cityGroup; }, obstacles, roadLift,
    updateEnvironment,
    loadVegetation, loadCity,
  };
}
