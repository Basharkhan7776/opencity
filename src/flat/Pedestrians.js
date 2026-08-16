/* Trackside pedestrians.
 *
 * Ten characters keep a standing cast on the footpaths of the city roads,
 * always somewhere inside the render sphere the car sits in (VIEW_RADIUS in
 * main.js), so a street is never empty and the cast is never a draw burden —
 * ten rigs, ten draw calls, streamed.
 *
 * Three properties are load-bearing and worth reading before changing this.
 *
 * **No physics — by construction, not by accident.** The car's physics only
 * knows the ObstacleGrid built from trees and buildings (see FlatWorld), and
 * pedestrians are never added to it. Characters are pure scene objects, so a
 * vehicle strikes straight through them — which is exactly the brief: a
 * pedestrian is scenery, and making it solid would stuff the whole city's
 * driving with invisible bodies. The only "collision" is visual: they stand
 * on the footpath slab (DECK above the island ground), off the driving
 * surface.
 *
 * **The gait comes from the model's own walk clip, minus its root.** The
 * pack's "walk" animation drives torso, head, arm and leg rotations AND a
 * translation on the root bone. The root motion is stripped from the clip
 * (the character's feet would otherwise carry it along an animator-authored
 * forward vector that has nothing to do with the road we walk), and the
 * pedestrian's forward progress is driven here, along the footpath line of
 * whichever road edge the character was born on.
 *
 * **The pool re-arms itself.** Each pedestrian owns one road edge and walks
 * it end to end, turning at the mitred junction ends. The moment they leave
 * the render sphere — the player turned a corner, or teleported — they are
 * hidden and re-spawned onto a fresh edge somewhere inside the annulus
 * around the player, at most two per frame so a respawn never pops as a
 * burst. So the ten are always near the camera without ever being authored
 * once around the (endless) island grid.
 *
 * The characters are the authored GLBs in assets/characters/ — twelve shared-
 * rig humans, so one scale constant fits all of them. They get the same cel
 * material treatment the fleet does: the pack's own colormap, quantised by
 * the shared ramp, keyed to the same shadows.
 */
import * as THREE from 'three';
import { heightAt } from './Island.js';
import { FOOT_W, DECK } from './CityRoads.js';
import { celMaterial } from '../render/cel.js';
/* SkeletonUtils.clone is what a per-instance character NEEDS and Object3D
   clone is not: SkinnedMesh.copy shares .skeleton, so two clone(true) rigs
   of the same model animate the same bones — one mixer would fight another
   and every walker wearing male-a would swing in lockstep. SkeletonUtils
   detaches the bones per clone. */
import { clone as cloneScene } from 'three/addons/utils/SkeletonUtils.js';

const CHARACTERS = [
  '/assets/characters/character-male-a.glb',
  '/assets/characters/character-male-b.glb',
  '/assets/characters/character-male-c.glb',
  '/assets/characters/character-male-d.glb',
  '/assets/characters/character-male-e.glb',
  '/assets/characters/character-male-f.glb',
  '/assets/characters/character-female-a.glb',
  '/assets/characters/character-female-b.glb',
  '/assets/characters/character-female-c.glb',
  '/assets/characters/character-female-d.glb',
  '/assets/characters/character-female-e.glb',
  '/assets/characters/character-female-f.glb',
];

/* The standing cast, and the sphere they live in. */
export const PED_COUNT = 10;
export const PED_RADIUS = 500;      // metres — must track main.js VIEW_RADIUS
const PED_SPAWN_MIN = 40;           // metres — keep the immediate frame clear
const PED_SPAWN_MAX = 460;          // metres — inside the fog's useful band

/* How fast they walk, m/s, and the stride sync. */
const PED_SPEED = 0.85;
const IDLE_RATIO = 0.40;            // mixture fraction of straight idle/standing characters

/* The pack's humanoid rig. Scaled down to compact stylized proportions
   (PED_HEIGHT = 0.85m) so characters look natural beside cars and blocks. */
