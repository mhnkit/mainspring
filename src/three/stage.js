import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials } from './materials.js';
import { setMaxAnisotropy, shadowTexture } from './textures.js';

export const FOV = 32;
const _p = new THREE.Vector3();

// Background: a soft glow anchored at a far point, so it drifts slower than the models (parallax).
const BG_VERT = `varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BG_FRAG = `uniform vec3 uGlow; uniform vec3 uPaper; uniform vec3 uLight; uniform vec3 uShade;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 tg = normalize(uGlow - cameraPosition);
  vec3 col = mix(uPaper, uLight, smoothstep(0.55, 1.0, dot(dir, tg)));
  col = mix(col, uShade, (1.0 - smoothstep(-0.6, -0.02, dir.y)) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

// Dust: kind 0 = tiny specks that catch the light, kind 1 = large blurred motes far behind.
const DUST_VERT = `attribute vec3 aOffset; attribute vec4 aSeed; uniform float uTime;
varying vec2 vUv; varying float vAlpha; varying float vKind;
void main() {
  vUv = uv;
  float t = uTime * aSeed.y;
  vec3 p = aOffset + vec3(sin(t + aSeed.x) * 0.7, sin(t * 0.7 + aSeed.x * 1.7) * 0.45, cos(t * 0.8 + aSeed.x) * 0.6);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * aSeed.z;
  gl_Position = projectionMatrix * mv;
  vAlpha = 0.55 + 0.45 * sin(uTime * (0.4 + aSeed.y) + aSeed.x * 3.0);
  vKind = aSeed.w;
}`;
const DUST_FRAG = `varying vec2 vUv; varying float vAlpha; varying float vKind;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  vec3 col; float a;
  if (vKind < 0.5) {
    col = mix(vec3(0.6, 0.58, 0.54), vec3(1.0), 1.0 - smoothstep(0.2, 0.8, d));
    a = (1.0 - smoothstep(0.25, 1.0, d)) * 0.6 * vAlpha;
  } else {
    col = vec3(0.8, 0.78, 0.73);
    a = (1.0 - smoothstep(0.0, 1.0, d)) * 0.14 * vAlpha;
  }
  gl_FragColor = vec4(col, a);
}`;

// Brass shimmer when a part snaps home: a small burst that spreads, slows and fades.
const SPARK_VERT = `attribute vec3 aStart; attribute vec3 aVel; attribute vec2 aLife; uniform float uTime;
varying vec2 vUv; varying float vA;
void main() {
  vUv = uv;
  float age = uTime - aLife.x;
  float k = age / 0.8;
  if (age < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  vec3 p = aStart + aVel * age * (1.0 - 0.45 * k);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * aLife.y * (1.0 - 0.5 * k);
  gl_Position = projectionMatrix * mv;
  vA = (1.0 - k) * (1.0 - k);
}`;
const SPARK_FRAG = `varying vec2 vUv; varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  vec3 col = mix(vec3(0.69, 0.553, 0.341), vec3(0.95, 0.86, 0.66), 1.0 - smoothstep(0.0, 0.7, d));
  gl_FragColor = vec4(col, (1.0 - smoothstep(0.2, 1.0, d)) * vA);
}`;

function instancedQuads(count, attrs) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  for (const [name, size] of attrs) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * size), size));
  g.instanceCount = count;
  return g;
}

