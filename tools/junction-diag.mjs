import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const g = window.__game;
    const { createCitySystem } = await import('./src/flat/CityLayout.js');
    const city = createCitySystem(42);
    const byId = new Map();
    for (const n of city.graph.nodes) byId.set(n.id, n);

    const j = city.graph.nodes.find(n => (city.graph.degree.get(n.id) || 0) >= 4);
    const jx = j.x, jz = j.z;
    const lift = g.track.roadLift;

    const inc = city.graph.edges.filter(e => e.a === j.id || e.b === j.id).map(e => {
      const na = byId.get(e.a), nb = byId.get(e.b);
      const dx = nb.x - na.x, dz = nb.z - na.z;
      const len = Math.hypot(dx, dz);
      return { id: e.id, a: e.a, b: e.b, w: e.width, len: +len.toFixed(1), na: [na.x, na.z], nb: [nb.x, nb.z] };
    });

    const jr = new Map();
    for (const n of city.graph.nodes) jr.set(n.id, 0);
    for (const e of city.graph.edges) {
      const r = e.width * 0.5 + 0.45;
      jr.set(e.a, Math.max(jr.get(e.a) || 0, r));
      jr.set(e.b, Math.max(jr.get(e.b) || 0, r));
    }

    const profile = [];
    for (let d = 0; d <= 12; d++) {
      profile.push({ d, lift: lift(jx + d, jz) });
    }

    const fences = g.track.obstacles.query(jx, jz, 8, []).map(c => ({
      x: +c.x.toFixed(1), z: +c.z.toFixed(1), kind: c.kind,
      d: +Math.hypot(c.x - jx, c.z - jz).toFixed(1),
    }));

    return {
      junction: { x: jx, z: jz, id: j.id, deg: city.graph.degree.get(j.id), jr: jr.get(j.id) },
      incident: inc,
      liftProfileEast: profile,
      fences,
      carPos: { x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1) },
      carSpeed: +g.player.speed?.toFixed(1),
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