const RIG_HEIGHT = 0.40;
const PED_HEIGHT = 0.85;

/* Stride length covered per 2-step walk cycle (m) for exact foot-to-ground speed sync. */
const STRIDE_LEN = 0.58 * (PED_HEIGHT / 0.85);

/* Where on the 2 m footpath strip the walker treads, as a fraction of
   FOOT_W out from the kerb — kept inside the strip, off its outer lip. */
const PED_FOOT_FRAC = [0.30, 0.62];

/* Grid cell for the edge lookup. The graph is a few thousand edges; asking
   "which footpath is near the player" per respawn via a hash keeps it O(1)
   instead of a linear scan on every frame. */
const EDGE_CELL = 96;
const EDGE_HASH = (x, z) => `${Math.floor(x / EDGE_CELL)},${Math.floor(z / EDGE_CELL)}`;

const _v2 = new THREE.Vector3();

export class Pedestrians {
  /**
   * @param {THREE.Scene} scene
   * @param {object} graph  the city road graph ({nodes, edges}) — see FlatWorld
   * @param {(x:number,z:number)=>number} roadLift  true-slab height oracle —
   *   DECK on any slab/junction/podium, 0 on bare ground (see buildRoadLift)
   */
  constructor(scene, graph, roadLift) {
    this.scene = scene;
    this.graph = graph || null;
    this.roadLift = roadLift || null;
    this.ready = false;

    this.root = new THREE.Group();
    this.root.name = 'pedestrians';
    scene.add(this.root);

    /* One styled copy per model file, shared by every clone. */
    this.models = [];
    this.walks = [];          // walk clip per model, root track stripped
    this.idles = [];          // idle clip per model (straight upright standing)
    this.peds = [];
    this.enabled = true;

    this._indexGraph();
  }

