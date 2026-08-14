import { run, capture } from './harness.mjs';
import { finish } from './tame.mjs';
import path from 'node:path';

await run({ width: 1400, height: 900, hash: 'manual&tier=medium&seed=22&ink=1&hud=0' }, async ({ page }) => {
  await page.evaluate(() => window.__game.begin());
  await page.waitForFunction(() => window.__game?.scene, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const geo = await page.evaluate(() => {
    const mp = window.__game.scene.getObjectByName('road-marks')?.geometry.attributes.position.array;
    const quads = [];
    for (let i = 0; i + 11 < mp.length; i += 12) {
      const xs = [mp[i], mp[i+3], mp[i+6], mp[i+9]];
      const zs = [mp[i+2], mp[i+5], mp[i+8], mp[i+11]];
      const cx = (xs[0]+xs[1]+xs[2]+xs[3])/4;
      const cz = (zs[0]+zs[1]+zs[2]+zs[3])/4;
      if (Math.abs(cx - 3000) < 8 && cz > -242 && cz < -236) {
        const xspan = Math.max(...xs)-Math.min(...xs);
        const zspan = Math.max(...zs)-Math.min(...zs);
        quads.push({
          cx:+cx.toFixed(2), cz:+cz.toFixed(2),
          xspan:+xspan.toFixed(3), zspan:+zspan.toFixed(3),
          xMin:+Math.min(...xs).toFixed(2), xMax:+Math.max(...xs).toFixed(2),
        });
      }
    }
    const maxLat = quads.length ? Math.max(...quads.map(q => Math.max(Math.abs(q.xMin-3000), Math.abs(q.xMax-3000)))) : 0;
    return {
      n: quads.length,
      sample: quads.slice(0, 4),
      maxLatFromCentre: +maxLat.toFixed(2),
      onAsphaltOnly: maxLat <= 7,
      offKerb: maxLat <= 7.45,
      offFootpath: maxLat <= 7.45, // foot starts 7.45
      barAlongRoad: quads[0]?.zspan,
      barAcrossRoad: quads[0]?.xspan,
    };
  });
  console.log(JSON.stringify(geo, null, 2));

  // top-down
  await page.evaluate(() => {
    const g = window.__game;
    g.camera.up.set(0, 0, -1);
    g.camera.position.set(3000, 20, -239);
    g.camera.lookAt(3000, 0, -239);
    g.camera.updateMatrixWorld();
    (g.pipeline?.render ? g.pipeline : g.renderer).render(g.scene, g.camera);
  });
  await page.waitForTimeout(120);
  await capture(page, path.resolve('shots/zebra/final-top.png'));

  // driver view approaching
  await page.evaluate(() => {
    const g = window.__game;
    g.camera.up.set(0, 1, 0);
    g.camera.position.set(3000, 4, -255);
    g.camera.lookAt(3000, 0, -238);
    g.camera.fov = 60;
    g.camera.updateProjectionMatrix();
    g.camera.updateMatrixWorld();
    (g.pipeline?.render ? g.pipeline : g.renderer).render(g.scene, g.camera);
  });
  await page.waitForTimeout(100);
  await capture(page, path.resolve('shots/zebra/final-drive.png'));

  // elevated 3/4
  await page.evaluate(() => {
    const g = window.__game;
    g.camera.position.set(3015, 12, -250);
    g.camera.lookAt(3000, 0, -235);
    g.camera.updateMatrixWorld();
    (g.pipeline?.render ? g.pipeline : g.renderer).render(g.scene, g.camera);
  });
  await page.waitForTimeout(100);
  await capture(page, path.resolve('shots/zebra/final-elev.png'));
});
finish(0);
