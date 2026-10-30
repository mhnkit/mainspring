import * as THREE from 'three';
import {
  TAU, disc, rod, lathe, extrude, gear, strapPath, band, links, bake, mergeAll, mesh, group, polyShape, handGeo,
} from '../three/geometry.js';

// Collects parts. Each part is a Group named by its key; the explode moves these groups.
export class PartSet {
  constructor() {
    this.root = new THREE.Group();
    this.map = new Map();
    this.anim = [];
  }
  part(key) {
    let g = this.map.get(key);
    if (!g) {
      g = new THREE.Group();
      g.name = key;
      g.userData.partKey = key;
      this.root.add(g);
      this.map.set(key, g);
    }
    return g;
  }
  add(key, ...objects) {
    const g = this.part(key);
    for (const o of objects) if (o) g.add(o);
    return g;
  }
  onFrame(fn) { this.anim.push(fn); }
  result(extra = {}) {
    const anim = this.anim;
    return {
      root: this.root,
      parts: this.map,
      update: (t, dt, live) => { for (const f of anim) f(t, dt, live); },
      ...extra,
    };
  }
}

// A slab from a polygon drawn in the (y, z) plane, `thickness` along x. Used for lugs and brackets.
const YZX = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
export function yzSlab(points, thickness, x = 0) {
  const g = extrude(polyShape(points), thickness, { curveSegments: 4 });
  g.applyMatrix4(YZX);
  if (x) g.translate(x, 0, 0);
  return g;
}

// Rounded bar between two points, for bridges, cocks and levers.
export function capsuleShape(ax, ay, bx, by, w) {
  const len = Math.hypot(bx - ax, by - ay) || 1e-4;
  const ang = Math.atan2(by - ay, bx - ax);
  const r = w / 2;
  const pt = (x, y) => [ax + x * Math.cos(ang) - y * Math.sin(ang), ay + x * Math.sin(ang) + y * Math.cos(ang)];
  const s = new THREE.Shape();
  const p0 = pt(0, -r);
  s.moveTo(p0[0], p0[1]);
  const p1 = pt(len, -r);
  s.lineTo(p1[0], p1[1]);
  s.absarc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2, false);
  const p2 = pt(0, r);
  s.lineTo(p2[0], p2[1]);
  s.absarc(ax, ay, r, ang + Math.PI / 2, ang + Math.PI * 1.5, false);
  return s;
}

export function capsuleChain(points, w, thickness, z = 0) {
  const geos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const g = extrude(capsuleShape(ax, ay, bx, by, w), thickness, { curveSegments: 10 });
    g.translate(0, 0, z);
    geos.push(g);
  }
  return mergeAll(geos);
}

export function handMaterial(M, key) {
  return { steel: M.steel, lume: M.lume, blued: M.blued, gold: M.gold, black: M.lacquerBlack }[key] || M.steel;
}

// Hour, minute and (optional) seconds hands plus a center cap. Hands point along +Y from the pivot.
export function buildHands({ M, style, matKey, r, z, seconds = true, secondsMat, thick, gap }) {
  const mat = handMaterial(M, matKey);
  const sMat = secondsMat || (matKey === 'lume' || matKey === 'black' ? M.steel : mat);
  thick = thick ?? r * 0.008;
  gap = gap ?? r * 0.012;
  const W = { dauphine: [0.1, 0.075], sword: [0.085, 0.065], baton: [0.05, 0.04], needle: [0.06, 0.045], spade: [0.11, 0.08] }[style] || [0.06, 0.045];
  const hour = mesh(handGeo(style, r * 0.56, r * W[0], thick), mat, { z });
  const minute = mesh(handGeo(style, r * 0.84, r * W[1], thick), mat, { z: z + gap });
  minute.userData.anchorTip = r * 0.66;
  const g = group(hour, minute);
  let second = null;
  if (seconds) {
    second = mesh(handGeo('needle', r * 0.9, r * 0.018, thick * 0.7, r * 0.2), sMat, { z: z + gap * 2 });
    g.add(second);
  }
  g.add(mesh(disc(r * 0.035, gap * 2.6, 24), sMat, { z: z + gap * 1.3 }));
  return { group: g, hour, minute, second };
}

