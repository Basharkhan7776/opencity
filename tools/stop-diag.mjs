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
    for (let i = 0; i < 8 * 120; i++) g.step(H);
    const s = p.s;

    const obs = g.track.obstacles.query(p.pos.x, p.pos.z, 12, [])
      .map(c => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), kind: c.kind, r: c.radius, d: +Math.hypot(c.x - p.pos.x, c.z - p.pos.z).toFixed(1) }))
      .sort((a, b) => a.d - b.d);

    const bump = g.track.obstacles.bump ? g.track.obstacles.bump(p.pos.x, p.pos.z, p.up, p.forward, p.right, 1) : null;

    return {
      stoppedAt: +s.toFixed(1),
      pos: { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) },
      obstaclesNear: obs.slice(0, 8),
      bump: bump,
      liftHere: g.track.roadLift(p.pos.x, p.pos.z),
      heightAt: g.track.heightAt(p.pos.x, p.pos.z),
      offRoad: p.offRoad,
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
