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
import { Pedestrians, PED_RADIUS } from './flat/Pedestrians.js';
import { loadCarGLB } from './car/mesh.js';
import { Car, MAX_RPM, steerLockAt } from './car/physics.js';
import { ChaseCamera } from './car/camera.js';
import { Driver } from './car/driver.js';
import { Input } from './core/input.js';
import { celMaterial } from './render/cel.js';
import { CelPipeline } from './render/outline.js';
import { clamp, formatTime } from './core/util.js';
import { generateRoute } from './race/path.js';
import {
  CityRace,
  RACE_LENGTHS, RACE_LENGTH_LABELS,
  RACE_DIFFS, RACE_DIFF_LABELS, RACE_MAX_LAPS,
} from './race/city.js';

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

/* Sphere of visibility, centred on the player's vehicle: world chunks whose
   bounding sphere intersects this radius render; beyond it everything is
   fogged out and not drawn. The island is ~2 km across, so 1 km keeps the
   near half crisp and melts the far side into haze. */
const VIEW_RADIUS = 500;       // metres — asset render sphere around the car
/* PED_RADIUS must track this: both are the boundary of what the player can
   see, and the pedestrians live inside it by construction. */
if (PED_RADIUS !== VIEW_RADIUS) console.warn('pedestrian radius drifted from VIEW_RADIUS');
const FOG_NEAR = 300;           // fog starts this far from the camera
const FOG_FAR = VIEW_RADIUS;    // fully fogged at the edge of the sphere
const CAM_FAR = FOG_FAR + 100;  // camera far plane, just past the fog

/* The player's garage. Each entry is a GLB from assets/vehicle/ which
   buildCarFromGLTF scales onto the physics platform, keeping the model's own
   baked track width so every vehicle runs a different tyre spacing. The pause
   menu's CHANGE VEHICLE picks from these; #car=<name> picks the starting one.

   perf drives the feel: power/drag = engine (acceleration, top speed),
   grip = tyre friction, steer = wheel response rate, susp = spring stiffness
   (<1 soft and bouncy — the trucks; >1 stiff and planted — the race cars),
   drift = how far the handbrake drops the rear (<1 glued — heavy vehicles
   refuse to slide; >1 tail-happy — the fast cars light right up). Power
   can't spin a drifty car on its own: the throttle only sustains a slide
   once the rear is well past its grip peak, so normal driving grips. */
