import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async () => {
    const THREE = await import('three');
    const g = window.__game;
    const deck = g.scene.getObjectByName('road-deck');
    const p = deck.geometry.attributes.position.array;
    const inSquare = [];
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i] - 3000) < 7.5 && Math.abs(p[i + 2] + 230) < 7.5) inSquare.push([+p[i].toFixed(2), +p[i + 1].toFixed(2), +p[i + 2].toFixed(2)]);
    }
    const centreRow = inSquare.filter(v => Math.abs(v[2] + 230) < 0.5);
    deck.geometry.computeBoundingBox();
    const bb = deck.geometry.boundingBox;
    const ray = new THREE.Raycaster();
    g.scene.updateMatrixWorld(true);
    ray.camera = g.camera;
    const origin = new THREE.Vector3(3000, 40, -230);
    const dir = new THREE.Vector3(0, -1, 0);
    ray.set(origin, dir);
    const hits = ray.intersectObjects(g.scene.children, true)
      .map(h => ({ d: +h.distance.toFixed(1), n: h.object.name || (h.object.parent ? h.object.parent.name : '?') }))
      .slice(0, 5);
    const deckHits = ray.intersectObject(deck)
      .map(h => ({ d: +h.distance.toFixed(2), n: 'road-deck' }));
    const off = new THREE.Raycaster();
    off.set(new THREE.Vector3(3000.5, 40, -230.5), new THREE.Vector3(0, -1, 0));
    const offHits = off.intersectObject(deck)
      .map(h => ({ d: +h.distance.toFixed(2), n: 'road-deck' }));
    const corner = new THREE.Raycaster();
    corner.set(new THREE.Vector3(3002, 40, -228), new THREE.Vector3(0, -1, 0));
    const cornerHits = corner.intersectObject(deck)
      .map(h => ({ d: +h.distance.toFixed(2), n: 'road-deck' }));
    const allDecks = [];
    g.scene.traverse(o => {
      if (o.name === 'road-deck' || o.name === 'road-walls' || o.name === 'city-roads') {
        allDecks.push({
          name: o.name,
          type: o.type,
          visible: o.visible,
          count: o.geometry ? o.geometry.attributes.position.count : null,
          idx: o.geometry ? o.geometry.index?.count : null,
          parent: o.parent?.name || null,
          pos: [o.position.x, o.position.y, o.position.z],
        });
      }
    });
    const diagRay = new THREE.Raycaster();
    diagRay.set(new THREE.Vector3(3000, 40, -260), new THREE.Vector3(0, -1, 0));
    const diagHits = diagRay.intersectObject(deck)
      .map(h => ({ d: +h.distance.toFixed(2), n: 'road-deck' }));
    return {
      deckVerts: p.length / 3,
      allDecks,
      junctionSquareVerts: inSquare.length,
      centreRow,
      sample: inSquare.slice(0, 8),
      islandAtJunction: g.track.heightAt(3000, -230),
      hits,
      deckHits,
      offHits,
      cornerHits,
      diagHits,
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
