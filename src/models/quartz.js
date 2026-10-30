import * as THREE from 'three';
import {
  TAU, disc, rod, box, sphere, gear, extrude, roundedRect, roundedRectHole, circleShape, bake, mergeAll, mesh, group, faceFromShape, handGeo, drawRoundedRect,
} from '../three/geometry.js';
import { dialTexture } from '../three/textures.js';
import { faceMaterial, tinted } from '../three/materials.js';
import {
  PartSet, roundCase, roundCrystal, roundCaseback, buildHands, setHands, buildStraps, buildCrown, capsuleChain,
} from './common.js';

export function buildQuartz(model, M) {
  const L = model.look;
  const rect = L.shape === 'rect';
  const D = L.depth;
  const P = new PartSet();
  const caseMat = M[L.caseMat] || M.steel;
  const zTop = D / 2;
  const zBot = -D / 2;
  const R = rect ? Math.min(L.W, L.H) / 2 : L.R;
  const halfW = rect ? L.W / 2 : R;
  const halfH = rect ? L.H / 2 : R;
  const strapW = rect ? L.W * 0.66 : R * 0.98;
  const lugT = R * 0.12;

  // ---------- case and crystal
  let dialW, dialH, zD;
  if (rect) {
    const cr = R * 0.32;
    const wall = R * 0.13;
    const outer = roundedRect(L.W, L.H, cr);
    outer.holes.push(roundedRectHole(L.W - wall * 2, L.H - wall * 2, cr * 0.55));
    const geos = [extrude(outer, D, { bevel: 0.012 * R, curveSegments: 14 })];
    for (const sy of [1, -1]) {
      for (const sx of [1, -1]) {
        geos.push(bake(box(lugT, 0.24 * R, D * 0.62), { x: sx * (strapW / 2 + lugT / 2), y: sy * (halfH + 0.06 * R), z: -D * 0.12 }));
      }
    }
    P.add('case', mesh(mergeAll(geos), caseMat));
    // crystal: rounded rectangle slab plus a faint edge
    const gw = L.W - wall * 1.6;
    const gh = L.H - wall * 1.6;
    const t = 0.03 * R;
    const edge = roundedRect(gw, gh, cr * 0.6);
    edge.holes.push(roundedRectHole(gw - 0.02 * R, gh - 0.02 * R, cr * 0.58));
    P.add('crystal',
      mesh(extrude(roundedRect(gw, gh, cr * 0.6), t, { curveSegments: 12 }), M.glass, { z: zTop + t / 2 + 0.01 * R }),
      mesh(extrude(edge, t, { curveSegments: 12 }), M.glassEdge, { z: zTop + t / 2 + 0.01 * R }));
    dialW = L.W - wall * 2 - 0.01 * R;
    dialH = L.H - wall * 2 - 0.01 * R;
    zD = zTop - 0.04 * R;
    const dShape = roundedRect(dialW, dialH, cr * 0.5);
    const tex = dialTexture({ bg: L.dial, ink: L.ink, markers: L.markers, shape: 'rect', w: dialW, h: dialH, brand: 'MAINSPRING', sub: 'QUARTZ' });
    P.add('dial',
      mesh(faceFromShape(dShape, dialW, dialH, 0, 0, 24), faceMaterial(tex, { roughness: 0.5 }), { z: zD }),
      mesh(extrude(roundedRect(dialW, dialH, cr * 0.5), 0.012 * R, { curveSegments: 12 }), tinted(M.lacquerWhite, L.dial), { z: zD - 0.0065 * R }));
  } else {
    P.add('case', mesh(roundCase({ R, D, lugGap: strapW, lugT, lugReach: 1.27, inner: 0.88 }), caseMat));
    P.add('case', mesh(bake(ringGeo(R * 0.86, R * 0.965, 0.03 * R), { z: zTop + 0.015 * R }), caseMat));
    if (L.chrono) {
      const pushers = [];
      for (const a of [0.62, -0.62]) {
        pushers.push(bake(rod(0.045 * R, 0.14 * R, 'x', 20), { x: Math.cos(a) * (R + 0.04 * R), y: Math.sin(a) * (R + 0.04 * R), rz: a }));
        pushers.push(bake(rod(0.065 * R, 0.05 * R, 'x', 24), { x: Math.cos(a) * (R + 0.12 * R), y: Math.sin(a) * (R + 0.12 * R), rz: a }));
      }
      P.add('case', mesh(mergeAll(pushers), caseMat));
    }
    P.add('crystal', roundCrystal({ M, r: R * 0.855, z0: zTop - 0.002 * R, t: 0.045 * R, dome: 0.006 * R }));
    const rd = R * 0.86;
    dialW = dialH = rd * 2;
    zD = zTop - 0.04 * R;
    const tex = dialTexture({ bg: L.dial, ink: L.ink, markers: L.markers, brand: 'MAINSPRING', sub: L.chrono ? 'CHRONOGRAPH' : 'QUARTZ' });
    P.add('dial',
      mesh(faceFromShape(circleShape(rd), rd * 2, rd * 2, 0, 0, 96), faceMaterial(tex, { roughness: 0.5 }), { z: zD }),
      mesh(disc(rd, 0.012 * R, 96), tinted(M.lacquerWhite, L.dial), { z: zD - 0.0065 * R }));
  }

  // ---------- hands
  const handR = Math.min(dialW, dialH) / 2;
  const hands = buildHands({ M, style: L.hands, matKey: L.handMat, r: handR, z: zD + 0.008 * R, seconds: L.seconds });
  P.add('hands', hands.group);
  const subHands = [];
  if (L.chrono) {
    for (const [sx, sy] of [[-0.42, 0], [0.42, 0], [0, -0.42]]) {
      const h = mesh(handGeo('needle', handR * 0.15, handR * 0.03, 0.005 * R, handR * 0.03), M.lacquerBlack, { x: sx * handR, y: sy * handR, z: zD + 0.005 * R });
      h.rotation.z = -sx * 2 + sy;
      subHands.push(h);
      P.add('hands', h);
    }
  }

  // ---------- quartz module (front to back: oscillator, IC, stepper, gear train + frame, battery)
  const mR = Math.min(halfW, halfH) * 0.92;
  const zF = zD - 0.03 * R;
  const zB = zBot + 0.03 * R;
  const T = zF - zB;
  const mz = (f) => zB + T * f;
  const p = (x, y) => [x * mR, y * mR];

  // oscillator: the little steel can holding the quartz tuning fork, plus its two leads
  {
    const [x, y] = p(-0.42, -0.42);
    P.add('oscillator',
      mesh(rod(0.05 * mR, 0.24 * mR, 'x', 20), M.steel, { x, y, z: mz(0.86) }),
      mesh(mergeAll([bake(rod(0.006 * mR, 0.1 * mR, 'x', 6), { x: x + 0.16 * mR, y: y + 0.015 * mR }), bake(rod(0.006 * mR, 0.1 * mR, 'x', 6), { x: x + 0.16 * mR, y: y - 0.015 * mR })]), M.copper, { z: mz(0.86) }));
  }

  // integrated circuit: small board with the chip under a black epoxy blob
  {
    const [x, y] = p(-0.36, -0.08);
    P.add('ic',
      mesh(box(0.3 * mR, 0.22 * mR, T * 0.06), M.pcb, { x, y, z: mz(0.76) }),
      mesh(bake(sphere(0.075 * mR, 20), { sz: 0.35 }), M.epoxy, { x, y, z: mz(0.76) + T * 0.04 }));
  }

  // stepper motor: copper coil on a steel core, stator plate, magnetic rotor
  const rotorPos = p(0.34, 0.3);
  const stepRotor = new THREE.Group();
  {
    const [cx, cy] = p(-0.06, 0.42);
    P.add('stepper',
      mesh(rod(0.07 * mR, 0.4 * mR, 'x', 24), M.copper, { x: cx, y: cy, z: mz(0.84) }),
      mesh(mergeAll([bake(box(0.05 * mR, 0.17 * mR, T * 0.1), { x: cx - 0.23 * mR, y: cy }), bake(box(0.05 * mR, 0.17 * mR, T * 0.1), { x: cx + 0.23 * mR, y: cy })]), M.steelDark, { z: mz(0.84) }),
      mesh(capsuleChain([[cx + 0.22 * mR, cy], rotorPos], 0.11 * mR, T * 0.06, mz(0.72)), M.steelBrushed));
    stepRotor.add(mesh(disc(0.055 * mR, T * 0.12, 24), M.lacquerBlack));
    stepRotor.add(mesh(box(0.11 * mR, 0.02 * mR, T * 0.13), M.copper));
    stepRotor.position.set(rotorPos[0], rotorPos[1], mz(0.84));
    P.add('stepper', stepRotor);
  }

  // gear train in a plastic module frame
  const trainWheels = [];
  {
    P.add('gearTrain', mesh(rect
      ? extrude(roundedRect(halfW * 1.7, halfH * 1.72, R * 0.25), T * 0.12, { curveSegments: 10 })
      : disc(mR * 0.88, T * 0.12, 64), M.resin, { z: mz(0.5) }));
    const spec = [[0.0, 0.0, 0.14, 'plastic'], [0.18, 0.16, 0.11, 'brass'], [0.22, -0.06, 0.09, 'plastic'], [0.05, 0.27, 0.08, 'brass']];
    for (const [x, y, r, mk] of spec) {
      const w = group(
        mesh(gear({ teeth: Math.round(r * 300), r: r * mR, tooth: r * mR * 0.1, style: 'spur', bore: 0.06 }, T * 0.05), M[mk]),
        mesh(rod(0.012 * mR, T * 0.24, 'z', 8), M.steel, { z: -T * 0.08 }),
      );
      w.position.set(x * mR, y * mR, mz(0.64));
      trainWheels.push(w);
      P.add('gearTrain', w);
    }
  }

  // battery: silver-oxide coin cell behind the frame
  {
    const [x, y] = p(0.3, -0.28);
    P.add('battery',
      mesh(disc(0.34 * mR, T * 0.2, 64), M.steel, { x, y, z: mz(0.24) }),
      mesh(disc(0.3 * mR, T * 0.03, 64), M.steelDark, { x, y, z: mz(0.355) }));
  }

  // ---------- crown, caseback, strap
  P.add('crown', buildCrown({ mat: caseMat, r: 0.085 * R, len: 0.1 * R, x: halfW - 0.015 * R, stemFrom: halfW - 0.13 * R, knurl: !rect }));
  if (rect) {
    P.add('caseback', mesh(extrude(roundedRect(L.W - 0.08 * R, L.H - 0.08 * R, R * 0.3), 0.04 * R, { bevel: 0.006 * R, curveSegments: 12 }), caseMat, { z: zBot - 0.02 * R }));
  } else {
    P.add('caseback', roundCaseback({ M, R, zBot, mat: caseMat, window: false }));
  }
  P.add('strap', buildStraps({
    M, type: L.strap, width: strapW * 0.96, thick: (L.strap === 'mesh' ? 0.035 : 0.06) * R,
    yStart: halfH + (rect ? 0.1 : 0.16) * R, zStart: zBot + 0.05 * R, wristR: Math.max(1.45 * R, halfH * 1.2), caseMat,
  }));

  // ---------- life: seconds tick once per second; the stepper rotor flips half a turn with each pulse
  P.onFrame((t, dt, live) => {
    const a = setHands(hands, 'tick', live.now);
    const sec = Math.floor(live.now / 1000);
    const frac = (live.now % 1000) / 1000;
    stepRotor.rotation.z = Math.PI * ((sec % 2) + Math.min(1, frac * 7));
    trainWheels[0].rotation.z = a.s * 0.2;
    trainWheels[1].rotation.z = -a.s * 0.5;
    trainWheels[2].rotation.z = a.m;
    trainWheels[3].rotation.z = -a.s;
    if (subHands[0]) subHands[0].rotation.z = a.s;
  });

  return P.result({ unit: R, handMode: 'tick' });
}

function ringGeo(rIn, rOut, depth) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, TAU, false);
  const h = new THREE.Path();
  h.absarc(0, 0, rIn, 0, TAU, true);
  s.holes.push(h);
  return extrude(s, depth, { curveSegments: 72 });
}

void drawRoundedRect;
