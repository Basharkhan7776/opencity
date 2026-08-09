import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const g = window.__game;
    g.autopilot(true);
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push({
        t: i * 400,
        sim: +g.time.toFixed(1),
        fps: +g.fps.toFixed(0),
        v: +g.player.speed.toFixed(1),
        x: +g.player.pos.x.toFixed(1),
      });
      await new Promise(r => setTimeout(r, 400));
    }
    return { rows };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
