/* Load and instance city GLBs (roads, houses, metro, fences).
 *
 * Same bake/instance path as Vegetation: one InstancedMesh per unique url,
 * fully opaque cel materials, shared colormaps from each kit.
 */
import * as THREE from 'three';
import { celMaterial } from '../render/cel.js';

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
 * @returns {Promise<THREE.Group>}
 */
export async function buildCityMeshes(placements) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const root = new THREE.Group();
  root.name = 'city';

  const byUrl = new Map();
  for (const p of placements) {
    let list = byUrl.get(p.url);
    if (!list) { list = []; byUrl.set(p.url, list); }
    list.push(p);
  }

  const dummy = new THREE.Object3D();
  const cache = new Map(); // url → { geo, map }

  await Promise.all([...byUrl.entries()].map(async ([url, items]) => {
    if (!items.length) return;
    let proto = cache.get(url);
    if (!proto) {
      let gltf;
      try {
        gltf = await loader.loadAsync(url);
      } catch (err) {
        console.warn('city load failed', url, err);
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
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.needsUpdate = true;
      }
      proto = { geo, map };
      cache.set(url, proto);
    }

    const mat = celMaterial({
      map: proto.map || undefined,
      color: proto.map ? 0xffffff : 0x888888,
    });
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    if (proto.map) mat.alphaTest = 0.45;

    const mesh = new THREE.InstancedMesh(proto.geo, mat, items.length);
    mesh.name = `city-${url.split('/').pop()}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.pitch || 0, it.yaw || 0, it.roll || 0);
      dummy.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }));

  return root;
}
