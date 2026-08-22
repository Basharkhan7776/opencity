/* Junction footpath visibility probe.
 *
 * Raycasts straight down onto the junction sidewalk geometry to answer one
 * question: does the FIRST surface under a point that should be footpath top
 * belong to the road deck at DECK height, or has the top face been culled so
 * the ray falls through to whatever is beneath (walls, terrain)?
 *
 *   node tools/junction-foot-probe.mjs
 */
import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' },
  async ({ page }) => {
    await page.evaluate(() => window.__game.begin());
    await page.waitForFunction(() => window.__game?.scene, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    const out = await page.evaluate(async () => {
      const g = window.__game;
      const THREE = await import('three');
      const { heightAt } = await import('./src/flat/Island.js');

      const city = g.world.city;
      const byId = new Map();
      for (const n of city.graph.nodes) byId.set(n.id, n);

      /* Junction radius — same rule as CityRoads.junctionRadius */
      const jr = new Map();
      for (const n of city.graph.nodes) jr.set(n.id, 0);
      for (const e of city.graph.edges) {
        const r = e.width * 0.5 + 0.45;
        jr.set(e.a, Math.max(jr.get(e.a) || 0, r));
        jr.set(e.b, Math.max(jr.get(e.b) || 0, r));
      }
      const deg = id => city.graph.degree.get(id) || 0;
      const j = city.graph.nodes.find(n => deg(n.id) >= 4 && (jr.get(n.id) || 0) > 3);
      if (!j) return { error: 'no 4-way junction found' };

      const cx = j.x, cz = j.z;
      const r = jr.get(j.id);
      const fw = 2;

      const dirs = [];
      let armWidth = 0;
      for (const e of city.graph.edges) {
        if (e.a === j.id || e.b === j.id) {
          armWidth = Math.max(armWidth, e.width);
          const o = byId.get(e.a === j.id ? e.b : e.a);
          const dx = o.x - cx, dz = o.z - cz;
          const l = Math.hypot(dx, dz);
          dirs.push({ x: dx / l, z: dz / l });
        }
      }
      const hasE = dirs.some(v => v.x > 0.7), hasW = dirs.some(v => v.x < -0.7);
      const hasS = dirs.some(v => v.z > 0.7), hasN = dirs.some(v => v.z < -0.7);

      const pts = [];
      if (hasE && hasS) pts.push({ label: 'corner-block SE', x: cx + r + fw * 0.5, z: cz + r + fw * 0.5 });
      if (hasW && hasN) pts.push({ label: 'corner-block NW', x: cx - r - fw * 0.5, z: cz - r - fw * 0.5 });
      if (!hasW) pts.push({ label: 'border W mid', x: cx - r - fw * 0.5, z: cz });
      if (!hasN) pts.push({ label: 'border N mid', x: cx, z: cz - r - fw * 0.5 });
      pts.push({ label: 'plate centre (control)', x: cx, z: cz });

      /* Control: footpath of the first arm, well away from the junction */
      const d0 = dirs[0];
      const perp = { x: -d0.z, z: d0.x };
      const lat = armWidth * 0.5 + 0.45 + fw * 0.5;
      pts.push({
        label: 'arm footpath (control)',
        x: cx + d0.x * (r + 8) + perp.x * lat,
        z: cz + d0.z * (r + 8) + perp.z * lat,
      });

      const ray = new THREE.Raycaster();
      ray.far = Infinity;
      const down = new THREE.Vector3(0, -1, 0);
      const results = [];
      for (const p of pts) {
        ray.set(new THREE.Vector3(p.x, 400, p.z), down);
        const hits = ray.intersectObjects(g.scene.children, true);
        const h = hits[0];
        results.push({
          label: p.label,
          expectDeckY: +(heightAt(p.x, p.z) + 0.14).toFixed(3),
          hit: h ? {
            mesh: h.object.name || h.object.type,
            y: +h.point.y.toFixed(3),
            gap: +(h.point.y - (heightAt(p.x, p.z) + 0.14)).toFixed(3),
          } : null,
        });
      }

      return {
        junction: { x: +cx.toFixed(1), z: +cz.toFixed(1), r: +r.toFixed(2), deg: deg(j.id),
          arms: { E: hasE, W: hasW, S: hasS, N: hasN } },
        results,
      };
    });

    console.log(JSON.stringify(out, null, 2));
  });

finish(process.exitCode || 0);
