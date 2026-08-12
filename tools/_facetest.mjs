import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/bashar-khan/projects/opencity';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => srv.listen(0, r));
const port = srv.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await page.waitForTimeout(300);
const result = await page.evaluate(async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const THREE = window.__game?.THREE ?? window.__game?.T;
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('/assets/characters/character-male-a.glb');
  const scene = gltf.scene;
  const dir = new THREE.Vector3(0, -1, 0);      // thigh rest direction (down)
  const dir1 = new THREE.Vector3(0, -1, 0);     // for head (up) - face direction proxy
  const walk = THREE.AnimationClip.findByName(gltf.animations, 'walk');
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(walk);
  action.play();
  const legL = scene.getObjectByName('leg-left');
  const legR = scene.getObjectByName('leg-right');
  const q = new THREE.Quaternion();
  const thigh = new THREE.Vector3(), thighB = new THREE.Vector3();
  let fwdZ = -1e9, bwdZ = 1e9, fwdIx = -1, bwdIx = -1;
  const dura = walk.duration;
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    action.time = (i / steps) * dura;
    mixer.update(0.001);
    scene.updateMatrixWorld(true);
    for (const leg of [legL, legR]) {
      const bone = leg;                          // thigh bone
      bone.getWorldQuaternion(q);
      thigh.copy(dir).applyQuaternion(q);
      thighB.copy(dir).applyQuaternion(q);
      if (thigh.z + thighB.z < bwdZ) { bwdZ = thigh.z + thighB.z; bwdIx = i; }
      if (thigh.z + thighB.z > fwdZ) { fwdZ = thigh.z + thighB.z; fwdIx = i; }
    }
  }
  return { fwdZ: +fwdZ.toFixed(3), bwdZ: +bwdZ.toFixed(3), fwdIx, bwdIx, dur: dura };
});
console.log('THIGH SWING', JSON.stringify(result));
await browser.close();
srv.close();
