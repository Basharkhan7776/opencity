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
import { CENTER, ISLAND_R } from './flat/Island.js';
import { buildFlatWorld } from './flat/FlatWorld.js';
import { Pedestrians, PED_RADIUS } from './flat/Pedestrians.js';
import { Traffic, TRAFFIC_COUNT } from './flat/Traffic.js';
import { VEHICLES } from './data/vehicles.js';
import { loadCarGLB } from './car/mesh.js';
import { Car, MAX_RPM, steerLockAt } from './car/physics.js';
import { ChaseCamera } from './car/camera.js';
import { Driver } from './car/driver.js';
import { Input } from './core/input.js';
import { Touch, safeInsets } from './ui/touch.js';
import { celMaterial } from './render/cel.js';
import { CelPipeline } from './render/outline.js';
import { clamp, formatTime } from './core/util.js';
import { generateRoute } from './race/path.js';
import {
  CityRace,
  RACE_LENGTHS, RACE_LENGTH_LABELS,
  RACE_DIFFS, RACE_DIFF_LABELS, RACE_MAX_LAPS,
} from './race/city.js';
import {
  loadMedals, saveMedals, awardPlace, fillOf, MEDAL_RANKS,
} from './race/medals.js';

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

/* ESC → SETTINGS. Resolution is a fraction of the current display so 1.0X
   is unchanged and 0.7X draws 49% of the pixels. */
const GFX_RES = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
const GFX_RES_LABELS = ['1.0X', '0.9X', '0.8X', '0.7X', '0.6X', '0.5X'];
const GFX_DIST = [250, 350, 500, 750, 1000];
const GFX_DIST_LABELS = ['250 M', '350 M', '500 M', '750 M', '1 KM'];
const GFX_PEDS = [0, 5, 10, 15, 20, 30, 40, 50];
const GFX_TRAFFIC = [0, 3, 5, 10, 15, 25, 35, 50];
const GFX_SHADOWS = ['off', 'low', 'medium', 'high'];
const GFX_SHADOW_LABELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
const GFX_SHADOW = {
  off: { size: 0, dist: 0 },
  low: { size: 1024, dist: 24 },
  medium: { size: 2048, dist: 38 },
  high: { size: 4096, dist: 46 },
};

const TIME_MODES = ['dynamic_30m', 'dynamic_15m', 'dynamic', 'dynamic_fast', 'dynamic_slow', 'day', 'sunset', 'night', 'dawn'];
const TIME_MODE_LABELS = [
  'DYNAMIC (30 MIN)',
  'DYNAMIC (15 MIN)',
  'DYNAMIC (3 MIN)',
  'DYNAMIC (1 MIN)',
  'DYNAMIC (8 MIN)',
  'ALWAYS DAY',
  'ALWAYS SUNSET',
  'ALWAYS NIGHT',
  'ALWAYS DAWN',
];

const GFX_KEY = 'opencity.gfx';

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

/* The player's garage. Vehicle models and characteristics are configured in src/data/vehicles.json. */
const VEHICLE_KEY = 'opencity_vehicle';

function loadSavedVehicleIndex() {
  const want = q.get('car');
  if (want) {
    const byUrl = VEHICLES.findIndex(v => v.url.endsWith(`/${want}.glb`) || v.id === want || v.name.toLowerCase() === want.toLowerCase());
    if (byUrl >= 0) return byUrl;
  }
  try {
    const saved = localStorage.getItem(VEHICLE_KEY);
    if (saved != null) {
      const byId = VEHICLES.findIndex(v => v.id === saved);
      if (byId >= 0) return byId;
      const byName = VEHICLES.findIndex(v => v.name.toLowerCase() === saved.toLowerCase());
      if (byName >= 0) return byName;
      const num = parseInt(saved, 10);
      if (!Number.isNaN(num) && num >= 0 && num < VEHICLES.length) return num;
    }
  } catch { /* private mode */ }
  return 0;
}

