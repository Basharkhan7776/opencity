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

function archGeo(radius, tube, yaw) {
  const pts = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * i / steps;
    const lat = Math.cos(a) * radius;
    const up = Math.sin(a) * radius;
    pts.push(new THREE.Vector3(
      -Math.sin(yaw) * lat,
      up,
      Math.cos(yaw) * lat,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, steps, tube, 6, false);
}

function makeArrow() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: LIVE });
  const ink = new THREE.MeshBasicMaterial({ color: INK });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 4), mat);
  head.rotation.x = -Math.PI / 2;
  head.position.z = 0.55;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.7), mat);
  tail.position.z = -0.15;
  const outline = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.2, 4), ink);
  outline.rotation.x = -Math.PI / 2;
  outline.position.z = 0.55;
  outline.position.y = -0.02;
  g.add(outline, tail, head);
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
      const live = new THREE.Mesh(archGeo(cp.radius, 0.18, cp.yaw), liveMat);
      const soon = new THREE.Mesh(archGeo(cp.radius * 0.92, 0.12, cp.yaw), nextMat);
      live.visible = false;
      soon.visible = false;
      group.add(live, soon);
      this.root.add(group);
      this.gates.push({ group, live, soon, liveMat, nextMat });
    }

    this.arrow = makeArrow();
    this.root.add(this.arrow);
    this.current = 1;
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
      g.live.visible = i === cur;
      g.soon.visible = i === nxt;
    }

    const cp = cps[cur];
    const y = player.pos.y + 2.55;
    this.arrow.position.set(player.pos.x, y, player.pos.z);
    const dx = cp.x - player.pos.x;
    const dz = cp.z - player.pos.z;
    this.arrow.rotation.set(0, Math.atan2(dx, dz), 0);
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
