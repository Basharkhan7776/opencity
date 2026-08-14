/* Vertex-based wheel contact check.
 *
 * The fleet's wheels are scaled by k so their real radius differs from
 * CAR.wheelR (0.50). mesh.js fixes this with
 *   spin.position.y = -box.min.y - CAR.wheelR
 * which should land the tire bottom exactly on the road at rest:
 *   bottom = root.y - rideHeight + susp
 * (rideHeight = 0.38). THREE.Box3().setFromObject() on a wheel reports an
 * inflated world box at runtime (~√2 × the true extent), so contact must be
 * measured from the raw geometry vertices transformed by matrixWorld, not
 * from setFromObject. This tool does that for every vehicle in the garage.
 *
 * Read-only. Nothing under src/ is touched.
 *
 *   node tools/_wheel-verify.mjs [--tier medium]
 */
import { run } from './harness.mjs';
import { finish } from './tame.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const TIER = flag('tier', 'medium');

const RIDE = 0.38;   // CAR.rideHeight, src/car/mesh.js

await run({ width: 800, height: 450, hash: `manual&tier=${TIER}&seed=22&ink=1&hud=0&cap=0` },
  async ({ page }) => {
    await page.evaluate(() => window.__game.begin());
    await page.waitForFunction(() => window.__game?.scene && window.__game.playerView,
      null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    const rows = await page.evaluate(async ({ RIDE }) => {
      const g = window.__game;
      const transformY = (o, x, y, z) => {
        const m = o.matrixWorld.elements;
        return m[1] * x + m[5] * y + m[9] * z + m[13];
      };
      const minVertexY = (o) => {
        let min = Infinity;
        o.traverse(m => {
          if (!m.isMesh || !m.geometry?.attributes?.position) return;
          const pos = m.geometry.attributes.position;
          for (let j = 0; j < pos.count; j++) {
            const y = transformY(m, pos.getX(j), pos.getY(j), pos.getZ(j));
            if (y < min) min = y;
          }
        });
        return min;
      };
      /* setFromObject-style: the geometry bounding box corners, transformed. */
      const boxMinY = (o) => {
        let min = Infinity;
        o.traverse(m => {
          if (!m.isMesh || !m.geometry) return;
          const b = m.geometry.boundingBox;
          if (!b) return;
          const cs = [
            [b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z],
            [b.min.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.min.z],
            [b.min.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.max.z],
            [b.min.x, b.max.y, b.max.z], [b.max.x, b.max.y, b.max.z],
          ];
          for (const [x, y, z] of cs) min = Math.min(min, transformY(m, x, y, z));
        });
        return min;
      };

      const results = [];
      let idx = 0;
      while (true) {
        g.vehicleIndex = idx;
        try { await g._loadVehicle(idx); } catch { break; }
        await new Promise(r => setTimeout(r, 60));

        const p = g.player, view = g.playerView;
        if (!view || !view.wheels.length) { idx++; continue; }

        p.placeAt(p.s, 0);
        for (let k = 0; k < 120; k++) g.step(1 / 60);
        p.applyTo(view, 0);
        g.scene.updateMatrixWorld(true);

        const wheelRows = [];
        for (let i = 0; i < view.wheels.length; i++) {
          const spin = view.wheels[i].userData.spin;
          const susp = p.susp[i] ?? 0;
          const expected = view.root.position.y - RIDE + susp;
          wheelRows.push({
            i,
            spinY: +spin.position.y.toFixed(4),
            susp: +susp.toFixed(3),
            vertexMin: +minVertexY(spin).toFixed(3),
            boxMin: +boxMinY(spin).toFixed(3),
            expected: +expected.toFixed(3),
            gap: +(minVertexY(spin) - expected).toFixed(3),
          });
        }

        const names = [...g.vehicleViews.keys()];
        results.push({
          name: names[names.length - 1] ?? String(idx),
          rootY: +view.root.position.y.toFixed(3),
          wheels: wheelRows,
        });
        idx++;
        if (idx > 60) break;
      }
      return results;
    }, { RIDE });

    console.log('vehicle  rootY  wheel  spinY   susp  vertexMin  boxCorners  expected  gap');
    for (const r of rows) {
      for (const w of r.wheels) {
        console.log(`${String(r.name).padEnd(22)} ${r.rootY.toFixed(2)}  ${w.i}  `
          + `${w.spinY.toFixed(4)}  ${w.susp.toFixed(3)}  ${w.vertexMin.toFixed(3)}`
          + `  ${w.boxMin.toFixed(3)}  ${w.expected.toFixed(3)}  ${w.gap.toFixed(3)}`);
      }
    }
    const ok = rows.every(r => r.wheels.every(w => Math.abs(w.gap) < 0.02));
    console.log(ok ? '\nPASS: every tyre sits on the road (|gap| < 0.02 m)'
      : '\nFAIL: some tyres float or sink (see gap column)');
    finish(ok ? 0 : 1);
  });
