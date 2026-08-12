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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${port}/#manual&cap=60`, { waitUntil: 'load' });
await page.waitForTimeout(200);
await page.evaluate(() => window.__game.begin());
await page.waitForSelector('#boot.gone', { timeout: 60000 });

await page.evaluate(() => window.__game.warp(6));
await page.waitForTimeout(200);

const info = await page.evaluate(async () => {
  const g = window.__game;
  const ped = g.pedestrians;
  const active = ped.peds.filter(p => p.active);
  const out = {
    ready: ped.ready, active: active.length, models: ped.models.length,
    edges: ped._edges.length, hasWalk: !!ped.walks[0],
    onSlab: 0, withinRadius: 0, animating: false,
  };
  const arm = active[0]?.anchor.getObjectByName('arm-left');
  let q0 = null;
  for (const p of active) {
    const pos = p.anchor.position;
    const gy = g.track.heightAt(pos.x, pos.z);
    if (Math.abs(pos.y - gy) < 0.06) out.onSlab++;
    const dx = pos.x - g.player.pos.x, dz = pos.z - g.player.pos.z;
    if (dx * dx + dz * dz < 500 * 500) out.withinRadius++;
  }
  if (arm) {
    const q = arm.getWorldQuaternion(new (g.THREE.Quaternion)());
    q0 = [...q.toArray()];
    await new Promise(r => setTimeout(r, 300));
    const q1 = [...arm.getWorldQuaternion(new (g.THREE.Quaternion)()).toArray()];
    out.animating = q0.some((v, i) => Math.abs(v - q1[i]) > 1e-4);
  }
  return out;
});
console.log('INFO', JSON.stringify(info, null, 1));
await page.screenshot({ path: '/tmp/opencode/peds.png' });
console.log('ERRORS', errs.slice(0, 8));
await browser.close();
srv.close();
