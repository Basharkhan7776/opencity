/* Load and instance city GLBs (roads, houses, metro, fences).
 *
 * Same bake/instance path as Vegetation: one InstancedMesh per unique url,
 * fully opaque cel materials, shared colormaps from each kit.
 */
import * as THREE from 'three';
import { celMaterial } from '../render/cel.js';
import { MODEL_SPAN } from './CityLayout.js';

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
 * @param {object[]} placements  from planCity
 * @param {(frac:number)=>void} [onProgress]  called with 0..1 per unique model loaded
 * @returns {Promise<THREE.Group>}
 */
export async function buildCityMeshes(placements, onProgress) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const root = new THREE.Group();
  root.name = 'city';

  const byUrl = new Map();
  for (const p of placements) {
    if (p.kind === 'platform') continue;   // podiums are procedural boxes
    let list = byUrl.get(p.url);
    if (!list) { list = []; byUrl.set(p.url, list); }
    list.push(p);
  }

  const urls = [...byUrl.keys()];
  const total = Math.max(1, urls.length);
  let done = 0;
  const bump = () => onProgress?.(done / total);

  const dummy = new THREE.Object3D();
  const cache = new Map(); // url → { geo, map }
  const lightMats = [];
  let lightPoolMesh = null;
  let lightPoolMat = null;

  await Promise.all(urls.map(async (url) => {
    const items = byUrl.get(url);
    let proto = cache.get(url);
    if (!proto) {
      let gltf;
      try {
        gltf = await loader.loadAsync(url);
      } catch (err) {
        console.warn('city load failed', url, err);
        done++; bump();
        return;
      }
      let map = null;
      gltf.scene.traverse(o => {
        if (o.isMesh && o.material) {
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          if (m && m.map && !map) map = m.map;
        }
      });
      const geo = bakeSceneGeometry(gltf.scene);
      if (!geo) return;
      /* Sit the prototype on y=0 so instance position.y = ground height.
         Kenney packs are often centred (−1…1); after scale the old
         heightAt+MESH_SCALE offset left whole blocks floating. */
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const midX = (bb.min.x + bb.max.x) * 0.5;
      const midZ = (bb.min.z + bb.max.z) * 0.5;
      const baseY = bb.min.y;
      geo.translate(-midX, -baseY, -midZ);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      /* Normalise the footprint (max of width/depth) to the layout's assumed
         MODEL_SPAN so a small-native model cannot render as a toy next to a
         big-native one. Fences keep their native length variety. */
      const kind = items[0].kind;
      const fb = geo.boundingBox;
      const foot = Math.max(fb.max.x - fb.min.x, fb.max.z - fb.min.z);
      const norm = (kind === 'building' || kind === 'house') && foot > 1e-4
        ? MODEL_SPAN / foot
        : 1;
      const protoHeight = fb.max.y - fb.min.y;
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.needsUpdate = true;
      }
      proto = { geo, map, norm, protoHeight };
      cache.set(url, proto);
      done++; bump();
    }

    const isLight = items[0].kind === 'light' || url.includes('light');
    const mat = celMaterial({
      map: proto.map || undefined,
      color: proto.map ? 0xffffff : 0x888888,
    });
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    if (proto.map) mat.alphaTest = 0.45;

    if (isLight) {
      mat.emissive = new THREE.Color(0x000000);
      mat.emissiveIntensity = 0.0;
      lightMats.push(mat);
    }

    const mesh = new THREE.InstancedMesh(proto.geo, mat, items.length);
    mesh.name = `city-${url.split('/').pop()}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.pitch || 0, it.yaw || 0, it.roll || 0);
      const n = proto.norm || 1;
      dummy.scale.set((it.sx ?? 1) * n, (it.sy ?? 1) * n, (it.sz ?? 1) * n);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }));

  /* Batched ground illumination pools beneath street light lamp heads */
  const lightPlacements = placements.filter(p => p.kind === 'light');
  if (lightPlacements.length > 0) {
    const poolGeo = new THREE.PlaneGeometry(34.0, 34.0);
    poolGeo.rotateX(-Math.PI * 0.5); // flat on ground plane

    const poolCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let poolTex = null;
    if (poolCanvas) {
      poolCanvas.width = 128;
      poolCanvas.height = 128;
      const ctx = poolCanvas.getContext('2d');
      const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.40)');
      grad.addColorStop(0.30, 'rgba(240, 248, 255, 0.22)');
      grad.addColorStop(0.60, 'rgba(215, 235, 255, 0.08)');
      grad.addColorStop(1, 'rgba(200, 225, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      poolTex = new THREE.CanvasTexture(poolCanvas);
      poolTex.colorSpace = THREE.SRGBColorSpace;
    }

    const poolMat = new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, lightPlacements.length);
    poolMesh.name = 'street-light-pools';
    poolMesh.renderOrder = 4;
    poolMesh.visible = false;

    for (let i = 0; i < lightPlacements.length; i++) {
      const lp = lightPlacements[i];
      const yaw = lp.yaw || 0;
      // Inward offset of lamp head from pole
      const offX = -Math.sin(yaw) * 1.8;
      const offZ = -Math.cos(yaw) * 1.8;
      dummy.position.set(lp.x + offX, lp.y + 0.03, lp.z + offZ);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poolMesh.setMatrixAt(i, dummy.matrix);
    }
    poolMesh.instanceMatrix.needsUpdate = true;
    poolMesh.computeBoundingSphere();
    root.add(poolMesh);

    lightPoolMesh = poolMesh;
    lightPoolMat = poolMat;
  }

  /* Grey podiums under metro buildings — one per city square, level with
     the footpath (a lighter warm grey than the road's cool concrete). */
  const platforms = placements.filter(p => p.kind === 'platform');
  if (platforms.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);   // base at instance y
    const mat = celMaterial({ color: 0xaaa59c });
    mat.transparent = false;
    mat.depthWrite = true;
    const pm = new THREE.InstancedMesh(box, mat, platforms.length);
    pm.name = 'city-platforms';
    pm.castShadow = true;
    pm.receiveShadow = true;
    for (let i = 0; i < platforms.length; i++) {
      const it = platforms[i];
      dummy.position.set(it.x, it.y + it.sy * 0.5, it.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.updateMatrix();
      pm.setMatrixAt(i, dummy.matrix);
    }
    pm.instanceMatrix.needsUpdate = true;
    pm.computeBoundingSphere();
    root.add(pm);
  }

  /** Dynamic night-time illumination update */
  root.updateCityLighting = (nightFactor) => {
    const f = Math.max(0, Math.min(1, nightFactor));
    if (lightPoolMat && lightPoolMesh) {
      lightPoolMat.opacity = f * 0.38;
      lightPoolMesh.visible = f > 0.02;
    }
  };

  return root;
}
