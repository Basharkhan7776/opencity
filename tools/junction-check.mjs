import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const THREE = await import('three');
    const g = window.__game;
    const { createCitySystem } = await import('./src/flat/CityLayout.js');
    const city = createCitySystem(42);
    const byId = new Map();
    for (const n of city.graph.nodes) byId.set(n.id, n);

    const j = city.graph.nodes.find(n => (city.graph.degree.get(n.id) || 0) >= 4);
    const deg = city.graph.degree.get(j.id);
    const jx = j.x, jz = j.z;

    const e = city.graph.edges.find(ed => ed.a === j.id || ed.b === j.id);
    const na = byId.get(e.a), nb = byId.get(e.b);
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    const tx = dx / len, tz = dz / len;
    const toward = (e.a === j.id) ? 1 : -1;
    const armX = jx + tx * toward * 20, armZ = jz + tz * toward * 20;

    const lift = g.track.roadLift;
    const fencesAtJunction = g.track.obstacles.query(jx, jz, 5, []).filter(c => c.kind === 'fence').length;
    const fencesOnArm = g.track.obstacles.query(armX, armZ, 5, []).filter(c => c.kind === 'fence').length;

    g.camera.up.set(0, 1, 0);
    g.camera.position.set(jx, 40, jz);
    g.camera.lookAt(jx, 0, jz);
    g.camera.updateMatrixWorld();
    g.camera.updateProjectionMatrix();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector3(0, 0, 0.5), g.camera);
    const hits = ray.intersectObjects(g.scene.children, true).slice(0, 3).map(h => ({
      name: h.object.name || (h.object.parent ? h.object.parent.name : ''),
      dist: +h.distance.toFixed(1),
    }));

    g.player.placeAt(jx, jz);
    g.player.applyTo(g.playerView);
    const p0 = { x: g.player.pos.x, z: g.player.pos.z };
    await new Promise(r => setTimeout(r, 800));
    const p1 = { x: g.player.pos.x, z: g.player.pos.z };
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);

    const marks = g.scene.getObjectByName('road-marks');
    const deck = g.scene.getObjectByName('road-deck');
    const totalFences = g.track.obstacles.colliders.filter(c => c.kind === 'fence').length;

    return {
      junction: { x: +jx.toFixed(0), z: +jz.toFixed(0), deg },
      liftAtJunction: lift ? lift(jx, jz) : null,
      liftOnArm: lift ? lift(armX, armZ) : null,
      fencesAtJunction,
      fencesOnArm,
      totalFences,
      rayHits: hits,
      marksVerts: marks ? marks.geometry.attributes.position.count : null,
      deckVerts: deck ? deck.geometry.attributes.position.count : null,
      carMovedM: +moved.toFixed(1),
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
