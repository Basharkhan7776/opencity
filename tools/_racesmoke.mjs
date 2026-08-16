/* Smoke the city race: menu, start, field, ambient gate, leave. */
import { run } from './harness.mjs';
import { finish } from './tame.mjs';

const fail = [];
const key = async (page, name) => {
  await page.keyboard.press(name);
  await page.waitForTimeout(120);
};

await run({ hash: 'manual', cpu: true, timeout: 180_000 }, async ({ page, errs }) => {
  await page.waitForFunction(() => window.__game?.running, { timeout: 30_000 });
  await page.waitForTimeout(400);

  await key(page, 'Escape');
  const paused = await page.waitForFunction(() => window.__game.paused, { timeout: 5000 })
    .then(() => true).catch(() => false);
  if (!paused) fail.push('Escape did not pause');

  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  const view = await page.evaluate(() => window.__game.menu?.view);
  if (view !== 'race') fail.push('RACE did not open setup, view=' + view);

  const started = await page.evaluate(async () => {
    const g = window.__game;
    g.raceSetup.laps = 0;
    g.raceSetup.lengthIdx = 0;
    g.raceSetup.difficulty = 0;
    try {
      await g._startRace();
      return {
        ok: !!(g.race && g.race.live),
        paused: g.paused,
        field: g.race?._order?.length ?? 0,
        rivals: g.race?.entries?.length ?? 0,
        ambient: g.ambientEnabled,
        pedOn: g.pedestrians?.enabled,
        cps: g.race?.route?.checkpoints?.length ?? 0,
        loop: !!g.race?.route?.loop,
        holding: !!g.race?.holding,
      };
    } catch (e) {
      return { ok: false, err: String(e && e.stack || e) };
    }
  });
  if (!started.ok) fail.push('start failed ' + JSON.stringify(started));
  else {
    if (started.field !== 6) fail.push('field ' + started.field);
    if (started.rivals !== 5) fail.push('rivals ' + started.rivals);
    if (started.ambient !== false) fail.push('ambient still on');
    if (started.pedOn !== false) fail.push('peds still enabled');
    if (started.loop) fail.push('sprint generated a loop');
    if (started.cps < 2) fail.push('too few checkpoints');
    if (started.paused) fail.push('still paused after start');
    const same = await page.evaluate(() => {
      const g = window.__game;
      return g.race.entries.every(e => e.vehicle === g.race.playerVehicle);
    });
    if (!same) fail.push('rivals are not the same vehicle');
  }

  if (started.ok) {
    await page.evaluate(() => window.__game.race.skipCountdown());
    await page.waitForTimeout(200);
    const afterSkip = await page.evaluate(() => window.__game.race?.holding);
    if (afterSkip) fail.push('skipCountdown left holding');

    await page.evaluate(() => window.__game.endRace());
    const after = await page.evaluate(() => ({
      race: !!window.__game.race,
      ambient: window.__game.ambientEnabled,
      pedOn: window.__game.pedestrians?.enabled,
    }));
    if (after.race) fail.push('endRace left race live');
    if (after.ambient !== true) fail.push('ambient not restored');
    if (after.pedOn !== true) fail.push('peds not restored');
  }

  const sprintFin = await page.evaluate(async () => {
    const g = window.__game;
    g.raceSetup.laps = 0;
    g.raceSetup.lengthIdx = 0;
    await g._startRace();
    g.race.skipCountdown();
    const cps = g.race.route.checkpoints;
    for (let i = g.race.playerSlot.cp; i < cps.length && !g.race.over; i++) {
      g.player.placeAt(cps[i].x, cps[i].z);
      g.race.step(1 / 60, g.player);
    }
    const out = {
      finished: g.race.playerSlot.finished,
      over: g.race.over,
      results: !!g.race.results,
    };
    g.endRace();
    return out;
  });
  if (!sprintFin.finished || !sprintFin.over || !sprintFin.results) {
    fail.push('sprint finish ' + JSON.stringify(sprintFin));
  }

  const circuit = await page.evaluate(async () => {
    const g = window.__game;
    g.raceSetup.laps = 2;
    g.raceSetup.lengthIdx = 1;
    g.raceSetup.difficulty = 2;
    await g._startRace();
    const r = g.race;
    const out = {
      ok: !!(r && r.live),
      loop: !!r?.route?.loop,
      laps: r?.laps,
      field: r?._order?.length,
    };
    g.endRace();
    return out;
  });
  if (!circuit.ok) fail.push('circuit start failed ' + JSON.stringify(circuit));
  else {
    if (!circuit.loop) fail.push('laps>0 did not generate a loop');
    if (circuit.laps !== 2) fail.push('laps ' + circuit.laps);
    if (circuit.field !== 6) fail.push('circuit field ' + circuit.field);
  }

  const pageErrs = errs.filter(e => e.startsWith('[pageerror]'));
  if (pageErrs.length) fail.push('pageerror: ' + pageErrs.join(' | '));
});

if (fail.length) {
  console.log('FAIL\n  ' + fail.join('\n  '));
  finish(1);
} else {
  console.log('OK');
  finish(process.exitCode || 0);
}
