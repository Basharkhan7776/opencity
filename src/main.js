/* OPENCITY — open road.
 *
 * The rally stripped away: no stage, no rivals, no countdown, no finish.
 * Just the car, a flat road that never ends, and the same cel pipeline,
 * chase camera and physics the rally used. `s` wraps invisibly (see
 * FlatTrack) so the drive is endless in every direction.
 *
 * The harness control surface from the rally build is kept — begin, step,
 * renderOnce, telemetry, goTo, driveTo, warp, autopilot — because tools/
 * and the boot path in index.html depend on window.__game.
 */
import * as THREE from 'three';
import { FlatTrack, ROAD_WIDTH, INTER_X, WATER_LEVEL } from './flat/FlatTrack.js';
import { buildFlatWorld } from './flat/FlatWorld.js';
import { loadCarGLB } from './car/mesh.js';
import { Car, MAX_RPM, steerLockAt } from './car/physics.js';
import { ChaseCamera } from './car/camera.js';
import { Driver } from './car/driver.js';
import { Input } from './core/input.js';
import { celMaterial } from './render/cel.js';
import { CelPipeline } from './render/outline.js';
import { clamp } from './core/util.js';

/* Silent audio stub — real Audio engine disabled for now. */
const Audio = class {
  start() {}
  stop() {}
  update() {}
  impact() {}
};

/* The rally stage's light rig, moved over verbatim so the comic look
   survives the flat land. See the original main.js for the reasoning. */
const SUN_OFFSET = new THREE.Vector3(-150, 125, 165);
const FILL_OFFSET = new THREE.Vector3(150, 56, -165);

const SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 8;

const q = new URLSearchParams(location.hash.slice(1));

const TIERS = {
  low: { dpr: 0.75, shadow: 1536, shadowDist: 30 },
  medium: { dpr: 1.0, shadow: 2048, shadowDist: 38 },
  high: { dpr: 1.0, shadow: 4096, shadowDist: 46 },
};

/* The player's garage. Each entry is a GLB from assets/vehicle/ which
   buildCarFromGLTF scales onto the physics platform, keeping the model's own
   baked track width so every vehicle runs a different tyre spacing. V cycles
   through these; #car=<name> picks the starting one. */
