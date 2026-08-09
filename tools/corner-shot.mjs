import { run } from './harness.mjs';
import { finish } from './tame.mjs';

await run({ width: 900, height: 900, hash: 'manual&tier=medium&seed=22&ink=1' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.evaluate(async () => {
    const g = window.__game;
    g.camera.position.set(3003.2, 60, -239.2);
    g.camera.lookAt(3003.2, 0, -239.2);
    g.camera.fov = 30;
    g.camera.updateProjectionMatrix();
    g.renderer?.render(g.scene, g.camera);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/opencode/corner-top.png' });
  console.log('saved');
});
finish(process.exitCode || 0);
