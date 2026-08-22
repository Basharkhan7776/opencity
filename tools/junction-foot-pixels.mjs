/* Junction footpath VISIBILITY probe (pixel truth, not raycast).
 *
 * Raycasting cannot see this bug: Mesh.raycast only backface-culls for
 * BackSide materials, so a FrontSide top face wound the wrong way still
 * registers a hit. Visibility is decided by the rasteriser's front-face
 * cull, and the only honest test is rendered pixels.
 *
 * The player is teleported onto each junction first — _cullWorldChunks()
 * hides every world chunk beyond viewRadius of the player, so an overhead
 * frame taken from across the map shows bare terrain no matter what.
 *
 * For each sampled world point (junction corner sidewalk blocks, closed-side
 * footpath borders, and plate/arm controls) the frame is rendered twice:
 * once as shipped, once with road-deck flipped to DoubleSide. If the shipped
 * frame shows ground/wall colours where DoubleSide shows concrete grey, the
 * top faces are wound backwards and culled.
 *
 *   node tools/junction-foot-pixels.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './harness.mjs';
import { finish } from './tame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots', 'junction-foot');

await run({ width: 640, height: 640, hash: 'manual&tier=medium&seed=22&ink=1' },
  async ({ page }) => {
    await page.evaluate(() => window.__game.begin());
    await page.waitForFunction(() => window.__game?.scene, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    const spots = await page.evaluate(async () => {
      const g = window.__game;
      let deck = null;
      g.scene.traverse(o => { if (o.name === 'road-deck') deck = o; });
      if (!deck) return [{ error: 'road-deck mesh not found' }];

      const city = g.world.city;
      const byId = new Map();
      for (const n of city.graph.nodes) byId.set(n.id, n);
      const jr = new Map();
      for (const n of city.graph.nodes) jr.set(n.id, 0);
      for (const e of city.graph.edges) {
        const r = e.width * 0.5 + 0.45;
        jr.set(e.a, Math.max(jr.get(e.a) || 0, r));
        jr.set(e.b, Math.max(jr.get(e.b) || 0, r));
      }
      const deg = id => city.graph.degree.get(id) || 0;

      const found = [];
      /* A 4-way junction exercises corner sidewalk blocks… */
      const j4 = city.graph.nodes.find(n => deg(n.id) >= 4 && (jr.get(n.id) || 0) > 3);
      if (j4) {
        const r = jr.get(j4.id), fw = 2;
        found.push({ label: 'j4 corner-block SE', x: j4.x + r + fw * 0.5, z: j4.z + r + fw * 0.5 });
        found.push({ label: 'j4 corner-block NW', x: j4.x - r - fw * 0.5, z: j4.z - r - fw * 0.5 });
        found.push({ label: 'j4 plate centre (control)', x: j4.x, z: j4.z });
      }
      /* …and a T-junction exercises a closed-side footpath border. */
      const j3 = city.graph.nodes.find(n => deg(n.id) === 3 && (jr.get(n.id) || 0) > 3);
      if (j3) {
        const r = jr.get(j3.id), fw = 2;
        const dirs = [];
        for (const e of city.graph.edges) {
          if (e.a === j3.id || e.b === j3.id) {
            const o = byId.get(e.a === j3.id ? e.b : e.a);
            dirs.push({ x: o.x - j3.x, z: o.z - j3.z });
          }
        }
        if (!dirs.some(v => v.x > 0.7)) found.push({ label: 'j3 border E mid', x: j3.x + r + fw * 0.5, z: j3.z });
        if (!dirs.some(v => v.x < -0.7)) found.push({ label: 'j3 border W mid', x: j3.x - r - fw * 0.5, z: j3.z });
        if (!dirs.some(v => v.z > 0.7)) found.push({ label: 'j3 border S mid', x: j3.x, z: j3.z + r + fw * 0.5 });
        if (!dirs.some(v => v.z < -0.7)) found.push({ label: 'j3 border N mid', x: j3.x, z: j3.z - r - fw * 0.5 });
        found.push({ label: 'j3 plate centre (control)', x: j3.x, z: j3.z });
      }
      return found;
    });

    const rows = [];
    for (const s of spots) {
      if (s.error) { rows.push(s); continue; }
      const row = await page.evaluate(async (spot) => {
        const g = window.__game;
        const cam = g.camera;
        let deck = null;
        g.scene.traverse(o => { if (o.name === 'road-deck') deck = o; });

        /* Teleport the player so the visibility sphere covers the junction */
        g.player.pos.x = spot.x;
        g.player.pos.z = spot.z;
        g._cullWorldChunks();

        cam.up.set(0, 0, -1);
        cam.position.set(spot.x, 45, spot.z);
        cam.lookAt(spot.x, 0, spot.z);

        const shoot = () => {
          g.setPaused(true);
          g.renderOnce();
          const url = g.renderer.domElement.toDataURL('image/png');
          g.setPaused(false);
          return url;
        };
        const decode = async (url) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return { ctx, w: c.width, h: c.height };
        };
        const centrePatch = (cv) => {
          const px = cv.w >> 1, py = cv.h >> 1;
          const R = [], G = [], B = [];
          for (let dy = -6; dy <= 6; dy++) {
            for (let dx = -6; dx <= 6; dx++) {
              const d = cv.ctx.getImageData(px + dx, py + dy, 1, 1).data;
              R.push(d[0]); G.push(d[1]); B.push(d[2]);
            }
          }
          const med = a => a.sort((p, q) => p - q)[a.length >> 1];
          return [med(R), med(G), med(B)];
        };

        const F = await decode(shoot());
        const savedSide = deck.material.side;
        deck.material.side = 2; /* THREE.DoubleSide */
        const D = await decode(shoot());
        deck.material.side = savedSide;

        const f = centrePatch(F);
        const d = centrePatch(D);
        return {
          label: spot.label,
          front: f,
          doubleside: d,
          delta: Math.abs(f[0] - d[0]) + Math.abs(f[1] - d[1]) + Math.abs(f[2] - d[2]),
        };
      }, s);
      console.log(JSON.stringify(row));
      rows.push(row);
    }

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
    const bad = rows.filter(r => !r.error && !r.label.includes('control') && r.delta > 30);
    console.log(bad.length
      ? `\nCULLED TOPS at: ${bad.map(b => b.label).join(', ')}`
      : '\nall sampled tops visible');
  });

finish(process.exitCode || 0);
