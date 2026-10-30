import * as THREE from 'three';
import {
  TAU, disc, rod, box, lathe, gear, spiral, extrude, roundedRect, circleHole, roundedRectHole, polyShape, bake, mergeAll, mesh, group,
} from '../three/geometry.js';
import { capsuleChain } from './common.js';

/*
 * Clock movement between a front and a back plate. All positions are relative to the dial center.
 * Layers front to back: front plate, mainspring (or weights), gear train, escapement + crutch, pendulum, back plate.
 * `ms` scales the movement, `zf` is the front plate's z, `weights` swaps the spring for three hanging weights.
 */
export function buildClockMovement(P, M, { ms = 1, zf, zDial, pendulum, weights = false, skeleton = false, plateBottom }) {
  const s = (x, y) => [x * ms, y * ms];
  const depth = 0.46 * ms;
  const zb = zf - depth;
  const pt = 0.045 * ms;
  const S = s(-0.38, -0.3);
  const C = s(0.12, -0.2);
  const Tw = s(0.36, 0.14);
  const E = s(0.04, 0.3);
  const A = s(0.04, 0.53);
  const px = A[0];

  // plates
  const plate = () => {
    if (!skeleton) return roundedRect(1.36 * ms, 1.28 * ms, 0.1 * ms, 0, -0.04 * ms);
    const sh = new THREE.Shape();
    const yb = plateBottom;
    sh.moveTo(-0.85, yb);
    sh.lineTo(0.85, yb);
    sh.lineTo(0.85, 0.2);
    sh.absarc(0, 0.2, 0.85, 0, Math.PI, false);
    sh.lineTo(-0.85, yb);
    const hole = (r, x, y) => circleHole(r, x, y);
    sh.holes.push(hole(0.38, 0, 0.28), hole(0.24, -0.42, -0.42), hole(0.24, 0.42, -0.42));
    sh.holes.push(roundedRectHole(0.9, Math.max(0.3, -0.8 - yb - 0.2), 0.12, 0, (-0.8 + yb + 0.2) / 2 - 0.02));
    return sh;
  };
  P.add('frontPlate', mesh(extrude(plate(), pt, { curveSegments: 24 }), M.brass, { z: zf }));
  P.add('backPlate', mesh(extrude(plate(), pt, { curveSegments: 24 }), M.brass, { z: zb }));
  {
    const pil = [];
    const py0 = skeleton ? [-0.25, plateBottom + 0.15] : [-0.04 * ms + 0.5 * ms, -0.04 * ms - 0.5 * ms];
    for (const x of [-0.6 * ms, 0.6 * ms]) for (const y of py0) pil.push(bake(rod(0.035 * ms, depth, 'z', 16), { x: skeleton ? x * 1.1 : x, y, z: (zf + zb) / 2 }));
    P.add('backPlate', mesh(mergeAll(pil), M.brassDark));
  }

  const wheel = (r, teeth, spokes, t) => gear({ teeth, r, tooth: r * 0.06, style: 'spur', spokes, hub: 0.2, rim: 0.1, bore: 0.04 }, t);
  const pinion = (r, t) => gear({ teeth: 8, r, tooth: r * 0.3, style: 'spur', bore: 0 }, t);
  const zz = (f) => zb + depth * f;

  // mainspring (open coil) or the three weights of a longcase clock
  let springCoil = null;
  if (!weights) {
    springCoil = mesh(spiral(0.05 * ms, 0.3 * ms, 7, 0.012 * ms), M.steelDark, { x: S[0], y: S[1], z: zz(0.82) });
    P.add('mainspring', springCoil, mesh(rod(0.03 * ms, 0.12 * ms, 'z', 12), M.steel, { x: S[0], y: S[1], z: zz(0.82) }));
  } else {
    const yTop = -0.66 * ms;
    const zw = zz(0.62);
    const items = [];
    const cables = [];
    for (const [x, len] of [[-0.48, 2.3], [0, 1.95], [0.48, 2.3]]) {
      const yc = yTop - len;
      items.push(bake(rod(0.14, 0.95, 'y', 32), { x, y: yc - 0.475 }));
      items.push(bake(disc(0.1, 0.05, 24), { x, y: yc + 0.06 }));
      cables.push(bake(rod(0.008, len, 'y', 6), { x, y: yTop - len / 2 }));
    }
    P.add('weights', mesh(mergeAll(items), M.brass, { z: zw }), mesh(mergeAll(cables), M.steelDark, { z: zw }));
  }

  // gear train: great wheel behind the spring, center wheel, third wheel
  const train = [];
  for (const w of [{ p: S, r: 0.34, teeth: 96, spokes: 6, z: 0.62 }, { p: C, r: 0.26, teeth: 80, spokes: 5, z: 0.5 }, { p: Tw, r: 0.2, teeth: 64, spokes: 4, z: 0.4 }]) {
    const g = group(
      mesh(wheel(w.r * ms, w.teeth, w.spokes, 0.025 * ms), M.brass),
      mesh(pinion(0.05 * ms, 0.08 * ms), M.steel, { z: -0.05 * ms }),
      mesh(rod(0.016 * ms, depth * 0.9, 'z', 10), M.steel, { z: -0.06 * ms }),
    );
    g.position.set(w.p[0], w.p[1], zz(w.z));
    train.push(g);
    P.add('gearTrain', g);
  }

  // escapement: escape wheel, anchor and crutch (the crutch reaches down to the pendulum)
  const escape = group(
    mesh(gear({ teeth: 30, r: 0.18 * ms, tooth: 0.05 * ms, style: 'escape', spokes: 4, hub: 0.22, rim: 0.14, bore: 0.05 }, 0.02 * ms), M.brass),
    mesh(pinion(0.035 * ms, 0.06 * ms), M.steel, { z: -0.04 * ms }),
  );
  escape.position.set(E[0], E[1], zz(0.3));
  const anchor = new THREE.Group();
  {
    const armL = [-0.2 * ms, -0.14 * ms];
    const armR = [0.2 * ms, -0.14 * ms];
    anchor.add(mesh(capsuleChain([armL, [0, 0], armR], 0.04 * ms, 0.03 * ms, 0), M.steel));
    anchor.add(mesh(mergeAll([armL, armR].map(([x, y]) => bake(box(0.03 * ms, 0.06 * ms, 0.035 * ms), { x, y: y - 0.035 * ms }))), M.steelDark));
    anchor.add(mesh(rod(0.02 * ms, 0.12 * ms, 'z', 10), M.steel));
  }
  anchor.position.set(A[0], A[1], zz(0.3));
  const crutchLen = A[1] - pendulum.top + 0.05 * ms;
  const crutch = group(mesh(rod(0.012 * ms, crutchLen, 'y', 8), M.steel, { y: -crutchLen / 2 }), mesh(box(0.08 * ms, 0.03 * ms, 0.03 * ms), M.steel, { y: -crutchLen + 0.02 * ms }));
  crutch.position.set(A[0], A[1], zz(0.24));
  P.add('escapement', escape, anchor, crutch);

  // pendulum: suspension block, rod and lens bob, pivoting at its top
  const pend = new THREE.Group();
  {
    const L = pendulum.length;
    const br = pendulum.bob;
    pend.add(mesh(box(0.1 * ms, 0.07 * ms, 0.05 * ms), M.brassDark, { y: 0.02 * ms }));
    pend.add(mesh(rod(pendulum.rodR || 0.016 * ms, L, 'y', 10), pendulum.rodMat || M.steel, { y: -L / 2 }));
    const t = br * 0.22;
    pend.add(mesh(lathe([[0, -t], [br * 0.62, -t * 0.82], [br, 0], [br * 0.62, t * 0.82], [0, t], [0, -t]], 64), M.brass, { y: -L }));
  }
  pend.position.set(px, pendulum.top, zz(0.16));
  P.add('pendulum', pend);

  // winding arbor: square shaft from the spring arbor out through the dial
  {
    const z0 = zz(0.75);
    const z1 = zDial + 0.025 * ms;
    P.add('windingArbor', mesh(box(0.07 * ms, 0.07 * ms, z1 - z0), M.steel, { x: S[0], y: S[1], z: (z0 + z1) / 2 }));
  }

  const period = 2 * Math.PI * Math.sqrt(Math.max(0.05, pendulum.realLength) / 9.81);
  const amp = pendulum.length > 1.5 ? 0.04 : 0.07;
  return {
    period,
    zb,
    update(t) {
      const a = amp * Math.sin((TAU * t) / period);
      pend.rotation.z = a;
      crutch.rotation.z = a * 0.6;
      anchor.rotation.z = a * 0.6;
      const beat = Math.floor((t * 2) / period);
      escape.rotation.z = -beat * (TAU / 60);
      if (springCoil) springCoil.rotation.z = -t * 0.002;
      train[1].rotation.z = -t * 0.01;
      train[2].rotation.z = t * 0.04;
    },
  };
}

void polyShape;
