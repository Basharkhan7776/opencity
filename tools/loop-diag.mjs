import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const { createCitySystem } = await import('./src/flat/CityLayout.js');
    const city = createCitySystem(42);
    const byId = new Map();
    for (const n of city.graph.nodes) byId.set(n.id, n);

    const col = city.graph.nodes
      .filter(n => Math.abs(n.x - 3000) < 0.5 && n.z <= 0 && n.z >= -330)
      .sort((a, b) => b.z - a.z)
      .map(n => ({
        id: n.id, z: n.z,
        deg: city.graph.degree.get(n.id) || 0,
        edges: city.graph.edges.filter(e => e.a === n.id || e.b === n.id).map(e => {
          const o = e.a === n.id ? e.b : e.a;
          const no = byId.get(o);
          const len = Math.hypot(no.x - n.x, no.z - n.z);
          return { to: `${no.x},${no.z}#${o}`, w: e.width, len: +len.toFixed(0) };
        }),
      }));

    return { column: col };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
