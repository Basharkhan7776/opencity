/* Race decorations: standing semicircle gates and a roof arrow.
 *
 * Only the live gate and the one after it are drawn. Passing the live one
 * promotes the next. The arch sits on the road; cars drive through it.
 * The roof arrow yaws toward the live gate — lookAt is not used, it aims
 * the mesh −Z and sent the cone the wrong way, off the map.
 */
import * as THREE from 'three';

const LIVE = 0xf0b429;
const NEXT = 0xe8d4a8;
const INK = 0x241812;

function archGeo(radius, tube) {
  const pts = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps;
    const lat = Math.cos(a) * radius;
    const up = Math.sin(a) * radius;
    pts.push(new THREE.Vector3(lat, up, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, steps, tube, 8, false);
}

/**
 * Build a flat arrow with thickness (depth).
 * Drawn in 2D and extruded with crisp bevels, then rotated flat into the XZ plane.
 * @param {number} thickness - Vertical thickness of the arrow
 * @param {number} [margin=0] - Inset or outset margin for border casing
 * @returns {THREE.BufferGeometry}
 */
function makeFlatArrowGeo(thickness = 0.18, margin = 0) {
  const shape = new THREE.Shape();
  // Length ~ 1.80m, Width ~ 1.15m with aggressive swept wings and tail notch
  const tipZ = 0.95 + margin * 1.1;
  const wingX = 0.60 + margin;
  const wingZ = 0.08 - margin * 0.4;
  const notchX = 0.28 + margin * 0.5;
  const notchZ = 0.20 + margin * 0.3;
  const tailZ = -0.72 - margin;
  const tailNotchZ = -0.46 - margin * 0.4;

  shape.moveTo(0, tipZ);
  shape.lineTo(wingX, wingZ);
  shape.lineTo(notchX, notchZ);
  shape.lineTo(notchX, tailZ);
  shape.lineTo(0, tailNotchZ);
  shape.lineTo(-notchX, tailZ);
  shape.lineTo(-notchX, notchZ);
  shape.lineTo(-wingX, wingZ);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  /* Lay flat horizontally in XZ plane with arrow tip pointing along +Z */
  geo.rotateX(Math.PI / 2);
  geo.center();
  return geo;
}

function makeArrow() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb800 });
  const darkBorderMat = new THREE.MeshBasicMaterial({ color: 0x181412 });
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  /* 1. Dark base casing underneath */
  const borderGeo = makeFlatArrowGeo(0.08, 0.04);
  const border = new THREE.Mesh(borderGeo, darkBorderMat);
  border.position.y = -0.06;

  /* 2. Main bright gold/amber flat arrow body with substantial thickness */
  const bodyGeo = makeFlatArrowGeo(0.18, 0);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.02;

  /* 3. Top accent chevron badges for instant readability */
  const accentShape = new THREE.Shape();
  accentShape.moveTo(0, 0.65);
  accentShape.lineTo(0.32, 0.16);
  accentShape.lineTo(0.16, 0.22);
  accentShape.lineTo(0, 0.40);
  accentShape.lineTo(-0.16, 0.22);
  accentShape.lineTo(-0.32, 0.16);
  accentShape.closePath();
  const accentGeo = new THREE.ExtrudeGeometry(accentShape, { depth: 0.04, bevelEnabled: false });
  accentGeo.rotateX(Math.PI / 2);
  accentGeo.center();
  const accent = new THREE.Mesh(accentGeo, highlightMat);
  accent.position.y = 0.12;

  g.add(border, body, accent);
  g.userData.mat = mat;
  return g;
}

export class RaceMarks {
  /**
   * @param {THREE.Scene} scene
   * @param {object} route
   * @param {(x:number,z:number)=>number} heightAt
   */
  constructor(scene, route, heightAt) {
    this.scene = scene;
    this.route = route;
    this.heightAt = heightAt;
    this.root = new THREE.Group();
    this.root.name = 'race-marks';
    scene.add(this.root);

    this.gates = [];
    const cps = route.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const y = heightAt(cp.x, cp.z) + 0.06;
      const group = new THREE.Group();
      group.position.set(cp.x, y, cp.z);

      const liveMat = new THREE.MeshBasicMaterial({
        color: LIVE, transparent: true, opacity: 0.95, depthWrite: false,
      });
      const nextMat = new THREE.MeshBasicMaterial({
        color: NEXT, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const live = new THREE.Mesh(archGeo(cp.radius, 0.20), liveMat);
      const soon = new THREE.Mesh(archGeo(cp.radius * 0.92, 0.14), nextMat);
      live.visible = false;
      soon.visible = false;
      group.add(live, soon);
      this.root.add(group);
      this.gates.push({ group, live, soon, liveMat, nextMat });
    }

    this.arrow = makeArrow();
    this.root.add(this.arrow);
    this.current = 1;
    this._clock = 0;
  }

  /** Show the live arch and the next one; aim the roof arrow at the live gate. */
  update(player, currentIndex) {
    const cps = this.route.checkpoints;
    if (!cps.length) return;
    const n = cps.length;
    const cur = ((currentIndex % n) + n) % n;
    const hasNext = this.route.loop || cur < n - 1;
    const nxt = hasNext ? (cur + 1) % n : -1;
    this.current = cur;

    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      const isLive = i === cur;
      const isSoon = i === nxt;
      g.live.visible = isLive;
      g.soon.visible = isSoon;

      /* Realtime orientation: center of semicircle rotates and points directly to the player's vehicle */
      if (isLive || isSoon) {
        const cp = cps[i];
        const dx = player.pos.x - cp.x;
        const dz = player.pos.z - cp.z;
        g.group.rotation.y = Math.atan2(dx, dz);
      }
    }

    const cp = cps[cur];
    this._clock += 0.016;
    const hover = Math.sin(this._clock * 4.0) * 0.06;
    /* Hover cleanly directly above the vehicle cabin roof */
    const y = player.pos.y + 2.50 + hover;
    this.arrow.position.set(player.pos.x, y, player.pos.z);
    const dx = cp.x - player.pos.x;
    const dz = cp.z - player.pos.z;
    const targetYaw = Math.atan2(dx, dz);
    /* Tilting slightly up gives the chase camera behind a full view of the top golden surface */
    this.arrow.rotation.set(0.18, targetYaw, 0, 'YXZ');
    this.arrow.visible = true;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => {
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
    this.gates.length = 0;
    this.arrow = null;
  }
}