function backOut(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// Real local time. mode: 'smooth' | 'sweep8' | 'sweep6' | 'tick' (quartz jump with a tiny overshoot)
export function timeAngles(mode, now = Date.now()) {
  const d = new Date(now);
  const ms = d.getMilliseconds();
  const s = d.getSeconds();
  const m = d.getMinutes();
  const h = d.getHours() % 12;
  let sec;
  if (mode === 'smooth') sec = s + ms / 1000;
  else if (mode && mode.startsWith('sweep')) {
    const n = Number(mode.slice(5)) || 8;
    sec = s + Math.floor((ms / 1000) * n) / n;
  } else {
    const t = ms / 1000;
    sec = s - 1 + (t < 0.14 ? backOut(t / 0.14) : 1);
  }
  const min = m + (s + ms / 1000) / 60;
  const hr = h + min / 60;
  return { h: (-hr / 12) * TAU, m: (-min / 60) * TAU, s: (-sec / 60) * TAU, sec };
}

export function setHands(hands, mode, now) {
  const a = timeAngles(mode, now);
  hands.hour.rotation.z = a.h;
  hands.minute.rotation.z = a.m;
  if (hands.second) hands.second.rotation.z = a.s;
  return a;
}

// Top and bottom straps leaving the lugs and curling back as if around a wrist.
export function buildStraps({ M, type, width, thick, yStart, zStart, wristR, sweep = 2.45, caseMat, linkCount = 14 }) {
  const top = strapPath(1, { yStart, zStart, wristR, sweep });
  const bottom = strapPath(-1, { yStart, zStart, wristR, sweep });
  if (type === 'bracelet') {
    return group(
      mesh(links(top, width, thick * 1.15, linkCount), caseMat),
      mesh(links(bottom, width, thick * 1.15, linkCount), caseMat),
    );
  }
  let mat;
  if (type === 'mesh') {
    mat = caseMat.clone();
    mat.roughness = 0.52;
    mat.userData = { ...caseMat.userData };
  } else {
    mat = M[type] || M.leatherBlack;
  }
  return group(mesh(band(top, width, thick), mat), mesh(band(bottom, width, thick), mat));
}

// Crown and stem along +X, starting at x.
export function buildCrown({ mat, r, len, x, stemFrom, knurl = true }) {
  const parts = [];
  if (knurl) {
    parts.push(bake(gear({ teeth: 30, r, tooth: r * 0.12, style: 'knurl', bore: 0 }, len), { x: x + len / 2, ry: Math.PI / 2 }));
  } else {
    parts.push(bake(rod(r, len, 'x', 32), { x: x + len / 2 }));
  }
  parts.push(bake(rod(r * 0.8, len * 0.16, 'x', 32), { x: x + len + len * 0.06 }));
  const stemLen = Math.max(0.01, x - stemFrom);
  parts.push(bake(rod(r * 0.17, stemLen + len * 0.2, 'x', 10), { x: stemFrom + stemLen / 2 }));
  return mesh(mergeAll(parts), mat);
}

// Round case middle with four lugs.
export function roundCase({ R, D, lugGap, lugT, lugReach = 1.3, inner = 0.86 }) {
  const zTop = D / 2;
  const zBot = -D / 2;
  const prof = [
    [R * inner, zBot + D * 0.12], [R * 0.93, zBot], [R, zBot + D * 0.3], [R, zTop - D * 0.22],
    [R * 0.975, zTop], [R * inner, zTop], [R * inner, zBot + D * 0.12],
  ];
  const geos = [lathe(prof, 96, Math.min(0.012, D * 0.04))];
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const pts = [
        [0.8 * R, zTop - D * 0.12], [1.2 * R, zTop - D * 0.24], [lugReach * R, zTop - D * 0.4],
        [lugReach * R + 0.01, zBot + D * 0.26], [(lugReach - 0.07) * R, zBot + D * 0.05], [0.8 * R, zBot + D * 0.07],
      ].map(([u, v]) => [u * sy, v]);
      geos.push(yzSlab(pts, lugT, sx * (lugGap / 2 + lugT / 2)));
    }
  }
  return mergeAll(geos);
}

export function roundCrystal({ M, r, z0, t, dome = 0 }) {
  const prof = [[0, z0], [r, z0], [r, z0 + t], [r * 0.72, z0 + t + dome * 0.6], [0, z0 + t + dome], [0, z0]];
  return group(
    mesh(lathe(prof, 72), M.glass),
    mesh(lathe([[r * 0.965, z0], [r, z0], [r, z0 + t], [r * 0.965, z0 + t], [r * 0.965, z0]], 72), M.glassEdge),
  );
}

// Caseback screwed into the back of a round case. window=true gives a sapphire display back.
export function roundCaseback({ M, R, zBot, mat, window = true, rw = 0.66 }) {
  const z0 = zBot - 0.055 * R;
  const z1 = zBot;
  if (!window) {
    return group(
      mesh(lathe([[0, z0 + 0.012 * R], [R * 0.86, z0], [R * 0.92, z0 + 0.025 * R], [R * 0.92, z1], [0, z1], [0, z0 + 0.012 * R]], 80, 0.004), mat),
      mesh(lathe([[R * 0.5, z0 + 0.008 * R], [R * 0.53, z0 + 0.008 * R], [R * 0.53, z0 + 0.0125 * R], [R * 0.5, z0 + 0.0125 * R], [R * 0.5, z0 + 0.008 * R]], 80), mat),
    );
  }
  return group(
    mesh(lathe([[R * rw, z0 + 0.012 * R], [R * 0.86, z0], [R * 0.92, z0 + 0.025 * R], [R * 0.92, z1], [R * rw, z1], [R * rw, z0 + 0.012 * R]], 80, 0.004), mat),
    mesh(lathe([[0, z0 + 0.014 * R], [R * rw, z0 + 0.014 * R], [R * rw, z1 - 0.006 * R], [0, z1 - 0.006 * R], [0, z0 + 0.014 * R]], 64), M.glass),
    mesh(lathe([[R * rw * 0.96, z0 + 0.014 * R], [R * rw, z0 + 0.014 * R], [R * rw, z1 - 0.006 * R], [R * rw * 0.96, z1 - 0.006 * R], [R * rw * 0.96, z0 + 0.014 * R]], 64), M.glassEdge),
  );
}

export function beatsFromSpecs(specs, fallback = 8) {
  const row = (specs || []).find(([k]) => /frequency/i.test(k));
  if (!row) return fallback;
  const n = Number(String(row[1]).replace(/[^0-9]/g, '').slice(0, 5));
  return n > 1000 ? Math.round(n / 3600) : fallback;
}

export { TAU };
