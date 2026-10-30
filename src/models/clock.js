import * as THREE from 'three';
import {
  disc, rod, box, sphere, lathe, ring, extrude, roundedRect, roundedRectHole, circleShape, circleHole, polyShape, bake, mergeAll, mesh, faceFromShape,
} from '../three/geometry.js';
import { dialTexture } from '../three/textures.js';
import { faceMaterial, tinted } from '../three/materials.js';
import { PartSet, buildHands, setHands } from './common.js';
import { buildClockMovement } from './clockMovement.js';

const FORMS = {
  wall: { rd: 1.0, Dc: 1.0, ms: 1, zDial: (Dc) => Dc / 2 - 0.16, plateGap: 0.16, pendulum: { top: -0.8, length: 2.75, bob: 0.42, realLength: 0.994 } },
  mantel: { rd: 0.78, Dc: 1.1, ms: 0.8, zDial: (Dc) => Dc / 2 + 0.03, plateGap: 0.2, pendulum: { top: -0.62, length: 0.17, bob: 0.1, realLength: 0.18 } },
  grandfather: { rd: 0.95, Dc: 1.1, ms: 1, zDial: (Dc) => Dc / 2 + 0.03, plateGap: 0.16, weights: true, pendulum: { top: -0.8, length: 3.0, bob: 0.45, realLength: 0.994 } },
  skeleton: { rd: 0.9, Dc: 1.2, ms: 1, zDial: () => 0.36, plateGap: 0.1, skeleton: true, plateBottom: -1.98, pendulum: { top: -0.8, length: 0.75, bob: 0.22, realLength: 0.25 } },
};

export function buildClock(model, M) {
  const L = model.look;
  const F = FORMS[L.form] || FORMS.mantel;
  const P = new PartSet();
  const wood = tinted(M.wood, L.wood);
  const { rd, Dc, ms } = F;
  const zDial = F.zDial(Dc);

  // ---------- dial
  const isRing = !!F.skeleton;
  const tex = dialTexture({ bg: L.dial, ink: '#1E1E1C', markers: isRing ? 'ring' : L.numerals, ringInner: 0.66, brand: 'MAINSPRING', sub: 'EIGHT DAY' });
  const dialMat = faceMaterial(tex, { roughness: 0.6, transparent: isRing });
  if (isRing) {
    const sh = circleShape(rd);
    sh.holes.push(circleHole(rd * 0.66));
    P.add('dial', mesh(faceFromShape(sh, rd * 2, rd * 2, 0, 0, 96), dialMat, { z: zDial }));
    P.add('dial', mesh(ring(rd * 0.66, rd, 0.02, 96, 0.004), M.steelBrushed, { z: zDial - 0.011 }));
  } else {
    P.add('dial', mesh(faceFromShape(circleShape(rd), rd * 2, rd * 2, 0, 0, 96), dialMat, { z: zDial }));
    P.add('dial', mesh(disc(rd, 0.02, 96), tinted(M.lacquerWhite, L.dial), { z: zDial - 0.011 }));
  }
  if (L.form === 'wall') P.add('dial', mesh(ring(rd, rd + 0.09, 0.06, 96, 0.01), M.brass, { z: zDial }));
  if (L.form === 'mantel') P.add('dial', mesh(disc(0.97, 0.02, 96), M.brassDark, { z: zDial - 0.02 }));
  if (L.form === 'grandfather') P.add('dial', mesh(extrude(roundedRect(2.12, 2.76, 0.04, 0, -0.05), 0.025, { curveSegments: 4 }), M.brassDark, { z: zDial - 0.022 }));

  // ---------- hands
  const hands = buildHands({ M, style: 'spade', matKey: L.form === 'mantel' ? 'black' : 'blued', r: rd, z: zDial + 0.012, seconds: false });
  P.add('hands', hands.group);

  // ---------- movement
  const zf = zDial - F.plateGap - (F.skeleton ? 0 : 0);
  const mv = buildClockMovement(P, M, {
    ms, zf, zDial, weights: !!F.weights, skeleton: !!F.skeleton, plateBottom: F.plateBottom,
    pendulum: { ...F.pendulum, rodMat: L.form === 'wall' || L.form === 'grandfather' ? wood : M.steel, rodR: L.form === 'wall' || L.form === 'grandfather' ? 0.028 : 0.014 },
  });

  // ---------- case and glass
  if (L.form === 'wall') wallCase(P, M, wood, Dc);
  else if (L.form === 'mantel') mantelCase(P, M, wood, Dc, zDial);
  else if (L.form === 'grandfather') longCase(P, M, wood, Dc, zDial);
  else skeletonBase(P, M, wood, F.plateBottom, zDial);

  P.onFrame((t, dt, live) => {
    setHands(hands, 'smooth', live.now);
    mv.update(t);
  });

  return P.result({ unit: rd, rate: 2 / mv.period });
}

