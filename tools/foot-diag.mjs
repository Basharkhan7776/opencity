import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const THREE = await import('three');
    const g = window.__game;
    const deck = g.scene.getObjectByName('road-deck');
    const pos = deck.geometry.attributes.position.array;
    const col = deck.geometry.attributes.color.array;

    const ringCols = (x0, x1) => {
      const out = [];
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] > x0 && pos[i] < x1 && Math.abs(pos[i + 2] + 9.45) < 0.01) {
          out.push([+pos[i].toFixed(1), ...col.slice(i, i + 3).map(c => +(c * 255).toFixed(0))]);
        }
      }
      return out.slice(0, 3);
    };
    const ringCols7 = (x0, x1) => {
      const out = [];
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] > x0 && pos[i] < x1 && Math.abs(pos[i + 2] + 7.0) < 0.01) {
          out.push([+pos[i].toFixed(1), ...col.slice(i, i + 3).map(c => +(c * 255).toFixed(0))]);
        }
      }
      return out.slice(0, 3);
    };
    const ringColsDeck = (x0, x1) => {
      const out = [];
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] > x0 && pos[i] < x1 && Math.abs(pos[i + 2] + 2.45) < 0.01) {
          out.push([+pos[i].toFixed(1), ...col.slice(i, i + 3).map(c => +(c * 255).toFixed(0))]);
        }
      }
      return out.slice(0, 3);
    };

    const outerEdge = () => {
      const out = [];
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] > 3007 && pos[i] < 3012 && Math.abs(pos[i + 2] + 239.45) < 0.01) {
          out.push([+pos[i].toFixed(2), ...col.slice(i, i + 3).map(c => +(c * 255).toFixed(0))]);
        }
      }
      return out;
    };

    const ray = (x, z) => {
      const r = new THREE.Raycaster();
      g.scene.updateMatrixWorld(true);
      r.camera = g.camera;
      r.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
      const h = r.intersectObjects(g.scene.children, true).find(h => h.distance > 5);
      return h ? (h.object.name || h.object.parent?.name || '?') : null;
    };

    const marks = g.scene.getObjectByName('road-marks');
    const mp = marks.geometry.attributes.position.array;
    const marksNear = [];
    for (let i = 0; i < mp.length; i += 3) {
      if (mp[i] > 3005.5 && mp[i] < 3012 && mp[i + 2] < -236 && mp[i + 2] > -242.5) {
        marksNear.push([+mp[i].toFixed(1), +mp[i + 2].toFixed(1)]);
      }
    }

    const wide = [];
    for (let i = 0; i < mp.length; i += 3) {
      if (mp[i] > 2990 && mp[i] < 3015 && mp[i + 2] < -224 && mp[i + 2] > -246) {
        wide.push([+mp[i].toFixed(1), +mp[i + 2].toFixed(1)]);
      }
    }

    const ginfo = {};
    {
      const { createCitySystem } = await import('./src/flat/CityLayout.js');
      const gr = createCitySystem(42);
      const byId = new Map();
      for (const n of gr.graph.nodes) byId.set(n.id, n);
      const node = id => byId.get(id);
      const jr = new Map();
      for (const n of gr.graph.nodes) jr.set(n.id, 0);
      for (const e of gr.graph.edges) {
        const r = e.width * 0.5 + 0.45;
        jr.set(e.a, Math.max(jr.get(e.a) || 0, r));
        jr.set(e.b, Math.max(jr.get(e.b) || 0, r));
      }
      const info = id => {
        const n = byId.get(id);
        return n ? { id, x: n.x, z: n.z, deg: gr.graph.degree.get(id), jr: jr.get(id) } : null;
      };
      ginfo.n7 = info(7); ginfo.n526 = info(526); ginfo.n527 = info(527); ginfo.n528 = info(528); ginfo.n2 = info(2);
      ginfo.e7 = gr.graph.edges.filter(e => e.a === 7 || e.b === 7).map(e => {
        const na = byId.get(e.a), nb = byId.get(e.b);
        return { a: e.a, b: e.b, len: +Math.hypot(nb.x - na.x, nb.z - na.z).toFixed(1), w: e.width };
      });
      ginfo.e526 = gr.graph.edges.filter(e => e.a === 526 || e.b === 526).map(e => {
        const na = byId.get(e.a), nb = byId.get(e.b);
        return { a: e.a, b: e.b, len: +Math.hypot(nb.x - na.x, nb.z - na.z).toFixed(1), w: e.width };
      });
      ginfo.e527 = gr.graph.edges.filter(e => e.a === 527 || e.b === 527).map(e => {
        const na = byId.get(e.a), nb = byId.get(e.b);
        return { a: e.a, b: e.b, len: +Math.hypot(nb.x - na.x, nb.z - na.z).toFixed(1), w: e.width };
      });
    }

    const island = g.scene.getObjectByName('island');
    const corners = {};
    if (island) {
      const ip = island.geometry.attributes.position.array;
      const ic = island.geometry.attributes.color.array;
      const pts = [];
      for (let i = 0; i < ip.length; i += 3) {
        if (ip[i] > 3005.5 && ip[i] < 3012 && ip[i + 2] < -236 && ip[i + 2] > -242.5) {
          pts.push([+ip[i].toFixed(1), +ip[i + 2].toFixed(1), ic.slice(i, i + 3).map(c => +(c * 255).toFixed(0)).join(',')]);
        }
      }
      corners.island = pts;
    } else {
      corners.island = 'MISSING';
    }

    const grid = [];
    for (const z of [-238.5, -239.0, -239.5, -240.0, -240.5]) {
      for (const x of [3007, 3008, 3009, 3010]) {
        grid.push([x, z, ray(x, z)]);
      }
    }

    return {
      footpathZ9: ringCols(3191, 3204),      /* z=-9.45 ring — grey */
      footpathZ7: ringCols7(3191, 3204),      /* z=-7.0 ring — kerb */
      deckLane: ringColsDeck(3191, 3204),     /* z=-2.45 — asphalt */
      eastOuterEdge: outerEdge(),             /* mitered footpath edge at z=-239.45 */
      grid,
      marksNear,
      wide,
      ginfo,
      corners,
      junctionCentre: ray(3000, -230),
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
