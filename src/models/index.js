import * as THREE from 'three';
import { buildMechanical } from './mechanical.js';
import { buildQuartz } from './quartz.js';
import { buildDigital } from './digital.js';
import { buildClock } from './clock.js';
import { partMeta } from '../config.js';

const BUILDERS = { mechanical: buildMechanical, quartz: buildQuartz, digital: buildDigital, clock: buildClock };
export const DISPLAY_SIZE = 2.4;
const DIRS = 16;
const LIBS = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/';

let renderer = null;
let gltfLoader = null;
export function setRenderer(r) { renderer = r; }

// Loaders are only fetched if a model actually has a `glb` path.
async function getLoader() {
  if (gltfLoader) return gltfLoader;
  const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/loaders/KTX2Loader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath(`${LIBS}draco/gltf/`));
  if (renderer) loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(`${LIBS}basis/`).detectSupport(renderer));
  loader.setMeshoptDecoder(MeshoptDecoder);
  gltfLoader = loader;
  return loader;
}

const norm = (s) => String(s || '').toLowerCase().replace(/^part[_\-\s]?/, '').replace(/[_\-\s.]/g, '');

// Mesh nodes (or any ancestor) named after a part key become that part. Anything unmatched joins "case".
async function loadGlb(category, model, onProgress) {
  const loader = await getLoader();
  const gltf = await loader.loadAsync(model.glb, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const lookup = new Map(category.parts.map((k) => [norm(k), k]));
  const keyOf = (obj) => {
    for (let o = obj; o && o !== scene; o = o.parent) {
      const k = lookup.get(norm(o.name));
      if (k) return k;
    }
    return 'case';
  };
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const root = new THREE.Group();
  const parts = new Map();
  for (const src of meshes) {
    const key = keyOf(src);
    let g = parts.get(key);
    if (!g) {
      g = new THREE.Group();
      g.name = key;
      g.userData.partKey = key;
      root.add(g);
      parts.set(key, g);
    }
    const m = new THREE.Mesh(src.geometry, src.material);
    src.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    g.add(m);
  }
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return { root, parts, update: () => {}, unit: Math.max(1e-3, Math.min(size.x, size.y) / 2) };
}

function meshCount(group) {
  let n = 0;
  group.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

// Every part gets its own material instances so it can fade and dim independently.
function cloneMaterials(group) {
  const map = new Map();
  group.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    let c = map.get(o.material);
    if (!c) {
      c = o.material.clone();
      c.transparent = true;
      c.userData.base = o.material.opacity;
      c.userData.depthWriteBase = o.material.depthWrite;
      map.set(o.material, c);
    }
    o.material = c;
    if (c.blending === THREE.AdditiveBlending) o.renderOrder = 3;
    else if (c.name === 'glassEdge') o.renderOrder = 2;
  });
  return [...map.values()];
}

// Extreme points of a part in 16 directions of its own plane. Labels attach to whichever is leftmost on screen.
function supportPoints(group) {
  const best = Array.from({ length: DIRS }, (_, k) => {
    const a = (k / DIRS) * Math.PI * 2;
    return { c: Math.cos(a), s: Math.sin(a), d: -Infinity, p: new THREE.Vector3() };
  });
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  group.traverse((o) => {
    const pos = o.isMesh ? o.geometry.attributes.position : null;
    if (!pos) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 1500));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      for (const b of best) {
        const d = v.x * b.c + v.y * b.s;
        if (d > b.d) { b.d = d; b.p.copy(v); }
      }
    }
  });
  return best.filter((b) => b.d > -Infinity).map((b) => b.p);
}

// Moving sub-objects (like the minute hand) can mark a live label anchor with userData.anchorTip.
function findAnchor(group) {
  let found = null;
  group.traverse((o) => {
    if (!found && o.userData && o.userData.anchorTip) found = { obj: o, local: new THREE.Vector3(0, o.userData.anchorTip, 0) };
  });
  return found;
}

/*
 * Parts are stacked along the model's +Z axis, back to front, so each one clears the one behind it by `gap`.
 * The last part (strap or case) drops back slightly so its own step is visible too.
 * Each part separates during its own window of scroll progress; windows overlap a little.
 */
export function prepare(built, category, model) {
  const root = built.root;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const unit = built.unit || 1;

  const order = category.parts.filter((k) => built.parts.has(k));
  for (const k of built.parts.keys()) if (!order.includes(k)) order.push(k);

  const parts = order
    .map((key) => ({ key, group: built.parts.get(key) }))
    .filter((p) => meshCount(p.group) > 0)
    .map((p, index) => {
      const box = new THREE.Box3().setFromObject(p.group);
      const meta = partMeta(category, model, p.key);
      return {
        key: p.key, index, group: p.group, box, minZ: box.min.z, maxZ: box.max.z,
        label: meta.label, info: meta.info,
        support: supportPoints(p.group), anchor: findAnchor(p.group), mats: cloneMaterials(p.group), span: Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2,
        offset: 0, a: 0, b: 1,
      };
    });

  const gap = (category.explode?.gap ?? 0.4) * unit;
  const factor = (p) => Math.min(1, Math.max(0.6, 0.45 + (0.55 * p.span) / unit));
  let ceiling = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const g = i < parts.length - 1 ? (gap * (factor(p) + factor(parts[i + 1]))) / 2 : gap;
    p.offset = i === parts.length - 1 ? -gap * 0.6 : Math.max(0, ceiling + g - p.minZ);
    ceiling = p.maxZ + p.offset;
  }

  const step = 0.86 / (parts.length + 0.5);
  parts.forEach((p, i) => { p.a = 0.08 + i * step; p.b = p.a + step * 1.5; });

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  center.z = 0;
  const scale = DISPLAY_SIZE / Math.max(size.x, size.y, 1e-3);
  return { built, root, parts, unit, gap, bobAmp: 0.03 * unit, fit: { box, size, center, scale } };
}

export async function buildModel(category, model, M, onProgress) {
  let built = null;
  if (model.glb) {
    try { built = await loadGlb(category, model, onProgress); }
    catch (err) { console.warn(`[mainspring] Could not load ${model.glb}; using the procedural model.`, err); }
  }
  if (!built) built = BUILDERS[category.builder](model, M);
  return prepare(built, category, model);
}
