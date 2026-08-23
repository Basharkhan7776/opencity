import * as THREE from 'three';
import { CENTER, ISLAND_R, WATER_LEVEL } from './Island.js';

/**
 * Procedural Cel-Shaded Ocean Waves and Shoreline Beach Surf System.
 * Renders dynamic rolling swells in the open sea and animated surf foam
 * waves that roll in from the ocean, wash up the beaches to the shoreline,
 * and recede with natural tidal rhythm.
 */
export class OceanWaves {
  constructor() {
    this.time = 0;
    this.center = new THREE.Vector2(CENTER.x, CENTER.z);
    this.islandR = ISLAND_R;

    this.group = this._createOceanMesh();
    this.group.name = 'water-ocean-waves-group';
  }

  get mesh() {
    return this.group;
  }

  _createOceanMesh() {
    const group = new THREE.Group();

    // 1. High-resolution animated wave & shoreline surf mesh around island
    const size = (ISLAND_R + 180) * 2;
    const segs = 260;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.center.x, WATER_LEVEL - 0.05, this.center.y);

    // Uniforms for dynamic animation and cel shading
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: this.center },
      uIslandR: { value: this.islandR },
      uDeepWaterColor: { value: new THREE.Color(0x184c72) },     // Deep rich ocean blue
      uMidWaterColor: { value: new THREE.Color(0x277a9e) },      // Vibrant mid-ocean azure
      uShallowWaterColor: { value: new THREE.Color(0x36b6c4) },  // Tropical shoreline turquoise
      uCrestHighlight: { value: new THREE.Color(0x76e6f4) },     // Bright sunlit crest
      uFoamColor: { value: new THREE.Color(0xf4fdff) },          // Crisp white froth
      uWaveFoamColor: { value: new THREE.Color(0xd0f5fc) },      // Soft cyan froth
      uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uNightFactor: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform float uTime;
        uniform vec2 uCenter;
        uniform float uIslandR;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;
        varying float vShoreDist;
        varying float vShoreWave;
        varying float vBeachWash;
        varying vec2 vXZ;

        // 2D Simplex Noise for natural shoreline and wave variation
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy));
          vec2 x0 = v - i + dot(i, C.xx);
          vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
          m = m * m;
          m = m * m;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
          vec3 g;
          g.x  = a0.x  * x0.x  + h.x  * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {
          vec3 pos = position;
          vec2 xz = pos.xz;
          vXZ = xz;
          vec2 toCenter = xz - uCenter;
          float dist = length(toCenter);

          // Shoreline distance: negative is on the beach slope, positive is in open ocean
          float coastWarp = snoise(xz * 0.0045) * 45.0;
          float edge = uIslandR + coastWarp;
          float shoreDist = dist - edge;

          // 1. Open Ocean rolling multi-frequency swells
          float w1 = sin(dot(xz, vec2(0.035, 0.022)) - uTime * 1.7) * 0.26;
          float w2 = sin(dot(xz, vec2(-0.018, 0.034)) - uTime * 2.1) * 0.16;
          float w3 = sin(dot(xz, vec2(0.042, -0.012)) + uTime * 1.3) * 0.10;
          float oceanSwell = w1 + w2 + w3;

          // 2. Shoreline Surf Waves: Waves travelling inward towards the beach
          // The wave steepens and accelerates as it reaches shallow coastal waters
          float waveSpeed = 2.5;
          float shorePhase = shoreDist * 0.13 - uTime * waveSpeed + snoise(xz * 0.015) * 1.4;
          float shoreCrest = pow(max(0.0, sin(shorePhase) * 0.5 + 0.5), 1.9);

          // Beach wash zone: stretches from 130m out in the water to 38m up the sandy beach slope
          float beachZone = smoothstep(130.0, 10.0, shoreDist) * smoothstep(-48.0, -12.0, shoreDist);
          float beachWaveHeight = shoreCrest * 0.68 * beachZone;

          // Secondary trailing surf wash for layered foam waves
          float trailPhase = (shoreDist + 24.0) * 0.15 - uTime * waveSpeed;
          float trailCrest = pow(max(0.0, sin(trailPhase) * 0.5 + 0.5), 2.2);
          float trailWaveHeight = trailCrest * 0.34 * beachZone;

          // Combined wave displacement
          float oceanWeight = smoothstep(-15.0, 60.0, shoreDist);
          float totalWave = oceanSwell * oceanWeight + beachWaveHeight + trailWaveHeight;
          pos.y += totalWave;

          vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
          vWaveHeight = totalWave;
          vShoreDist = shoreDist;
          vShoreWave = (shoreCrest + trailCrest * 0.6) * beachZone;
          vBeachWash = beachZone;

          // Compute surface normal for cel shading glint
          float dHdx = cos(dot(xz, vec2(0.035, 0.022)) - uTime * 1.7) * 0.035 * 0.26 +
                       cos(shorePhase) * 0.13 * 0.45 * (toCenter.x / (dist + 1e-3)) * beachZone;
          float dHdz = cos(dot(xz, vec2(0.035, 0.022)) - uTime * 1.7) * 0.022 * 0.26 +
                       cos(shorePhase) * 0.13 * 0.45 * (toCenter.y / (dist + 1e-3)) * beachZone;
          vNormal = normalize(vec3(-dHdx, 1.0, -dHdz));

          gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uDeepWaterColor;
        uniform vec3 uMidWaterColor;
        uniform vec3 uShallowWaterColor;
        uniform vec3 uCrestHighlight;
        uniform vec3 uFoamColor;
        uniform vec3 uWaveFoamColor;
        uniform vec3 uSunDir;
        uniform float uNightFactor;
        uniform float uTime;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;
        varying float vShoreDist;
        varying float vShoreWave;
        varying float vBeachWash;
        varying vec2 vXZ;

        // Procedural foam cellular noise
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy));
          vec2 x0 = v - i + dot(i, C.xx);
          vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
          m = m * m;
          m = m * m;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
          vec3 g;
          g.x  = a0.x  * x0.x  + h.x  * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {
          // 1. Water depth gradient (Deep Ocean -> Mid Azure -> Tropical Shoreline Turquoise)
          float depthFactor = clamp((vShoreDist + 30.0) / 220.0, 0.0, 1.0);
          vec3 waterCol = mix(uShallowWaterColor, uMidWaterColor, smoothstep(0.0, 0.45, depthFactor));
          waterCol = mix(waterCol, uDeepWaterColor, smoothstep(0.45, 1.0, depthFactor));

          // 2. Wave crest highlights (cel-shaded band on swell peaks)
          float crestT = smoothstep(0.18, 0.38, vWaveHeight);
          waterCol = mix(waterCol, uCrestHighlight, crestT * 0.65);

          // 3. Cel lighting & sun glint
          vec3 lightDir = normalize(uSunDir);
          float ndotl = max(0.0, dot(vNormal, lightDir));
          float celBand = ndotl > 0.65 ? 1.0 : ndotl > 0.35 ? 0.78 : 0.62;
          waterCol *= celBand;

          // 4. Shoreline Surf Foam Waves (Waves touching beaches and reaching end of beaches)
          // High-frequency bubbly foam texture
          float fNoise1 = snoise(vXZ * 0.18 + vec2(uTime * 0.35, -uTime * 0.25));
          float fNoise2 = snoise(vXZ * 0.45 - vec2(uTime * 0.45, uTime * 0.35));
          float combinedNoise = (fNoise1 * 0.65 + fNoise2 * 0.35);

          // Leading edge of the wave washing up the sand
          float foamThreshold = 0.42 + combinedNoise * 0.18;
          float surfFoam = smoothstep(foamThreshold, foamThreshold + 0.12, vShoreWave);

          // Beach wash line (receding tidal fringe right at the end of the beach)
          float shoreWashLine = smoothstep(-32.0, -18.0, vShoreDist) * smoothstep(-4.0, -14.0, vShoreDist);
          float shoreFringe = shoreWashLine * smoothstep(0.25, 0.55, combinedNoise + 0.35);

          // Open ocean wave crest foam caps
          float oceanCap = smoothstep(0.30, 0.42, vWaveHeight) * smoothstep(0.2, 0.6, fNoise1 + 0.3) * smoothstep(30.0, 80.0, vShoreDist);

          // Combine foam layers
          float totalFoam = clamp(surfFoam + shoreFringe * 0.85 + oceanCap * 0.75, 0.0, 1.0);

          // Foam color with soft aqua edge and crisp white center
          vec3 finalFoam = mix(uWaveFoamColor, uFoamColor, smoothstep(0.3, 0.85, totalFoam));
          vec3 finalColor = mix(waterCol, finalFoam, totalFoam);

          // Night time dimming
          if (uNightFactor > 0.0) {
            finalColor *= mix(1.0, 0.45, uNightFactor);
          }

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'water-ocean-waves';
    group.add(mesh);

    // 2. Horizon ocean plane for infinite sea views
    const outerGeo = new THREE.PlaneGeometry(size * 4.5, size * 4.5);
    outerGeo.rotateX(-Math.PI / 2);
    outerGeo.translate(this.center.x, WATER_LEVEL - 0.12, this.center.y);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x184c72,
      depthTest: true,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.name = 'water-ocean-outer';
    group.add(outerMesh);

    return group;
  }

  update(dt, atmo = null) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (atmo) {
      this.uniforms.uNightFactor.value = atmo.nightFactor || 0;
      if (atmo.cSun) {
        this.uniforms.uSunDir.value.set(
          Math.cos(atmo.t * Math.PI * 2) * 165,
          Math.max(25, Math.sin(atmo.t * Math.PI * 2) * 145),
          Math.cos(atmo.t * Math.PI * 2) * 35 + 25
        ).normalize();
      }
    }
  }
}
