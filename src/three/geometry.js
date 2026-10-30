import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
const cache = new Map();

export function memo(key, fn) {
  let g = cache.get(key);
  if (!g) { g = fn(); cache.set(key, g); }
  return g;
}

const k = (...a) => a.map((v) => (typeof v === 'number' ? +v.toFixed(4) : v)).join(':');

// ---------- primitives (all oriented along +Z unless stated) ----------

export function disc(r, depth, seg = 48) {
  return memo(k('disc', r, depth, seg), () => {
    const g = new THREE.CylinderGeometry(r, r, depth, seg);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

// Cylinder along an axis: 'x' | 'y' | 'z'
export function rod(r, len, axis = 'z', seg = 16, r2 = r) {
  return memo(k('rod', r, len, axis, seg, r2), () => {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    return g;
  });
}

export function box(w, h, d) {
  return memo(k('box', w, h, d), () => new THREE.BoxGeometry(w, h, d));
}

export function sphere(r, seg = 24) {
  return memo(k('sph', r, seg), () => new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)));
}

// Replace each corner of a closed polygon with a tiny chamfer, so lathe normals stay crisp.
export function chamfer(points, c, keepAxis = true) {
  const pts = points.slice(0, -1);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const v = pts[i];
    const q = pts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    if ((keepAxis && Math.abs(v[0]) < 1e-6) || l1 < 1e-6 || l2 < 1e-6) { out.push(v); continue; }
    const c1 = Math.min(c, l1 * 0.3);
    const c2 = Math.min(c, l2 * 0.3);
    out.push([v[0] + ((p[0] - v[0]) / l1) * c1, v[1] + ((p[1] - v[1]) / l1) * c1]);
    out.push([v[0] + ((q[0] - v[0]) / l2) * c2, v[1] + ((q[1] - v[1]) / l2) * c2]);
  }
  out.push(out[0]);
  return out;
}

// Profile points are [radius, z], counter-clockwise, closed (first == last).
export function lathe(profile, seg = 64, bevel = 0) {
  return memo(k('lathe', JSON.stringify(profile), seg, bevel), () => {
    const prof = bevel > 0 ? chamfer(profile, bevel) : profile;
    // One lathe per profile segment: shared corners get their own normals, so edges stay crisp.
    const pieces = [];
    for (let i = 0; i < prof.length - 1; i++) {
      const a = prof[i];
      const b = prof[i + 1];
      if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7) continue;
      if (a[0] < 1e-6 && b[0] < 1e-6) continue;
      pieces.push(new THREE.LatheGeometry([new THREE.Vector2(a[0], a[1]), new THREE.Vector2(b[0], b[1])], seg));
    }
    const g = pieces.length > 1 ? mergeGeometries(pieces, false) : pieces[0];
    g.rotateX(Math.PI / 2);
    return g;
  });
}

export function ring(rIn, rOut, depth, seg = 64, bevel = 0.006) {
  const h = depth / 2;
  return lathe([[rIn, -h], [rOut, -h], [rOut, h], [rIn, h], [rIn, -h]], seg, bevel);
}

export function extrude(shape, depth, { bevel = 0, curveSegments = 18, key = null } = {}) {
  const make = () => {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  return key ? memo(k('ext', key, depth, bevel, curveSegments), make) : make();
}

// ---------- 2D shapes ----------

export function drawRoundedRect(p, w, h, r, cx = 0, cy = 0) {
  r = Math.max(0, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  if (r < 1e-4) {
    p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.lineTo(x0, y0);
    return p;
  }
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - r);
  p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  p.lineTo(x0 + r, y1);
  p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + r);
  p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}

export const roundedRect = (w, h, r, cx = 0, cy = 0) => drawRoundedRect(new THREE.Shape(), w, h, r, cx, cy);
export const roundedRectHole = (w, h, r, cx = 0, cy = 0) => drawRoundedRect(new THREE.Path(), w, h, r, cx, cy);

export function circleHole(r, cx = 0, cy = 0) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, TAU, false);
  return p;
}

export function circleShape(r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, TAU, false);
  return s;
}

export function sectorShape(rIn, rOut, a0, a1) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, a0, a1, false);
  s.absarc(0, 0, rIn, a1, a0, true);
  s.closePath();
  return s;
}

