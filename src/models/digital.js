import {
  disc, rod, box, sphere, extrude, roundedRect, roundedRectHole, bake, mergeAll, mesh, faceFromShape,
} from '../three/geometry.js';
import { lcdTexture, plateTexture } from '../three/textures.js';
import { faceMaterial } from '../three/materials.js';
import { PartSet, buildStraps } from './common.js';

/*
 * The face plate is carried by the crystal assembly, so once it lifts off, the module underneath
 * (LCD, zebra strips, backlight, board, oscillator, buzzer, battery) can lift out through the open case.
 */
export function buildDigital(model, M) {
  const L = model.look;
  const W = L.W;
  const H = L.H;
  const D = L.depth;
  const u = Math.min(W, H) / 2;
  const cr = L.r;
  const P = new PartSet();
  const caseMat = M[L.caseMat] || M.resin;
  const zTop = D / 2;
  const zBot = -D / 2;
  const wall = (L.sport ? 0.2 : 0.12) * u;
  const strapW = W * (L.sport ? 0.62 : 0.58);

  // ---------- layout of the front
  const pw = W - (L.sport ? 0.62 : 0.26) * u;
  const ph = H - (L.sport ? 0.62 : 0.28) * u;
  const pr = Math.max(0.03 * u, cr - (L.sport ? 0.32 : 0.14) * u);
  const win = { x: 0, y: L.keypad ? ph * 0.2 : ph * 0.04, w: pw * 0.74, h: ph * (L.keypad ? 0.3 : 0.4) };
  const keypad = L.keypad ? { x: 0, y: -ph * 0.2, w: pw * 0.74, h: ph * 0.34 } : null;

  // ---------- case shell with lug blocks (sport adds a raised guard)
  {
    const shell = roundedRect(W, H, cr);
    shell.holes.push(roundedRectHole(W - wall * 2, H - wall * 2, Math.max(0.02 * u, cr - wall)));
    const geos = [extrude(shell, D, { bevel: 0.02 * u, curveSegments: 16 })];
    for (const sy of [1, -1]) geos.push(bake(box(strapW + 0.12 * u, 0.14 * u, D * 0.72), { y: sy * (H / 2 + 0.03 * u), z: -D * 0.1 }));
    P.add('case', mesh(mergeAll(geos), caseMat));
    if (L.sport) {
      const guard = roundedRect(W - 0.04 * u, H - 0.04 * u, cr * 0.95);
      guard.holes.push(roundedRectHole(pw + 0.06 * u, ph + 0.06 * u, pr + 0.02 * u));
      P.add('case', mesh(extrude(guard, 0.07 * u, { bevel: 0.01 * u, curveSegments: 16 }), M.resin, { z: zTop + 0.03 * u }));
    }
  }

  // ---------- crystal assembly: face plate (with printed face) and the acrylic window
  {
    const plateShape = () => {
      const s = roundedRect(pw, ph, pr);
      s.holes.push(roundedRectHole(win.w, win.h, 0.02 * u, win.x, win.y));
      if (keypad) s.holes.push(roundedRectHole(keypad.w, keypad.h, 0.02 * u, keypad.x, keypad.y));
      return s;
    };
    const metal = L.plate !== 'resin';
    const names = ['LIGHT', 'MODE', 'ALARM', 'START'];
    const btnPos = buttonLayout(L.buttons);
    const tex = plateTexture({
      pw, ph, metal, win, keypad, sub: L.keypad ? 'CALCULATOR' : (L.sport ? 'DUAL TIME' : 'ALARM CHRONOGRAPH'),
      buttons: btnPos.map(([sx, sy], i) => ({ x: sx * (pw / 2 - 0.05 * u), y: sy * ph * 0.34, label: names[i] })),
    });
    const t = 0.02 * u;
    P.add('crystal',
      mesh(extrude(plateShape(), t, { curveSegments: 10 }), metal ? M.steelBrushed : M.resin, { z: zTop }),
      mesh(faceFromShape(plateShape(), pw, ph, 0, 0, 10), faceMaterial(tex, { roughness: metal ? 0.38 : 0.6, metalness: metal ? 0.35 : 0 }), { z: zTop + t / 2 + 0.0008 * u }));
    const gw = win.w + 0.08 * u;
    const gh = win.h + 0.08 * u;
    const edge = roundedRect(gw, gh, 0.04 * u, win.x, win.y);
    edge.holes.push(roundedRectHole(gw - 0.02 * u, gh - 0.02 * u, 0.035 * u, win.x, win.y));
    P.add('crystal',
      mesh(extrude(roundedRect(gw, gh, 0.04 * u, win.x, win.y), 0.025 * u, { curveSegments: 8 }), M.glass, { z: zTop + t / 2 + 0.014 * u }),
      mesh(extrude(edge, 0.025 * u, { curveSegments: 8 }), M.glassEdge, { z: zTop + t / 2 + 0.014 * u }));
  }

  // ---------- module layers
  const zF = zTop - 0.012 * u;
  const zB = zBot + 0.02 * u;
  const T = zF - zB;
  const mz = (f) => zB + T * f;

  if (keypad) {
    const keys = [];
    const kw = keypad.w / 4;
    const kh = keypad.h / 4;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const g = extrude(roundedRect(kw - 0.03 * u, kh - 0.03 * u, 0.02 * u), 0.03 * u, { curveSegments: 4 });
        g.translate(keypad.x - keypad.w / 2 + kw * (i + 0.5), keypad.y - keypad.h / 2 + kh * (j + 0.5), 0);
        keys.push(g);
      }
    }
    P.add('keypad', mesh(mergeAll(keys), M.resinGray, { z: zTop - 0.005 * u }));
  }

  const lcd = lcdTexture({ aspect: win.w / win.h, calculator: !!keypad });
  P.add('lcd',
    mesh(box(win.w + 0.04 * u, win.h + 0.04 * u, T * 0.12), M.lcdBody, { x: win.x, y: win.y, z: mz(0.9) }),
    mesh(faceFromShape(roundedRect(win.w, win.h, 0.01 * u, win.x, win.y), win.w, win.h, win.x, win.y, 4), faceMaterial(lcd.texture, { roughness: 0.25 }), { z: mz(0.96) + 0.002 * u }));

  P.add('zebra', mesh(mergeAll([1, -1].map((s) => bake(box(win.w * 0.92, 0.03 * u, T * 0.18), { x: win.x, y: win.y + s * (win.h / 2 + 0.035 * u) }))), M.zebra, { z: mz(0.74) }));

  P.add('backlight',
    mesh(box(win.w - 0.02 * u, win.h - 0.02 * u, T * 0.07), M.backlight, { x: win.x, y: win.y, z: mz(0.76) }),
    mesh(box(0.05 * u, 0.04 * u, T * 0.07), M.ceramic, { x: win.x - win.w / 2 + 0.02 * u, y: win.y, z: mz(0.76) }));

  {
    const bw = pw * 0.92;
    const bh = ph * 0.9;
    const pads = [];
    for (let i = 0; i < 9; i++) {
      for (const s of [1, -1]) pads.push(bake(box(0.025 * u, 0.04 * u, 0.006 * u), { x: win.x - win.w * 0.42 + (i * win.w * 0.84) / 8, y: win.y + s * (win.h / 2 + 0.035 * u) }));
    }
    P.add('pcb',
      mesh(extrude(roundedRect(bw, bh, 0.05 * u), T * 0.09, { curveSegments: 6 }), M.pcb, { z: mz(0.6) }),
      mesh(mergeAll(pads), M.gold, { z: mz(0.6) + T * 0.05 }),
      mesh(bake(sphere(0.1 * u, 20), { sz: 0.32 }), M.epoxy, { x: -0.12 * u, y: -0.02 * u, z: mz(0.6) - T * 0.07 }));
  }

  P.add('oscillator', mesh(rod(0.03 * u, 0.15 * u, 'x', 16), M.steel, { x: 0.28 * u, y: -0.2 * u, z: mz(0.46) }));

  {
    const geos = [];
    for (const [sx, sy] of buttonLayout(L.buttons)) {
      const y = sy * H * 0.24;
      const big = L.sport ? 1.35 : 1;
      geos.push(bake(rod(0.04 * u * big, 0.14 * u, 'x', 16), { x: sx * (W / 2 + 0.03 * u), y }));
      geos.push(bake(rod(0.055 * u * big, 0.045 * u, 'x', 20), { x: sx * (W / 2 + 0.1 * u), y }));
    }
    P.add('buttons', mesh(mergeAll(geos), M.steel));
  }

  P.add('buzzer',
    mesh(disc(0.36 * u, T * 0.04, 48), M.brass, { x: -0.08 * u, y: 0.02 * u, z: mz(0.34) }),
    mesh(disc(0.24 * u, T * 0.05, 40), M.ceramic, { x: -0.08 * u, y: 0.02 * u, z: mz(0.34) + T * 0.01 }));

  P.add('battery',
    mesh(disc(0.3 * u, T * 0.16, 48), M.steel, { x: 0.12 * u, y: -0.08 * u, z: mz(0.17) }),
    mesh(disc(0.26 * u, T * 0.02, 48), M.steelDark, { x: 0.12 * u, y: -0.08 * u, z: mz(0.255) }));

  {
    const gw = W - wall * 2 - 0.02 * u;
    const gh = H - wall * 2 - 0.02 * u;
    const g = roundedRect(gw, gh, Math.max(0.02 * u, cr - wall));
    g.holes.push(roundedRectHole(gw - 0.07 * u, gh - 0.07 * u, Math.max(0.015 * u, cr - wall - 0.04 * u)));
    P.add('gasket', mesh(extrude(g, 0.02 * u, { curveSegments: 12 }), M.rubber, { z: zBot + 0.012 * u }));
  }

  {
    const bw = W - 0.3 * u;
    const bh = H - 0.3 * u;
    const screws = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => bake(disc(0.035 * u, 0.012 * u, 16), { x: sx * (bw / 2 - 0.08 * u), y: sy * (bh / 2 - 0.08 * u) }));
    P.add('caseback',
      mesh(extrude(roundedRect(bw, bh, Math.max(0.05 * u, cr - 0.12 * u)), 0.03 * u, { bevel: 0.005 * u, curveSegments: 12 }), M.steelBrushed, { z: zBot - 0.012 * u }),
      mesh(mergeAll(screws), M.steelDark, { z: zBot - 0.03 * u }));
  }

  P.add('strap', buildStraps({
    M, type: L.strap, width: strapW, thick: (L.strap === 'bracelet' ? 0.05 : 0.09) * u,
    yStart: H / 2 + 0.05 * u, zStart: -D * 0.15, wristR: Math.max(1.55 * u, H * 0.62), caseMat: M[L.caseMat] || M.steel,
  }));

  P.onFrame((t, dt, live) => { lcd.draw(new Date(live.now)); });

  return P.result({ unit: u });
}

function buttonLayout(n) {
  if (n <= 2) return [[-1, 1], [1, 1]];
  if (n === 3) return [[-1, 1], [-1, -1], [1, 1]];
  return [[-1, 1], [-1, -1], [1, 1], [1, -1]];
}
