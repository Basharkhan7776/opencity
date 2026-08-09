import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const THREE = await import('three');
    const g = window.__game;
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

    const prof = [];
    for (let k = -14; k <= 14; k++) prof.push([k, lift(3000, -230 + k)]);

    const loopMid = lift(3000, -250);
    const stationJunction = lift(3000, -276);

    const marks = g.scene.getObjectByName('road-marks');
    const mp = marks ? marks.geometry.attributes.position.array : null;
    const zebraAtArm = (() => {
      if (!mp) return -1;
      let n = 0;
      for (let i = 0; i < mp.length; i += 3) {
        if (Math.abs(mp[i] - 3000) < 7.5 && mp[i + 2] > -241.5 && mp[i + 2] < -233.5) n++;
      }
      return n;
    })();
    const zebraAtDeadEnd = (() => {
      if (!mp) return -1;
      let n = 0;
      for (let i = 0; i < mp.length; i += 3) {
        if (Math.abs(mp[i] - 3000) < 7.5 && mp[i + 2] > -234.5 && mp[i + 2] < -230.5) n++;
      }
      return n;
    })();

    const rayJunction = rayAt(3000, -230);
    const rayArm = rayAt(3000, -222);

    g.autopilot(true);
    const samples = [];
    for (let i = 0; i < 20; i++) {
      samples.push({ t: i * 400, x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1), v: +(g.player.speed || 0).toFixed(1) });
      await new Promise(r => setTimeout(r, 400));
    }

    return {
      liftProfileNS: prof,
      loopMidLift: loopMid,
      stationJunctionLift: stationJunction,
      rayJunction,
      rayArm,
      zebraVertsAtJunctionArm: zebraAtArm,
      zebraVertsAtDeadEnd: zebraAtDeadEnd,
      drive: samples,
      marksVerts: mp ? mp.length / 3 : null,
      deckVerts: g.scene.getObjectByName('road-deck')?.geometry.attributes.position.count ?? null,
      fencesAtJunction: g.track.obstacles.query(3000, -230, 6, []).filter(c => c.kind === 'fence').length,
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