// A thin brass-edged glass pane in the XY plane.
function pane(M, w, h, x, y, z) {
  const t = 0.02;
  const frame = roundedRect(w, h, 0.02, x, y);
  frame.holes.push(roundedRectHole(w - 0.05, h - 0.05, 0.015, x, y));
  return [
    mesh(extrude(roundedRect(w, h, 0.02, x, y), t, { curveSegments: 4 }), M.glass, { z }),
    mesh(extrude(frame, t * 1.6, { curveSegments: 4 }), M.brassDark, { z }),
  ];
}

// Rectangular frame slab with a rectangular opening.
function frameSlab(w, h, border, t, cx = 0, cy = 0) {
  const s = roundedRect(w, h, 0.02, cx, cy);
  s.holes.push(roundedRectHole(w - border * 2, h - border * 2, 0.02, cx, cy));
  return extrude(s, t, { curveSegments: 4 });
}

function verticalLathe(profile, seg = 32) {
  return bake(lathe(profile, seg), { rx: -Math.PI / 2 });
}

function wallCase(P, M, wood, Dc) {
  const W = 2.6;
  const top = 1.42;
  const bottom = -4.25;
  const H = top - bottom;
  const yc = (top + bottom) / 2;
  const geos = [
    bake(box(W, H, 0.06), { y: yc, z: -Dc / 2 + 0.03 }),
    bake(box(0.1, H, Dc), { x: W / 2 - 0.05, y: yc }),
    bake(box(0.1, H, Dc), { x: -W / 2 + 0.05, y: yc }),
    bake(frameSlab(W, H, 0.16, 0.08, 0, yc), { z: Dc / 2 - 0.04 }),
    bake(box(W + 0.24, 0.14, Dc + 0.16), { y: top + 0.07 }),
    bake(extrude(polyShape([[-1.18, 0], [1.18, 0], [0, 0.42]]), 0.14, { curveSegments: 2 }), { y: top + 0.14, z: Dc / 2 - 0.08 }),
    bake(box(W + 0.2, 0.16, Dc + 0.14), { y: bottom - 0.08 }),
    bake(verticalLathe([[0, -0.44], [0.07, -0.36], [0.16, -0.18], [0.2, 0], [0, 0], [0, -0.44]]), { y: bottom - 0.16 }),
  ];
  P.add('case', mesh(mergeAll(geos), wood));
  P.add('case', mesh(sphere(0.06, 16), M.brass, { y: top + 0.6, z: Dc / 2 - 0.08 }));
  P.add('glass', ...pane(M, W - 0.3, H - 0.3, 0, yc, Dc / 2 + 0.02));
}

function camelPath(p, k = 1, cy = 0.05) {
  const T = (x, y) => [x * k, cy + (y - cy) * k];
  const mv = (x, y) => p.moveTo(...T(x, y));
  const ln = (x, y) => p.lineTo(...T(x, y));
  const bz = (a, b, c, d, e, f) => p.bezierCurveTo(...T(a, b), ...T(c, d), ...T(e, f));
  mv(-1.85, -1.15);
  ln(1.85, -1.15);
  ln(1.85, -0.55);
  bz(1.85, -0.22, 1.3, -0.3, 1.08, 0.02);
  bz(0.95, 0.5, 0.65, 1.25, 0, 1.25);
  bz(-0.65, 1.25, -0.95, 0.5, -1.08, 0.02);
  bz(-1.3, -0.3, -1.85, -0.22, -1.85, -0.55);
  ln(-1.85, -1.15);
  return p;
}

function mantelCase(P, M, wood, Dc, zDial) {
  const front = camelPath(new THREE.Shape());
  front.holes.push(circleHole(0.95));
  const band = camelPath(new THREE.Shape());
  band.holes.push(camelPath(new THREE.Path(), 0.9));
  const geos = [
    bake(extrude(front, 0.12, { curveSegments: 24 }), { z: Dc / 2 - 0.06 }),
    bake(extrude(camelPath(new THREE.Shape()), 0.08, { curveSegments: 24 }), { z: -Dc / 2 + 0.04 }),
    extrude(band, Dc - 0.2, { curveSegments: 24 }),
    bake(box(3.95, 0.14, Dc + 0.2), { y: -1.15 - 0.07 }),
  ];
  P.add('case', mesh(mergeAll(geos), wood));
  const feet = [];
  for (const x of [-1.75, 1.75]) for (const z of [-Dc / 2, Dc / 2]) feet.push(bake(sphere(0.09, 16), { x, y: -1.33, z }));
  P.add('case', mesh(mergeAll(feet), M.brassDark));
  P.add('glass',
    mesh(lathe([[0, zDial + 0.012], [0.82, zDial + 0.012], [0.82, zDial + 0.05], [0.55, zDial + 0.1], [0, zDial + 0.12], [0, zDial + 0.012]], 72), M.glass),
    mesh(lathe([[0.8, zDial - 0.005], [0.93, zDial - 0.005], [0.93, zDial + 0.035], [0.86, zDial + 0.07], [0.8, zDial + 0.07], [0.8, zDial - 0.005]], 96, 0.006), M.brass));
}

