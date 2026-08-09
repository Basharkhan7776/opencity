import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const THREE = await import('three');
    const g = window.__game;
    const p = g.player;
    const H = 1 / 120;

    const grid = g.track.obstacles;
    const plantCols = grid.colliders.filter(c => c.kind === 'plant');
    const plantSizes = plantCols.map(c => c.radius);
    const b = plantCols[0];

    p.placeAt(b.x - 5, b.z);
    p.vx = 20; p.vy = 0; p.r = 0;
    p.yaw = 0;
    p.forward.set(1, 0, 0); p.right.set(0, 0, 1);
    for (let i = 0; i < 3 * 120; i++) {
      g.step(H);
    }

    return {
      plantColliders: plantCols.length,
      bushMinRadius: +Math.min(...plantSizes).toFixed(2),
      bushMaxRadius: +Math.max(...plantSizes).toFixed(2),
      bushRadiusSample: plantSizes.slice(0, 5).map(r => +r.toFixed(2)),
      bushPos: { x: b.x, z: b.z },
      carPos: [p.pos.x, p.pos.z],
      distToBush: +Math.hypot(p.pos.x - b.x, p.pos.z - b.z).toFixed(2),
      carSpeed: +p.speed.toFixed(1),
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
