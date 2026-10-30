import * as THREE from 'three';

const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
let maxAniso = 4;
export const setMaxAnisotropy = (v) => { maxAniso = Math.min(8, v || 4); };

function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function spaced(ctx, text, x, y, spacing) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = 'center';
}

const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

/*
 * Draws a dial. Options:
 *  bg, ink, accent, markers: 'applied'|'baton'|'arabic'|'dive'|'roman'|'minimal'|'chrono'|'ring'
 *  shape: 'round' | 'rect' (w,h ratio) ; brand, sub ; ringInner (for 'ring')
 */
export function dialTexture(opts) {
  const {
    bg = '#EEEBE4', ink = '#1C1C1C', accent = '#B08D57', markers = 'baton', shape = 'round',
    w = 1, h = 1, brand = 'MAINSPRING', sub = '', ringInner = 0.7, size = 768, numeralsInside = false,
  } = opts;
  const W = shape === 'rect' ? Math.round(size * Math.min(1, w / h)) : size;
  const H = shape === 'rect' ? Math.round(size * Math.min(1, h / w)) : size;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2;

  if (markers === 'ring') {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.arc(cx, cy, R * ringInner, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // a whisper of radial sheen
    const g = ctx.createRadialGradient(cx, cy * 0.8, R * 0.05, cx, cy, R * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Where a ray from the center at angle a meets the track (rect dials use a rounded-rect track).
  const track = (a, inset) => {
    const dx = Math.sin(a), dy = -Math.cos(a);
    if (shape !== 'rect') return [cx + dx * R * inset, cy + dy * R * inset];
    const hw = (W / 2) * inset, hh = (H / 2) * inset;
    const t = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  };

  // minute track
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const hour = i % 5 === 0;
    const [x0, y0] = track(a, markers === 'ring' ? 0.985 : 0.965);
    const [x1, y1] = track(a, (markers === 'ring' ? 0.985 : 0.965) - (hour ? 0.06 : 0.03));
    ctx.lineWidth = hour ? R * 0.009 : R * 0.004;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  if (shape === 'rect') {
    ctx.lineWidth = R * 0.004;
    ctx.strokeRect(cx - (W / 2) * 0.9, cy - (H / 2) * 0.9, W * 0.9, H * 0.9);
  }

  const hourAngle = (i) => (i / 12) * Math.PI * 2;

  if (markers === 'baton' || markers === 'chrono') {
    for (let i = 0; i < 12; i++) {
      const a = hourAngle(i);
      ctx.save();
      const [x, y] = track(a, 0.8);
      ctx.translate(x, y); ctx.rotate(a);
      ctx.fillRect(-R * 0.012, -R * 0.07, R * 0.024, R * (i === 0 ? 0.16 : 0.12));
      ctx.restore();
    }
  }
  if (markers === 'arabic') {
    ctx.font = `500 ${R * 0.15}px ${FONT}`;
    for (let i = 0; i < 12; i++) {
      const [x, y] = track(hourAngle(i), 0.74);
      ctx.fillText(String(i === 0 ? 12 : i), x, y + R * 0.005);
    }
    ctx.font = `400 ${R * 0.045}px ${FONT}`;
    for (let i = 0; i < 12; i++) {
      const [x, y] = track(hourAngle(i), 0.87);
      ctx.fillText(String((i === 0 ? 12 : i) + 12), x, y);
    }
  }
  if (markers === 'dive') {
    for (let i = 0; i < 12; i++) {
      const a = hourAngle(i);
      const [x, y] = track(a, 0.8);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      if (i === 0) {
        ctx.beginPath(); ctx.moveTo(-R * 0.07, -R * 0.07); ctx.lineTo(R * 0.07, -R * 0.07); ctx.lineTo(0, R * 0.07); ctx.closePath(); ctx.fill();
      } else if (i % 3 === 0) {
        ctx.fillRect(-R * 0.03, -R * 0.08, R * 0.06, R * 0.16);
      } else {
        ctx.beginPath(); ctx.arc(0, 0, R * 0.045, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  if (markers === 'roman' || markers === 'ring') {
    const inset = markers === 'ring' ? (1 + ringInner) / 2 - 0.02 : 0.77;
    ctx.font = `400 ${R * (markers === 'ring' ? 0.12 : 0.13)}px "Times New Roman", Georgia, serif`;
    for (let i = 0; i < 12; i++) {
      const a = hourAngle(i);
      const [x, y] = track(a, inset);
      ctx.save(); ctx.translate(x, y);
      if (shape !== 'rect') ctx.rotate(a);
      ctx.fillText(ROMAN[i], 0, 0);
      ctx.restore();
    }
  }
  if (markers === 'minimal') {
    for (let i = 0; i < 12; i += 3) {
      const [x, y] = track(hourAngle(i), 0.84);
      ctx.beginPath(); ctx.arc(x, y, R * 0.018, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (markers === 'chrono') {
    for (const [sx, sy] of [[-0.42, 0], [0.42, 0], [0, 0.42]]) {
      const x = cx + sx * R, y = cy + sy * R;
      ctx.lineWidth = R * 0.005;
      ctx.beginPath(); ctx.arc(x, y, R * 0.17, 0, Math.PI * 2); ctx.stroke();
      for (let j = 0; j < 30; j++) {
        const a = (j / 30) * Math.PI * 2;
        const l = j % 5 === 0 ? 0.045 : 0.022;
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(a) * R * 0.165, y - Math.cos(a) * R * 0.165);
        ctx.lineTo(x + Math.sin(a) * R * (0.165 - l), y - Math.cos(a) * R * (0.165 - l));
        ctx.stroke();
      }
    }
  }

  if (markers !== 'ring') {
    ctx.font = `500 ${R * 0.05}px ${FONT}`;
    if (brand) spaced(ctx, brand, cx, cy - R * (markers === 'chrono' ? 0.28 : 0.36), R * 0.022);
    if (sub) {
      ctx.font = `400 ${R * 0.034}px ${FONT}`;
      ctx.globalAlpha = 0.75;
      spaced(ctx, sub, cx, cy + R * (markers === 'chrono' ? 0.66 : 0.4), R * 0.018);
      ctx.globalAlpha = 1;
    }
  }
  if (accent && markers !== 'ring' && markers !== 'dive') {
    ctx.fillStyle = accent;
    const [x, y] = track(0, 0.965);
    ctx.beginPath(); ctx.arc(x, y + R * 0.03, R * 0.01, 0, Math.PI * 2); ctx.fill();
  }
  void numeralsInside;
  return makeTexture(c);
}

// ---------- LCD ----------

const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };

function segPath(ctx, seg, x, y, w, h, t) {
  const hh = h / 2;
  const r = {
    a: [x + t, y, w - 2 * t, t],
    d: [x + t, y + h - t, w - 2 * t, t],
    g: [x + t, y + hh - t / 2, w - 2 * t, t],
    f: [x, y + t, t, hh - t * 1.5],
    b: [x + w - t, y + t, t, hh - t * 1.5],
    e: [x, y + hh + t / 2, t, hh - t * 1.5],
    c: [x + w - t, y + hh + t / 2, t, hh - t * 1.5],
  }[seg];
  ctx.fillRect(r[0], r[1], r[2], r[3]);
}

function digit(ctx, ch, x, y, w, h, t, on, off) {
  for (const s of 'abcdefg') {
    ctx.fillStyle = (SEG[ch] || '').includes(s) ? on : off;
    segPath(ctx, s, x, y, w, h, t);
  }
}

// Returns { texture, draw(date) } — a live LCD that redraws itself once per second.
export function lcdTexture({ aspect = 1.35, calculator = false } = {}) {
  const W = 512, H = Math.round(512 / aspect);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const texture = makeTexture(c);
  const on = '#262922', off = 'rgba(38,41,34,0.07)';
  let last = '';
  const draw = (d = new Date()) => {
    const hh = d.getHours() % 12 || 12;
    const mm = d.getMinutes();
    const ss = d.getSeconds();
    const key = `${hh}:${mm}:${ss}`;
    if (key === last) return;
    last = key;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#C9CDBB'); g.addColorStop(1, '#BEC2AF');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.transform(1, 0, -0.07, 1, H * 0.04, 0);

    const top = calculator ? H * 0.16 : H * 0.12;
    ctx.fillStyle = on;
    ctx.font = `600 ${H * 0.12}px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    ctx.fillText(days[d.getDay()], W * 0.1, top);
    ctx.textAlign = 'right';
    ctx.fillText(String(d.getDate()), W * 0.88, top);
    ctx.textAlign = 'left';
    ctx.fillText(d.getHours() < 12 ? 'AM' : 'PM', W * 0.1, top + H * 0.17);

    const dh = calculator ? H * 0.42 : H * 0.48;
    const dw = dh * 0.52;
    const t = dh * 0.11;
    const y = calculator ? H * 0.42 : H * 0.36;
    const str = `${hh < 10 ? ' ' : ''}${hh}${mm < 10 ? '0' : ''}${mm}`;
    let x = W * 0.22;
    for (let i = 0; i < 4; i++) {
      if (i === 2) {
        ctx.fillStyle = ss % 2 ? on : off;
        ctx.fillRect(x + dw * 0.05, y + dh * 0.28, t, t);
        ctx.fillRect(x + dw * 0.05, y + dh * 0.66, t, t);
        x += dw * 0.4;
      }
      digit(ctx, str[i], x, y, dw, dh, t, on, off);
      x += dw * 1.22;
    }
    const sdh = dh * 0.55, sdw = sdh * 0.55, st = sdh * 0.12;
    const s = `${ss < 10 ? '0' : ''}${ss}`;
    digit(ctx, s[0], x + dw * 0.05, y + dh - sdh, sdw, sdh, st, on, off);
    digit(ctx, s[1], x + dw * 0.05 + sdw * 1.25, y + dh - sdh, sdw, sdh, st, on, off);
    texture.needsUpdate = true;
  };
  draw();
  return { texture, draw };
}

// ---------- contact shadow ----------
let shadowTex = null;
export function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// ---------- dive bezel insert ----------
export function bezelTexture({ bg = '#1B2128', ink = '#E9E6DE', inner = 0.84 } = {}) {
  const S = 768;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const C = S / 2, R = S / 2;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(C, C, R, 0, Math.PI * 2);
  ctx.arc(C, C, R * inner, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mid = (1 + inner) / 2;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(a);
    if (i === 0) {
      ctx.beginPath();
      ctx.moveTo(-R * 0.045, -R * 0.985);
      ctx.lineTo(R * 0.045, -R * 0.985);
      ctx.lineTo(0, -R * (inner + 0.03));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#B08D57';
      ctx.beginPath();
      ctx.arc(0, -R * 0.94, R * 0.014, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
    } else if (i % 10 === 0) {
      ctx.font = `500 ${R * 0.085}px ${FONT}`;
      ctx.fillText(String(i), 0, -R * mid);
    } else if (i % 5 === 0) {
      ctx.fillRect(-R * 0.012, -R * 0.975, R * 0.024, R * 0.09);
    } else if (i < 15) {
      ctx.fillRect(-R * 0.005, -R * 0.975, R * 0.01, R * 0.05);
    }
    ctx.restore();
  }
  return makeTexture(c);
}

// ---------- digital watch face plate ----------
// Coordinates are plate-local units (plate is pw × ph, centered). Rects: { x, y, w, h } centered.
export function plateTexture({ pw, ph, metal = true, ink = '#2A2B2C', brand = 'MAINSPRING', sub = 'ALARM CHRONOGRAPH', win, keypad, buttons = [] }) {
  const W = 768;
  const H = Math.round((W * ph) / pw);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const px = (x) => (x / pw + 0.5) * W;
  const py = (y) => (0.5 - y / ph) * H;
  const sc = W / pw;
  if (metal) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#C9CBCC'); g.addColorStop(0.5, '#B8BBBD'); g.addColorStop(1, '#C4C6C7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < H; y += 2) {
      ctx.fillStyle = (y / 2) % 2 ? '#ffffff' : '#000000';
      ctx.fillRect(0, y, W, 1);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#2B2D30';
    ctx.fillRect(0, 0, W, H);
    ink = '#D9D7D0';
  }
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (win) {
    ctx.lineWidth = Math.max(2, sc * 0.012);
    const x0 = px(win.x - win.w / 2 - 0.04), y0 = py(win.y + win.h / 2 + 0.04);
    ctx.strokeRect(x0, y0, (win.w + 0.08) * sc, (win.h + 0.08) * sc);
    ctx.font = `600 ${sc * 0.055}px ${FONT}`;
    spaced(ctx, brand, px(win.x), py(win.y + win.h / 2 + 0.14), sc * 0.012);
    if (sub) {
      ctx.font = `500 ${sc * 0.038}px ${FONT}`;
      spaced(ctx, sub, px(win.x), py(win.y - win.h / 2 - 0.1), sc * 0.008);
    }
  }
  if (keypad) {
    ctx.lineWidth = Math.max(1, sc * 0.006);
    ctx.strokeRect(px(keypad.x - keypad.w / 2 - 0.03), py(keypad.y + keypad.h / 2 + 0.03), (keypad.w + 0.06) * sc, (keypad.h + 0.06) * sc);
  }
  ctx.font = `500 ${sc * 0.034}px ${FONT}`;
  for (const b of buttons) {
    ctx.textAlign = b.x < 0 ? 'left' : 'right';
    ctx.fillText(b.label, px(b.x), py(b.y));
  }
  ctx.textAlign = 'center';
  ctx.font = `500 ${sc * 0.03}px ${FONT}`;
  ctx.globalAlpha = 0.7;
  spaced(ctx, 'WATER RESIST', px(0), py(-ph / 2 + 0.07), sc * 0.006);
  ctx.globalAlpha = 1;
  return makeTexture(c);
}