export function polyShape(points) {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

// Gear outline. style: 'spur' | 'escape' | 'knurl'. holeR > 0 makes a ring (no spokes).
export function gearShape({ teeth, r, tooth = r * 0.09, style = 'spur', spokes = 0, hub = 0.24, rim = 0.13, bore = 0.06, holeR = 0 }) {
  const rRoot = r - tooth;
  const step = TAU / teeth;
  const profiles = {
    spur: [[0, rRoot], [0.14, r], [0.4, r], [0.54, rRoot], [0.77, rRoot]],
    escape: [[0, rRoot], [0.52, r], [0.6, r * 0.985], [0.66, rRoot]],
    knurl: [[0, rRoot], [0.5, r]],
  };
  const prof = profiles[style] || profiles.spur;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [f, rr] of prof) pts.push(new THREE.Vector2(Math.cos(a + f * step) * rr, Math.sin(a + f * step) * rr));
  }
  const shape = new THREE.Shape(pts);
  if (holeR > 0) {
    shape.holes.push(circleHole(holeR));
    return shape;
  }
  if (spokes > 0) {
    const rIn = r * hub;
    const rOut = rRoot - r * rim;
    if (rOut - rIn > r * 0.12) {
      const spokeW = r * 0.085;
      for (let s = 0; s < spokes; s++) {
        const a0 = (s * TAU) / spokes;
        const a1 = ((s + 1) * TAU) / spokes;
        const padO = spokeW / 2 / rOut;
        const padI = spokeW / 2 / rIn;
        const hole = new THREE.Path();
        hole.absarc(0, 0, rOut, a0 + padO, a1 - padO, false);
        hole.absarc(0, 0, rIn, a1 - padI, a0 + padI, true);
        hole.closePath();
        shape.holes.push(hole);
      }
    }
  }
  if (bore > 0) shape.holes.push(circleHole(r * bore));
  return shape;
}

export function gear(params, thickness) {
  return memo(k('gear', JSON.stringify(params), thickness), () =>
    extrude(gearShape(params), thickness, { curveSegments: 10 }));
}

// Flat Archimedean spiral as a thin tube (hairspring, mainspring).
export function spiral(r0, r1, turns, thick, z = 0) {
  return memo(k('spiral', r0, r1, turns, thick, z), () => {
    const n = Math.max(32, Math.floor(turns * 36));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = t * turns * TAU;
      const r = r0 + (r1 - r0) * t;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, thick, 5, false);
  });
}

// ---------- straps ----------

// Points of a strap leaving the lug and curling back, in the YZ plane. dir = +1 (top) or -1 (bottom).
export function strapPath(dir, { yStart = 1.12, zStart = -0.08, wristR = 1.55, sweep = 2.45, samples = 14 } = {}) {
  const t0 = Math.asin(Math.min(0.98, yStart / wristR));
  const cz = zStart - wristR * Math.cos(t0);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((sweep - t0) * i) / samples;
    pts.push([0, dir * wristR * Math.sin(t), cz + wristR * Math.cos(t)]);
  }
  return pts;
}

