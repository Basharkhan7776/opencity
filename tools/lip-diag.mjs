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

    const runManual = async (sx) => {
      g.autopilot(false);
      g.botInput = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
      p.placeAt(sx, 0); p.vx = 0; p.vy = 0; p.r = 0;
      const rows = [];
      for (let i = 0; i < 6 * 120; i++) {
        g.step(H);
        if (i % 120 === 0) rows.push({ s: +p.s.toFixed(1), v: +p.speed.toFixed(1), lat: +p.lat.toFixed(2) });
      }
      return rows;
    };

    const runBot = async (sx) => {
      g.autopilot(true);
      p.placeAt(sx, 0); p.vx = 0; p.vy = 0; p.r = 0;
      const rows = [];
      for (let i = 0; i < 8 * 120; i++) {
        g.step(H);
        if (i % 120 === 0) rows.push({ s: +p.s.toFixed(1), v: +p.speed.toFixed(1), lat: +p.lat.toFixed(2) });
      }
      return rows;
    };

    return {
      manualFromPlaza: await runManual(3000),
      manualFromDeck: await runManual(3120),
      botFromDeck: await runBot(3120),
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