const VEHICLES = [
  { name: 'Sports Sedan', url: '/assets/vehicle/sedan-sports.glb', wheel: '/assets/vehicle/wheel-racing.glb', perf: { power: 1.0, drag: 1.0, grip: 1.05, steer: 1.05, susp: 1.15, drift: 0.8 } },
  { name: 'Sedan', url: '/assets/vehicle/sedan.glb', wheel: '/assets/vehicle/wheel-default.glb', perf: { power: 0.69, drag: 1.0, grip: 1.0, steer: 1.0, susp: 1.0, drift: 0.55 } },
  { name: 'Hatchback', url: '/assets/vehicle/hatchback-sports.glb', wheel: '/assets/vehicle/wheel-default.glb', perf: { power: 0.59, drag: 1.0, grip: 0.98, steer: 1.0, susp: 0.9, drift: 0.6 } },
  { name: 'SUV', url: '/assets/vehicle/suv.glb', wheel: '/assets/vehicle/wheel-dark.glb', perf: { power: 0.72, drag: 1.0, grip: 1.0, steer: 0.9, susp: 0.7, drift: 0.3 } },
  { name: 'Luxury SUV', url: '/assets/vehicle/suv-luxury.glb', wheel: '/assets/vehicle/wheel-dark.glb', perf: { power: 0.88, drag: 1.05, grip: 1.0, steer: 0.9, susp: 0.7, drift: 0.3 } },
  { name: 'Race', url: '/assets/vehicle/race.glb', wheel: '/assets/vehicle/wheel-racing.glb', perf: { power: 1.58, drag: 0.8, grip: 5.0, steer: 1.0, susp: 10.0, drift: 0.1 } },
  { name: 'Future Race', url: '/assets/vehicle/race-future.glb', wheel: '/assets/vehicle/wheel-racing.glb', perf: { power: 1.72, drag: 0.9, grip: 1.35, steer: 1.35, susp: 2.1, drift: 0.35 } },
  { name: 'Police', url: '/assets/vehicle/police.glb', wheel: '/assets/vehicle/wheel-dark.glb', perf: { power: 0.92, drag: 1.0, grip: 1.05, steer: 1.05, susp: 1.1, drift: 0.75 } },
  { name: 'Taxi', url: '/assets/vehicle/taxi.glb', wheel: '/assets/vehicle/wheel-default.glb', perf: { power: 0.49, drag: 1.0, grip: 0.95, steer: 0.95, susp: 0.9, drift: 0.7 } },
  { name: 'Van', url: '/assets/vehicle/van.glb', wheel: '/assets/vehicle/wheel-default.glb', perf: { power: 0.44, drag: 1.0, grip: 0.9, steer: 0.85, susp: 0.5, drift: 0.2 } },
  { name: 'Delivery', url: '/assets/vehicle/delivery.glb', wheel: '/assets/vehicle/wheel-default.glb', perf: { power: 0.4, drag: 1.15, grip: 0.9, steer: 0.85, susp: 0.5, drift: 0.2 } },
  { name: 'Delivery Flat', url: '/assets/vehicle/delivery-flat.glb', wheel: '/assets/vehicle/wheel-default.glb', perf: { power: 0.42, drag: 1.1, grip: 0.9, steer: 0.85, susp: 0.5, drift: 0.2 } },
  { name: 'Truck', url: '/assets/vehicle/truck.glb', wheel: '/assets/vehicle/wheel-truck.glb', perf: { power: 0.55, drag: 1.35, grip: 0.85, steer: 0.8, susp: 0.45, drift: 0.12 } },
  { name: 'Flatbed Truck', url: '/assets/vehicle/truck-flat.glb', wheel: '/assets/vehicle/wheel-truck.glb', perf: { power: 0.52, drag: 1.3, grip: 0.85, steer: 0.8, susp: 0.45, drift: 0.12 } },
  { name: 'Garbage Truck', url: '/assets/vehicle/garbage-truck.glb', wheel: '/assets/vehicle/wheel-truck.glb', perf: { power: 0.38, drag: 1.45, grip: 0.8, steer: 0.75, susp: 0.4, drift: 0.08 } },
  { name: 'Firetruck', url: '/assets/vehicle/firetruck.glb', wheel: '/assets/vehicle/wheel-truck.glb', perf: { power: 0.7, drag: 1.4, grip: 0.85, steer: 0.8, susp: 0.5, drift: 0.18 } },
  { name: 'Ambulance', url: '/assets/vehicle/ambulance.glb', wheel: '/assets/vehicle/wheel-truck.glb', perf: { power: 0.75, drag: 1.2, grip: 0.9, steer: 0.85, susp: 0.55, drift: 0.25 } },
  { name: 'Tractor', url: '/assets/vehicle/tractor.glb', wheel: { front: '/assets/vehicle/wheel-tractor-front.glb', back: '/assets/vehicle/wheel-tractor-back.glb' }, perf: { power: 0.35, drag: 1.25, grip: 0.8, steer: 0.7, susp: 0.4, drift: 0.05 } },
  { name: 'Tractor Shovel', url: '/assets/vehicle/tractor-shovel.glb', wheel: { front: '/assets/vehicle/wheel-tractor-front.glb', back: '/assets/vehicle/wheel-tractor-back.glb' }, perf: { power: 0.32, drag: 1.3, grip: 0.75, steer: 0.65, susp: 0.35, drift: 0.04 } },
  { name: 'Police Tractor', url: '/assets/vehicle/tractor-police.glb', wheel: { front: '/assets/vehicle/wheel-tractor-dark-front.glb', back: '/assets/vehicle/wheel-tractor-dark-back.glb' }, perf: { power: 0.36, drag: 1.25, grip: 0.8, steer: 0.7, susp: 0.4, drift: 0.05 } },
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
    /* Fog makes the render distance a sphere of visibility around the car:
       everything past FOG_NEAR melts toward the sky colour and is gone by the
       camera far plane, so nothing pops at the clip. The colour matches the
       background so the horizon is seamless. */
    this.scene.fog = new THREE.Fog(0x8cc8e8, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, CAM_FAR);

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
    if (world.roadLift) this.track.setRoadLift(world.roadLift);
    this.world = world;
    this._assetsLoading = false;
    this._scanWorldChunks();

    /* Trackside pedestrians — ten characters walking the footpaths inside
       the render sphere. Scene-only (no colliders), so cars pass through. */
    this.pedestrians = new Pedestrians(this.scene, world.city?.graph);

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

    this.race = null;
    this.ambientEnabled = true;
    this.raceSetup = {
      vehicle: this.vehicleIndex,
      lengthIdx: 1,
      laps: 3,
      difficulty: 1,
    };
    this.menu = null;

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildCars() {
    this.player = new Car(this.track, { palette: 0, perf: VEHICLES[0].perf });
    /* The run starts on a random city road, facing along the tarmac. */
    this._teleportToRandomRoad();

    this.vehicleViews = new Map();
    this.vehiclesLoading = new Map();

    const want = q.get('car');
    let idx = 0;
    if (want) {
      const byUrl = VEHICLES.findIndex(v => v.url.endsWith(`/${want}.glb`));
      if (byUrl >= 0) idx = byUrl;
    }
    this.vehicleIndex = idx;
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

  async _setVehicle(idx) {
    const v = VEHICLES[idx];
    if (this.vehicleViews.has(v.name)) return this.vehicleViews.get(v.name);
    if (this.vehiclesLoading.has(v.name)) return this.vehiclesLoading.get(v.name);
    const p = loadCarGLB(v.url, v.wheel).then(view => {
      this._styleView(view);
      this.vehicleViews.set(v.name, view);
      return view;
    });
    this.vehiclesLoading.set(v.name, p);
    return p;
  }

  async _loadVehicle(idx) {
    this.vehicleIndex = idx;
    const v = VEHICLES[idx];
    if (!v) return;
    const view = await this._setVehicle(idx);
    if (this.vehicleIndex !== idx) return;   // user moved on while loading
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

    /* While paused the world is not redrawn — see frame() — and the only
       thing that runs is the menu shell. */
    if (this.paused) {
      this._menuStep();
      return;
    }

    if (this.input.pausePressed) this.togglePause();

    if (this.race?.over) {
      if (this.input.confirmPressed || this.input.resetPressed) this.endRace();
      this.hud.race = this.race ? this.race.hud() : null;
      this.hud.update(dt, { speed: this.player.speed, gear: this.player.gear });
      return;
    }

    if (this.fly && !this.race) {
      this.flyStep(dt);
      this.pipeline.update(dt, { speed: 0 });
      this.hud.update(dt, { speed: 0, gear: 0 });
      return;
    }

    this.time += dt;
    if (!this.race && this.input.resetPressed) this.respawn();

    const p = this.player;
    p.lastImpact = 0;
    p.landingForce = 0;

    const holding = !!(this.race && this.race.holding);
    if (holding && this.input.skipPressed) this.race.skipCountdown();

    if (!holding) {
      this._simAcc += dt;
      let n = 0;
      while (this._simAcc >= SUBSTEP && n < MAX_SUBSTEPS) {
        p.step(SUBSTEP, this.driverInput());
        this._simAcc -= SUBSTEP;
        n++;
      }
      if (n >= MAX_SUBSTEPS) this._simAcc = 0;
    }
    const alpha = this._simAcc / SUBSTEP;

    if (this.race) this.race.step(dt, p);

    /* Drove into the sea — back onto a random road. Mid-race, snap back
       onto the route instead of throwing the run away. */
    if (this._isSubmerged(p)) {
      if (this.race && !this.race.over) this.race.rescue(p);
      else if (!this.race) {
        this._teleportToRandomRoad();
        this.chase.started = false;
      }
    }

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

    this.hud.race = this.race ? this.race.hud() : null;
    this.hud.update(dt, { speed: p.speed, gear: p.gear });

    if (this.ambientEnabled && this.pedestrians) {
      this.pedestrians.update(dt, p.pos.x, p.pos.z);
    }
  }

  driverInput() {
    if (this.bot) return this.bot.drive(this.player, 1 / 120);
    const i = this.input;
    return { steer: i.steer, throttle: i.throttle, brake: i.brake, handbrake: i.handbrake };
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.menu = { view: 'main', index: 0, liveRace: !!this.race };
      this.audio.stop();
      this._exitPointerLock();
      this._setCursorVisible(true);
    } else {
      this.menu = null;
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

  /* ---- pause menu shell ------------------------------------------------ */

  /* Menu navigation. Views: main, vehicles, race. Esc steps back one view,
     or resumes from the top view. */
  _menuItems() {
    return this.race
      ? ['RESUME', 'LEAVE RACE']
      : ['RESUME', 'RACE', 'CHANGE VEHICLE', 'RESTART'];
  }

  _menuStep() {
    const m = this.menu;
    const i = this.input;
    if (!m) return;
    m.liveRace = !!this.race;
    m.setup = this.raceSetup;
    if (this._switching) return;
    if (i.pausePressed) {
      if (m.view === 'vehicles' || m.view === 'race') { m.view = 'main'; m.index = 0; return; }
      this.togglePause();
      return;
    }
    if (m.view === 'race') return this._raceMenuStep();
    if (m.view === 'main') {
      const items = this._menuItems();
      const n = items.length;
      if (i.menuUpPressed) m.index = (m.index + n - 1) % n;
      else if (i.menuDownPressed) m.index = (m.index + 1) % n;
      else if (i.confirmPressed) {
        const pick = items[m.index];
        if (pick === 'RESUME') this.togglePause();
        else if (pick === 'RACE') { m.view = 'race'; m.index = 0; }
        else if (pick === 'CHANGE VEHICLE') {
          m.view = 'vehicles';
          m.index = this.vehicleIndex;
        } else if (pick === 'RESTART') {
          this.respawn();
          this.togglePause();
        } else if (pick === 'LEAVE RACE') {
          this.endRace();
          this.togglePause();
        }
      }
      return;
    }
    const n = VEHICLES.length;
    if (i.menuUpPressed) m.index = (m.index + n - 1) % n;
    else if (i.menuDownPressed) m.index = (m.index + 1) % n;
    else if (i.confirmPressed) this._chooseVehicle(m.index);
  }

  _raceMenuStep() {
    const m = this.menu;
    const i = this.input;
    const s = this.raceSetup;
    const rows = 5; /* vehicle, length, laps, difficulty, START */
    if (i.menuUpPressed) m.index = (m.index + rows - 1) % rows;
    else if (i.menuDownPressed) m.index = (m.index + 1) % rows;
    else if (i.menuLeftPressed || i.menuRightPressed) {
      const dir = i.menuRightPressed ? 1 : -1;
      if (m.index === 0) {
        s.vehicle = (s.vehicle + dir + VEHICLES.length) % VEHICLES.length;
      } else if (m.index === 1) {
        s.lengthIdx = (s.lengthIdx + dir + RACE_LENGTHS.length) % RACE_LENGTHS.length;
      } else if (m.index === 2) {
        s.laps = (s.laps + dir + RACE_MAX_LAPS + 1) % (RACE_MAX_LAPS + 1);
      } else if (m.index === 3) {
        s.difficulty = (s.difficulty + dir + RACE_DIFFS.length) % RACE_DIFFS.length;
      }
    } else if (i.confirmPressed && m.index === 4) {
      this._startRace();
    }
  }

  setAmbient(on) {
    this.ambientEnabled = !!on;
    this.pedestrians?.setEnabled(this.ambientEnabled);
  }

  async _startRace() {
    if (this._switching) return;
    const graph = this.world?.city?.graph;
    if (!graph) return;
    this._switching = true;
    let started = false;
    let race = null;
    try {
      const s = this.raceSetup;
      const route = generateRoute(graph, {
        length: RACE_LENGTHS[s.lengthIdx],
        loop: s.laps > 0,
        seed: (Math.random() * 0xffffffff) >>> 0,
      });
      if (!route) return;
      await this._loadVehicle(s.vehicle);
      race = new CityRace({
        track: this.track,
        scene: this.scene,
        route,
        laps: s.laps,
        difficulty: RACE_DIFFS[s.difficulty],
        vehicles: VEHICLES,
        playerVehicle: s.vehicle,
        heightAt: (x, z) => this.track.heightAt(x, z),
        loadView: idx => this._loadRivalView(idx),
      });
      await race.begin(this.player);
      this.player.applyTo(this.playerView, 0);
      if (this.chase?.snap) this.chase.snap(this.player);
      else if (this.chase?.set) this.chase.set(this.player.pos, this.player.forward);
      if (this.race) this.race.dispose();
      this.setAmbient(false);
      this.race = race;
      started = true;
      this.chase.started = false;
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.resetSimClock();
      if (this.paused) this.togglePause();
    } catch (err) {
      console.warn('race start failed', err);
      if (!started) race?.dispose();
    } finally {
      this._switching = false;
      if (!started) this.setAmbient(true);
    }
  }

  async _loadRivalView(idx) {
    const v = VEHICLES[idx];
    const view = await loadCarGLB(v.url, v.wheel);
    this._styleView(view);
    return view;
  }

  endRace() {
    if (!this.race) return;
    this.race.dispose();
    this.race = null;
    this.hud.race = null;
    this.setAmbient(true);
    this.resetSimClock();
  }

  /** Swap to the chosen garage entry, drop on a random road, resume. */
  async _chooseVehicle(idx) {
    if (this._switching) return;
    this._switching = true;
    this.vehicleIndex = idx;
    this.raceSetup.vehicle = idx;
    try {
      await this._loadVehicle(idx);
      this._teleportToRandomRoad();
    } finally {
      this._switching = false;
    }
    this.chase.started = false;
    this.togglePause();
  }

  /** Mid-point of a random city road edge, facing along the tarmac. */
  _teleportToRandomRoad() {
    const g = this.world?.city?.graph;
    const p = this.player;
    if (g && g.edges.length) {
      const byId = new Map(g.nodes.map(n => [n.id, n]));
      const e = g.edges[Math.floor(Math.random() * g.edges.length)];
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (a && b) {
        p.placeAt((a.x + b.x) * 0.5, (a.z + b.z) * 0.5);
        p.yaw = Math.atan2(b.z - a.z, b.x - a.x);
        this.resetSimClock();
        return;
      }
    }
    this.respawn();
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
    /* Always stepped, even paused: step() updates input first and returns
       before the substep loop when this.paused, so the shell can read the
       Escape edge that closes the menu — see ui/pause.js. Only rendering is
       skipped below. */
    this.step(dt);
    /* Sphere of visibility: hide world chunks outside VIEW_RADIUS of the car
       before the frame is drawn, so distant assets aren't rendered at all. */
    this._cullWorldChunks();
    /* Paused: no GL work at all, the compositor holds the last picture. */
    if (!this.paused) this.pipeline.render();
    if (this.hudOn) this.hud.draw(this.paused, this.menu);
  }

  /* ---- harness control surface ------------------------------------- */
  begin() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this._lastRaf = -1;
    this._vsync = Infinity; this._vsyncMin = Infinity; this._vsyncSeen = 0;
    this._vsyncSum = 0; this._vsyncN = 0; this._pending = 0;
    this._raf = requestAnimationFrame(t => this.frame(t));
    this.loadAssets();
  }

  /**
   * Loader — the single entry point for all world assets. Runs the city and
   * vegetation loaders together, drives the boot bar with their progress, and
   * hides the loading screen once every asset is in the scene.
   */
  async loadAssets() {
    if (this._assetsLoading) return;
    this._assetsLoading = true;
    const w = this.world;
    let a = 0, b = 0, c = 0;
    const bump = () => this._setLoadProgress((a + b + c) / 3);
    const tasks = [];
    if (w.loadCity) {
      tasks.push(w.loadCity({ onProgress: f => { a = f; bump(); } })
        .catch(err => console.warn('city', err)));
    } else a = 1;
    if (w.loadVegetation) {
      tasks.push(w.loadVegetation({ onProgress: f => { b = f; bump(); } })
        .catch(err => console.warn('vegetation', err)));
    } else b = 1;
    tasks.push(this.pedestrians.load()
      .then(() => { c = 1; bump(); })
      .catch(err => console.warn('pedestrians', err)));
    bump();
    await Promise.all(tasks);
    this._setLoadProgress(1);
    this._scanWorldChunks();
    document.getElementById('boot')?.classList.add('gone');
  }

  _setLoadProgress(frac) {
    const fill = document.getElementById('boot-fill');
    if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
    const pct = document.getElementById('boot-pct');
    if (pct) pct.textContent = `${Math.round(frac * 100)}%`;
  }

  /* World chunks for the visibility sphere. Each entry carries its bounding
     sphere in WORLD space (setFromObject folds in transforms and instances). */
  _scanWorldChunks() {
    const chunks = [];
    const box = new THREE.Box3(), sph = new THREE.Sphere();
    for (const o of this.world.root.children) {
      if (!(o.isMesh || o.isGroup) || !o.children?.length && !o.isMesh) continue;
      box.setFromObject(o);
      const c = box.getBoundingSphere(sph);
      chunks.push({ object: o, x: c.center.x, y: c.center.y, z: c.center.z, r: c.radius });
    }
    this.worldChunks = chunks;
  }

  _cullWorldChunks() {
    const chunks = this.worldChunks;
    if (!chunks || !chunks.length) return;
    const px = this.player.pos.x, pz = this.player.pos.z;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const dx = c.x - px, dz = c.z - pz;
      const lim = VIEW_RADIUS + c.r;
      c.object.visible = dx * dx + dz * dz <= lim * lim;
    }
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
    this.race = null;
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

  draw(paused = false, menu = null) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (paused) {
      this._drawMenu(menu);
      return;
    }

    if (this.race) this._drawRace(ctx, w, h);

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
    const hint = this.race
      ? 'WASD / ARROWS  drive   MOUSE  look   ESC  menu   ENTER  skip countdown'
      : 'WASD / ARROWS  drive   MOUSE  look   R  reset   ESC  menu   CTRL+SHIFT+C  fly cam';
    ctx.fillText(hint, 24, h - 20);

    /* Current vehicle, bottom centre. */
    if (this.carName) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(240,230,216,0.75)';
      ctx.fillText(this.carName, w / 2, h - 20);
    }
  }

  /* ---- the pause menu ------------------------------------------------ */

  /* Wash over the frozen frame so the menu type stays legible against the
     cel world, matching the plate's 0.55 dim. */
  _drawMenu(menu) {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(15,10,14,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';

    if (menu?.view === 'vehicles') return this._drawVehicleList(menu);
    if (menu?.view === 'race') return this._drawRaceSetup(menu);

    ctx.font = '700 34px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 12;
    ctx.fillText('PAUSED', w / 2, h / 2 - 92);
    ctx.shadowBlur = 0;
    ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#c9b8a5';
    ctx.fillText(this.carName || '', w / 2, h / 2 - 60);

    const items = menu?.liveRace
      ? ['RESUME', 'LEAVE RACE']
      : ['RESUME', 'RACE', 'CHANGE VEHICLE', 'RESTART'];
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    for (let k = 0; k < items.length; k++) {
      const y = h / 2 + k * 34;
      const sel = menu ? k === menu.index : k === 0;
      ctx.fillStyle = sel ? '#f0e6d8' : 'rgba(201,184,165,0.7)';
      ctx.fillText(items[k], w / 2 + 14, y);
      if (sel) {
        ctx.fillStyle = '#ffd54a';
        ctx.fillText('▶', w / 2 - 96, y);
      }
    }
    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('UP / DOWN  choose    ENTER  select    ESC  back', w / 2, h / 2 + 16 + items.length * 34);
  }

  _drawRaceSetup(menu) {
    const { ctx, w, h } = this;
    const s = menu.setup || { vehicle: 0, lengthIdx: 1, laps: 3, difficulty: 1 };
    const lapsLabel = s.laps === 0 ? 'SPRINT' : (s.laps === 1 ? '1 LAP' : s.laps + ' LAPS');
    const rows = [
      ['VEHICLE', VEHICLES[s.vehicle]?.name?.toUpperCase() || ''],
      ['LENGTH', RACE_LENGTH_LABELS[s.lengthIdx] || ''],
      ['LAPS', lapsLabel],
      ['DIFFICULTY', RACE_DIFF_LABELS[s.difficulty] || ''],
      ['START RACE', ''],
    ];

    ctx.font = '700 28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillText('RACE', w / 2, h / 2 - 130);
    ctx.shadowBlur = 0;

    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    for (let k = 0; k < rows.length; k++) {
      const y = h / 2 - 70 + k * 36;
      const sel = k === menu.index;
      ctx.fillStyle = sel ? '#ffd54a' : 'rgba(201,184,165,0.8)';
      if (sel) ctx.fillText('▶', w / 2 - 220, y);
      ctx.textAlign = 'left';
      ctx.fillText(rows[k][0], w / 2 - 190, y);
      if (rows[k][1]) {
        ctx.textAlign = 'right';
        ctx.fillStyle = sel ? '#f0e6d8' : 'rgba(240,230,216,0.75)';
        ctx.fillText('<  ' + rows[k][1] + '  >', w / 2 + 220, y);
      }
      ctx.textAlign = 'center';
    }

    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('UP / DOWN  row    LEFT / RIGHT  value    ENTER  start    ESC  back',
      w / 2, h / 2 + 140);
  }

  _drawRace(ctx, w, h) {
    const r = this.race;
    if (r.results) return this._drawRaceResults(ctx, w, h, r.results);

    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 8;
    ctx.font = '700 28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    const ord = r.position + (
      r.position % 10 === 1 && r.position !== 11 ? 'ST'
        : r.position % 10 === 2 && r.position !== 12 ? 'ND'
          : r.position % 10 === 3 && r.position !== 13 ? 'RD' : 'TH'
    );
    ctx.fillText(ord + ' / ' + r.fieldSize, w / 2, 36);
    ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(formatTime(r.time), w / 2, 62);
    if (r.laps > 0) {
      ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#c9b8a5';
      ctx.fillText('LAP ' + r.lap + ' / ' + r.laps, w / 2, 84);
    }
    ctx.shadowBlur = 0;

    const cd = r.countdown;
    if (cd) {
      ctx.save();
      ctx.globalAlpha = clamp(cd.alpha, 0, 1);
      ctx.translate(w / 2, h * 0.35);
      ctx.scale(cd.scale, cd.scale);
      ctx.font = '800 96px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = cd.go ? '#6f8f38' : '#d8462a';
      ctx.strokeStyle = '#241812';
      ctx.lineWidth = 10;
      ctx.strokeText(cd.text, 0, 0);
      ctx.fillText(cd.text, 0, 0);
      ctx.restore();
    }
  }

  _drawRaceResults(ctx, w, h, e) {
    ctx.fillStyle = 'rgba(15,10,14,0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 12;
    ctx.font = '700 22px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = e.pos === 1 ? '#6f8f38' : '#f0e6d8';
    ctx.fillText('FINISH', w / 2, h / 2 - 86);
    ctx.font = '800 54px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(e.label, w / 2, h / 2 - 22);
    ctx.shadowBlur = 0;
    ctx.font = '600 22px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.fillText(formatTime(e.time), w / 2, h / 2 + 18);
    if (e.laps > 0 && e.bestLap != null) {
      ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#c9b8a5';
      ctx.fillText('BEST LAP  ' + formatTime(e.bestLap), w / 2, h / 2 + 46);
    }
    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('ENTER  OR  R   BACK TO THE CITY', w / 2, h / 2 + 88);
  }

  /* The garage list — a scrolling window over VEHICLES, the current car
     marked, the cursor in yellow, ENTER to drive that car. */
  _drawVehicleList(menu) {
    const { ctx, w, h } = this;
    const n = VEHICLES.length;
    const rows = 9;
    const start = clamp(menu.index - ((rows - 1) >> 1), 0, Math.max(0, n - rows));
    const rowH = 26;
    const top = h / 2 - (rows * rowH) / 2 + 10;

    ctx.font = '700 26px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillText('SELECT VEHICLE', w / 2, top - 38);
    ctx.shadowBlur = 0;

    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    for (let k = 0; k < rows && start + k < n; k++) {
      const idx = start + k;
      const y = top + k * rowH;
      const name = VEHICLES[idx].name;
      const sel = idx === menu.index;
      const isCur = name === this.carName;
      ctx.fillStyle = sel ? '#ffd54a' : isCur ? '#f0e6d8' : 'rgba(201,184,165,0.75)';
      ctx.fillText(name, w / 2 + 14, y);
      if (sel) ctx.fillText('▶', w / 2 - 190, y);
      else if (isCur) ctx.fillText('●', w / 2 - 190, y);
    }

    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('UP / DOWN  browse    ENTER  drive this vehicle    ESC  back',
      w / 2, top + rows * rowH + 26);
    if (start > 0) ctx.fillText('▲', w / 2 + 190, top + 12);
    if (start + rows < n) ctx.fillText('▼', w / 2 + 190, top + rows * rowH - 6);
  }
}

const game = new Game(document.getElementById('view'));
game.THREE = THREE;
window.__game = game;
if (!location.hash.includes('manual')) game.begin();
