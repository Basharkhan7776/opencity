import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const g = window.__game;
    const p = g.player;
    const H = 1 / 120;

    g.autopilot(true);
    p.placeAt(3120, 0); p.vx = 0; p.vy = 0; p.r = 0;
    const rows = [];
    for (let i = 0; i < 8 * 120; i++) {
      g.step(H);
      if (i % 5 === 0 && p.s > 3140 && p.s < 3147) {
        rows.push({
          s: +p.s.toFixed(2), v: +p.speed.toFixed(2),
          y: +p.pos.y.toFixed(2), air: p.airborne,
          yaw: +(p.yaw * 180 / Math.PI).toFixed(0),
        });
      }
    }
    return { rows };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
