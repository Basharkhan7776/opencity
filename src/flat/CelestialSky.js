/* 2D Celestial Sky System:
 * - Clean radiant 2D Sun with soft corona (visible across 24h orbit, descending to horizon at sunset)
 * - Detailed 2D Moon with lunar craters and silver-blue halo (shining at night)
 * - 2D twinkling night starfield
 * - Plump circular & oval 2D cartoon cloud puffs spread across 360° sky (drifting North to South with depth effect)
 * - Face-on celestial dome orientation (always appears circular/oval, never thin lines)
 * - Full hardware depth-testing: buildings, mountains, and terrain properly occlude sky elements
 */
import * as THREE from 'three';
import { CENTER } from './Island.js';

const STAR_COUNT = 1200;
const CLOUD_PATCH_COUNT = 16;

/**
 * Procedurally generates plump circular and oval cartoon cloud textures (512x512)
 * with soft rounded lobes, gentle internal shading, and feathered edges.
 */
function createCircularOvalCloudTexture(type = 0) {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  let lobes = [];

  if (type === 0) {
    // Plump, round cumulus cloud (circular cluster)
    lobes = [
      { x: 256, y: 260, rx: 110, ry: 95, opacity: 0.70 },
      { x: 195, y: 285, rx: 78,  ry: 68, opacity: 0.60 },
      { x: 318, y: 280, rx: 82,  ry: 70, opacity: 0.62 },
      { x: 215, y: 215, rx: 80,  ry: 72, opacity: 0.65 },
      { x: 298, y: 210, rx: 86,  ry: 76, opacity: 0.68 },
      { x: 256, y: 175, rx: 75,  ry: 65, opacity: 0.60 },
    ];
  } else if (type === 1) {
    // Plump horizontal oval cloud
    lobes = [
      { x: 256, y: 265, rx: 135, ry: 90, opacity: 0.70 },
      { x: 170, y: 280, rx: 75,  ry: 62, opacity: 0.58 },
      { x: 342, y: 275, rx: 78,  ry: 65, opacity: 0.60 },
      { x: 210, y: 215, rx: 82,  ry: 70, opacity: 0.65 },
      { x: 305, y: 210, rx: 88,  ry: 74, opacity: 0.66 },
      { x: 256, y: 185, rx: 72,  ry: 60, opacity: 0.58 },
    ];
  } else if (type === 2) {
    // Rounded double-puff circular cloud
    lobes = [
      { x: 220, y: 260, rx: 95, ry: 85, opacity: 0.68 },
      { x: 295, y: 250, rx: 90, ry: 80, opacity: 0.66 },
      { x: 175, y: 290, rx: 65, ry: 58, opacity: 0.55 },
      { x: 340, y: 280, rx: 68, ry: 60, opacity: 0.56 },
      { x: 245, y: 195, rx: 80, ry: 70, opacity: 0.65 },
    ];
  } else {
    // Compact rounded oval cloudlet
    lobes = [
      { x: 256, y: 260, rx: 115, ry: 85, opacity: 0.68 },
      { x: 190, y: 275, rx: 70,  ry: 60, opacity: 0.58 },
      { x: 322, y: 270, rx: 72,  ry: 62, opacity: 0.60 },
      { x: 256, y: 205, rx: 85,  ry: 72, opacity: 0.65 },
    ];
  }

  // Draw soft feathered radial lobes
  for (const p of lobes) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1.0, p.ry / p.rx);

    const grad = ctx.createRadialGradient(0, 0, p.rx * 0.15, 0, 0, p.rx);
    grad.addColorStop(0.0, `rgba(255, 255, 255, ${p.opacity})`);
    grad.addColorStop(0.45, `rgba(248, 252, 255, ${p.opacity * 0.72})`);
    grad.addColorStop(0.78, `rgba(235, 245, 255, ${p.opacity * 0.22})`);
    grad.addColorStop(1.0, 'rgba(220, 235, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, p.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedurally generates clean, radiant 2D Sun image texture (smooth glowing disc, zero tentacles).
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

    // 1. Clean Radiant 2D Sun (depth-tested, occluded by buildings)
    this._buildSun();

    // 2. 2D Moon (depth-tested)
    this._buildMoon();

    // 3. 2D Twinkling Starfield
    this._buildStarfield();

    // 4. Plump Circular & Oval Cloud Puffs (spread across 360° sky)
    this._buildCircularCloudPatches();

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
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.sunQuad = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.sunMat);
    this.sunQuad.renderOrder = -8;
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
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.moonQuad = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), this.moonMat);
    this.moonQuad.renderOrder = -8;
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

  /* ---- 4. Plump Circular & Oval Cloud Puffs ---------------------------- */

  _buildCircularCloudPatches() {
    this.cloudPatches = [];

    const textures = [
      createCircularOvalCloudTexture(0),
      createCircularOvalCloudTexture(1),
      createCircularOvalCloudTexture(2),
      createCircularOvalCloudTexture(3),
    ];

    this.patchMats = textures.map(tex => new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      side: THREE.DoubleSide,
      opacity: 0.88,
    }));

    const patchGeom = new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < CLOUD_PATCH_COUNT; i++) {
      const texIdx = i % textures.length;
      const mat = this.patchMats[texIdx];
      const mesh = new THREE.Mesh(patchGeom, mat);
      mesh.renderOrder = -6;

      // Distribute evenly in a 360° circle around the entire sky (North, South, East, West)
      const angle = (i / CLOUD_PATCH_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const distRatio = 0.48 + (i % 4) * 0.14 + Math.random() * 0.08;

      const relX = Math.cos(angle) * distRatio;
      const relZ = Math.sin(angle) * distRatio;
      const relY = 0.18 + (i % 5) * 0.07 + Math.random() * 0.05; // 12° to 32° natural elevation

      // Plump circular and oval proportions (aspect ratio 1.15 to 1.30, never thin lines)
      const baseWidth = 180 + Math.random() * 110;
      const baseHeight = baseWidth * (0.80 + Math.random() * 0.12);

      // North to South drift speed (12 to 20 m/s)
      const speed = 12.0 + (i % 4) * 3.0 + Math.random() * 2.5;

      this.cloudPatches.push({
        mesh,
        relX,
        relY,
        relZ,
        baseWidth,
        baseHeight,
        speed,
      });

      this.root.add(mesh);
    }
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

    // Place celestial sphere at 92% of camera far plane so it is behind scene buildings,
    // allowing buildings and mountains to cleanly occlude the sun, moon, and cloud patches via depth test
    const r = camera ? Math.max(180, camera.far * 0.92) : 500;
    this.skyRadius = r;

    const scale = r / 300;
    this.sunQuad.scale.set(scale, scale, 1);
    this.moonQuad.scale.set(scale, scale, 1);

    // 1. Update 2D Sun Position & Color (Tilted visible solar arc)
    const theta = atmo.t * Math.PI * 2;
    const sinElev = Math.sin(theta);
    const cosAzim = Math.cos(theta);

    const sunX = cosAzim * (r * 0.78);
    const sunY = sinElev * (r * 0.62);
    const sunZ = -cosAzim * (r * 0.52) - (r * 0.35);

    this.sunQuad.position.set(sunX, sunY, sunZ);
    this.sunQuad.visible = sunY > -30;

    // 2. Update 2D Moon Position (Tilted visible lunar arc)
    const moonX = -cosAzim * (r * 0.78);
    const moonY = -sinElev * (r * 0.62);
    const moonZ = cosAzim * (r * 0.52) + (r * 0.35);

    this.moonQuad.position.set(moonX, moonY, moonZ);
    this.moonQuad.visible = moonY > -30;

    // Face inward from sky dome towards viewer
    this.sunQuad.lookAt(0, 0, 0);
    this.moonQuad.lookAt(0, 0, 0);

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

    // 4. Update Plump Circular & Oval Cloud Puffs (North to South drift & Lighting)
    const t = atmo.t;
    let cloudColor = new THREE.Color(0xffffff);

    if (atmo.nightFactor > 0.5) {
      // Moonlit midnight indigo fog
      cloudColor.setHex(0x384a68).lerp(new THREE.Color(0x202e42), 0.35);
    } else if (t >= 0.44 && t <= 0.60) {
      // Sunset warm peach, fiery coral, and violet haze
      const sunsetAlpha = (t - 0.44) / 0.16;
      cloudColor.setHex(0xffc292).lerp(new THREE.Color(0xd67066), sunsetAlpha);
    } else if (t >= 0.00 && t <= 0.14) {
      // Dawn peach mist
      const dawnAlpha = t / 0.14;
      cloudColor.setHex(0xd6947e).lerp(new THREE.Color(0xffeed4), dawnAlpha);
    } else {
      // Daytime bright atmospheric ivory-white
      cloudColor.setHex(0xfffef6);
    }

    for (const mat of this.patchMats) {
      mat.color.copy(cloudColor);
      mat.opacity = atmo.isNight ? 0.65 : 0.88;
    }

    const bound = 1.15;

    for (const p of this.cloudPatches) {
      // Continuous North-to-South drift along Z axis across the whole sky
      p.relZ += (p.speed * dt) / r;

      // Toroidal continuous wrap: when passing southern horizon (+1.15), wrap to northern horizon (-1.15)
      if (p.relZ > bound) {
        p.relZ -= (bound * 2.0);
      }

      const posX = p.relX * r;
      const posY = p.relY * r;
      const posZ = p.relZ * r;

      p.mesh.position.set(posX, posY, posZ);

      // Scale dynamically with sky radius (plump circular/oval proportions)
      const patchW = (p.baseWidth * scale);
      const patchH = (p.baseHeight * scale);
      p.mesh.scale.set(patchW, patchH, 1);

      // Face viewer directly from sky dome so it ALWAYS appears as a full circular/oval cloud
      p.mesh.lookAt(0, 0, 0);
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