// A rectangular-section band along a curve. Width runs along X.
export function band(points, width, thickness, samples = 56) {
  return memo(k('band', JSON.stringify(points), width, thickness, samples), () => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const X = new THREE.Vector3(1, 0, 0);
    const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3();
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      curve.getPointAt(u, P);
      curve.getTangentAt(u, T);
      N.crossVectors(X, T).normalize();
      for (let s = 0; s < 4; s++) {
        for (const c of [corners[s], corners[(s + 1) % 4]]) {
          pos.push(P.x + X.x * c[0] * width / 2 + N.x * c[1] * thickness / 2,
            P.y + X.y * c[0] * width / 2 + N.y * c[1] * thickness / 2,
            P.z + X.z * c[0] * width / 2 + N.z * c[1] * thickness / 2);
          uv.push(u, (c[0] + 1) / 2);
        }
      }
    }
    for (let i = 0; i < samples; i++) {
      for (let s = 0; s < 4; s++) {
        const a = i * 8 + s * 2, b = a + 1, c = a + 9, d = a + 8;
        idx.push(a, b, c, a, c, d);
      }
    }
    const capStart = pos.length / 3;
    for (const [u, sign] of [[0, -1], [1, 1]]) {
      curve.getPointAt(u, P);
      curve.getTangentAt(u, T);
      N.crossVectors(X, T).normalize();
      const base = pos.length / 3;
      for (const c of corners) {
        pos.push(P.x + X.x * c[0] * width / 2 + N.x * c[1] * thickness / 2,
          P.y + X.y * c[0] * width / 2 + N.y * c[1] * thickness / 2,
          P.z + X.z * c[0] * width / 2 + N.z * c[1] * thickness / 2);
        uv.push(u, (c[0] + 1) / 2);
      }
      if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    void capStart;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

// Metal bracelet: individual links following the strap path.
export function links(points, width, thickness, count = 13, gapRatio = 0.86) {
  return memo(k('links', JSON.stringify(points), width, thickness, count), () => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const len = curve.getLength() / count;
    const X = new THREE.Vector3(1, 0, 0);
    const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const parts = [];
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      curve.getPointAt(u, P);
      curve.getTangentAt(u, T);
      N.crossVectors(X, T).normalize();
      m.makeBasis(X, T, N).setPosition(P);
      const outer = new THREE.BoxGeometry(width, len * gapRatio, thickness);
      outer.applyMatrix4(m);
      parts.push(outer);
      const center = new THREE.BoxGeometry(width * 0.42, len * 0.98, thickness * 1.12);
      center.applyMatrix4(m);
      parts.push(center);
    }
    return mergeAll(parts);
  });
}

// ---------- utilities ----------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function bake(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx = s, sy = s, sz = s } = {}) {
  const g = geo.clone();
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

export function mergeAll(list) {
  const prepared = list.map((g) => {
    const h = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(h.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') h.deleteAttribute(name);
    }
    if (!h.attributes.normal) h.computeVertexNormals();
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    h.morphAttributes = {};
    h.clearGroups();
    return h;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) console.warn('[mainspring] geometry merge failed');
  return merged || prepared[0];
}

// Flat face geometry from a shape, with UVs remapped to the given bounds (for printed dials).
export function faceFromShape(shape, w, h, cx = 0, cy = 0, segments = 64) {
  const g = new THREE.ShapeGeometry(shape, segments);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - (cx - w / 2)) / w, (pos.getY(i) - (cy - h / 2)) / h);
  }
  uv.needsUpdate = true;
  return g;
}

export function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, name = '' } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (s !== 1) m.scale.setScalar(s);
  if (name) m.name = name;
  return m;
}

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children) if (c) g.add(c);
  return g;
}

// Hand outlines, pointing along +Y from the pivot.
export function handShape(style, len, w, tail = len * 0.18) {
  const s = new THREE.Shape();
  if (style === 'dauphine') {
    s.moveTo(0, -tail); s.lineTo(w / 2, 0); s.lineTo(0, len); s.lineTo(-w / 2, 0); s.closePath();
  } else if (style === 'sword') {
    s.moveTo(-w * 0.32, -tail); s.lineTo(w * 0.32, -tail); s.lineTo(w / 2, len * 0.72); s.lineTo(0, len); s.lineTo(-w / 2, len * 0.72); s.closePath();
  } else if (style === 'needle') {
    s.moveTo(-w / 2, -tail); s.lineTo(w / 2, -tail); s.lineTo(w * 0.12, len); s.lineTo(-w * 0.12, len); s.closePath();
  } else if (style === 'spade') {
    s.moveTo(-w * 0.18, -tail); s.lineTo(w * 0.18, -tail); s.lineTo(w * 0.16, len * 0.62);
    s.lineTo(w * 0.5, len * 0.78); s.lineTo(0, len); s.lineTo(-w * 0.5, len * 0.78); s.lineTo(-w * 0.16, len * 0.62); s.closePath();
  } else {
    drawRoundedRect(s, w, len + tail, w * 0.45, 0, (len - tail) / 2);
  }
  return s;
}

export function handGeo(style, len, w, thick = 0.008, tail) {
  return memo(k('hand', style, len, w, thick, tail ?? -1), () => extrude(handShape(style, len, w, tail), thick, { curveSegments: 6 }));
}