function longCase(P, M, wood, Dc, zDial) {
  // one front panel: hood, trunk and base outline with a single tall opening for the movement, weights and pendulum
  const outline = () => {
    const s = new THREE.Shape();
    s.moveTo(-1.15, -6.0);
    s.lineTo(1.15, -6.0);
    s.lineTo(1.15, -5.0);
    s.lineTo(0.95, -5.0);
    s.lineTo(0.95, -1.25);
    s.lineTo(1.25, -1.25);
    s.lineTo(1.25, 1.45);
    s.absarc(0, 0.1375, 1.8125, Math.atan2(1.3125, 1.25), Math.PI - Math.atan2(1.3125, 1.25), false);
    s.lineTo(-1.25, -1.25);
    s.lineTo(-0.95, -1.25);
    s.lineTo(-0.95, -5.0);
    s.lineTo(-1.15, -5.0);
    s.lineTo(-1.15, -6.0);
    return s;
  };
  const front = outline();
  const hole = new THREE.Path();
  hole.moveTo(-0.72, -4.85);
  hole.lineTo(0.72, -4.85);
  hole.lineTo(0.72, -1.42);
  hole.lineTo(1.02, -1.42);
  hole.lineTo(1.02, 1.32);
  hole.lineTo(-1.02, 1.32);
  hole.lineTo(-1.02, -1.42);
  hole.lineTo(-0.72, -1.42);
  hole.lineTo(-0.72, -4.85);
  front.holes.push(hole);
  const geos = [
    bake(extrude(front, 0.08, { curveSegments: 20 }), { z: Dc / 2 - 0.04 }),
    bake(extrude(outline(), 0.08, { curveSegments: 20 }), { z: -Dc / 2 + 0.04 }),
    bake(box(0.08, 2.7, Dc), { x: 1.21, y: 0.1 }),
    bake(box(0.08, 2.7, Dc), { x: -1.21, y: 0.1 }),
    bake(box(0.08, 3.75, Dc), { x: 0.91, y: -3.125 }),
    bake(box(0.08, 3.75, Dc), { x: -0.91, y: -3.125 }),
    bake(box(0.3, 0.08, Dc), { x: 1.1, y: -1.25 }),
    bake(box(0.3, 0.08, Dc), { x: -1.1, y: -1.25 }),
    bake(box(2.5, 0.08, Dc), { y: 1.45 }),
    bake(box(2.3, 0.96, Dc + 0.04), { y: -5.5 }),
    bake(box(2.42, 0.1, Dc + 0.14), { y: -5.97 }),
  ];
  P.add('case', mesh(mergeAll(geos), wood));
  const fin = [];
  for (const [x, y] of [[0, 1.95], [1.12, 1.47], [-1.12, 1.47]]) {
    fin.push(bake(sphere(0.07, 14), { x, y: y + 0.16, z: Dc / 2 - 0.1 }));
    fin.push(bake(rod(0.03, 0.14, 'y', 10), { x, y: y + 0.05, z: Dc / 2 - 0.1 }));
  }
  P.add('case', mesh(mergeAll(fin), M.brass));
  P.add('glass', ...pane(M, 2.2, 2.9, 0, 0.05, zDial + 0.09), ...pane(M, 1.5, 3.5, 0, -3.12, Dc / 2 + 0.02));
}

function skeletonBase(P, M, wood, plateBottom, zDial) {
  const geos = [
    bake(box(2.5, 0.28, 1.25), { y: plateBottom - 0.14 }),
    bake(box(2.62, 0.05, 1.37), { y: plateBottom - 0.025 }),
  ];
  P.add('case', mesh(mergeAll(geos), wood));
  const feet = [];
  for (const x of [-1.1, 1.1]) for (const z of [-0.5, 0.5]) feet.push(bake(sphere(0.08, 14), { x, y: plateBottom - 0.32, z }));
  P.add('case', mesh(mergeAll(feet), M.brass));
  P.add('glass', ...pane(M, 1.95, 3.1, 0, (1.05 + plateBottom) / 2, zDial + 0.14));
}