const VEHICLES = [
  { name: 'Sports Sedan', url: '/assets/vehicle/sedan-sports.glb', perf: { power: 1.0, drag: 1.0 } },
  { name: 'Sedan', url: '/assets/vehicle/sedan.glb', perf: { power: 0.69, drag: 1.0 } },
  { name: 'Hatchback', url: '/assets/vehicle/hatchback-sports.glb', perf: { power: 0.59, drag: 1.0 } },
  { name: 'SUV', url: '/assets/vehicle/suv.glb', perf: { power: 0.72, drag: 1.0 } },
  { name: 'Luxury SUV', url: '/assets/vehicle/suv-luxury.glb', perf: { power: 0.88, drag: 1.05 } },
  { name: 'Race', url: '/assets/vehicle/race.glb', perf: { power: 1.58, drag: 0.95 } },
  { name: 'Future Race', url: '/assets/vehicle/race-future.glb', perf: { power: 1.72, drag: 0.9 } },
  { name: 'Police', url: '/assets/vehicle/police.glb', perf: { power: 0.92, drag: 1.0 } },
  { name: 'Taxi', url: '/assets/vehicle/taxi.glb', perf: { power: 0.49, drag: 1.0 } },
  { name: 'Van', url: '/assets/vehicle/van.glb', perf: { power: 0.44, drag: 1.0 } },
  { name: 'Delivery', url: '/assets/vehicle/delivery.glb', perf: { power: 0.4, drag: 1.15 } },
  { name: 'Delivery Flat', url: '/assets/vehicle/delivery-flat.glb', perf: { power: 0.42, drag: 1.1 } },
  { name: 'Truck', url: '/assets/vehicle/truck.glb', perf: { power: 0.55, drag: 1.35 } },
  { name: 'Flatbed Truck', url: '/assets/vehicle/truck-flat.glb', perf: { power: 0.52, drag: 1.3 } },
  { name: 'Garbage Truck', url: '/assets/vehicle/garbage-truck.glb', perf: { power: 0.38, drag: 1.45 } },
  { name: 'Firetruck', url: '/assets/vehicle/firetruck.glb', perf: { power: 0.7, drag: 1.4 } },
  { name: 'Ambulance', url: '/assets/vehicle/ambulance.glb', perf: { power: 0.75, drag: 1.2 } },
  { name: 'Tractor', url: '/assets/vehicle/tractor.glb', perf: { power: 0.35, drag: 1.25 } },
  { name: 'Tractor Shovel', url: '/assets/vehicle/tractor-shovel.glb', perf: { power: 0.32, drag: 1.3 } },
  { name: 'Police Tractor', url: '/assets/vehicle/tractor-police.glb', perf: { power: 0.36, drag: 1.25 } },
];

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.paused = false;
    this.running = false;
    this.fps = 0;
    this._acc = 0; this._frames = 0;
    this._simAcc = 0;
    this.time = 0;

    this._manual = location.hash.includes('manual');
    this.tier = TIERS[q.get('tier')] ? q.get('tier') : 'high';
    this.fpsCap = +(q.get('cap') || 60);
    this._lastFrame = 0;
    this._lastRaf = -1;
    this._vsync = Infinity;
    this._vsyncMin = Infinity;
    this._vsyncSeen = 0;
    this._vsyncSum = 0;
    this._vsyncN = 0;
    this._pending = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, TIERS[this.tier].dpr));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8cc8e8);
    /* No fog — this world has distance to look at (the whole playground is
       visible from a standstill), so nothing melts into the horizon. */

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, 2600);

    /* The world. */
    this.track = new FlatTrack();
    const sm = TIERS[this.tier];
    const world = buildFlatWorld({
      shadowSize: Math.min(sm.shadow, this.renderer.capabilities.maxTextureSize),
      shadowDist: sm.shadowDist,
    });
    this.scene.add(world.root);
    this.sun = world.sun;
    /* Trees/rocks + city buildings/fences: colliders now; meshes stream in. */
    if (world.obstacles) this.track.setObstacles(world.obstacles);
    else if (world.vegetation) this.track.setObstacles(world.vegetation.grid);
    world.loadCity?.().catch(err => console.warn('city', err));
    world.loadVegetation?.().catch(err => console.warn('vegetation', err));

    this.buildCars();
    /* Sun follows the car; aim it at the island centre for the first frame. */
    this.sun.position.copy(this.player.pos).add(SUN_OFFSET);
    this.sun.target.position.copy(this.player.pos);
    this.sun.target.updateMatrixWorld();

    this.input = new Input();
    this.chase = new ChaseCamera(this.camera);

    /* Free-fly camera: Ctrl+Shift+C toggles between the chase cam and a free
       camera that can roam the whole map (WASD + Space/Shift). Toggling back
       puts the car back at the island centre. */
    this.fly = false;
    addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyC' || e.key === 'C')) {
        e.preventDefault();
        this.toggleFly();
      }
    });

    /* Mouse look: orbits around the vehicle middle (see ChaseCamera). Pointer
       lock keeps the cursor off-screen while driving; ESC pause restores it. */
    this.lookYaw = 0;
    this.lookPitch = 0;
    this._pointerLocked = false;
    this._setCursorVisible(false);
    this.canvas.addEventListener('click', () => {
      if (!this.paused) this._requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === this.canvas;
      /* Cursor only while the pause menu is open. While driving it stays
         hidden even if the browser briefly drops pointer lock (Esc once). */
      this._setCursorVisible(this.paused);
    });
    addEventListener('mousemove', e => {
      if (this.paused) return;
      /* Prefer pointer-lock deltas; fall back to raw movement if unlocked. */
      if (e.movementX === 0 && e.movementY === 0) return;
      this.lookYaw -= e.movementX * 0.004;
      this.lookPitch = clamp(this.lookPitch - e.movementY * 0.003, -0.85, 0.55);
    });

    this.pipeline = new CelPipeline(this.renderer, this.scene, this.camera, {
      enabled: q.get('post') !== '0',
      outlines: q.get('ink') !== '0',
      grade: q.get('grade') !== '0',
      vignette: q.get('vignette') !== '0',
      speed: true,
      impact: q.get('impactfx') !== '0',
    });

    this.audio = new Audio();
    let woke = false;
    const wake = () => {
      this.audio.start();
      if (woke) return;
      woke = true;
    };
    addEventListener('pointerdown', wake, { once: true });
    addEventListener('keydown', wake, { once: true });

    this.hud = new Hud(document.getElementById('hud'));
    this.hud.setCarName(VEHICLES[this.vehicleIndex].name);
    this.hudOn = q.get('hud') !== '0';

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildCars() {
    this.player = new Car(this.track, { palette: 0, perf: VEHICLES[0].perf });
    /* Spawn on the island flats at map centre. */
    this.player.placeAt(INTER_X, 0);

    this.vehicleViews = new Map();
    this.vehiclesLoading = new Map();

    const want = q.get('car');
    let idx = 0;
    if (want) {
      const byUrl = VEHICLES.findIndex(v => v.url.endsWith(`/${want}.glb`));
      if (byUrl >= 0) idx = byUrl;
    }
    this.vehicleIndex = idx;
    addEventListener('keydown', e => {
      if (e.key === 'v' || e.key === 'V') this.cycleVehicle();
    });
    this._loadVehicle(this.vehicleIndex);
  }

  /* Give a player view its materials: the GLB models are textured, so they
     get the game's cel ramp with their own colormap. */
  _styleView(view) {
    view.root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const map = o.material ? o.material.map : null;
      o.material = celMaterial({ map });
    });
  }

  cycleVehicle() {
    this.vehicleIndex = (this.vehicleIndex + 1) % VEHICLES.length;
    this._loadVehicle(this.vehicleIndex);
  }

  async _setVehicle(idx) {
    const v = VEHICLES[idx];
    if (this.vehicleViews.has(v.name)) return this.vehicleViews.get(v.name);
    if (this.vehiclesLoading.has(v.name)) return this.vehiclesLoading.get(v.name);
    const p = loadCarGLB(v.url).then(view => {
      this._styleView(view);
      this.vehicleViews.set(v.name, view);
      return view;
    });
    this.vehiclesLoading.set(v.name, p);
    return p;
  }

  async _loadVehicle(idx) {
    const v = VEHICLES[idx];
    const view = await this._setVehicle(idx);
    if (VEHICLES[this.vehicleIndex] !== v) return;   // user moved on while loading
    this.player.setPerf(v.perf);
    if (this.playerView && this.playerView.root.parent === this.scene) {
      this.scene.remove(this.playerView.root);
    }
    this.scene.add(view.root);
    this.playerView = view;
    this.hud.setCarName(v.name);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.hud.resize(w, h, devicePixelRatio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  step(dt) {
    this.input.update(dt);

    /* Escape toggles a freeze. The world is not redrawn while paused — see
       frame() — so the picture is genuinely still. */
    if (this.input.pausePressed) this.togglePause();
    if (this.paused) return;

    if (this.fly) {
      this.flyStep(dt);
      this.pipeline.update(dt, { speed: 0 });
      this.hud.update(dt, { speed: 0, gear: 0 });
      return;
    }

    this.time += dt;
    if (this.input.resetPressed) this.respawn();

    const p = this.player;
    p.lastImpact = 0;
    p.landingForce = 0;

    /* Fixed 120 Hz substeps, exactly as the rally ran them. */
    this._simAcc += dt;
    let n = 0;
    while (this._simAcc >= SUBSTEP && n < MAX_SUBSTEPS) {
      p.step(SUBSTEP, this.driverInput());
      this._simAcc -= SUBSTEP;
      n++;
    }
    if (n >= MAX_SUBSTEPS) this._simAcc = 0;
    const alpha = this._simAcc / SUBSTEP;

    /* Drove into the sea — snap back to the island centre. */
    if (this._isSubmerged(p)) this.teleportToCenter();

    if (this.playerView) p.applyTo(this.playerView, alpha);

    this.pipeline.update(dt, { speed: p.speed });
    if (p.lastImpact > 0.02) {
      this.chase.addShake(p.lastImpact);
      this.pipeline.addImpact(p.lastImpact);
      this.audio.impact(p.lastImpact);
    }

    this.chase.update(p, dt, {
      lookBack: this.input.lookBack,
      orbitYaw: this.lookYaw,
      orbitPitch: this.lookPitch,
    });

    /* Keep the sun's shadow frustum over the car. */
    this.sun.position.copy(p.pos).add(SUN_OFFSET);
    this.sun.target.position.copy(p.pos);
    this.sun.target.updateMatrixWorld();

    this.audio.update(dt, {
      speed: p.speed,
      rpm: p.rpm / MAX_RPM,
      gear: p.gear,
      throttle: p.throttle,
      brake: p.brake,
      handbrake: p.handbrake,
      slipAngle: p.slipAngle,
      wheelSlip: Math.max(...p.wheelSlip),
      offRoad: p.offRoad,
      airborne: p.airborne,
      landingForce: p.landingForce,
      /* No ocean in this world — push the ambience's surf past hearing. */
      shoreDistance: 1e9, shoreDrop: 0, oceanSide: 1, openness: 0,
    });

    this.hud.update(dt, { speed: p.speed, gear: p.gear });
  }

  driverInput() {
    if (this.bot) return this.bot.drive(this.player, 1 / 120);
    const i = this.input;
    return { steer: i.steer, throttle: i.throttle, brake: i.brake, handbrake: i.handbrake };
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.audio.stop();
      this._exitPointerLock();
      this._setCursorVisible(true);
    } else {
      this.audio.start();
      this._setCursorVisible(false);
      this._requestPointerLock();
    }
  }

  /** Hide system cursor while driving; show it on the pause menu. */
  _setCursorVisible(visible) {
    const v = visible ? 'default' : 'none';
    document.body.style.cursor = v;
    document.documentElement.style.cursor = v;
    if (this.canvas) this.canvas.style.cursor = v;
  }

  _requestPointerLock() {
    if (this.paused) return;
    if (document.pointerLockElement === this.canvas) return;
    this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  _exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  respawn() {
    this.resetSimClock();
    this.teleportToCenter();
  }

  /** Map centre of the island flats (same as spawn). */
  teleportToCenter() {
    const p = this.player;
    p.placeAt(INTER_X, 0);
    p.vertVel = 0; p.height = 0;
    this.chase.started = false;
  }

  /* ---- free-fly camera (Ctrl+Shift+C) -------------------------------- */

  toggleFly() {
    this.fly = !this.fly;
    if (this.fly) {
      /* Start where the chase camera currently is, facing the same way. */
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.lookYaw = e.y;
      this.lookPitch = e.x;
      this.flySpeed = 60;
      this._requestPointerLock();
    } else {
      this.teleportToCenter();
      this.chase.started = false;
      this.chase.update(this.player, 1 / 60, {
        lookBack: false, orbitYaw: 0, orbitPitch: 0,
      });
    }
  }

  /** Free-roam camera: WASD move on the camera plane, Space up, Shift down. */
  flyStep(dt) {
    const i = this.input;
    let fwd = 0, strafe = 0, up = 0;
    if (i.held('throttle')) fwd += 1;
    if (i.held('brake')) fwd -= 1;
    if (i.held('left')) strafe -= 1;
    if (i.held('right')) strafe += 1;
    if (i.down.has('Space')) up += 1;
    if (i.down.has('ShiftLeft') || i.down.has('ShiftRight')) up -= 1;

    /* Camera-relative basis. Yaw on the ground plane, pitch in the air. */
    const cp = Math.cos(this.lookPitch);
    const fwdVec = new THREE.Vector3(
      -Math.sin(this.lookYaw) * cp,
      Math.sin(this.lookPitch),
      -Math.cos(this.lookYaw) * cp,
    );
    const rightVec = new THREE.Vector3(
      Math.cos(this.lookYaw), 0, -Math.sin(this.lookYaw),
    );

    /* Speed scales with distance from the map centre so the whole island is
       reachable in reasonable time without being slow up close. */
    const dist = this.camera.position.distanceTo(
      this.player ? this.player.pos : new THREE.Vector3(),
    );
    const speed = Math.min(this.flySpeed * (1 + dist / 900), 400);
    this.camera.position.addScaledVector(fwdVec, fwd * speed * dt);
    this.camera.position.addScaledVector(rightVec, strafe * speed * dt);
    this.camera.position.y += up * speed * dt;

    this.camera.quaternion.setFromEuler(
      new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'),
    );

    /* Sun follows the camera so shadows stay lit around the free view. */
    this.sun.position.copy(this.camera.position).add(SUN_OFFSET);
    this.sun.target.position.copy(this.camera.position);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * True when the car body is in the water — either below sea level or sitting
   * on seafloor under the waterline. Used to teleport back to the island centre.
   */
  _isSubmerged(p) {
    const water = this.track.waterLevel ?? WATER_LEVEL;
    /* Chassis low enough that the ride is underwater. */
    if (p.pos.y < water + 0.15) return true;
    /* Standing on land that itself is below the waterline (beach/seafloor). */
    if (typeof this.track.heightAt === 'function') {
      const ground = this.track.heightAt(p.pos.x, p.pos.z);
      if (ground < water - 0.25 && p.height < 1.5) return true;
    }
    return false;
  }

  resetSimClock() { this._simAcc = 0; }

  _paceK(period, vsync) {
    if (!(vsync > 0) || !Number.isFinite(vsync)) return 1;
    return Math.max(1, Math.round(period / vsync));
  }

  frame(now) {
    this._raf = requestAnimationFrame(t => this.frame(t));

    const prev = this._lastRaf;
    this._lastRaf = now;
    const gap = prev >= 0 ? now - prev : -1;
    if (gap > 0) {
      if (gap >= 1 && gap < this._vsyncMin) this._vsyncMin = gap;
      this._vsyncSum += gap; this._vsyncN++;
    }
    if (++this._vsyncSeen >= 60) {
      if (this._vsyncMin < Infinity) this._vsync = this._vsyncMin;
      else if (this._vsyncN > 0) this._vsync = this._vsyncSum / this._vsyncN;
      this._vsyncMin = Infinity;
      this._vsyncSum = 0; this._vsyncN = 0;
    } else if (this._vsync === Infinity && gap >= 1) {
      this._vsync = gap;
    }

    if (this.fpsCap > 0) {
      const period = 1000 / this.fpsCap;
      const k = this._paceK(period, this._vsync);
      this._pending++;
      if (this._pending < k && now - this._lastFrame < period) return;
      this._pending = 0;
      this._lastFrame = now;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._acc += dt; this._frames++;
    if (this._acc > 0.5) { this.fps = this._frames / this._acc; this._acc = 0; this._frames = 0; }
    if (!this.paused) this.step(dt);
    /* Paused: no GL work at all, the compositor holds the last picture. */
    if (!this.paused) this.pipeline.render();
    if (this.hudOn) this.hud.draw(this.paused);
  }

  /* ---- harness control surface ------------------------------------- */
  begin() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this._lastRaf = -1;
    this._vsync = Infinity; this._vsyncMin = Infinity; this._vsyncSeen = 0;
    this._vsyncSum = 0; this._vsyncN = 0; this._pending = 0;
    document.getElementById('boot')?.classList.add('gone');
    this._raf = requestAnimationFrame(t => this.frame(t));
  }
  setPaused(p) {
    const next = !!p;
    if (next === this.paused) return;
    this.paused = next;
    if (this.paused) {
      this._exitPointerLock();
      this._setCursorVisible(true);
    } else {
      this._setCursorVisible(false);
      this._requestPointerLock();
    }
  }
  renderOnce() { this.pipeline.render(); }

  goTo(t) {
    this.resetSimClock();
    this.s = clamp(t, 0, 1) * this.track.length;
    /* On the island, goTo still places by s (world X) at lat 0. */
    this.player.placeAt(clamp(this.s, 0, this.track.length - 1), 0);
    this.player.applyTo(this.playerView);
    this.chase.started = false;
    this.chase.update(this.player, 1 / 60, {});
  }

  warp(sec) {
    for (let i = 0; i < sec * 60; i++) this.step(1 / 60);
  }

  driveTo(t, { runUp = 180, skill = 0.85, maxSec = 30 } = {}) {
    const target = clamp(t, 0, 1) * this.track.length;
    const hadBot = this.bot;
    this.autopilot(true, skill);
    this.goTo(Math.max(0, target - runUp) / this.track.length);
    const limit = maxSec * 60;
    for (let i = 0; i < limit && this.player.s < target; i++) this.step(1 / 60);
    this.s = this.player.s;
    if (!hadBot) this.autopilot(false);
    return this.telemetry();
  }

  autopilot(on, skill = 0.85) {
    this.bot = on ? new Driver(this.track, { skill }) : null;
  }

  telemetry() {
    const p = this.player;
    return {
      kmh: +p.kmh.toFixed(1),
      s: +p.s.toFixed(1),
      lat: +p.lat.toFixed(2),
      slipDeg: +((p.slipAngle * 180) / Math.PI).toFixed(1),
      yawRate: +p.r.toFixed(2),
      gear: p.gear + 1,
      rpm: Math.round(p.rpm),
      air: +p.height.toFixed(2),
      roll: +((p.roll * 180) / Math.PI).toFixed(1),
      pitch: +((p.pitch * 180) / Math.PI).toFixed(1),
      offRoad: +p.offRoad.toFixed(2),
    };
  }

  info() {
    const r = this.pipeline?.stats ?? this.renderer.info.render;
    return {
      calls: r.calls, triangles: r.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      roadWidth: ROAD_WIDTH,
      car: this.telemetry(),
    };
  }
}

/* The whole HUD: a speed readout, a gear, a hint line, and a pause plate.
   Drawn in canvas like the rally's, but with none of its furniture. */
class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.speed = 0; this.gear = 1;
    this.carName = '';
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  setCarName(name) { this.carName = name; }

  update(dt, { speed, gear }) {
    this.speed = speed;
    this.gear = gear;
  }

  draw(paused = false) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (paused) {
      ctx.font = '700 34px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f0e6d8';
      ctx.shadowColor = 'rgba(20,10,14,0.9)';
      ctx.shadowBlur = 12;
      ctx.fillText('PAUSED', w / 2, h / 2 - 10);
      ctx.shadowBlur = 0;
      ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#c9b8a5';
      ctx.fillText('ESC to resume', w / 2, h / 2 + 22);
      return;
    }

    /* Speed, bottom right. */
    const kmh = Math.round(this.speed * 3.6);
    ctx.textAlign = 'right';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 10;
    ctx.font = '700 64px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.fillText(String(kmh), w - 28, h - 66);
    ctx.font = '600 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#c9b8a5';
    ctx.fillText('KM/H', w - 28, h - 38);
    ctx.shadowBlur = 0;
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('GEAR ' + (this.gear + 1), w - 28, h - 14);

    /* Hint, bottom left. */
    ctx.textAlign = 'left';
    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('WASD / ARROWS  drive   MOUSE  look   V  vehicle   R  reset   ESC  pause   CTRL+SHIFT+C  fly cam', 24, h - 20);

    /* Current vehicle, bottom centre. */
    if (this.carName) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(240,230,216,0.75)';
      ctx.fillText(this.carName, w / 2, h - 20);
    }
  }
}

const game = new Game(document.getElementById('view'));
game.THREE = THREE;
window.__game = game;
if (!location.hash.includes('manual')) game.begin();
