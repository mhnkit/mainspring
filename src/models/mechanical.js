import * as THREE from 'three';
import {
  TAU, disc, rod, box, ring, gear, sectorShape, spiral, extrude, bake, mergeAll, mesh, group, faceFromShape, circleShape, circleHole,
} from '../three/geometry.js';
import { dialTexture, bezelTexture } from '../three/textures.js';
import { faceMaterial, tinted } from '../three/materials.js';
import {
  PartSet, roundCase, roundCrystal, roundCaseback, buildHands, setHands, buildStraps, buildCrown, capsuleChain, beatsFromSpecs,
} from './common.js';

/*
 * Layout (front = +Z): crystal, bezel, hands, dial, then the movement in z-layers ordered so each part
 * can lift toward the front once the parts before it have gone: barrel, gear train (wheels, bridge, ring),
 * escape wheel, pallet fork, balance, jewels, rotor. Then crown, case, caseback, strap.
 */
export function buildMechanical(model, M) {
  const L = model.look;
  const R = L.R;
  const D = L.depth;
  const P = new PartSet();
  const caseMat = M[L.caseMat] || M.steel;
  const zTop = D / 2;
  const zBot = -D / 2;
  const strapW = R * 1.02;
  const lugT = R * 0.13;
  const beats = beatsFromSpecs(model.specs, 8);
  const handMode = `sweep${beats}`;

  // ---------- case
  P.add('case', mesh(roundCase({ R, D, lugGap: strapW, lugT }), caseMat));
  if (L.bezel === 'dive') {
    const guards = [1, -1].map((sy) => bake(box(0.12 * R, 0.07 * R, D * 0.5), { x: R * 1.0, y: sy * 0.19 * R }));
    P.add('case', mesh(mergeAll(guards), caseMat));
  }

  // ---------- bezel
  let zBezel;
  if (L.bezel === 'dive') {
    const t = 0.075 * R;
    P.add('bezel', mesh(gear({ teeth: 120, r: R * 1.035, tooth: R * 0.018, style: 'knurl', holeR: R * 0.8 }, t), caseMat, { z: zTop + t / 2 }));
    const ins = new THREE.Shape();
    ins.absarc(0, 0, R * 0.985, 0, TAU, false);
    ins.holes.push(circleHole(R * 0.83));
    P.add('bezel', mesh(faceFromShape(ins, R * 1.97, R * 1.97, 0, 0, 96), faceMaterial(bezelTexture({ inner: 0.83 / 0.985 }), { roughness: 0.3, transparent: true }), { z: zTop + t + 0.002 * R }));
    zBezel = zTop + t;
  } else if (L.bezel === 'thin') {
    const t = 0.035 * R;
    P.add('bezel', mesh(ring(R * 0.86, R * 0.97, t, 96, 0.004), caseMat, { z: zTop + t / 2 }));
    zBezel = zTop + t;
  } else {
    const t = 0.06 * R;
    P.add('bezel', mesh(ring(R * 0.8, R * 0.975, t * 0.45, 96, 0.004), caseMat, { z: zTop + t * 0.225 }));
    P.add('bezel', mesh(ring(R * 0.8, R * 0.9, t * 0.55, 96, 0.006), caseMat, { z: zTop + t * 0.72 }));
    zBezel = zTop + t;
  }

  // ---------- crystal
  const rc = L.bezel === 'thin' ? R * 0.855 : R * 0.8;
  P.add('crystal', roundCrystal({ M, r: rc - 0.004 * R, z0: zTop - 0.004 * R, t: zBezel - zTop + 0.01 * R, dome: L.bezel === 'polished' ? 0.03 * R : 0.012 * R }));

  // ---------- dial
  const rd = R * 0.855;
  const zD = zTop - 0.05 * R;
  const skeleton = !!L.skeleton;
  const dialTex = dialTexture({ bg: L.dial, ink: L.ink, markers: L.markers, brand: 'MAINSPRING', sub: L.rotor ? 'AUTOMATIC' : 'HAND-WOUND', ringInner: 0.72 });
  const dialMat = faceMaterial(dialTex, { roughness: 0.55, transparent: skeleton });
  if (skeleton) {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, rd, 0, TAU, false);
    sh.holes.push(circleHole(rd * 0.72));
    P.add('dial', mesh(faceFromShape(sh, rd * 2, rd * 2, 0, 0, 96), dialMat, { z: zD }));
    P.add('dial', mesh(ring(rd * 0.72, rd, 0.012 * R, 96, 0.002), tinted(M.lacquerWhite, L.dial), { z: zD - 0.0065 * R }));
  } else {
    P.add('dial', mesh(faceFromShape(circleShape(rd), rd * 2, rd * 2, 0, 0, 96), dialMat, { z: zD }));
    P.add('dial', mesh(disc(rd, 0.012 * R, 96), tinted(M.lacquerWhite, L.dial), { z: zD - 0.0065 * R }));
  }
  if (L.markers === 'applied') {
    const bars = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const rr = rd * 0.8;
      const make = (dx) => bake(box(0.034 * R, 0.12 * R, 0.016 * R), {
        x: Math.sin(a) * rr + Math.cos(a) * dx, y: Math.cos(a) * rr - Math.sin(a) * dx, z: zD + 0.008 * R, rz: -a,
      });
      if (i === 0) bars.push(make(-0.03 * R), make(0.03 * R));
      else bars.push(make(0));
    }
    P.add('dial', mesh(mergeAll(bars), M.steel));
  }

  // ---------- hands (they show the real time)
  const hands = buildHands({ M, style: L.hands, matKey: L.handMat, r: rd, z: zD + 0.01 * R });
  P.add('hands', hands.group);

  // ---------- movement layout (R units)
  const zMF = zD - 0.035 * R;
  const zMB = zBot + 0.012 * R;
  const T = zMF - zMB;
  const mz = (f) => zMB + T * f;
  const v = (x, y) => [x * R, y * R];
  const B = v(-0.264, 0.222);
  const C = v(0, 0);
  const Tw = v(0.26, 0.116);
  const F = v(0.401, -0.053);
  const E = v(0.353, -0.232);
  const Pf = v(0.2, -0.385);
  const Bal = v(0.0, -0.52);
  const brass = M.brass;
  const bridgeMat = M.steelBrushed;

  const wheel = (r, teeth, spokes, thick) => gear({ teeth, r, tooth: r * 0.075, style: 'spur', spokes, hub: 0.22, rim: 0.12, bore: 0.05 }, thick);
  const pinion = (r, thick) => gear({ teeth: 8, r, tooth: r * 0.32, style: 'spur', bore: 0 }, thick);
  const screw = (x, y, z) => mesh(disc(0.022 * R, 0.01 * R, 16), M.blued, { x, y, z });

  // barrel (front-most movement part): drum, teeth, ratchet wheel on its back
  {
    const drum = mesh(disc(R * 0.285, T * 0.3, 64), brass, { x: B[0], y: B[1], z: mz(0.8) });
    const teeth = mesh(gear({ teeth: 72, r: R * 0.3, tooth: R * 0.018, style: 'spur', holeR: R * 0.24 }, T * 0.07), M.brassDark, { x: B[0], y: B[1], z: mz(0.7) });
    const ratchet = mesh(gear({ teeth: 40, r: R * 0.2, tooth: R * 0.02, style: 'escape', spokes: 0, bore: 0 }, T * 0.05), M.steel, { x: B[0], y: B[1], z: mz(0.62) });
    const arbor = mesh(rod(R * 0.03, T * 0.5, 'z', 16), M.steel, { x: B[0], y: B[1], z: mz(0.75) });
    P.add('barrel', drum, teeth, ratchet, arbor);
  }

  // gear train: center, third and fourth wheels with pinions and arbors, train bridge, movement ring
  const trainWheels = [];
  {
    const spec = [
      { p: C, r: 0.24 * R, teeth: 72, spokes: 4, z: 0.46 },
      { p: Tw, r: 0.18 * R, teeth: 60, spokes: 4, z: 0.42 },
      { p: F, r: 0.15 * R, teeth: 56, spokes: 5, z: 0.38 },
    ];
    for (const w of spec) {
      const g = group(
        mesh(wheel(w.r, w.teeth, w.spokes, T * 0.045), brass, { z: 0 }),
        mesh(pinion(R * 0.045, T * 0.12), M.steel, { z: -T * 0.07 }),
        mesh(rod(R * 0.014, T * 0.32, 'z', 10), M.steel, { z: -T * 0.05 }),
      );
      g.position.set(w.p[0], w.p[1], mz(w.z));
      trainWheels.push(g);
      P.add('gearTrain', g);
    }
    P.add('gearTrain', mesh(capsuleChain([C, Tw, F, v(0.68, -0.12)], 0.11 * R, T * 0.08, mz(0.24)), bridgeMat));
    P.add('gearTrain', screw(Tw[0] + 0.07 * R, Tw[1] + 0.05 * R, mz(0.24) - T * 0.045), screw(0.64 * R, -0.11 * R, mz(0.24) - T * 0.045));
    P.add('gearTrain', mesh(ring(R * 0.8, R * 0.855, T * 0.77, 96, 0.004), M.steelDark, { z: mz(0.585) }));
  }

  // escape wheel with its own small bridge
  const escape = group(
    mesh(gear({ teeth: 20, r: 0.12 * R, tooth: 0.12 * R * 0.28, style: 'escape', spokes: 4, hub: 0.25, rim: 0.14, bore: 0.05 }, T * 0.04), M.steel),
    mesh(pinion(R * 0.035, T * 0.1), M.steel, { z: -T * 0.06 }),
    mesh(rod(R * 0.012, T * 0.3, 'z', 10), M.steel, { z: -T * 0.06 }),
  );
  escape.position.set(E[0], E[1], mz(0.44));
  P.add('escapeWheel', escape, mesh(capsuleChain([E, v(0.62, -0.38)], 0.08 * R, T * 0.08, mz(0.24)), bridgeMat), screw(0.6 * R, -0.37 * R, mz(0.24) - T * 0.045));

  // pallet fork: lever toward the balance, anchor arms toward the escape wheel, two ruby stones
  const fork = new THREE.Group();
  {
    const toBal = Math.atan2(Bal[1] - Pf[1], Bal[0] - Pf[0]);
    const toE = Math.atan2(E[1] - Pf[1], E[0] - Pf[0]);
    const lever = capsuleChain([[0, 0], [Math.cos(toBal) * 0.17 * R, Math.sin(toBal) * 0.17 * R]], 0.03 * R, T * 0.035, 0);
    const armA = [Math.cos(toE + 0.42) * 0.12 * R, Math.sin(toE + 0.42) * 0.12 * R];
    const armB = [Math.cos(toE - 0.42) * 0.12 * R, Math.sin(toE - 0.42) * 0.12 * R];
    const arms = capsuleChain([armA, [0, 0], armB], 0.028 * R, T * 0.035, 0);
    fork.add(mesh(mergeAll([lever, arms]), M.steel));
    const stones = [armA, armB].map(([x, y]) => bake(box(0.018 * R, 0.04 * R, T * 0.05), { x, y, rz: toE }));
    fork.add(mesh(mergeAll(stones), M.ruby));
    fork.add(mesh(rod(R * 0.011, T * 0.3, 'z', 10), M.steel, { z: -T * 0.05 }));
  }
  fork.position.set(Pf[0], Pf[1], mz(0.44));
  P.add('palletFork', fork, mesh(capsuleChain([Pf, v(0.36, -0.6)], 0.07 * R, T * 0.08, mz(0.24)), bridgeMat));

  // balance wheel, hairspring and balance cock
  const balanceWheel = new THREE.Group();
  {
    const rimT = T * 0.06;
    const geos = [ring(0.17 * R, 0.21 * R, rimT, 64, 0.003), box(0.36 * R, 0.024 * R, rimT * 0.7)];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      geos.push(bake(rod(0.012 * R, 0.03 * R, 'x', 8), { x: Math.cos(a) * 0.225 * R, y: Math.sin(a) * 0.225 * R, rz: a }));
    }
    balanceWheel.add(mesh(mergeAll(geos), M.gold));
    balanceWheel.add(mesh(rod(R * 0.012, T * 0.42, 'z', 10), M.steel, { z: -T * 0.08 }));
  }
  balanceWheel.position.set(Bal[0], Bal[1], mz(0.46));
  const hairspring = mesh(spiral(0.025 * R, 0.14 * R, 9, 0.0035 * R), M.blued, { x: Bal[0], y: Bal[1], z: mz(0.36) });
  P.add('balance', balanceWheel, hairspring,
    mesh(capsuleChain([Bal, v(0.4, -0.7)], 0.12 * R, T * 0.08, mz(0.24)), bridgeMat),
    screw(0.36 * R, -0.67 * R, mz(0.24) - T * 0.045));

  // jewels: rubies set in the back of the bridges, one per pivot
  {
    const pts = [C, Tw, F, E, Pf, Bal];
    const rub = pts.map(([x, y]) => bake(disc(0.032 * R, T * 0.05, 20), { x, y }));
    const chatons = pts.map(([x, y]) => bake(ring(0.032 * R, 0.046 * R, T * 0.035, 24, 0), { x, y }));
    P.add('jewels', mesh(mergeAll(rub), M.ruby, { z: mz(0.16) }), mesh(mergeAll(chatons), M.gold, { z: mz(0.16) }));
  }

  // rotor (automatics only): half disc with a heavy rim, swinging on a center bearing
  let rotor = null;
  if (L.rotor) {
    rotor = new THREE.Group();
    rotor.add(mesh(extrude(sectorShape(0.06 * R, 0.66 * R, 0, Math.PI), T * 0.05, { curveSegments: 40 }), M.steelBrushed));
    rotor.add(mesh(extrude(sectorShape(0.64 * R, 0.78 * R, 0, Math.PI), T * 0.09, { curveSegments: 40 }), M.brassDark));
    rotor.add(mesh(disc(0.075 * R, T * 0.1, 32), M.steel));
    rotor.position.set(0, 0, mz(0.06));
    P.add('rotor', rotor);
  }

  // ---------- crown, caseback, strap
  const crownR = (L.bezel === 'dive' ? 0.14 : 0.11) * R;
  P.add('crown', buildCrown({ mat: caseMat, r: crownR, len: 0.12 * R, x: R * 0.985, stemFrom: R * 0.865 }));
  P.add('caseback', roundCaseback({ M, R, zBot, mat: caseMat, window: true, rw: 0.66 }));
  P.add('strap', buildStraps({
    M, type: L.strap, width: strapW * 0.96, thick: (L.strap === 'rubber' ? 0.085 : 0.065) * R,
    yStart: 1.16 * R, zStart: zBot + 0.06 * R, wristR: 1.48 * R, caseMat,
  }));

  // ---------- life
  const swingPhase = Math.random() * TAU;
  P.onFrame((t, dt, live) => {
    const a = setHands(hands, handMode, live.now);
    const bt = t * beats;
    balanceWheel.rotation.z = 2.3 * Math.sin(Math.PI * bt);
    hairspring.rotation.z = 0.25 * Math.sin(Math.PI * bt);
    fork.rotation.z = 0.09 * Math.tanh(4 * Math.sin(Math.PI * bt));
    const step = Math.floor(bt);
    escape.rotation.z = -(step + Math.min(1, (bt - step) * 6)) * (TAU / 40);
    trainWheels[0].rotation.z = a.m;
    trainWheels[1].rotation.z = -a.s * 0.125;
    trainWheels[2].rotation.z = a.s;
    if (rotor) rotor.rotation.z = 0.9 * Math.sin(t * 0.35 + swingPhase) + (live.spin || 0) * 0.6;
  });

  return P.result({ unit: R, beats, handMode });
}
