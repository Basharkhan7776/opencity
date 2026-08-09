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

    const results = {};

    /* 1. Grass → road (southward, onto the z=0 deck). Car starts at lat 14. */
    p.placeAt(3000, 14);
    p.yaw = -Math.PI / 2;
    p.forward.set(0, 0, -1);
    p.right.set(1, 0, 0);
    p.vx = 15; p.vy = 0; p.r = 0;
    let crossedEdge = false;
    for (let i = 0; i < 4 * 120; i++) {
      g.step(H);
      if (!crossedEdge && p.pos.z <= 7.45) crossedEdge = true;
    }
    results.upToRoad = {
      crossedDeckEdge: crossedEdge,
      finalZ: +p.pos.z.toFixed(2),
      speed: +p.speed.toFixed(1),
      onDeck: g.track.roadLift(3000, p.pos.z) > 0.1,
    };

    /* 2. Road → grass → back up (the round trip the user reported). */
    p.placeAt(3000, 0);
    p.yaw = Math.PI / 2;
    p.forward.set(0, 0, 1);
    p.right.set(-1, 0, 0);
    p.vx = 15; p.vy = 0; p.r = 0;
    let left = false, returned = false;
    for (let i = 0; i < 8 * 120; i++) {
      g.step(H);
      if (!left && p.pos.z >= 7.45) left = true;
      if (left && !returned && p.pos.z <= 7.45) returned = true;
    }
    results.roundTrip = {
      leftDeck: left,
      climbedBackOn: returned,
      finalZ: +p.pos.z.toFixed(2),
      speed: +p.speed.toFixed(1),
    };

    /* 3. Steep wall still blocks: artificial wall at z=40 by sampling a fake lift. */
    const savedLift = g.track.roadLift;
    g.track.roadLift = (x, z) => (z >= 40 && z <= 41 ? 0.5 : 0);
    p.placeAt(3000, 36);
    p.yaw = Math.PI / 2;
    p.forward.set(0, 0, 1);
    p.right.set(-1, 0, 0);
    p.vx = 15; p.vy = 0; p.r = 0;
    let maxH = 0, minSpeed = 999;
    for (let i = 0; i < 6 * 120; i++) {
      g.step(H);
      if (p.height > maxH) maxH = p.height;
      if (i > 60 && p.speed < minSpeed) minSpeed = p.speed;
    }
    results.wall = {
      stoppedAtZ: +p.pos.z.toFixed(2),
      minSpeed: +minSpeed.toFixed(1),
      maxHeight: +maxH.toFixed(2),
      crossed: p.pos.z > 41,
    };
    g.track.roadLift = savedLift;

    return results;
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
