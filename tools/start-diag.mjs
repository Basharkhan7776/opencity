import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const g = window.__game;
    const near = g.track.obstacles.query(3000, 0, 30, [])
      .map(c => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), kind: c.kind, r: c.radius }))
      .sort((a, b) => Math.hypot(a.x - 3000, a.z) - Math.hypot(b.x - 3000, b.z));
    return {
      count: near.length,
      nearest: near.slice(0, 12),
      carPos: { x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1), y: +g.player.pos.y.toFixed(2) },
      carSpeed: +(g.player.speed || 0).toFixed(1),
      liftAtStart: g.track.roadLift(3000, 0),
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
