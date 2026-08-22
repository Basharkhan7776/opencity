/* Ambient traffic cars running on city roads.
 *
 * Rules:
 *  1. Vehicles stay strictly on road tarmac and return cleanly if displaced.
 *  2. Vehicles stop before zebra crossings at junctions/intersections and wait randomly between 0 to 10 seconds before continuing.
 *  3. Vehicles stop suddenly and wait up to 10 seconds if an obstacle (player, other vehicle, pedestrian) is in front.
 *  4. Hidden and paused during races.
 */
import * as THREE from 'three';
import { Car } from '../car/physics.js';
import { heightAt } from './Island.js';
import { DECK } from './CityRoads.js';
import { clamp, approach } from '../core/util.js';

export const TRAFFIC_COUNT = 5;
export const TRAFFIC_RADIUS = 500;
const TRAFFIC_SPAWN_MIN = 45;
const TRAFFIC_SPAWN_MAX = 450;
const EDGE_CELL = 96;
const EDGE_HASH = (x, z) => `${Math.floor(x / EDGE_CELL)},${Math.floor(z / EDGE_CELL)}`;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Traffic {
  /**
   * @param {THREE.Scene} scene
   * @param {object} track - FlatTrack
   * @param {object} graph - City road graph ({nodes, edges})
   * @param {object[]} vehicles - VEHICLES garage array
   * @param {(idx:number)=>Promise<object>} loadView - View loader for car models
   */
  constructor(scene, track, graph, vehicles, loadView) {
    this.scene = scene;
    this.track = track;
    this.graph = graph || null;
    this.vehicles = vehicles || [];
    this.loadView = loadView;
    this.ready = false;
    this.disposed = false;

    this.root = new THREE.Group();
    this.root.name = 'traffic';
    scene.add(this.root);

    this.cars = [];
    this.enabled = true;
    this.limit = TRAFFIC_COUNT;
    this.radius = TRAFFIC_RADIUS;
    this.spawnMax = TRAFFIC_SPAWN_MAX;

    this._indexGraph();
  }

  async _addCar(i) {
    if (!this.vehicles.length) return null;
    const vIdx = (i * 2 + 1) % this.vehicles.length;
    const spec = this.vehicles[vIdx];
    try {
      const view = await this.loadView(vIdx);
      this.root.add(view.root);
      view.root.visible = false;

      const car = new Car(this.track, {
        palette: (i % 6) + 1,
        ai: true,
        perf: spec.perf,
      });

      const item = {
        car,
        view,
        spec,
        vIdx,
        active: false,
        edge: null,
        dir: 1,
        laneOffset: 1.6,
        targetSpeed: 13 + (i % 4) * 2.2,
        steerSmooth: 0,
        throttleSmooth: 0,
        stuckTimer: 0,
        isWaitingJunction: false,
        junctionTimer: 0,
        lastJunctionId: null,
        hasWaitedAtNode: false,
        nextBranch: null,
        isWaitingObstacle: false,
        obstacleTimer: 0,
        _lastPos: new THREE.Vector2(),
      };
      this.cars.push(item);
      return item;
    } catch (err) {
      console.warn('Traffic vehicle load error', err);
      return null;
    }
  }

  async setCount(n) {
    this.limit = Math.max(0, n | 0);
    if (!this.ready) return;
    while (this.cars.length < this.limit) {
      await this._addCar(this.cars.length);
    }
    for (let i = 0; i < this.cars.length; i++) {
      if (i >= this.limit) {
        this.cars[i].active = false;
        if (this.cars[i].view?.root) this.cars[i].view.root.visible = false;
      }
    }
  }

  setRadius(r) {
    this.radius = Math.max(80, r);
    this.spawnMax = Math.max(this.radius - 40, TRAFFIC_SPAWN_MIN + 20);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) return;
    for (const c of this.cars) {
      c.active = false;
      if (c.view?.root) c.view.root.visible = false;
    }
  }

  _indexGraph() {
    this._edges = [];
    this._edgeCells = new Map();
    this._nodeOut = new Map();

    const g = this.graph;
    if (!g || !g.nodes || !g.edges) return;

    const byId = new Map(g.nodes.map(n => [n.id, n]));
    for (let idx = 0; idx < g.edges.length; idx++) {
      const e = g.edges[idx];
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 2) continue;

      const edge = {
        id: idx,
        aId: a.id,
        bId: b.id,
        ax: a.x, az: a.z,
        bx: b.x, bz: b.z,
        len,
        width: e.width || 7,
        tx: (b.x - a.x) / len,
        tz: (b.z - a.z) / len,
      };
      this._edges.push(edge);

      /* Outgoing branches from node A and node B */
      if (!this._nodeOut.has(a.id)) this._nodeOut.set(a.id, []);
      this._nodeOut.get(a.id).push({ edge, toNodeId: b.id, dir: 1 });

      if (!this._nodeOut.has(b.id)) this._nodeOut.set(b.id, []);
      this._nodeOut.get(b.id).push({ edge, toNodeId: a.id, dir: -1 });

      /* Spatial hash for nearest edge lookups */
      const cells = new Set();
      const from = Math.floor(-1 / EDGE_CELL), to = Math.floor((len + 1) / EDGE_CELL);
      for (let u = from; u <= to; u++) {
        cells.add(EDGE_HASH(a.x + edge.tx * u * EDGE_CELL, a.z + edge.tz * u * EDGE_CELL));
      }
      for (const c of cells) {
        const arr = this._edgeCells.get(c);
        if (arr) arr.push(edge);
        else this._edgeCells.set(c, [edge]);
      }
    }
  }

  _closestEdge(x, z, reach = 160) {
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
          if (d < bestD && d <= reach) {
            bestD = d;
            best = e;
          }
        }
      }
    }
    return best;
  }

  async load() {
    if (!this._edges.length || !this.vehicles.length) {
      this.ready = true;
      return;
    }

    const initialCount = Math.max(12, Math.min(50, this.limit));
    const loadPromises = [];
    for (let i = 0; i < initialCount; i++) {
      loadPromises.push(this._addCar(i));
    }
    await Promise.all(loadPromises);
    this.ready = true;
    this.setCount(this.limit);
  }

  _spawn(item, px, pz, player) {
    if (!this._edges.length) return false;

    let pFwdX = 0, pFwdZ = 1;
    if (player?.forward) {
      pFwdX = player.forward.x;
      pFwdZ = player.forward.z;
    } else if (player?.yaw != null) {
      pFwdX = Math.cos(player.yaw);
      pFwdZ = Math.sin(player.yaw);
    }

    for (let tries = 0; tries < 25; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const d = TRAFFIC_SPAWN_MIN + Math.random() * (this.spawnMax - TRAFFIC_SPAWN_MIN);
      const sx = px + Math.cos(ang) * d;
      const sz = pz + Math.sin(ang) * d;

      // Reject candidates in front of the player (< 180m and dot > 0.20)
      const toSx = sx - px, toSz = sz - pz;
      const dist = Math.hypot(toSx, toSz);
      if (dist < 1e-3) continue;
      const dotFwd = (toSx / dist) * pFwdX + (toSz / dist) * pFwdZ;
      if (dotFwd > 0.20 && dist < 180) {
        continue;
      }

      const edge = this._closestEdge(sx, sz);
      if (!edge) continue;

      item.edge = edge;
      item.dir = Math.random() < 0.5 ? 1 : -1;
      // Lane position: right side of travel direction
      const laneWidth = edge.width * 0.22;
      item.laneOffset = laneWidth * (0.85 + Math.random() * 0.3);

      // Place along edge
      const u = 0.15 + Math.random() * 0.7;
      const ex = edge.ax + (edge.bx - edge.ax) * u;
      const ez = edge.az + (edge.bz - edge.az) * u;

      const fwdX = edge.tx * item.dir;
      const fwdZ = edge.tz * item.dir;
      const normX = -fwdZ;
      const normZ = fwdX;

      const posX = ex + normX * item.laneOffset;
      const posZ = ez + normZ * item.laneOffset;

      // Verify the placed position is also not directly in front of the player
      const finalDx = posX - px, finalDz = posZ - pz;
      const finalDist = Math.hypot(finalDx, finalDz);
      if (finalDist > 0) {
        const finalDot = (finalDx / finalDist) * pFwdX + (finalDz / finalDist) * pFwdZ;
        if (finalDot > 0.20 && finalDist < 180) {
          continue;
        }
      }

      const yaw = Math.atan2(fwdZ, fwdX);

      item.car.placeAtWorld(posX, posZ, yaw);
      item.car.vx = 7 + Math.random() * 3;
      item.car.vy = 0;
      item.car.r = 0;
      item.car.vertVel = 0;
      item.car.height = 0;
      item.car.strandedFor = 0;

      item.steerSmooth = 0;
      item.throttleSmooth = 0.4;
      item.stuckTimer = 0;
      item.isWaitingJunction = false;
      item.junctionTimer = 0;
      item.lastJunctionId = null;
      item.hasWaitedAtNode = false;
      item.nextBranch = null;
      item.isWaitingObstacle = false;
      item.obstacleTimer = 0;
      item._lastPos.set(posX, posZ);

      item.active = true;
      item.car.applyTo(item.view, 0);
      item.view.root.visible = true;
      return true;
    }
    return false;
  }

  /**
   * Detect obstacles (player, other vehicles, pedestrians) directly in front of this vehicle.
   */
  _checkObstacleAhead(item, allCars, player, peds) {
    const car = item.car;
    const cx = car.pos.x, cz = car.pos.z;
    const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
    const rx = -fz, rz = fx;
    const DETECT_DIST = 11.0;
    const DETECT_WIDTH = 2.0;

    // 1. Player vehicle check
    if (player && player.pos) {
      const dx = player.pos.x - cx, dz = player.pos.z - cz;
      const fwd = dx * fx + dz * fz;
      const lat = Math.abs(dx * rx + dz * rz);
      if (fwd > 0.8 && fwd < DETECT_DIST && lat < DETECT_WIDTH) {
        return true;
      }
    }

    // 2. Other traffic vehicles check
    if (allCars) {
      for (const other of allCars) {
        if (other === item || !other.active) continue;
        const dx = other.car.pos.x - cx, dz = other.car.pos.z - cz;
        const fwd = dx * fx + dz * fz;
        const lat = Math.abs(dx * rx + dz * rz);
        if (fwd > 1.2 && fwd < DETECT_DIST && lat < DETECT_WIDTH) {
          return true;
        }
      }
    }

    // 3. Pedestrians check (including characters crossing on zebra crossings)
    if (peds && peds.peds) {
      for (const ped of peds.peds) {
        if (!ped.active || !ped.anchor) continue;
        const dx = ped.anchor.position.x - cx, dz = ped.anchor.position.z - cz;
        const fwd = dx * fx + dz * fz;
        const lat = Math.abs(dx * rx + dz * rz);
        if (fwd > 0.6 && fwd < 8.5 && lat < 2.2) {
          return true;
        }
      }
    }

    return false;
  }

  _stepCar(item, dt, player, peds) {
    const car = item.car;
    let edge = item.edge;
    if (!edge) {
      item.active = false;
      return;
    }

    // Determine current point on edge
    const tx = edge.tx * item.dir;
    const tz = edge.tz * item.dir;
    const normX = -tz;
    const normZ = tx;

    // Start and end points of this edge in direction of travel
    const startX = item.dir === 1 ? edge.ax : edge.bx;
    const startZ = item.dir === 1 ? edge.az : edge.bz;
    const endX = item.dir === 1 ? edge.bx : edge.ax;
    const endZ = item.dir === 1 ? edge.bz : edge.az;
    const endNodeId = item.dir === 1 ? edge.bId : edge.aId;

    // Progress along edge (metres from start)
    const along = (car.pos.x - startX) * tx + (car.pos.z - startZ) * tz;
    const distToEnd = edge.len - along;

    // Look up connected branches at destination node
    const branches = this._nodeOut.get(endNodeId) || [];

    // -------------------------------------------------------------
    // 1. Off-Road Check & Automatic Road Return Enforcement
    // -------------------------------------------------------------
    const clX = startX + tx * along;
    const clZ = startZ + tz * along;
    const latOff = (car.pos.x - clX) * normX + (car.pos.z - clZ) * normZ;
    const maxAllowedLat = edge.width * 0.48;

    if (Math.abs(latOff) > maxAllowedLat || along < -3.0 || along > edge.len + 3.0) {
      // Vehicle strayed off tarmac: instantly bring it back into its road lane
      const safeAlong = clamp(along, 2.0, Math.max(2.0, edge.len - 2.0));
      const targetReturnX = startX + tx * safeAlong + normX * item.laneOffset;
      const targetReturnZ = startZ + tz * safeAlong + normZ * item.laneOffset;

      car.placeAt(targetReturnX, targetReturnZ);
      car.yaw = Math.atan2(tz, tx);
      car.vx = Math.max(car.vx, 6.0);
      car.vy = 0;
      car.r = 0;
      car.vertVel = 0;
      car.height = 0;
      item.stuckTimer = 0;
    }

    // -------------------------------------------------------------
    // 2. Zebra Crossing Stop & Wait Logic (Stop Before Zebra Stripes)
    // -------------------------------------------------------------
    // Junction radius opens the road slab; zebra crossing sits right at the mouth of the junction
    const junctionRadius = Math.min(edge.width * 0.7, edge.len * 0.45);
    // Stop line is positioned just before the painted zebra crossing stripes (approx 3.5m - 4.5m before junction mouth)
    const zebraStopDist = junctionRadius + 3.8;

    if (branches.length >= 2 && distToEnd <= zebraStopDist + 2.8 && distToEnd >= zebraStopDist - 2.2) {
      if (item.lastJunctionId !== endNodeId && !item.hasWaitedAtNode) {
        item.hasWaitedAtNode = true;
        item.lastJunctionId = endNodeId;
        const waitSec = Math.random() * 10.0; // Random wait from 0 to 10 seconds!
        if (waitSec > 0.4) {
          item.isWaitingJunction = true;
          item.junctionTimer = waitSec;
        }
      }
    }

    if (item.isWaitingJunction) {
      item.junctionTimer -= dt;
      if (item.junctionTimer <= 0) {
        item.isWaitingJunction = false;
        // Launch forward smoothly across the zebra crossing and into the intersection
        item.throttleSmooth = 0.8;
        car.vx = Math.max(car.vx, 4.5);
      }
    }

    // Clear lastJunctionId once vehicle has advanced into the new road
    if (along > 12.0 && item.lastJunctionId !== null && item.lastJunctionId !== endNodeId) {
      item.lastJunctionId = null;
    }

    // -------------------------------------------------------------
    // 3. Forward Obstacle Detection & Wait Logic (0 to 10 Seconds)
    // -------------------------------------------------------------
    const obstacleAhead = this._checkObstacleAhead(item, this.cars, player, peds);
    if (obstacleAhead) {
      if (!item.isWaitingObstacle) {
        item.isWaitingObstacle = true;
        item.obstacleTimer = 1.0 + Math.random() * 9.0; // Wait up to 10 seconds
      }
    }

    if (item.isWaitingObstacle) {
      item.obstacleTimer -= dt;
      if (item.obstacleTimer <= 0) {
        if (!obstacleAhead) {
          item.isWaitingObstacle = false;
          item.throttleSmooth = 0.8;
          car.vx = Math.max(car.vx, 4.0);
        } else {
          item.obstacleTimer = 0.5; // Continue holding until obstacle moves away
        }
      }
    }

    // -------------------------------------------------------------
    // 4. Stable Next Branch & Waypoint Lookahead
    // -------------------------------------------------------------
    // Select and lock the next outgoing branch consistently when approaching the node
    if (!item.nextBranch || item.nextBranch.fromNodeId !== endNodeId) {
      const validBranches = branches.filter(b => b.edge.id !== edge.id);
      const picked = validBranches.length > 0
        ? validBranches[Math.floor(Math.random() * validBranches.length)]
        : (branches[0] || null);

      if (picked) {
        item.nextBranch = {
          edge: picked.edge,
          dir: picked.dir,
          fromNodeId: endNodeId,
        };
      } else {
        item.nextBranch = null;
      }
    }

    // Perform transition when vehicle crosses onto the next edge
    if (distToEnd <= 1.0 || along >= edge.len - 0.4) {
      if (item.nextBranch && item.nextBranch.edge) {
        item.edge = item.nextBranch.edge;
        item.dir = item.nextBranch.dir;
        edge = item.nextBranch.edge;
        item.nextBranch = null;
        item.hasWaitedAtNode = false;
        car.vx = Math.max(car.vx, 4.0);
      } else if (branches.length <= 1 && along >= edge.len - 0.4) {
        // Dead end: reverse direction
        item.dir *= -1;
        item.hasWaitedAtNode = false;
        car.vx = Math.max(car.vx, 3.5);
      }
    }

    // Calculate waypoint ahead
    const lookDist = Math.max(12, car.speed * 0.9);
    let targetX, targetZ;

    if (distToEnd > lookDist) {
      // Waypoint is on current edge
      const wpAlong = along + lookDist;
      targetX = startX + tx * wpAlong + normX * item.laneOffset;
      targetZ = startZ + tz * wpAlong + normZ * item.laneOffset;
    } else if (item.nextBranch && item.nextBranch.edge) {
      // Waypoint smoothly continues into the next road branch
      const nb = item.nextBranch;
      const ntx = nb.edge.tx * nb.dir;
      const ntz = nb.edge.tz * nb.dir;
      const nnx = -ntz;
      const nnz = ntx;
      const nStartX = nb.dir === 1 ? nb.edge.ax : nb.edge.bx;
      const nStartZ = nb.dir === 1 ? nb.edge.az : nb.edge.bz;
      const rem = Math.max(2.0, lookDist - distToEnd);
      targetX = nStartX + ntx * rem + nnx * item.laneOffset;
      targetZ = nStartZ + ntz * rem + nnz * item.laneOffset;
    } else {
      targetX = endX + normX * item.laneOffset;
      targetZ = endZ + normZ * item.laneOffset;
    }

    // Steering controller
    const wantAngle = Math.atan2(targetZ - car.pos.z, targetX - car.pos.x);
    const headingErr = wrapAngle(wantAngle - car.yaw);
    const steer = clamp(headingErr / 0.45, -1, 1);
    item.steerSmooth = approach(item.steerSmooth, steer, 8.0, dt);

    // Speed controller & Stop Execution
    const isTurning = Math.abs(headingErr) > 0.38;
    const targetSpeed = isTurning ? Math.min(item.targetSpeed, 7.8) : item.targetSpeed;
    let throttle = 0, brake = 0, handbrake = 0;

    const mustStop = item.isWaitingJunction || item.isWaitingObstacle;

    if (mustStop) {
      // Sudden stop and firm hold right before zebra crossing or obstacle
      throttle = 0;
      brake = 1.0;
      handbrake = 1.0;
      car.vx = approach(car.vx, 0, 24.0, dt);
      car.vy = 0;
      item.throttleSmooth = 0;
    } else {
      if (car.speed < targetSpeed - 1.0) {
        throttle = clamp((targetSpeed - car.speed) / 5.5 + 0.4, 0.25, 1.0);
      } else if (car.speed > targetSpeed + 1.2) {
        brake = clamp((car.speed - targetSpeed) / 5.5, 0.25, 0.85);
      } else {
        throttle = 0.35;
      }
      item.throttleSmooth = approach(item.throttleSmooth, throttle, 6.0, dt);
    }

    // Stuck detector (only when not intentionally waiting)
    if (!mustStop) {
      const moved = Math.hypot(car.pos.x - item._lastPos.x, car.pos.z - item._lastPos.y);
      if (moved < 0.15 && car.speed < 0.8) {
        item.stuckTimer += dt;
        if (item.stuckTimer > 4.0 || car.strandedFor > 4.5) {
          item.active = false;
          if (item.view?.root) item.view.root.visible = false;
          return;
        }
      } else {
        item.stuckTimer = 0;
      }
    } else {
      item.stuckTimer = 0;
    }
    item._lastPos.set(car.pos.x, car.pos.z);

    // Integrate physics substeps
    const sub = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / sub;
    const input = {
      steer: mustStop ? 0 : item.steerSmooth,
      throttle: item.throttleSmooth,
      brake,
      handbrake,
    };
    for (let s = 0; s < sub; s++) car.step(h, input);

    // Apply physics transform to visual 3D view
    car.applyTo(item.view, dt);
  }

  update(dt, playerOrPx, pedsOrPz) {
    if (!this.ready || this.disposed || !this.enabled || this.limit <= 0) return;

    let px, pz, player, peds;
    if (typeof playerOrPx === 'object' && playerOrPx !== null) {
      player = playerOrPx;
      px = player.pos ? player.pos.x : 0;
      pz = player.pos ? player.pos.z : 0;
      peds = pedsOrPz;
    } else {
      px = Number(playerOrPx) || 0;
      pz = Number(pedsOrPz) || 0;
      player = { pos: { x: px, z: pz } };
      peds = null;
    }

    let respawns = 0;
    const maxRespawns = Math.max(2, Math.min(8, Math.ceil(this.limit / 6)));
    const radSq = this.radius * this.radius;

    for (let i = 0; i < this.cars.length; i++) {
      const item = this.cars[i];

      if (i >= this.limit) {
        if (item.active) {
          item.active = false;
          if (item.view?.root) item.view.root.visible = false;
        }
        continue;
      }

      if (item.active) {
        this._stepCar(item, dt, player, peds);
        const dx = item.car.pos.x - px;
        const dz = item.car.pos.z - pz;
        if (dx * dx + dz * dz > radSq) {
          item.active = false;
          if (item.view?.root) item.view.root.visible = false;
        }
      } else if (respawns < maxRespawns && this._spawn(item, px, pz, player)) {
        respawns++;
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.root);
    for (const item of this.cars) {
      if (item.view?.root) {
        this.root.remove(item.view.root);
        item.view.root.traverse(o => {
          o.geometry?.dispose?.();
          o.material?.dispose?.();
        });
      }
    }
    this.cars.length = 0;
  }
}
