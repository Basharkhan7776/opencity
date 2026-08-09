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

    g.autopilot(true);
    p.placeAt(3000, 0); p.vx = 0; p.vy = 0; p.r = 0;

    let vMinAfter = 999;
    const crossings = [];
    let prevS = p.s;
    for (let i = 0; i < 12 * 120; i++) {
      g.step(H);
      if (i > 4 * 120 && p.speed < vMinAfter) vMinAfter = p.speed;
      for (const jx of [3046, 3092, 3138, 3184]) {
        if (prevS < jx && p.s >= jx) crossings.push({ at: jx, speed: +p.speed.toFixed(1) });
      }
      prevS = p.s;
    }

    const lift = g.track.roadLift;
    const rayAt = (x, z) => {
      g.camera.up.set(0, 1, 0);
      g.camera.position.set(x, 40, z);
      g.camera.lookAt(x, 0, z);
      g.camera.updateMatrixWorld();
      g.camera.updateProjectionMatrix();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector3(0, 0, 0.5), g.camera);
      const h = ray.intersectObjects(g.scene.children, true).find(h => h.distance > 5);
      return h ? (h.object.name || (h.object.parent ? h.object.parent.name : '')) : null;
    };

    const marks = g.scene.getObjectByName('road-marks');
    const mp = marks ? marks.geometry.attributes.position.array : null;
    let zebra = 0;
    if (mp) {
      for (let i = 0; i < mp.length; i += 3) {
        if (Math.abs(mp[i] - 3000) < 9.5 && mp[i + 2] > -240.5 && mp[i + 2] < -237.0) zebra++;
      }
    }

    return {
      droveTo: +p.s.toFixed(0),
      endSpeed: +p.speed.toFixed(1),
      minSpeedAfter4s: +vMinAfter.toFixed(1),
      junctionCrossings: crossings,
      rayAtJunction: rayAt(3000, -230),
      rayAtJunctionCentre: rayAt(3000, 0),
      rayOnArm: rayAt(3000, -222),
      liftAtJunction: lift(3000, -230),
      liftAtJunctionCentre: lift(3000, 0),
      liftOnArm: lift(3000, -220),
      liftStationJunction: lift(3000, -276),
      liftLoopMid: lift(3000, -250),
      zebraVertsOnArm: zebra,
      fencesNearJunction: g.track.obstacles.query(3000, -230, 8, []).filter(c => c.kind === 'fence').length,
      marksVerts: mp ? mp.length / 3 : null,
      deckVerts: g.scene.getObjectByName('road-deck')?.geometry.attributes.position.count ?? null,
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