export class Stage {
  constructor(canvas) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: this.dpr < 1.5, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this.dpr);
    renderer.setClearColor(0xf4f3ef, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    this.renderer = renderer;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 320);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();

    // Soft studio lighting: warm key, cool fill, bright rim from behind.
    const key = new THREE.DirectionalLight(0xfff3e4, 1.7);
    key.position.set(-6, 9, 8);
    const fill = new THREE.DirectionalLight(0xe6edf5, 0.5);
    fill.position.set(8, 2, 6);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(3, 6, -10);
    this.scene.add(key, fill, rim, new THREE.HemisphereLight(0xffffff, 0xd8d3c7, 0.35));

    this.M = createMaterials();
    this.proxyMaterial = new THREE.MeshBasicMaterial();
    this.shadowGeo = new THREE.PlaneGeometry(1, 1);
    this.uTime = { value: 0 };
    this.measure = false;
    this._acc = 0;
    this._frames = 0;
    this.width = 1;
    this.height = 1;
    this._background();
    this._dust();
    this._sparks();
    this.resize();
  }

  _background() {
    const v3 = (r, g, b) => new THREE.Vector3(r, g, b);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uGlow: { value: v3(-2, 4, -45) },
        uPaper: { value: v3(0.957, 0.953, 0.937) },
        uLight: { value: v3(0.988, 0.985, 0.975) },
        uShade: { value: v3(0.918, 0.91, 0.886) },
      },
      vertexShader: BG_VERT, fragmentShader: BG_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.bg = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), mat);
    this.bg.renderOrder = -100;
    this.bg.frustumCulled = false;
    this.scene.add(this.bg);
  }

  _dust() {
    const near = 64;
    const far = 12;
    const n = near + far;
    const g = instancedQuads(n, [['aOffset', 3], ['aSeed', 4]]);
    const off = g.attributes.aOffset.array;
    const seed = g.attributes.aSeed.array;
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const isFar = i >= near;
      off.set([(r() * 2 - 1) * (isFar ? 34 : 24), -6 + r() * (isFar ? 18 : 15), isFar ? -42 + r() * 22 : -22 + r() * 31], i * 3);
      seed.set([r() * 6.283, 0.05 + r() * 0.12, isFar ? 0.9 + r() * 1.6 : 0.022 + r() * 0.03, isFar ? 1 : 0], i * 4);
    }
    const m = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime }, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false });
    this.dust = new THREE.Mesh(g, m);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.scene.add(this.dust);
  }

  _sparks() {
    this.sparkMax = 120;
    this.sparkIdx = 0;
    const g = instancedQuads(this.sparkMax, [['aStart', 3], ['aVel', 3], ['aLife', 2]]);
    const life = g.attributes.aLife.array;
    for (let i = 0; i < this.sparkMax; i++) life[i * 2] = -100;
    const m = new THREE.ShaderMaterial({ uniforms: { uTime: this.uTime }, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, depthTest: false });
    this.sparks = new THREE.Mesh(g, m);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 6;
    this.scene.add(this.sparks);
  }

  shimmer(pos, count = 12, spread = 0.45) {
    const a = this.sparks.geometry.attributes;
    for (let i = 0; i < count; i++) {
      const j = this.sparkIdx;
      this.sparkIdx = (j + 1) % this.sparkMax;
      const ang = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.3) * 0.9;
      const sp = spread * (0.45 + Math.random() * 0.75);
      a.aStart.array.set([pos.x, pos.y, pos.z], j * 3);
      a.aVel.array.set([Math.cos(ang) * Math.cos(el) * sp, Math.sin(el) * sp + 0.12, Math.sin(ang) * Math.cos(el) * sp], j * 3);
      a.aLife.array.set([this.uTime.value + Math.random() * 0.06, 0.018 + Math.random() * 0.022], j * 2);
    }
    a.aStart.needsUpdate = true;
    a.aVel.needsUpdate = true;
    a.aLife.needsUpdate = true;
  }

  makeShadow() {
    const mat = new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x2b2620, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
    const m = new THREE.Mesh(this.shadowGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = -1;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  // rig: { target, az, el, dist, ox, oy } — the target appears at screen center + (ox, oy) px.
  applyRig(r) {
    const c = Math.cos(r.el);
    this.camera.position.set(
      r.target.x + r.dist * Math.sin(r.az) * c,
      r.target.y + r.dist * Math.sin(r.el),
      r.target.z + r.dist * Math.cos(r.az) * c,
    );
    this.camera.lookAt(r.target);
    this.camera.setViewOffset(this.width, this.height, -r.ox, -r.oy, this.width, this.height);
    this.camera.updateMatrixWorld();
    this.bg.position.copy(this.camera.position);
  }

  toScreen(v, out) {
    _p.copy(v).project(this.camera);
    out.x = (_p.x + 1) * 0.5 * this.width;
    out.y = (1 - _p.y) * 0.5 * this.height;
    out.ok = _p.z < 1;
    return out;
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    this.uTime.value += dt;
    this.renderer.render(this.scene, this.camera);
    if (!this.measure) return;
    // Adaptive quality: if frames run slow for a while, lower the pixel ratio a step.
    this._acc += dt;
    this._frames++;
    if (this._acc > 2.5) {
      const avg = this._acc / this._frames;
      if (avg > 0.024 && this.dpr > 1) {
        this.dpr = Math.max(1, this.dpr - 0.25);
        this.renderer.setPixelRatio(this.dpr);
        this.resize();
      }
      this._acc = 0;
      this._frames = 0;
    }
  }

  compile() {
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* first render compiles anyway */ }
  }
}

/*
 * Smallest camera distance so every point fits inside a screen region (px), for a camera orbiting `target`
 * at azimuth `az` / elevation `el`. The target is drawn at the region's center via a view offset.
 */
export function fitDistance(points, target, az, el, fovDeg, H, region) {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const fpx = H / 2 / tanV;
  const f = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const rl = Math.hypot(f[2], f[0]) || 1;
  const r = [f[2] / rl, 0, -f[0] / rl];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const halfW = Math.max(40, (region.right - region.left) / 2);
  const halfH = Math.max(40, (region.bottom - region.top) / 2);
  let d = 0;
  for (const p of points) {
    const x = p.x - target.x;
    const y = p.y - target.y;
    const z = p.z - target.z;
    const cx = x * r[0] + y * r[1] + z * r[2];
    const cy = x * u[0] + y * u[1] + z * u[2];
    const cz = x * f[0] + y * f[1] + z * f[2];
    d = Math.max(d, cz + (Math.abs(cx) * fpx) / halfW, cz + (Math.abs(cy) * fpx) / halfH);
  }
  return d;
}
