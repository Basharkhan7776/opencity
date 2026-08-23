/* 2D Celestial Sky System:
 * - Clean radiant 2D Sun with soft corona (zero spiky tentacles)
 * - Detailed 2D Moon with lunar craters and silver-blue halo
 * - 2D twinkling night starfield
 * - Full depth-testing enabled: buildings, terrain, and obstacles properly occlude the sun, moon, and stars
 * - Dynamically scaled to celestial background plane so it is 100% visible across all rendering distances
 */
import * as THREE from 'three';
import { CENTER } from './Island.js';

const STAR_COUNT = 1200;

/**
 * Procedurally generates clean, radiant 2D Sun image texture (smooth glowing disc, no tentacles).
 */
function createSunTexture() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const cx = 256, cy = 256;

  // Multi-layer smooth radial solar corona glow
  const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 240);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.18, 'rgba(255, 248, 200, 0.95)');
  grad.addColorStop(0.38, 'rgba(255, 215, 110, 0.70)');
  grad.addColorStop(0.62, 'rgba(255, 160, 45, 0.35)');
  grad.addColorStop(0.85, 'rgba(255, 110, 15, 0.12)');
  grad.addColorStop(1.0, 'rgba(255, 80, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Smooth brilliant inner disc
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 65, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedurally generates 2D stylized Moon image texture with craters and soft halo.
 */
function createMoonTexture() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const cx = 256, cy = 256;

  // Soft atmospheric lunar halo
  const grad = ctx.createRadialGradient(cx, cy, 35, cx, cy, 240);
  grad.addColorStop(0.0, 'rgba(242, 248, 255, 0.95)');
  grad.addColorStop(0.24, 'rgba(215, 235, 255, 0.65)');
  grad.addColorStop(0.55, 'rgba(125, 175, 255, 0.22)');
  grad.addColorStop(0.82, 'rgba(80, 140, 255, 0.06)');
  grad.addColorStop(1.0, 'rgba(60, 120, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Luminous moon body
  ctx.fillStyle = '#f2f8ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 65, 0, Math.PI * 2);
  ctx.fill();

  // Subtle lunar maria crater markings
  ctx.fillStyle = 'rgba(165, 192, 225, 0.45)';
  const craters = [
    { x: cx - 18, y: cy - 16, r: 16 },
    { x: cx + 22, y: cy - 22, r: 13 },
    { x: cx + 14, y: cy + 18, r: 19 },
    { x: cx - 24, y: cy + 24, r: 11 },
    { x: cx + 32, y: cy + 4,  r: 9 },
  ];
  for (const c of craters) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class CelestialSky {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'celestial-sky-2d';

    this._clock = 0;
    this.skyRadius = 300;

    // 1. Clean Radiant 2D Sun (depth-tested, blocked by buildings)
    this._buildSun();

    // 2. 2D Moon (depth-tested)
    this._buildMoon();

    // 3. 2D Twinkling Starfield
    this._buildStarfield();

    this.scene.add(this.root);
  }

  /* ---- 1. 2D Sun ------------------------------------------------------ */

  _buildSun() {
    const sunTex = createSunTexture();
    this.sunMat = new THREE.MeshBasicMaterial({
      map: sunTex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.sunQuad = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.sunMat);
    this.sunQuad.renderOrder = -7;
    this.root.add(this.sunQuad);
  }

  /* ---- 2. 2D Moon ----------------------------------------------------- */

  _buildMoon() {
    const moonTex = createMoonTexture();
    this.moonMat = new THREE.MeshBasicMaterial({
      map: moonTex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.moonQuad = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), this.moonMat);
    this.moonQuad.renderOrder = -7;
    this.root.add(this.moonQuad);
  }

  /* ---- 3. 2D Twinkling Starfield -------------------------------------- */

  _buildStarfield() {
    this.starPositions = new Float32Array(STAR_COUNT * 3);
    this.starDirections = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const phases = new Float32Array(STAR_COUNT);
    const sizes = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.94 + 0.06);

      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(theta);

      this.starDirections[i * 3] = dx;
      this.starDirections[i * 3 + 1] = dy;
      this.starDirections[i * 3 + 2] = dz;

      const r = this.skyRadius + 15;
      this.starPositions[i * 3] = dx * r;
      this.starPositions[i * 3 + 1] = dy * r;
      this.starPositions[i * 3 + 2] = dz * r;

      const pick = Math.random();
      if (pick < 0.55) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
      } else if (pick < 0.80) {
        colors[i * 3] = 0.78; colors[i * 3 + 1] = 0.88; colors[i * 3 + 2] = 1.0;
      } else if (pick < 0.92) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.92; colors[i * 3 + 2] = 0.75;
      } else {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.75; colors[i * 3 + 2] = 0.50;
      }

      phases[i] = Math.random() * Math.PI * 2;
      sizes[i] = Math.random() < 0.08 ? 3.6 : (Math.random() < 0.25 ? 2.4 : 1.4);
    }

    this.starGeom = new THREE.BufferGeometry();
    this.starGeom.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
    this.starGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.starGeom.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    this.starGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const starVert = /* glsl */`
      attribute vec3 color;
      attribute float phase;
      attribute float size;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float uTime;
      uniform float uStarOpacity;

      void main() {
        vColor = color;
        float twinkle = 0.65 + 0.35 * sin(uTime * 3.0 + phase);
        vTwinkle = twinkle * uStarOpacity;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (220.0 / -mvPosition.z) * (0.8 + 0.2 * twinkle);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const starFrag = /* glsl */`
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        if (vTwinkle <= 0.002) discard;
        vec2 coord = gl_PointCoord - vec2(0.5);
        float distSq = dot(coord, coord);
        if (distSq > 0.25) discard;
        float alpha = smoothstep(0.25, 0.0, distSq) * vTwinkle;
        gl_FragColor = vec4(vColor, alpha);
      }
    `;

    this.starUniforms = {
      uTime: { value: 0 },
      uStarOpacity: { value: 0 },
    };

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: this.starUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    });

    this.starPoints = new THREE.Points(this.starGeom, this.starMat);
    this.starPoints.renderOrder = -9;
    this.root.add(this.starPoints);
  }

  /* ---- Frame Update Loop ---------------------------------------------- */

  update(dt, timeOfDay, targetPos, atmo, camera) {
    this._clock += dt;
    this.starUniforms.uTime.value = this._clock;

    // Follow camera/player so celestial dome is ALWAYS centered
    const px = targetPos ? targetPos.x : (camera ? camera.position.x : CENTER.x);
    const py = targetPos ? targetPos.y : (camera ? camera.position.y : 0);
    const pz = targetPos ? targetPos.z : (camera ? camera.position.z : CENTER.z);

    this.root.position.set(px, py, pz);

    // Place celestial sphere at 92% of camera far plane so it is behind all scene buildings,
    // allowing buildings and mountains to cleanly occlude the sun and moon via hardware depth test
    const r = camera ? Math.max(180, camera.far * 0.92) : 500;
    this.skyRadius = r;

    const scale = r / 300;
    this.sunQuad.scale.set(scale, scale, 1);
    this.moonQuad.scale.set(scale, scale, 1);

    // 1. Update 2D Sun Position & Color
    const theta = atmo.t * Math.PI * 2;
    const sinElev = Math.sin(theta);
    const cosAzim = Math.cos(theta);

    const sunX = cosAzim * r;
    const sunY = sinElev * (r * 0.85);
    const sunZ = cosAzim * 35;

    this.sunQuad.position.set(sunX, sunY, sunZ);
    this.sunQuad.visible = sunY > -30;

    // 2. Update 2D Moon Position
    const moonX = -cosAzim * (r * 0.95);
    const moonY = -sinElev * (r * 0.82);
    const moonZ = -cosAzim * 30;

    this.moonQuad.position.set(moonX, moonY, moonZ);
    this.moonQuad.visible = moonY > -30;

    // Billboards face camera
    if (camera) {
      this.sunQuad.quaternion.copy(camera.quaternion);
      this.moonQuad.quaternion.copy(camera.quaternion);
    }

    // Sun color modulation (Golden -> Crimson Sunset -> Dawn)
    this.sunMat.color.copy(atmo.cSun);
    this.sunMat.opacity = Math.max(0, (1 - atmo.nightFactor) * 0.96);
    this.moonMat.opacity = Math.max(0, atmo.nightFactor * 0.92);

    // 3. Stars Twinkling & Dynamic Radial Placement
    this.starUniforms.uStarOpacity.value = Math.pow(atmo.nightFactor, 1.4);
    this.starPoints.visible = atmo.nightFactor > 0.01;

    if (this.starPositions && this.starGeom) {
      const starR = r + 10;
      for (let i = 0; i < STAR_COUNT; i++) {
        this.starPositions[i * 3] = this.starDirections[i * 3] * starR;
        this.starPositions[i * 3 + 1] = this.starDirections[i * 3 + 1] * starR;
        this.starPositions[i * 3 + 2] = this.starDirections[i * 3 + 2] * starR;
      }
      this.starGeom.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => {
      o.material?.dispose?.();
      o.geometry?.dispose?.();
    });
  }
}