  /**
   * Hide the cast and stop respawns. Used for the whole of a street race so
   * walkers do not pop onto the course.
   */
  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) return;
    for (const ped of this.peds) {
      ped.active = false;
      if (ped.anchor) ped.anchor.visible = false;
    }
  }

  _indexGraph() {
    this._edges = [];
    this._edgeCells = new Map();
    const g = this.graph;
    if (!g) return;
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    for (const e of g.edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 2) continue;
      const edge = {
        ax: a.x, az: a.z, bx: b.x, bz: b.z,
        len,
        width: e.width || 0,
        tx: (b.x - a.x) / len, tz: (b.z - a.z) / len,
      };
      this._edges.push(edge);
      /* An edge lives in every cell its body passes through, plus one ring
         of neighbours — a spawn inside the band requests cells around the
         player, so give the lookup some slack. */
      const cells = new Set();
      const from = Math.floor(-1 / EDGE_CELL), to = Math.floor((len + 1) / EDGE_CELL);
      for (let u = from; u <= to; u++) {
        cells.add(EDGE_HASH(a.x + edge.tx * u * EDGE_CELL, a.z + edge.tz * u * EDGE_CELL));
      }
      for (const c of cells) {
        const arr = this._edgeCells.get(c);
        if (arr) arr.push(edge); else this._edgeCells.set(c, [edge]);
      }
    }
  }

  /**
   * Character(s) closest to a point, from the cell hash. Returns the closest
   * edge whose FOOTPATH line passes within `reach` of the point.
   */
  _closestEdge(x, z, reach = 140) {
    const seen = new Set();
    const cx = Math.floor(x / EDGE_CELL), cz = Math.floor(z / EDGE_CELL);
    let best = null, bestD = Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this._edgeCells.get(EDGE_HASH(x + i * EDGE_CELL, z + j * EDGE_CELL));
        if (!arr) continue;
        for (const e of arr) {
          const u = ((x - e.ax) * e.tx + (z - e.az) * e.tz) / e.len;
          if (u < -0.1 || u > 1.1) continue;
          const px = e.ax + e.tx * u, pz = e.az + e.tz * u;
          const d = Math.hypot(x - px, z - pz);
          if (d >= bestD) continue;
          /* The footpath is offset from the centreline by more than the
             point was; keep the margin generous so a roadside point still
             resolves to the road whose footpath it belongs to. */
          const footD = d + e.width * 0.5;
          if (footD > reach) continue;
          if (!seen.has(e)) { seen.add(e); bestD = d; best = e; }
        }
      }
    }
    return best;
  }

  async load() {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(CHARACTERS.map(async (url) => {
      const gltf = await loader.loadAsync(url);
      /* The gait clip, with its root translation cut — the legs, arms,
         torso and head keep swinging; the walk itself is ours. */
      const walk = THREE.AnimationClip.findByName(gltf.animations, 'walk');
      const walkClip = walk ? walk.clone() : null;
      if (walkClip) {
        walkClip.tracks = walkClip.tracks.filter(t => !t.name.endsWith('.position'));
      }
      this.walks.push(walkClip);

      /* Idle / straight standing clip */
      const idle = THREE.AnimationClip.findByName(gltf.animations, 'idle')
        || THREE.AnimationClip.findByName(gltf.animations, 'static');
      const idleClip = idle ? idle.clone() : null;
      if (idleClip) {
        idleClip.tracks = idleClip.tracks.filter(t => !t.name.endsWith('.position'));
      }
      this.idles.push(idleClip);

      const scene = gltf.scene;
      /* Same treatment the fleet gets: the pack's colormap through the cel
         ramp, keyed to the same shadows. */
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const map = o.material ? o.material.map : null;
        o.material = celMaterial({ map });
      });
      scene.scale.multiplyScalar(PED_HEIGHT / RIG_HEIGHT);
      this.models.push(scene);
    }));

    if (!this.models.length) { this.disposed = true; return; }
    /* The pool. Ten rigs, each with its own mixer (a mixer can only drive
       one skeleton), all hidden until their first spawn. */
    for (let i = 0; i < PED_COUNT; i++) {
      const model = cloneScene(this.models[i % this.models.length]);
      const anchor = new THREE.Group();
      anchor.add(model);
      anchor.visible = false;
      this.root.add(anchor);

      const walkClip = this.walks[i % this.walks.length];
      const idleClip = this.idles[i % this.idles.length];
      const mixer = new THREE.AnimationMixer(model);

      const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
      const idleAction = idleClip ? mixer.clipAction(idleClip) : null;

      this.peds.push({
        anchor,
        mixer,
        walkAction,
        idleAction,
        walkClip,
        idleClip,
        active: false,
        isIdle: false,
        edge: null,
        t: 0,
        side: 1,
        foot: 0,
        dir: 1,
        speed: 1,
      });
    }
    this.ready = true;
  }

  /**
   * Place an inactive pedestrian onto a footpath near the player.
   *
   * The spawn is an annulus around the car: not so close it pops into the
   * lens, not so far the fog owns it. The annulus picks the nearest road
   * edge to a random point in it, and the walker is born at the middle of
   * the footpath strip on a random side of that road.
   */
  _spawn(ped, px, pz) {
    if (!this._edges.length) return false;
    for (let tries = 0; tries < 10; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const d = PED_SPAWN_MIN + Math.random() * (PED_SPAWN_MAX - PED_SPAWN_MIN);
      const edge = this._closestEdge(px + Math.cos(ang) * d, pz + Math.sin(ang) * d);
      if (!edge) continue;
      ped.edge = edge;
      ped.t = 0.08 + Math.random() * 0.84;
      ped.side = Math.random() < 0.5 ? -1 : 1;
      ped.foot = PED_FOOT_FRAC[0] + Math.random() * (PED_FOOT_FRAC[1] - PED_FOOT_FRAC[0]);
      ped.dir = Math.random() < 0.5 ? -1 : 1;

      // Mélange of straight upright standing / idle and walking characters
      ped.isIdle = Math.random() < IDLE_RATIO;
      if (ped.isIdle) {
        ped.speed = 0;
        if (ped.walkAction) ped.walkAction.stop();
        if (ped.idleAction) {
          ped.idleAction.reset();
          ped.idleAction.time = Math.random() * (ped.idleClip ? ped.idleClip.duration : 1);
          ped.idleAction.play();
        }
        if (ped.mixer) ped.mixer.timeScale = 0.85 + Math.random() * 0.3;
        // Stand straight facing along the footpath or slightly toward the street
        const baseAngle = Math.atan2(edge.tx, edge.tz) + (Math.random() < 0.5 ? 0 : Math.PI);
        ped.anchor.rotation.y = baseAngle + (Math.random() - 0.5) * 0.4;
      } else {
        ped.speed = PED_SPEED * (0.9 + Math.random() * 0.25);
        if (ped.idleAction) ped.idleAction.stop();
        if (ped.walkAction) {
          ped.walkAction.reset();
          ped.walkAction.time = Math.random() * (ped.walkClip ? ped.walkClip.duration : 0.66);
          ped.walkAction.play();
        }
        // Exactly sync animation playback rate to translation speed and stride length
        const clipDur = ped.walkClip ? ped.walkClip.duration : 0.6667;
        const targetTimeScale = (ped.speed * clipDur) / STRIDE_LEN;
        if (ped.mixer) ped.mixer.timeScale = targetTimeScale;

        const vx = edge.tx * ped.dir, vz = edge.tz * ped.dir;
        ped.anchor.rotation.y = Math.atan2(vx, vz);
      }

      ped.active = true;
      return true;
    }
    return false;
  }

  /**
   * Park a pedestrian back on its footpath, exactly as the slab draws it.
   *
   * The footpath is a strip of the road slab at half-width + kerb (0.45 m)
   * on out, FOOT_W deep — sampled along the edge the pedestrian owns. This
   * is the only line they ever walk, so a character cannot stray onto the
   * tarmac or off the slab; the mitred junction ends are why the walk
   * reverses at t ∈ [0.06, 0.94] rather than reaching the node.
   */
  _footPathPoint(ped, out = _v2) {
    const e = ped.edge;
    const x = e.ax + (e.bx - e.ax) * ped.t;
    const z = e.az + (e.bz - e.az) * ped.t;
    const lat = ped.side * (e.width * 0.5 + 0.45 + ped.foot * FOOT_W);
    out.set(x - e.tz * lat, heightAt(x, z) + DECK, z + e.tx * lat);
    return out;
  }

  _stepPed(ped, dt) {
    if (ped.isIdle) return;
    const e = ped.edge;
    ped.t += (ped.dir * ped.speed * dt) / e.len;
    if (ped.t < 0.06) { ped.t = 0.06; ped.dir = 1; }
    else if (ped.t > 0.94) { ped.t = 0.94; ped.dir = -1; }
    /* Face the walk, not the road: the pack faces +Z in bind pose, so the
       yaw that points the model at the travel vector is atan2(vx, vz). */
    const vx = e.tx * ped.dir, vz = e.tz * ped.dir;
    ped.anchor.rotation.y = Math.atan2(vx, vz);
  }

  /**
   * Advance the cast. Called once per simulation step from Game.step.
   */
  update(dt, px, pz) {
    if (!this.ready || this.disposed || this.enabled === false) return;
    let respawns = 0;
    for (const ped of this.peds) {
      if (ped.mixer) ped.mixer.update(dt);

      if (ped.active) {
        this._stepPed(ped, dt);
        this._footPathPoint(ped, ped.anchor.position);
        const dx = ped.anchor.position.x - px, dz = ped.anchor.position.z - pz;
        if (dx * dx + dz * dz > PED_RADIUS * PED_RADIUS) ped.active = false;
      } else if (respawns < 2 && this._spawn(ped, px, pz)) {
        respawns++;
      }
      ped.anchor.visible = ped.active;
    }
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.root);
    this.root.traverse(o => {
      o.material?.dispose?.();
      o.geometry?.dispose?.();
    });
  }
}