function saveSelectedVehicle(specOrIdx) {
  try {
    if (typeof specOrIdx === 'number') {
      const spec = VEHICLES[specOrIdx];
      if (spec) localStorage.setItem(VEHICLE_KEY, spec.id || spec.name);
    } else if (specOrIdx && typeof specOrIdx === 'object') {
      localStorage.setItem(VEHICLE_KEY, specOrIdx.id || specOrIdx.name);
    } else if (typeof specOrIdx === 'string') {
      localStorage.setItem(VEHICLE_KEY, specOrIdx);
    }
  } catch { /* private mode */ }
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.vehicleIndex = loadSavedVehicleIndex();
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
    this.viewRadius = VIEW_RADIUS;
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

    /* Ambient traffic — civilian/commercial vehicles running on the roads. */
    this.traffic = new Traffic(
      this.scene,
      this.track,
      world.city?.graph,
      VEHICLES,
      idx => this._loadRivalView(idx)
    );

    this.buildCars();
    this.timeOfDay = 0.25;
    if (this.world?.updateEnvironment) {
      this.world.updateEnvironment(this.timeOfDay, this.player.pos, this.scene, this.camera, 0);
    }

    this.touch = new Touch();
    this.input = new Input();
    this.input.touch = this.touch;
    this.chase = new ChaseCamera(this.camera);

    /* Free-fly camera: Ctrl+Shift+C toggles between the chase cam and a free
       camera that can roam the whole map (WASD + Space/Shift). Toggling back
       puts the car back at the island centre. */
    this.fly = false;
    addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyC' || e.key === 'C')) {
        e.preventDefault();
        this.toggleFly();
      } else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        this.toggleFullscreen();
      }
    });

    /* Mouse look: orbits around the vehicle middle (see ChaseCamera). Pointer
       lock keeps the cursor off-screen while driving; ESC pause restores it. */
    this.lookYaw = 0;
    this.lookPitch = 0;
    this._pointerLocked = false;
    this._setCursorVisible(false);

    const forceFullscreenStart = () => {
      if (!this.paused && !document.fullscreenElement) {
        this._requestFullscreen();
        this._requestPointerLock();
      }
    };
    window.addEventListener('click', forceFullscreenStart);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;
      forceFullscreenStart();
    });
    window.addEventListener('touchstart', forceFullscreenStart, { passive: true });

    this.canvas.addEventListener('click', () => {
      if (!this.paused) {
        this._requestFullscreen();
        this._requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === this.canvas;
      /* Cursor only while the pause menu is open. While driving it stays
         hidden even if the browser briefly drops pointer lock (Esc once). */
      this._setCursorVisible(this.paused);
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && !this.paused) {
        this.togglePause();
      }
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

    // Interactive pointer clicks on Minimap, Fullscreen Map Back button, and Race Setup reload
    const handleUIPointer = (e) => {
      // Touch interactions are managed via Touch component to prevent double-toggling
      if (e.pointerType === 'touch') return;

      const x = e.clientX, y = e.clientY;
      if (this.showMap) {
        // Tapping Back button or anywhere in map view closes map
        this.showMap = false;
        return;
      }
      if (!this.paused) {
        // Check if minimap was clicked
        const isMobile = this.touch?.live;
        const r = isMobile ? 64 : 74;
        const pad = isMobile ? 18 : 24;
        const cx = isMobile ? (window.innerWidth - pad - r) : (pad + r);
        const cy = isMobile ? (pad + r) : (window.innerHeight - pad - r);
        if (Math.hypot(x - cx, y - cy) <= r + 12) {
          this.showMap = true;
          return;
        }
      } else if (this.menu?.view === 'race') {
        const w = window.innerWidth, h = window.innerHeight;
        const mapSize = Math.min(340, h * 0.52, w * 0.38);
        const mapX = Math.max(24, w / 2 - mapSize - 36);
        const mapY = h / 2 - mapSize / 2 + 8;
        const cx = mapX + mapSize / 2;
        const reloadW = Math.min(180, mapSize * 0.85);
        const reloadH = 34;
        const reloadX = cx - reloadW / 2;
        const reloadY = mapY + mapSize + 30;
        // Check if Reload button or preview map was clicked
        if ((x >= reloadX && x <= reloadX + reloadW && y >= reloadY && y <= reloadY + reloadH) ||
            Math.hypot(x - cx, y - (mapY + mapSize / 2)) <= mapSize / 2) {
          this.menu.index = 4;
          this._previewRace(true);
          return;
        }
        // Check if options on the right were clicked
        const optX = mapX + mapSize + 36;
        const rowTop = mapY + 18;
        for (let k = 0; k < 6; k++) {
          const ry = rowTop + k * 36;
          if (x >= optX - 24 && x <= optX + 280 && y >= ry - 16 && y <= ry + 16) {
            this.menu.index = k;
            if (k === 4) this._previewRace(true);
            else if (k === 5) this._startRace();
            else {
              const s = this.raceSetup;
              if (k === 0) s.vehicle = (s.vehicle + 1) % VEHICLES.length;
              else if (k === 1) { s.lengthIdx = (s.lengthIdx + 1) % RACE_LENGTHS.length; this._previewRace(true); }
              else if (k === 2) { s.laps = (s.laps + 1) % (RACE_MAX_LAPS + 1); this._previewRace(true); }
              else if (k === 3) s.difficulty = (s.difficulty + 1) % RACE_DIFFS.length;
            }
            return;
          }
        }
      }
    };
    window.addEventListener('pointerdown', handleUIPointer);

    this.hud = new Hud(document.getElementById('hud'), this.world?.city?.graph);
    this.hud.touch = this.touch;
    this.hud.setCarName(VEHICLES[this.vehicleIndex].name);
    this.hudOn = q.get('hud') !== '0';

    this.race = null;
    this.showMap = false;
    this.ambientEnabled = true;
    this.raceSetup = {
      vehicle: this.vehicleIndex,
      lengthIdx: 1,
      laps: 3,
      difficulty: 1,
    };
    this.racePreview = null;
    this.menu = null;
    this.medals = loadMedals();
    this.gfx = this._loadGfx();
    this._applyGfx({ persist: false });

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildCars() {
    this.player = new Car(this.track, { palette: 0, perf: VEHICLES[this.vehicleIndex]?.perf || VEHICLES[0].perf });
    /* The run starts on a random city road, facing along the tarmac. */
    this._teleportToRandomRoad();

    this.vehicleViews = new Map();
    this.vehiclesLoading = new Map();

    const want = q.get('car');
    if (want) {
      const byUrl = VEHICLES.findIndex(v => v.url.endsWith(`/${want}.glb`) || v.id === want || v.name.toLowerCase() === want.toLowerCase());
      if (byUrl >= 0) this.vehicleIndex = byUrl;
    }
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
    const v = VEHICLES[idx] || VEHICLES[0];
    if (this.vehicleViews.has(v.name)) return this.vehicleViews.get(v.name);
    if (this.vehiclesLoading.has(v.name)) return this.vehiclesLoading.get(v.name);
    const p = loadCarGLB(v).then(view => {
      this._styleView(view);
      this.vehicleViews.set(v.name, view);
      return view;
    });
    this.vehiclesLoading.set(v.name, p);
    return p;
  }

  async _loadVehicle(idx) {
    this.vehicleIndex = idx;
    const v = VEHICLES[idx] || VEHICLES[0];
    if (!v) return;
    saveSelectedVehicle(v);
    const view = await this._setVehicle(idx);
    if (this.vehicleIndex !== idx) return;   // user moved on while loading
    this.player.setVehicleConfig(v);
    if (this.playerView && this.playerView.root.parent === this.scene) {
      this.scene.remove(this.playerView.root);
    }
    this.scene.add(view.root);
    this.playerView = view;
    this.hud.setCarName(v.name);
  }

  resize() {
    const w = window.innerWidth || document.documentElement.clientWidth || 800;
    const h = window.innerHeight || document.documentElement.clientHeight || 600;
    const insets = safeInsets();
    this.touch?.resize(w, h, insets);
    const scale = GFX_RES[this.gfx?.resIdx ?? 0];
    const cap = TIERS[this.tier].dpr;
    const dpr = Math.min(window.devicePixelRatio || 1, cap) * scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.pipeline.setSize(w, h);
    this.hud.resize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  step(dt) {
    if (this.touch) {
      const camDelta = this.touch.consumeCameraDelta();
      if (camDelta.x !== 0 || camDelta.y !== 0) {
        this.lookYaw -= camDelta.x * 0.004;
        this.lookPitch = clamp(this.lookPitch - camDelta.y * 0.003, -0.85, 0.55);
      }
      this.touch.setMenuMode(this.paused || !!this.menu || !!this.race?.over);
    }

    this.input.update(dt);

    /* While paused the world is not redrawn — see frame() — and the only
       thing that runs is the menu shell. */
    if (this.paused) {
      this._menuStep();
      return;
    }

    if (this.input.mapPressed) {
      this.showMap = !this.showMap;
    }

    if (this.showMap && this.input.pausePressed) {
      this.showMap = false;
      return;
    }

    if (this.input.pausePressed) this.togglePause();

    if (this.race?.over) {
      if (!this.race.results.medal) {
        this.race.results.medal = awardPlace(this.medals, this.race.results.pos);
        saveMedals(this.medals);
        this.hud.medalT = 0;
      }
      if (this.input.confirmPressed || this.input.resetPressed) this.endRace();
      this.hud.race = this.race ? this.race.hud() : null;
      this.hud.medals = this.medals;
      this.hud.update(dt, {
        speed: this.player.speed,
        playerX: this.player.pos.x,
        playerZ: this.player.pos.z,
        playerYaw: this.player.yaw,
        race: this.race,
        showMap: this.showMap,
      });
      return;
    }

    if (this.fly && !this.race) {
      this.flyStep(dt);
      this.time += dt;

      const p = this.player;
      p.lastImpact = 0;
      p.landingForce = 0;
      p.step(dt, { steer: 0, throttle: 0, brake: 1.0, handbrake: 1.0 });
      if (this.playerView) p.applyTo(this.playerView, 0);

      this.pipeline.update(dt, { speed: 0 });
      this.hud.update(dt, {
        speed: 0,
        playerX: this.camera.position.x,
        playerZ: this.camera.position.z,
        playerYaw: this.lookYaw || 0,
        race: null,
      });

      if (this.ambientEnabled) {
        const camX = this.camera.position.x, camZ = this.camera.position.z;
        if (this.pedestrians) this.pedestrians.update(dt, camX, camZ);
        if (this.traffic) this.traffic.update(dt, { pos: { x: camX, z: camZ } }, this.pedestrians);
      }
      this._updateDayNight(dt);
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

    /* Celestial orbit (Sun / Moon) and shadow tracking */
    this._updateDayNight(dt);

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
      /* Coastal ambient surf & open sky breeze */
      shoreDistance: Math.max(0, 1800 - Math.hypot(p.pos.x - 3000, p.pos.z - 0)),
      shoreDrop: Math.max(0, p.pos.y),
      oceanSide: Math.sign(p.pos.x - 3000),
      openness: 1.0,
    });

    this.hud.race = this.race ? this.race.hud() : null;
    this.hud.medals = this.medals;
    this.hud.update(dt, {
      speed: p.speed,
      playerX: p.pos.x,
      playerZ: p.pos.z,
      playerYaw: p.yaw,
      race: this.race,
      showMap: this.showMap,
    });

    if (this.ambientEnabled) {
      if (this.pedestrians) this.pedestrians.update(dt, p.pos.x, p.pos.z, p);
      if (this.traffic) this.traffic.update(dt, p, this.pedestrians);
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
      this.showMap = false;
      this.menu = { view: 'main', index: 0, liveRace: !!this.race };
      this.audio.stop();
      this._exitFullscreen();
      this._exitPointerLock();
      this._setCursorVisible(true);
    } else {
      this.menu = null;
      this.audio.start();
      this._setCursorVisible(false);
      this._requestFullscreen();
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

  _requestFullscreen() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      elem.requestFullscreen?.()?.catch?.(() => {});
    }
  }

  _exitFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()?.catch?.(() => {});
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      this._exitFullscreen();
    } else {
      this._requestFullscreen();
      if (!this.paused) this._requestPointerLock();
    }
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
      ? ['RESUME', 'SETTINGS', 'LEAVE RACE']
      : ['RESUME', 'RACE', 'CHANGE VEHICLE', 'SETTINGS', 'RESTART'];
  }

  _menuStep() {
    const m = this.menu;
    const i = this.input;
    if (!m) return;
    m.liveRace = !!this.race;
    m.setup = this.raceSetup;
    m.preview = this.racePreview;
    m.medals = this.medals;
    if (this._switching) return;
    m.gfx = this.gfx;
    if (i.pausePressed) {
      if (m.view === 'vehicles' || m.view === 'race' || m.view === 'settings') {
        m.view = 'main'; m.index = 0; return;
      }
      this.togglePause();
      return;
    }
    if (m.view === 'race') return this._raceMenuStep();
    if (m.view === 'settings') return this._settingsMenuStep();
    if (m.view === 'main') {
      const items = this._menuItems();
      const n = items.length;
      if (i.menuUpPressed) m.index = (m.index + n - 1) % n;
      else if (i.menuDownPressed) m.index = (m.index + 1) % n;
      else if (i.confirmPressed) {
        const pick = items[m.index];
        if (pick === 'RESUME') this.togglePause();
        else if (pick === 'RACE') {
          m.view = 'race';
          m.index = 0;
          this._previewRace(false);
        }
        else if (pick === 'CHANGE VEHICLE') {
          m.view = 'vehicles';
          m.index = this.vehicleIndex;
        } else if (pick === 'SETTINGS') { m.view = 'settings'; m.index = 0; }
        else if (pick === 'RESTART') {
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
    this._previewRace(false);
    const rows = 6; /* vehicle, length, laps, difficulty, reload, START */
    if (i.resetPressed) {
      this._previewRace(true);
      return;
    }
    if (i.menuUpPressed) m.index = (m.index + rows - 1) % rows;
    else if (i.menuDownPressed) m.index = (m.index + 1) % rows;
    else if (i.menuLeftPressed || i.menuRightPressed) {
      const dir = i.menuRightPressed ? 1 : -1;
      if (m.index === 0) {
        s.vehicle = (s.vehicle + dir + VEHICLES.length) % VEHICLES.length;
      } else if (m.index === 1) {
        s.lengthIdx = (s.lengthIdx + dir + RACE_LENGTHS.length) % RACE_LENGTHS.length;
        this._previewRace(true);
      } else if (m.index === 2) {
        s.laps = (s.laps + dir + RACE_MAX_LAPS + 1) % (RACE_MAX_LAPS + 1);
        this._previewRace(true);
      } else if (m.index === 3) {
        s.difficulty = (s.difficulty + dir + RACE_DIFFS.length) % RACE_DIFFS.length;
      } else if (m.index === 4) {
        this._previewRace(true);
      }
    } else if (i.confirmPressed) {
      if (m.index === 4) {
        this._previewRace(true);
      } else if (m.index === 5) {
        this._startRace();
      }
    }
  }

  /** Build or refresh the route shown on the race-setup map. */
  _previewRace(force) {
    const graph = this.world?.city?.graph;
    if (!graph) return;
    const s = this.raceSetup;
    const stale = !this.racePreview
      || this.racePreview.lengthIdx !== s.lengthIdx
      || this.racePreview.laps !== s.laps
      || this.racePreview.difficulty !== s.difficulty
      || !this.racePreview.route;
    if (!force && !stale) return;
    const route = generateRoute(graph, {
      length: RACE_LENGTHS[s.lengthIdx],
      loop: s.laps > 0,
      difficulty: RACE_DIFFS[s.difficulty],
      seed: (Math.random() * 0xffffffff) >>> 0,
    });
    this.racePreview = {
      route,
      lengthIdx: s.lengthIdx,
      laps: s.laps,
      difficulty: s.difficulty,
    };
  }

  _settingsMenuStep() {
    const m = this.menu;
    const i = this.input;
    const g = this.gfx;
    const rows = 6;
    if (i.menuUpPressed) m.index = (m.index + rows - 1) % rows;
    else if (i.menuDownPressed) m.index = (m.index + 1) % rows;
    else if (i.menuLeftPressed || i.menuRightPressed) {
      const dir = i.menuRightPressed ? 1 : -1;
      if (m.index === 0) {
        g.resIdx = (g.resIdx + dir + GFX_RES.length) % GFX_RES.length;
      } else if (m.index === 1) {
        g.distIdx = (g.distIdx + dir + GFX_DIST.length) % GFX_DIST.length;
      } else if (m.index === 2) {
        g.pedIdx = (g.pedIdx + dir + GFX_PEDS.length) % GFX_PEDS.length;
      } else if (m.index === 3) {
        g.trafficIdx = (g.trafficIdx + dir + GFX_TRAFFIC.length) % GFX_TRAFFIC.length;
      } else if (m.index === 4) {
        g.shadowIdx = (g.shadowIdx + dir + GFX_SHADOWS.length) % GFX_SHADOWS.length;
      } else if (m.index === 5) {
        g.timeIdx = (g.timeIdx + dir + TIME_MODES.length) % TIME_MODES.length;
      }
      this._applyGfx({ preview: true });
    }
  }

  _defaultGfx() {
    return {
      resIdx: 0,
      distIdx: GFX_DIST.indexOf(VIEW_RADIUS) >= 0 ? GFX_DIST.indexOf(VIEW_RADIUS) : 2,
      pedIdx: GFX_PEDS.indexOf(10) >= 0 ? GFX_PEDS.indexOf(10) : 2,
      trafficIdx: GFX_TRAFFIC.indexOf(5) >= 0 ? GFX_TRAFFIC.indexOf(5) : 2,
      shadowIdx: this.tier === 'low' ? 1 : this.tier === 'medium' ? 2 : 3,
      timeIdx: 0,
    };
  }

  /** Use a stored index when it is in range; otherwise the default. */
  _gfxIdx(value, count, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = n | 0;
    return i >= 0 && i < count ? i : fallback;
  }

  /**
   * Local settings first, defaults only for missing or invalid fields.
   * Corrupt or blocked storage falls back to a full default object.
   */
  _loadGfx() {
    const defaults = this._defaultGfx();
    try {
      const raw = localStorage.getItem(GFX_KEY);
      if (raw == null || raw === '') return defaults;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return defaults;
      return {
        resIdx: this._gfxIdx(saved.resIdx, GFX_RES.length, defaults.resIdx),
        distIdx: this._gfxIdx(saved.distIdx, GFX_DIST.length, defaults.distIdx),
        pedIdx: this._gfxIdx(saved.pedIdx, GFX_PEDS.length, defaults.pedIdx),
        trafficIdx: this._gfxIdx(saved.trafficIdx, GFX_TRAFFIC.length, defaults.trafficIdx),
        shadowIdx: this._gfxIdx(saved.shadowIdx, GFX_SHADOWS.length, defaults.shadowIdx),
        timeIdx: this._gfxIdx(saved.timeIdx, TIME_MODES.length, defaults.timeIdx),
      };
    } catch {
      return defaults;
    }
  }

  _saveGfx() {
    try { localStorage.setItem(GFX_KEY, JSON.stringify(this.gfx)); } catch { /* private mode */ }
  }

  _updateDayNight(dt) {
    const mode = TIME_MODES[this.gfx?.timeIdx ?? 0];
    if (mode === 'dynamic_30m') {
      this.timeOfDay = ((this.timeOfDay + dt * (1 / 1800)) % 1 + 1) % 1;
    } else if (mode === 'dynamic_15m') {
      this.timeOfDay = ((this.timeOfDay + dt * (1 / 900)) % 1 + 1) % 1;
    } else if (mode === 'dynamic') {
      this.timeOfDay = ((this.timeOfDay + dt * (1 / 180)) % 1 + 1) % 1;
    } else if (mode === 'dynamic_fast') {
      this.timeOfDay = ((this.timeOfDay + dt * (1 / 60)) % 1 + 1) % 1;
    } else if (mode === 'dynamic_slow') {
      this.timeOfDay = ((this.timeOfDay + dt * (1 / 480)) % 1 + 1) % 1;
    } else if (mode === 'day') {
      this.timeOfDay = 0.30;
    } else if (mode === 'sunset') {
      this.timeOfDay = 0.50;
    } else if (mode === 'night') {
      this.timeOfDay = 0.75;
    } else if (mode === 'dawn') {
      this.timeOfDay = 0.08;
    }

    const focusPos = (this.fly && !this.race)
      ? this.camera.position
      : (this.player ? this.player.pos : null);
    if (this.world?.updateEnvironment) {
      this.world.updateEnvironment(this.timeOfDay, focusPos, this.scene, this.camera, dt);
    }
  }

  _applyGfx({ persist = true, preview = false } = {}) {
    const g = this.gfx;
    this.resize();

    const dist = GFX_DIST[g.distIdx];
    this.viewRadius = dist;
    if (this.scene.fog) {
      this.scene.fog.near = dist * 0.6;
      this.scene.fog.far = dist;
    }
    this.camera.far = dist + 100;
    this.camera.updateProjectionMatrix();
    this.pedestrians?.setRadius(dist);
    this.pedestrians?.setCount(GFX_PEDS[g.pedIdx]);
    this.traffic?.setRadius(dist);
    this.traffic?.setCount(GFX_TRAFFIC[g.trafficIdx]);

    const spec = GFX_SHADOW[GFX_SHADOWS[g.shadowIdx]];
    const shadowsOn = spec.size > 0;
    this.renderer.shadowMap.enabled = shadowsOn;
    if (this.sun) {
      this.sun.castShadow = shadowsOn;
      if (shadowsOn) {
        const size = Math.min(spec.size, this.renderer.capabilities.maxTextureSize);
        if (this.sun.shadow.mapSize.x !== size) {
          this.sun.shadow.mapSize.set(size, size);
          this.sun.shadow.map?.dispose();
          this.sun.shadow.map = null;
        }
        const cam = this.sun.shadow.camera;
        cam.left = -spec.dist; cam.right = spec.dist;
        cam.top = spec.dist; cam.bottom = -spec.dist;
        cam.updateProjectionMatrix();
      }
    }

    if (persist) this._saveGfx();
    if (preview && this.running && this.pipeline && !this.paused) this.pipeline.render();
    if (preview && this.running && this.pipeline && this.paused) {
      this._cullWorldChunks();
      this.pipeline.render();
    }
  }

  setAmbient(on) {
    this.ambientEnabled = !!on;
    this.pedestrians?.setEnabled(this.ambientEnabled);
    this.traffic?.setEnabled(this.ambientEnabled);
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
      this._previewRace(false);
      const route = this.racePreview?.route
        && this.racePreview.lengthIdx === s.lengthIdx
        && this.racePreview.laps === s.laps
        && this.racePreview.difficulty === s.difficulty
        ? this.racePreview.route
        : generateRoute(graph, {
          length: RACE_LENGTHS[s.lengthIdx],
          loop: s.laps > 0,
          difficulty: RACE_DIFFS[s.difficulty],
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
      for (const entry of race.entries) {
        if (entry.view) entry.car.applyTo(entry.view, 0);
      }
      if (this.race) this.race.dispose();
      this.setAmbient(false);
      this.race = race;
      started = true;
      this.chase.started = false;
      this.chase.update(this.player, 1 / 60, { lookBack: false, orbitYaw: 0, orbitPitch: 0 });
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
    const v = VEHICLES[idx] || VEHICLES[0];
    const view = await loadCarGLB(v);
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
    saveSelectedVehicle(idx);
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
        const yaw = Math.atan2(b.z - a.z, b.x - a.x);
        p.placeAtWorld((a.x + b.x) * 0.5, (a.z + b.z) * 0.5, yaw);
        if (this.chase) this.chase.started = false;
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
    p.placeAtWorld(INTER_X, 0, 0);
    p.vertVel = 0; p.height = 0;
    if (this.chase) this.chase.started = false;
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
    let a = 0, b = 0, c = 0, d = 0;
    const bump = () => this._setLoadProgress((a + b + c + d) / 4);
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
    tasks.push(this.traffic.load()
      .then(() => { d = 1; bump(); })
      .catch(err => console.warn('traffic', err)));
    bump();
    await Promise.all(tasks);
    this._setLoadProgress(1);
    this._scanWorldChunks();
    /* Ped & traffic pools exist now — re-apply the saved (or default) counts/radii. */
    this._applyGfx({ persist: false });
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
      const lim = this.viewRadius + c.r;
      c.object.visible = dx * dx + dz * dz <= lim * lim;
    }
  }

  setPaused(p) {
    const next = !!p;
    if (next === this.paused) return;
    this.paused = next;
    if (this.paused) {
      this._exitFullscreen();
      this._exitPointerLock();
      this._setCursorVisible(true);
    } else {
      this._setCursorVisible(false);
      this._requestFullscreen();
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

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* The HUD: real-time mini map radar, crisp digital speed readout, race stats, and pause plate. */
class Hud {
  constructor(canvas, graph = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.speed = 0;
    this.carName = '';
    this.race = null;
    this.medals = null;
    this.medalT = 0;
    this.playerX = 0;
    this.playerZ = 0;
    this.playerYaw = 0;
    this.activeRace = null;
    this._clock = 0;
    this.graph = null;
    this.nodeMap = new Map();
    if (graph) this.setGraph(graph);
  }

  setGraph(graph) {
    this.graph = graph;
    this.nodeMap.clear();
    if (graph?.nodes) {
      for (const n of graph.nodes) this.nodeMap.set(n.id, n);
    }
  }

  resize(w, h, dpr = window.devicePixelRatio || 1) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  setCarName(name) { this.carName = name; }

  update(dt, { speed = 0, playerX = 0, playerZ = 0, playerYaw = 0, race = null, showMap = false } = {}) {
    this.speed = speed;
    this.playerX = playerX;
    this.playerZ = playerZ;
    this.playerYaw = playerYaw;
    this.activeRace = race;
    this.showMap = showMap;
    if (this.touch) this.touch.setMapMode(showMap);
    this._clock += dt;
    if (race?.results?.medal) this.medalT = Math.min(1, this.medalT + dt / 0.85);
    else this.medalT = 0;
  }

  draw(paused = false, menu = null) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (paused) {
      this._drawMenu(menu);
      if (this.touch) this._drawTouch(ctx, this.touch);
      return;
    }

    /* 1. Real-time City Mini Map (Top-Right on Mobile, Bottom-Left on Desktop) */
    this._drawMinimap(ctx, w, h);

    /* 2. Active Race HUD at Top-Centre */
    if (this.race) this._drawRace(ctx, w, h);

    /* 3. Speed Readout (Top-Right on Mobile, Bottom-Right on Desktop) */
    this._drawSpeedometer(ctx, w, h);

    /* 4. Current Vehicle Name, Bottom-Centre */
    if (this.carName && !this.touch?.live) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(240,230,216,0.65)';
      ctx.fillText(this.carName, w / 2, h - 22);
    }

    /* 5. Full Tactical Map Overlay (Toggled via [M] key or Map button) */
    if (this.showMap) {
      this._drawFullscreenMap(ctx, w, h);
    }

    /* 6. Translucent Touch Controls */
    if (this.touch) this._drawTouch(ctx, this.touch);
  }

  _drawSpeedometer(ctx, w, h) {
    const isMobile = this.touch?.live;
    const kmh = Math.round(this.speed * 3.6);
    ctx.save();
    if (isMobile) {
      const r = 64;
      const pad = 18;
      const x = w - pad - 6;
      const y = pad + r * 2 + 36;
      ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(20,10,14,0.9)';
      ctx.shadowBlur = 10;
      ctx.font = '700 36px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#f0e6d8';
      ctx.fillText(String(kmh), x, y);
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#c9b8a5';
      ctx.fillText('KM/H', x, y + 16);
    } else {
      ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(20,10,14,0.9)';
      ctx.shadowBlur = 10;
      ctx.font = '700 58px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#f0e6d8';
      ctx.fillText(String(kmh), w - 28, h - 50);
      ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#c9b8a5';
      ctx.fillText('KM/H', w - 28, h - 26);
    }
    ctx.restore();
  }

  _drawTouchButton(ctx, r, label, pressed, colorType = 'default') {
    if (!r) return;
    const c = Math.min(r.w, r.h) * 0.28;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, c);
    else ctx.rect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = pressed
      ? (colorType === 'green' ? 'rgba(38, 185, 90, 0.72)'
        : colorType === 'red' ? 'rgba(225, 45, 55, 0.78)'
        : 'rgba(250, 195, 45, 0.75)')
      : 'rgba(16, 22, 34, 0.52)';
    ctx.fill();

    ctx.lineWidth = pressed ? 3.0 : 1.8;
    ctx.strokeStyle = pressed ? '#ffffff' : 'rgba(255, 255, 255, 0.40)';
    ctx.stroke();

    const isSymbol = label.length <= 2;
    const fontSize = isSymbol
      ? Math.max(22, Math.min(36, r.h * 0.48))
      : Math.max(13, Math.min(18, r.h * 0.36));
    const textColor = pressed ? '#ffffff' : 'rgba(255, 255, 255, 0.95)';
    ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
  }

  _drawTouch(ctx, touch) {
    const tc = touch.display();
    if (!tc) return;
    const L = tc.layout;
    if (!L) return;

    if (tc.inMap) {
      if (L.mapBackBtn) this._drawTouchButton(ctx, L.mapBackBtn, L.mapBackBtn.label, tc.mapPressed, 'gold');
      return;
    }

    if (tc.inMenu) {
      // Menu D-pad
      this._drawTouchButton(ctx, L.menuUp, L.menuUp.label, tc.menuUpPressed, 'gold');
      this._drawTouchButton(ctx, L.menuDown, L.menuDown.label, tc.menuDownPressed, 'gold');
      this._drawTouchButton(ctx, L.menuLeft, L.menuLeft.label, tc.menuLeftPressed, 'gold');
      this._drawTouchButton(ctx, L.menuRight, L.menuRight.label, tc.menuRightPressed, 'gold');

      // Menu Actions
      this._drawTouchButton(ctx, L.menuConfirm, L.menuConfirm.label, tc.confirmPressed, 'green');
      this._drawTouchButton(ctx, L.menuBack, L.menuBack.label, tc.pausePressed, 'red');
    } else {
      // Top-Left Pause Button
      this._drawTouchButton(ctx, L.pauseBtn, L.pauseBtn.label, tc.pausePressed, 'gold');

      // Bottom-Left Steering Buttons
      this._drawTouchButton(ctx, L.leftBtn, L.leftBtn.label, tc.leftPressed, 'gold');
      this._drawTouchButton(ctx, L.rightBtn, L.rightBtn.label, tc.rightPressed, 'gold');

      // Bottom-Right Pedals & Handbrake
      this._drawTouchButton(ctx, L.gasPedal, L.gasPedal.label, tc.throttlePressed, 'green');
      this._drawTouchButton(ctx, L.brakePedal, L.brakePedal.label, tc.brakePressed, 'red');
      this._drawTouchButton(ctx, L.handbrakeBtn, L.handbrakeBtn.label, tc.handbrakePressed, 'gold');
    }
  }

  /* ---- Mini Map Radar (Top-Right on mobile, Bottom-Left on desktop) --- */

  _drawMinimap(ctx, w, h) {
    const isMobile = this.touch?.live;
    const r = isMobile ? 64 : 74; // Radar radius in CSS pixels
    const pad = isMobile ? 18 : 24;
    const cx = isMobile ? (w - pad - r) : (pad + r);
    const cy = isMobile ? (pad + r) : (h - pad - r);

    ctx.save();

    // 1. Dark frosted circular backdrop with soft shadow
    ctx.shadowColor = 'rgba(10, 8, 12, 0.85)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(18, 14, 18, 0.86)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 2. Circular clipping for map viewport
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
    ctx.clip();

    // 3. Subtle radar range rings & crosshairs
    ctx.strokeStyle = 'rgba(240, 230, 216, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.80, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(240, 230, 216, 0.05)';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // 4. World-to-Radar coordinate projection (rotating with player vehicle heading)
    const viewRadius = 180; // World radius visible on radar in meters
    const scale = (r - 4) / viewRadius; // px per meter
    const cosY = Math.cos(this.playerYaw);
    const sinY = Math.sin(this.playerYaw);
    const px = this.playerX, pz = this.playerZ;

    const toU = (wx, wz) => {
      const dx = wx - px, dz = wz - pz;
      const right = -dx * sinY + dz * cosY;
      return cx + right * scale;
    };
    const toV = (wx, wz) => {
      const dx = wx - px, dz = wz - pz;
      const fwd = dx * cosY + dz * sinY;
      return cy - fwd * scale;
    };

    // 5. Draw City Road Graph
    if (this.graph && this.graph.edges) {
      const edges = this.graph.edges;
      const byId = this.nodeMap;
      const viewMaxDistSq = (viewRadius * 1.5) ** 2;

      const minorStreets = [];
      const majorAvenues = [];

      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const na = byId.get(e.a), nb = byId.get(e.b);
        if (!na || !nb) continue;
        const dxa = na.x - px, dza = na.z - pz;
        const dxb = nb.x - px, dzb = nb.z - pz;
        if (dxa * dxa + dza * dza > viewMaxDistSq && dxb * dxb + dzb * dzb > viewMaxDistSq) {
          continue;
        }
        if (e.width >= 12) majorAvenues.push(e);
        else minorStreets.push(e);
      }

      // Draw regular streets
      if (minorStreets.length) {
        ctx.strokeStyle = 'rgba(215, 210, 202, 0.40)';
        ctx.lineWidth = 3.0;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < minorStreets.length; i++) {
          const e = minorStreets[i];
          const na = byId.get(e.a), nb = byId.get(e.b);
          ctx.moveTo(toU(na.x, na.z), toV(na.x, na.z));
          ctx.lineTo(toU(nb.x, nb.z), toV(nb.x, nb.z));
        }
        ctx.stroke();
      }

      // Draw major 2-lane avenues
      if (majorAvenues.length) {
        ctx.strokeStyle = 'rgba(255, 245, 230, 0.85)';
        ctx.lineWidth = 4.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < majorAvenues.length; i++) {
          const e = majorAvenues[i];
          const na = byId.get(e.a), nb = byId.get(e.b);
          ctx.moveTo(toU(na.x, na.z), toV(na.x, na.z));
          ctx.lineTo(toU(nb.x, nb.z), toV(nb.x, nb.z));
        }
        ctx.stroke();
      }
    }

    // 6. Draw Race Route, All Checkpoints, and Competitor Blips if in a Race
    if (this.activeRace && this.activeRace.route) {
      const route = this.activeRace.route;
      const pts = route.points || [];
      const cps = route.checkpoints || [];
      const curCpIdx = this.activeRace.playerSlot?.cp || 0;
      const n = cps.length;

      // 6a. Draw Race Route Polyline
      if (pts.length > 1) {
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.45)';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const u = toU(p.x, p.z), v = toV(p.x, p.z);
          if (i === 0) ctx.moveTo(u, v);
          else ctx.lineTo(u, v);
        }
        if (route.loop) ctx.closePath();
        ctx.stroke();
      }

      // 6b. Draw Checkpoints along the Route (Active Checkpoint prominently featured)
      for (let i = 0; i < cps.length; i++) {
        const cp = cps[i];
        let cu = toU(cp.x, cp.z);
        let cv = toV(cp.x, cp.z);
        const dist = Math.hypot(cu - cx, cv - cy);
        const isLive = n > 0 && (i === curCpIdx % n);
        const isNext = n > 0 && (i === (curCpIdx + 1) % n);

        if (isLive) {
          if (dist > r - 9) {
            // Off-radar: draw high-visibility pointing directional beacon on the perimeter ring
            const angle = Math.atan2(cv - cy, cu - cx);
            cu = cx + Math.cos(angle) * (r - 9);
            cv = cy + Math.sin(angle) * (r - 9);

            ctx.save();
            ctx.translate(cu, cv);
            ctx.rotate(angle);
            ctx.shadowColor = 'rgba(255, 184, 0, 0.95)';
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#ffd54a';
            ctx.strokeStyle = '#140c0e';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(7, 0);
            ctx.lineTo(-5, -5.5);
            ctx.lineTo(-2, 0);
            ctx.lineTo(-5, 5.5);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.stroke();
            ctx.restore();
          } else {
            // On-radar active checkpoint: vibrant pulsing halo + glowing golden bullseye
            const pulsePhase = (this._clock * 3.5) % 1;
            const haloRadius = 6.5 + pulsePhase * 12;
            const haloAlpha = (1 - pulsePhase) * 0.75;
            ctx.strokeStyle = `rgba(255, 213, 74, ${haloAlpha})`;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(cu, cv, haloRadius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.shadowColor = 'rgba(255, 184, 0, 0.95)';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#ffb800';
            ctx.beginPath();
            ctx.arc(cu, cv, 6.0, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.2;
            ctx.stroke();

            // Inner white bullseye dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(cu, cv, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (dist <= r - 2) {
          if (isNext) {
            // Next upcoming checkpoint
            ctx.fillStyle = '#f5b025';
            ctx.strokeStyle = '#140c0e';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(cu, cv, 4.0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          } else {
            // Other checkpoints on the route
            ctx.fillStyle = 'rgba(255, 184, 0, 0.70)';
            ctx.strokeStyle = '#140c0e';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(cu, cv, 2.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // 6c. Draw Rival Vehicles
      const rivals = this.activeRace.entries || [];
      for (let i = 0; i < rivals.length; i++) {
        const rv = rivals[i];
        if (rv.isPlayer || !rv.car?.pos) continue;
        const ru = toU(rv.car.pos.x, rv.car.pos.z);
        const rv_v = toV(rv.car.pos.x, rv.car.pos.z);
        if (Math.hypot(ru - cx, rv_v - cy) < r - 3) {
          ctx.fillStyle = '#ff4242';
          ctx.strokeStyle = '#140c0e';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(ru, rv_v, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    ctx.restore(); // End clipping

    // 7. Draw Player Vehicle Arrow at Radar Center (Pointing UP)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = 'rgba(255, 184, 0, 0.85)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffb800';
    ctx.strokeStyle = '#120d0b';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Sharp white inner core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(3.2, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-3.2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 8. Radar Outer Border Rim & North Compass Indicator
    ctx.strokeStyle = 'rgba(240, 230, 216, 0.35)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Compass North Indicator (World -Z)
    const nAngle = Math.atan2(-Math.sin(this.playerYaw), -Math.cos(this.playerYaw));
    const nx = cx + Math.cos(nAngle) * (r - 7);
    const ny = cy - Math.sin(nAngle) * (r - 7);
    ctx.fillStyle = '#ff4d4d';
    ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    ctx.restore();
  }

  /* ---- Full Tactical Map Overlay ([M] key / Map button) --------------- */

  _drawFullscreenMap(ctx, w, h) {
    const isMobile = this.touch?.live;
    const pad = isMobile ? 12 : 24;
    const cardW = Math.min(w - pad * 2, 780);
    const cardH = Math.min(h - pad * 2, 680);
    const cardX = (w - cardW) / 2;
    const cardY = (h - cardH) / 2;

    ctx.save();

    // 1. Dark semi-transparent card backdrop
    ctx.shadowColor = 'rgba(10, 8, 12, 0.95)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(14, 12, 18, 0.94)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 18);
    else ctx.rect(cardX, cardY, cardW, cardH);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Outer border
    ctx.strokeStyle = 'rgba(240, 230, 216, 0.22)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 2. Card Header
    const isRace = !!(this.activeRace && this.activeRace.route);
    const route = isRace ? this.activeRace.route : null;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.fillText(isRace ? 'TACTICAL RACE MAP' : 'CITY MAP — OPEN ROAM', cardX + 22, cardY + 28);

    // Back / Close Button in header (drawn on desktop; on mobile _drawTouch draws responsive touch button)
    if (!isMobile) {
      const backW = 105;
      const backH = 32;
      const backX = cardX + cardW - backW - 18;
      const backY = cardY + 12;

      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(backX, backY, backW, backH, 8);
      else ctx.rect(backX, backY, backW, backH);
      ctx.fillStyle = 'rgba(255, 184, 0, 0.22)';
      ctx.fill();
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#ffd54a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◀ BACK', backX + backW / 2, backY + backH / 2);
      ctx.restore();
    }

    // 3. Map Viewport Dimensions
    const mapPadTop = 48;
    const mapPadBottom = 40;
    const availW = cardW - 32;
    const availH = cardH - mapPadTop - mapPadBottom;
    const mapSize = Math.min(availW, availH);
    const cx = cardX + cardW / 2;
    const cy = cardY + mapPadTop + availH / 2;

    const sc = (mapSize / 2 - 8) / ISLAND_R;
    const toX = wx => cx + (wx - CENTER.x) * sc;
    const toY = wz => cy + (wz - CENTER.z) * sc;

    // Map Area Clipping
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, mapSize / 2, 0, Math.PI * 2);
    ctx.clip();

    // Ocean fill
    ctx.fillStyle = '#122533';
    ctx.beginPath();
    ctx.arc(cx, cy, mapSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Island landmass fill
    ctx.beginPath();
    ctx.arc(cx, cy, ISLAND_R * sc, 0, Math.PI * 2);
    ctx.fillStyle = '#2d5a2d';
    ctx.fill();

    // Beach sand ring
    ctx.beginPath();
    ctx.arc(cx, cy, (ISLAND_R - 35) * sc, 0, Math.PI * 2);
    ctx.fillStyle = '#3a7238';
    ctx.fill();

    // City center ring
    ctx.beginPath();
    ctx.arc(cx, cy, (ISLAND_R - 120) * sc, 0, Math.PI * 2);
    ctx.fillStyle = '#42803f';
    ctx.fill();

    // 4. City Road Graph
    if (this.graph?.edges && this.nodeMap) {
      const edges = this.graph.edges;
      const byId = this.nodeMap;
      const minor = [], major = [];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.width >= 12) major.push(e);
        else minor.push(e);
      }

      // Minor streets
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(210, 205, 198, 0.40)';
      ctx.lineWidth = Math.max(1.2, 2.0 * (mapSize / 400));
      ctx.beginPath();
      for (let i = 0; i < minor.length; i++) {
        const e = minor[i];
        const a = byId.get(e.a), b = byId.get(e.b);
        if (!a || !b) continue;
        ctx.moveTo(toX(a.x), toY(a.z));
        ctx.lineTo(toX(b.x), toY(b.z));
      }
      ctx.stroke();

      // Major 2-lane avenues
      ctx.strokeStyle = 'rgba(255, 248, 238, 0.85)';
      ctx.lineWidth = Math.max(2.2, 3.8 * (mapSize / 400));
      ctx.beginPath();
      for (let i = 0; i < major.length; i++) {
        const e = major[i];
        const a = byId.get(e.a), b = byId.get(e.b);
        if (!a || !b) continue;
        ctx.moveTo(toX(a.x), toY(a.z));
        ctx.lineTo(toX(b.x), toY(b.z));
      }
      ctx.stroke();
    }

    // 5. If in Race Mode: Draw Race Route, Checkpoints, and Opponent / Rival Cars
    if (isRace && route) {
      const pts = route.points || [];
      const cps = route.checkpoints || [];
      const curCpIdx = this.activeRace.playerSlot?.cp || 0;
      const n = cps.length;

      // 5a. Route polyline
      if (pts.length > 1) {
        // Glowing outline
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.35)';
        ctx.lineWidth = 6.0;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const u = toX(pts[i].x), v = toY(pts[i].z);
          if (i === 0) ctx.moveTo(u, v);
          else ctx.lineTo(u, v);
        }
        if (route.loop) ctx.closePath();
        ctx.stroke();

        // Main golden path
        ctx.strokeStyle = '#ffd54a';
        ctx.lineWidth = 3.6;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const u = toX(pts[i].x), v = toY(pts[i].z);
          if (i === 0) ctx.moveTo(u, v);
          else ctx.lineTo(u, v);
        }
        if (route.loop) ctx.closePath();
        ctx.stroke();
      }

      // 5b. Checkpoints
      for (let i = 0; i < cps.length; i++) {
        const cp = cps[i];
        const cu = toX(cp.x), cv = toY(cp.z);
        const isLive = n > 0 && (i === curCpIdx % n);
        const isStart = i === 0;

        if (isStart) {
          ctx.fillStyle = '#6f8f38';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(cu, cv, 5.0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (isLive) {
          const pulse = (this._clock * 3.5) % 1;
          ctx.strokeStyle = `rgba(255, 213, 74, ${1 - pulse})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cu, cv, 5 + pulse * 10, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#ffb800';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cu, cv, 5.0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255, 184, 0, 0.70)';
          ctx.beginPath();
          ctx.arc(cu, cv, 3.0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 5c. Opponent / Rival Cars
      const rivals = this.activeRace.entries || [];
      for (let i = 0; i < rivals.length; i++) {
        const rv = rivals[i];
        if (rv.isPlayer || !rv.car?.pos) continue;
        const rx = toX(rv.car.pos.x), ry = toY(rv.car.pos.z);

        ctx.shadowColor = 'rgba(255, 50, 50, 0.9)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ff3838';
        ctx.beginPath();
        ctx.arc(rx, ry, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#140c0e';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Rival tag
        ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`R${i + 1}`, rx, ry - 8);
      }
    }

    // 6. Player Vehicle Marker & Orientation Arrow
    const px = toX(this.playerX);
    const py = toY(this.playerZ);

    // Player position pulse
    const pPulse = (this._clock * 2) % 1;
    ctx.strokeStyle = `rgba(255, 90, 36, ${0.8 * (1 - pPulse)})`;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(px, py, 6 + pPulse * 12, 0, Math.PI * 2);
    ctx.stroke();

    // Player arrow
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.playerYaw);
    ctx.shadowColor = 'rgba(255, 90, 36, 0.95)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff5a24';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // End Map Clipping

    // Map Border Ring
    ctx.strokeStyle = 'rgba(240, 230, 216, 0.35)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(cx, cy, mapSize / 2, 0, Math.PI * 2);
    ctx.stroke();

    // 7. Footer Prompt
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240, 230, 216, 0.75)';
    ctx.fillText(isMobile ? 'TAP [BACK] OR TOUCH OUTSIDE TO CLOSE' : 'PRESS [M] OR [ESC] TO CLOSE MAP', cardX + cardW / 2, cardY + cardH - 18);

    ctx.restore();
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
    if (menu?.view === 'settings') return this._drawSettings(menu);

    ctx.font = '700 34px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 12;
    ctx.fillText('PAUSED', w / 2, h / 2 - 105);
    ctx.shadowBlur = 0;
    ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#c9b8a5';
    ctx.fillText(this.carName || '', w / 2, h / 2 - 75);
    this._drawMedalChip(ctx, w / 2, h / 2 - 52, menu?.medals || this.medals);

    const items = menu?.liveRace
      ? ['RESUME', 'SETTINGS', 'LEAVE RACE']
      : ['RESUME', 'RACE', 'CHANGE VEHICLE', 'SETTINGS', 'RESTART'];
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    const startY = h / 2 - 14;
    for (let k = 0; k < items.length; k++) {
      const y = startY + k * 34;
      const sel = menu ? k === menu.index : k === 0;
      ctx.fillStyle = sel ? '#f0e6d8' : 'rgba(201,184,165,0.7)';
      ctx.fillText(items[k], w / 2 + 14, y);
      if (sel) {
        ctx.fillStyle = '#ffd54a';
        ctx.fillText('▶', w / 2 - 106, y);
      }
    }

    // Guide lines / touch instructions at bottom
    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.6)';
    if (this.touch?.live) {
      ctx.fillText('Tap on-screen D-Pad & Action buttons or menu items', w / 2, startY + items.length * 34 + 20);
    } else {
      ctx.fillText('UP / DOWN  choose    ENTER  select    ESC  resume', w / 2, startY + items.length * 34 + 20);

      // Controls guide badge bar
      const barW = Math.min(680, w * 0.9);
      const barH = 38;
      const barX = (w - barW) / 2;
      const barY = Math.max(startY + items.length * 34 + 44, h - 58);

      ctx.fillStyle = 'rgba(28, 18, 24, 0.72)';
      ctx.strokeStyle = 'rgba(184, 114, 79, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(barX, barY, barW, barH, 6);
      else ctx.rect(barX, barY, barW, barH);
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#ffd54a';
      ctx.textAlign = 'center';
      ctx.fillText('CONTROLS:  WASD / ARROWS  drive    SPACE  handbrake / drift    C  look back    CTRL+F  fullscreen    R  reset', w / 2, barY + 23);
    }
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
      ['RELOAD TRACK 🔄', 'GENERATE NEW'],
      ['START RACE 🏁', ''],
    ];

    const mapSize = Math.min(340, h * 0.52, w * 0.38);
    const mapX = Math.max(24, w / 2 - mapSize - 36);
    const mapY = h / 2 - mapSize / 2 + 8;
    const optX = mapX + mapSize + 36;
    const cx = mapX + mapSize / 2;

    ctx.font = '700 28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillText('RACE', w / 2, Math.max(36, mapY - 28));
    ctx.shadowBlur = 0;

    this._drawRacePreviewMap(ctx, mapX, mapY, mapSize, menu.preview?.route);

    // Interactive Reload Track Button below preview map
    const reloadW = Math.min(180, mapSize * 0.85);
    const reloadH = 34;
    const reloadX = cx - reloadW / 2;
    const reloadY = mapY + mapSize + 30;
    const isReloadSel = menu.index === 4;

    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(reloadX, reloadY, reloadW, reloadH, 8);
    else ctx.rect(reloadX, reloadY, reloadW, reloadH);
    ctx.fillStyle = isReloadSel ? 'rgba(255, 184, 0, 0.28)' : 'rgba(240, 230, 216, 0.14)';
    ctx.fill();
    ctx.strokeStyle = isReloadSel ? '#ffd54a' : 'rgba(240, 230, 216, 0.40)';
    ctx.lineWidth = isReloadSel ? 2.0 : 1.4;
    ctx.stroke();

    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = isReloadSel ? '#ffd54a' : '#f0e6d8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔄 GENERATE NEW TRACK', cx, reloadY + reloadH / 2);
    ctx.restore();

    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    const rowTop = mapY + 18;
    for (let k = 0; k < rows.length; k++) {
      const y = rowTop + k * 36;
      const sel = k === menu.index;
      ctx.fillStyle = sel ? '#ffd54a' : 'rgba(201,184,165,0.8)';
      ctx.textAlign = 'left';
      if (sel) ctx.fillText('▶', optX - 22, y);
      ctx.fillText(rows[k][0], optX, y);
      if (rows[k][1]) {
        ctx.fillStyle = sel ? '#f0e6d8' : 'rgba(240,230,216,0.75)';
        ctx.fillText('<  ' + rows[k][1] + '  >', optX + 130, y);
      }
    }
    ctx.textAlign = 'center';

    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('UP / DOWN  row    LEFT / RIGHT  value    R / RELOAD  new track    ENTER  start    ESC  back',
      w / 2, Math.min(h - 24, reloadY + reloadH + 24));
  }

  _drawRacePreviewMap(ctx, x, y, size, route) {
    const cx = x + size / 2, cy = y + size / 2;
    const sc = (size / 2 - 10) / ISLAND_R;
    const toX = wx => cx + (wx - CENTER.x) * sc;
    const toY = wz => cy + (wz - CENTER.z) * sc;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#1a3d52';
    ctx.fillRect(x, y, size, size);
    ctx.beginPath();
    ctx.arc(cx, cy, ISLAND_R * sc, 0, Math.PI * 2);
    ctx.fillStyle = '#3d7a38';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, (ISLAND_R - 90) * sc, 0, Math.PI * 2);
    ctx.fillStyle = '#4a9a42';
    ctx.fill();

    const graph = this.graph;
    const byId = this.nodeMap;
    if (graph?.edges && byId) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(40,40,46,0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const e of graph.edges) {
        const a = byId.get(e.a), b = byId.get(e.b);
        if (!a || !b) continue;
        ctx.moveTo(toX(a.x), toY(a.z));
        ctx.lineTo(toX(b.x), toY(b.z));
      }
      ctx.stroke();
    }

    if (route?.points?.length > 1) {
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 3.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(toX(route.points[0].x), toY(route.points[0].z));
      for (let i = 1; i < route.points.length; i++) {
        ctx.lineTo(toX(route.points[i].x), toY(route.points[i].z));
      }
      if (route.loop) ctx.closePath();
      ctx.stroke();
      const p0 = route.points[0];
      ctx.fillStyle = '#6f8f38';
      ctx.beginPath();
      ctx.arc(toX(p0.x), toY(p0.z), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(240,230,216,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = route?.coast ? '#e8c96a' : 'rgba(240,230,216,0.55)';
    ctx.fillText(route ? (route.coast ? 'BEACH RING' : (route.loop ? 'CIRCUIT' : 'SPRINT')) : 'NO TRACK',
      cx, y + size + 16);
  }

  _drawSettings(menu) {
    const { ctx, w, h } = this;
    const g = menu.gfx || { resIdx: 0, distIdx: 2, pedIdx: 2, trafficIdx: 2, shadowIdx: 3, timeIdx: 0 };
    const rows = [
      ['RESOLUTION', GFX_RES_LABELS[g.resIdx] || '1.0X'],
      ['DRAW DISTANCE', GFX_DIST_LABELS[g.distIdx] || '500 M'],
      ['PEDESTRIANS', String(GFX_PEDS[g.pedIdx] ?? 10)],
      ['TRAFFIC CARS', String(GFX_TRAFFIC[g.trafficIdx] ?? 5)],
      ['SHADOWS', GFX_SHADOW_LABELS[g.shadowIdx] || 'HIGH'],
      ['TIME OF DAY', TIME_MODE_LABELS[g.timeIdx || 0] || 'DYNAMIC (3 MIN)'],
    ];

    ctx.font = '700 28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f0e6d8';
    ctx.shadowColor = 'rgba(20,10,14,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillText('SETTINGS', w / 2, h / 2 - 145);
    ctx.shadowBlur = 0;

    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    for (let k = 0; k < rows.length; k++) {
      const y = h / 2 - 95 + k * 35;
      const sel = k === menu.index;
      ctx.fillStyle = sel ? '#ffd54a' : 'rgba(201,184,165,0.8)';
      if (sel) ctx.fillText('▶', w / 2 - 220, y);
      ctx.textAlign = 'left';
      ctx.fillText(rows[k][0], w / 2 - 190, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = sel ? '#f0e6d8' : 'rgba(240,230,216,0.75)';
      ctx.fillText('<  ' + rows[k][1] + '  >', w / 2 + 220, y);
      ctx.textAlign = 'center';
    }

    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('UP / DOWN  row    LEFT / RIGHT  change    ESC  back',
      w / 2, h / 2 + 135);
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
    this._drawMedalProgress(ctx, w / 2, h / 2 + (e.laps > 0 && e.bestLap != null ? 70 : 52), e.medal);
    ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,230,216,0.55)';
    ctx.fillText('ENTER  OR  R   BACK TO THE CITY', w / 2, h / 2 + 148);
  }

  _drawMedalChip(ctx, cx, y, medals) {
    if (!medals) return;
    const rank = MEDAL_RANKS[medals.rank] || MEDAL_RANKS[0];
    const next = MEDAL_RANKS[medals.rank + 1];
    const fill = next ? fillOf(medals) : 1;
    ctx.save();
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    const textW = ctx.measureText(rank.name).width;
    const bw = 90, bh = 6;
    const totalW = 16 + textW + 10 + bw;
    const startX = cx - totalW / 2;

    ctx.beginPath();
    ctx.arc(startX + 6, y - 4, 6, 0, Math.PI * 2);
    ctx.fillStyle = rank.color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#241812';
    ctx.stroke();

    ctx.fillStyle = '#f0e6d8';
    ctx.textAlign = 'left';
    ctx.fillText(rank.name, startX + 16, y);

    const bx = startX + 16 + textW + 10, by = y - 8;
    ctx.fillStyle = 'rgba(36,24,18,0.55)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = next ? next.color : rank.color;
    ctx.fillRect(bx, by, bw * fill, bh);
    ctx.strokeStyle = 'rgba(240,230,216,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.restore();
    ctx.textAlign = 'center';
  }

  _drawMedalProgress(ctx, cx, y, medal) {
    if (!medal) return;
    const t = this.medalT;
    const k = t * t * (3 - 2 * t);
    const fill = medal.rankedUp
      ? medal.toFill * k
      : medal.fromFill + (medal.toFill - medal.fromFill) * k;
    ctx.save();
    ctx.textAlign = 'center';
    if (medal.rankedUp) {
      ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = medal.color;
      ctx.fillText('RANK UP', cx, y);
      y += 22;
    } else if (medal.points > 0) {
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#f0b429';
      ctx.fillText('+' + medal.points + '  PODIUM', cx, y);
      y += 20;
    } else {
      ctx.font = '500 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#c9b8a5';
      ctx.fillText('NO PODIUM', cx, y);
      y += 20;
    }
    ctx.beginPath();
    ctx.arc(cx - 70, y - 5, 9, 0, Math.PI * 2);
    ctx.fillStyle = medal.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#241812';
    ctx.stroke();
    ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = medal.color;
    ctx.textAlign = 'left';
    ctx.fillText(medal.name, cx - 56, y);
    ctx.textAlign = 'center';
    y += 18;
    const bw = 260, bh = 9, bx = cx - bw / 2;
    ctx.fillStyle = 'rgba(36,24,18,0.55)';
    roundRect(ctx, bx, y, bw, bh, 3);
    ctx.fill();
    ctx.fillStyle = medal.nextColor || medal.color;
    if (fill > 0) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, bx, y, Math.max(4, bw * fill), bh, 3);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(240,230,216,0.5)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, bx, y, bw, bh, 3);
    ctx.stroke();
    ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#c9b8a5';
    ctx.fillText(medal.nextName ? ('NEXT  ' + medal.nextName) : 'MAX RANK', cx, y + 22);
    ctx.restore();
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
