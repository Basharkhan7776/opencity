/* Load and instance city GLBs (roads, houses, metro, fences).
 *
 * Same bake/instance path as Vegetation: one InstancedMesh per unique url,
 * fully opaque cel materials, shared colormaps from each kit.
 */
import * as THREE from 'three';
import { celMaterial } from '../render/cel.js';
import { MODEL_SPAN } from './CityLayout.js';
import { skipOverridePass } from '../fx/pass.js';

/* Temporary: floating name banner above buildings/houses (asset file name). */
function makeBannerTexture(name) {
  const pad = 14;
  const font = 'bold 56px monospace';
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const w = Math.ceil(g.measureText(name).width) + pad * 2;
  c.width = w;
  c.height = 96;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 12;
  g.lineJoin = 'round';
  g.strokeText(name, w / 2, 48);
  g.fillStyle = '#ffe9a8';
  g.fillText(name, w / 2, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
      const n = proto.norm || 1;
      dummy.scale.set((it.sx ?? 1) * n, (it.sy ?? 1) * n, (it.sz ?? 1) * n);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);

    /* Temporary name banners above buildings/houses. */
    if (items.some(it => it.banner)) {
      const name = url.split('/').pop().replace(/\.glb$/, '');
      const tex = makeBannerTexture(name);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }),
      );
      const span = MODEL_SPAN * (proto.norm || 1);
      const unit = span * 0.9;
      sprite.scale.set(tex.image.width / 96 * unit, unit, 1);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.banner) continue;
        const h = proto.protoHeight * (it.sy ?? 1) * (proto.norm || 1);
        const s = sprite.clone();
        s.position.set(it.x, it.y + h + unit * 0.8, it.z);
        /* Keep the banner out of the ink prepass: it is transparent in the
           beauty pass, so a solid quad in the normals buffer turns into an
           inked rectangle floating over whatever is behind it. */
        skipOverridePass(s);
        root.add(s);
      }
      tex.dispose();
    }
  }));

  return root;
}
