/* Smoke ESC → SETTINGS: scale, distance, peds, shadows, persist. */
import { run } from './harness.mjs';
import { finish } from './tame.mjs';

const fail = [];
const key = async (page, name) => {
  await page.keyboard.press(name);
  await page.waitForTimeout(200);
};

await run({ hash: 'manual', cpu: true, timeout: 120_000 }, async ({ page, errs }) => {
  await page.waitForFunction(() => window.__game?.running, { timeout: 30_000 });
  await page.evaluate(() => {
    localStorage.removeItem('opencity.gfx');
    const g = window.__game;
    g.gfx = g._defaultGfx();
    g._applyGfx({ persist: false });
  });

  await key(page, 'Escape');
  const paused = await page.waitForFunction(() => window.__game.paused, { timeout: 5000 })
    .then(() => true).catch(() => false);
  if (!paused) fail.push('Escape did not pause');

  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  const view = await page.evaluate(() => window.__game.menu?.view);
  if (view !== 'settings') fail.push('SETTINGS did not open, view=' + view);

  const before = await page.evaluate(() => window.__game.renderer.getPixelRatio());
  const applied = await page.evaluate(() => {
    const g = window.__game;
    g.gfx.resIdx = 5;
    g.gfx.distIdx = 0;
    g.gfx.pedIdx = 0;
    g.gfx.shadowIdx = 0;
    g._applyGfx({ persist: true, preview: false });
    return {
      pr: g.renderer.getPixelRatio(),
      dist: g.viewRadius,
      fog: g.scene.fog.far,
      peds: g.pedestrians.limit,
      shadows: g.renderer.shadowMap.enabled,
      cast: g.sun.castShadow,
      saved: JSON.parse(localStorage.getItem('opencity.gfx') || 'null'),
    };
  });

  if (!(applied.pr < before - 1e-6)) {
    fail.push('pixel ratio did not drop ' + before + ' → ' + applied.pr);
  }
  if (applied.dist !== 250 || applied.fog !== 250) {
    fail.push('draw distance ' + applied.dist + ' fog ' + applied.fog);
  }
  if (applied.peds !== 0) fail.push('ped limit ' + applied.peds);
  if (applied.shadows || applied.cast) fail.push('shadows still on');
  if (!applied.saved || applied.saved.resIdx !== 5 || applied.saved.shadowIdx !== 0) {
    fail.push('persist ' + JSON.stringify(applied.saved));
  }

  const merge = await page.evaluate(() => {
    const g = window.__game;
    const defaults = g._defaultGfx();
    localStorage.setItem('opencity.gfx', JSON.stringify({ resIdx: 3, pedIdx: 4 }));
    const partial = g._loadGfx();
    localStorage.setItem('opencity.gfx', 'not-json');
    const corrupt = g._loadGfx();
    localStorage.removeItem('opencity.gfx');
    const missing = g._loadGfx();
    return { defaults, partial, corrupt, missing };
  });
  if (merge.partial.resIdx !== 3 || merge.partial.pedIdx !== 4) {
    fail.push('partial local not applied ' + JSON.stringify(merge.partial));
  }
  if (merge.partial.distIdx !== merge.defaults.distIdx) {
    fail.push('missing field did not fall back to default');
  }
  if (merge.corrupt.resIdx !== merge.defaults.resIdx || merge.missing.resIdx !== merge.defaults.resIdx) {
    fail.push('corrupt/missing did not use defaults');
  }

  const pageErrs = errs.filter(e => e.startsWith('[pageerror]'));
  if (pageErrs.length) fail.push(pageErrs.join(' | '));
});

if (fail.length) {
  console.log('FAIL\n  ' + fail.join('\n  '));
  finish(1);
} else {
  console.log('OK');
  finish(process.exitCode || 0);
}
