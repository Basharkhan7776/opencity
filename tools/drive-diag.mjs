import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const g = window.__game;
    g.autopilot(true);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      const p = g.player;
      const drv = g.bot.drive(p, 1 / 120);
      samples.push({
        t: i * 500, x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1),
        v: +p.speed.toFixed(1), s: +p.s.toFixed(1), lat: +p.lat.toFixed(2),
        throttle: +drv.throttle.toFixed(2), brake: +drv.brake.toFixed(2),
        slip: +p.slipAngle.toFixed(2), air: p.airborne,
      });
      await new Promise(r => setTimeout(r, 500));
    }
    return { samples };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
