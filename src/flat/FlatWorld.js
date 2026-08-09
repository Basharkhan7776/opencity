/* The flat world: island terrain, continuous city roads, houses/metro buildings,
 * forest props, water, and the rally light rig.
 */
import * as THREE from 'three';
import { buildIslandMeshes, CENTER } from './Island.js';
import { createVegetationSystem, buildVegetationMeshes, ObstacleGrid } from './Vegetation.js';
import { createCitySystem } from './CityLayout.js';
import { buildCityMeshes } from './CityTiles.js';
import { buildRoadNetworkMesh, buildRoadLift } from './CityRoads.js';

/**
 * @returns {{root:THREE.Group, sun:THREE.DirectionalLight,
 *            fill:THREE.DirectionalLight,
 *            vegetation: object,
 *            city: object,
 *            obstacles: ObstacleGrid,
 *            roadLift: ((x:number,z:number)=>number)|null,
 *            loadVegetation: ({onProgress}?) => Promise<void>,
 *            loadCity: ({onProgress}?) => Promise<void>}}
 */
export function buildFlatWorld({ shadowSize = 4096, shadowDist = 46 } = {}) {
  const root = new THREE.Group();
  root.name = 'flatworld';

  const { land, water } = buildIslandMeshes();
  root.add(land);
  root.add(water);

  /* City plan first (roads + buildings). Continuous roads are sync meshes. */
  const city = createCitySystem();
  let roadLift = null;
  if (city.graph) {
    const roads = buildRoadNetworkMesh(city.graph);
    root.add(roads.root);
    roadLift = buildRoadLift(city.graph, city.placements);
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
  const loadCity = async ({ onProgress } = {}) => {
    if (cityLoaded) return;
    cityLoaded = true;
    /* Buildings / houses / fences / lights only — roads already in scene. */
    const group = await buildCityMeshes(city.placements, onProgress);
    root.add(group);
  };

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

  root.add(new THREE.HemisphereLight(0xa9d2ff, 0x3d5058, 2.4));

  return {
    root, sun, fill,
    vegetation, city, obstacles, roadLift,
    loadVegetation, loadCity,
  };
}
