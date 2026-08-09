import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 800, height: 600, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const out = await page.evaluate(() => {
    const g = window.__game;
    const world = g.world || g.flatWorld || Object.values(g).find(v => v?.vegetation?.placements);
    const pl = world.vegetation.placements;

    const trees = pl.filter(p => p.kind === 'tree' || p.kind === 'treeHigh');
    const heights = trees.map(t => t.sy);
    heights.sort((a, b) => a - b);

    /* Mountain grove clustering: count trees within 25m of each mountain tree. */
    const mtnTrees = trees.filter(t => Math.hypot(t.x - 0, t.z - 0) < 1500);
    let clustered = 0;
    let biggest = 0;
    for (const t of mtnTrees) {
      let near = 0;
      for (const u of mtnTrees) {
        if (u === t) continue;
        if (Math.hypot(t.x - u.x, t.z - u.z) < 25) near++;
      }
      if (near >= 3) clustered++;
      if (near > biggest) biggest = near;
    }

    const heightsSorted = heights;
    return {
      totalTrees: trees.length,
      trees,
      minH: +heightsSorted[0].toFixed(1),
      medianH: +heightsSorted[Math.floor(heightsSorted.length / 2)].toFixed(1),
      maxH: +heightsSorted[heightsSorted.length - 1].toFixed(1),
      mtnTreesNearCity: mtnTrees.length,
      mtnClustered: clustered,
      maxNeighboursIn25m: biggest,
    };
  });
  console.log(JSON.stringify(out));
});
finish(process.exitCode || 0);
