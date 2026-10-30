import * as THREE from 'three';
import { CATEGORIES, signatureOf, formatPrice } from './config.js';
import { Stage, FOV, fitDistance } from './three/stage.js';
import { buildModel, setRenderer } from './models/index.js';
import { Item } from './item.js';
import { Labels } from './ui/labels.js';
import { Shop } from './ui/shop.js';
import { Sound } from './lib/audio.js';
import { Spring, clamp, lerp, smoothstep, damp, ease, nextFrame, wait } from './lib/springs.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;
motionQuery.addEventListener?.('change', (e) => { reducedMotion = e.matches; });
const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
body.classList.toggle('is-touch', isTouch);

const ui = {
  canvas: $('#gl'), fade: $('#fade'), names: $('#names'), options: $('#options'), back: $('#back-btn'),
  crumbHome: $('[data-crumb="home"]'), crumbCat: $('[data-crumb="category"]'), crumbModel: $('[data-crumb="model"]'),
  wordmark: $('.wordmark'), sound: $('#sound-btn'), cartBtn: $('#cart-btn'),
  galleryKicker: $('#gallery-kicker'), galleryTitle: $('#gallery-title'), galleryHint: $('#gallery-hint'),
  spec: $('#spec'), specHandle: $('#spec-handle'), specType: $('#spec-type'), specName: $('#spec-name'),
  specPrice: $('#spec-price'), specDesc: $('#spec-desc'), specList: $('#spec-list'),
  progressFill: $('#progress-fill'), progressCount: $('#progress-count'), zoomIn: $('#zoom-in'), zoomOut: $('#zoom-out'),
  cta: $('#cta'), ctaPrice: $('#cta-price'), add: $('#add-btn'),
  loader: $('#loader'), loaderBar: $('#loader span'), webglError: $('#webgl-error'),
};

const PIVOT = 9.5;
const GALLERY_RADIUS = 9;
const GALLERY_DEPTH = -4.5;
const HERO_Y = [-0.06, 0.1, -0.1, 0.06];
const GALLERY_Y = [0.08, -0.1, 0.12, -0.05];

let stage = null;
let sound = null;
let labels = null;
let shop = null;
let lenis = null;

const state = {
  view: 'hero', category: null, detail: null, items: new Map(),
  t: 0, bootT: Infinity, busy: false, flight: null, rig: null, settled: false,
  cartFlight: false, collapse: false, checkoutAt: 0, snapNext: false,
  hovered: null, focus: -1, options: [], hoverAt: null, dragging: false,
  arc: new Spring(0, 14, 0.92), galleryArc: new Spring(0, 14, 0.92), zoom: new Spring(1, 60, 0.9),
  mouse: { x: 0, y: 0, sx: 0, sy: 0 }, scrollP: 0, explodeP: 0, muteUntil: 0,
  driftFrom: new THREE.Vector3(),
};

const itemId = (cat, model) => `${cat.id}/${model.id}`;
const getItem = (cat, model) => state.items.get(itemId(cat, model));

function viewport() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return { W, H, mobile: W < 760, wide: W / H >= 0.95, bar: W < 760 ? 56 : 64 };
}

// Screen area (px) each view frames its objects into, leaving room for copy, labels and panels.
function regionFor(view, v) {
  if (view === 'detail') {
    if (v.mobile) return { left: 132, right: v.W - 14, top: v.bar + 70, bottom: v.H - 210 };
    return { left: 260, right: v.W - (Math.min(340, v.W * 0.3) + 60), top: v.bar + 28, bottom: v.H - Math.max(120, v.H * 0.07 + 84) };
  }
  const k = view === 'gallery' ? 0.25 : 0.22;
  const top = v.mobile ? v.bar + Math.min(view === 'gallery' ? 200 : 170, v.H * (k + 0.02)) : v.bar + v.H * k;
  return { left: v.mobile ? 12 : 40, right: v.W - (v.mobile ? 12 : 40), top, bottom: v.H - (v.mobile ? 40 : 56) };
}

// ---------- layouts

function arcLocal(i, n, spread, radius) {
  const th = (i - (n - 1) / 2) * spread;
  return new THREE.Vector3(radius * Math.sin(th), 0, radius * (Math.cos(th) - 1));
}

function gridLocal(i) {
  const col = i % 2;
  const row = Math.floor(i / 2);
  return new THREE.Vector3((col - 0.5) * 2.75, (0.5 - row) * 3.3, 0);
}

// Rotate a layout point about a vertical axis `radius` behind the layout's front (drag rotates the arc).
function pivotRotate(p, yaw, radius) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const z = p.z + radius;
  return new THREE.Vector3(p.x * c + z * s, p.y, -p.x * s + z * c - radius);
}

function heroLayout(i, v) {
  if (v.wide) {
    const p = arcLocal(i, CATEGORIES.length, 0.36, PIVOT);
    p.y = HERO_Y[i % 4];
    return { local: p, scale: 1 };
  }
  const p = gridLocal(i);
  p.y += HERO_Y[i % 4] * 0.5;
  return { local: p, scale: 0.86 };
}

function galleryLayout(j, n, v) {
  if (v.wide) {
    const p = arcLocal(j, n, 0.34, GALLERY_RADIUS);
    p.y = GALLERY_Y[j % 4];
    return { local: p, scale: 0.92 };
  }
  return { local: gridLocal(j), scale: 0.86 };
}

// Each category's gallery lives behind its spot in the hero arc, so choosing one flies toward it.
function galleryCenter(cat, v) {
  const h = heroLayout(CATEGORIES.indexOf(cat), v).local;
  return new THREE.Vector3(h.x, 0, h.z + GALLERY_DEPTH);
}

function heroSlot(i, v) {
  const L = heroLayout(i, v);
  const showBack = CATEGORIES[i].builder === 'mechanical';
  return {
    position: pivotRotate(L.local, state.arc.value, PIVOT), yaw: showBack ? Math.PI : -0.18, pitch: 0.04,
    scale: L.scale, opacity: state.t > state.bootT + 0.15 * i ? 1 : 0, float: 0.085, sway: 0.5, floor: 1.55,
  };
}

function gallerySlot(cat, j, v) {
  const L = galleryLayout(j, cat.models.length, v);
  const p = pivotRotate(L.local, state.galleryArc.value, GALLERY_RADIUS).add(galleryCenter(cat, v));
  return { position: p, yaw: -0.12, pitch: 0.04, scale: L.scale, opacity: 1, float: 0.075, sway: 0.75, floor: 1.55 };
}

function detailSlot(item) {
  return { position: item.anchorPos, yaw: 0, pitch: 0, scale: item.anchorScale, opacity: 1, float: 0.025, sway: 0, floor: 1.55 };
}

function visibleSlots(v) {
  const map = new Map();
  if (state.view === 'hero') {
    CATEGORIES.forEach((c, i) => { const it = getItem(c, signatureOf(c)); if (it) map.set(it, heroSlot(i, v)); });
  } else if (state.view === 'gallery' && state.category) {
    state.category.models.forEach((m, j) => { const it = getItem(state.category, m); if (it) map.set(it, gallerySlot(state.category, j, v)); });
  } else if (state.detail) {
    map.set(state.detail, detailSlot(state.detail));
  }
  return map;
}

// Items in the current view take their slots; the rest drift outward and fade.
function assignSlots(v) {
  const map = visibleSlots(v);
  for (const it of state.items.values()) {
    const s = map.get(it);
    if (s) {
      it.setSlot(s);
      if (!it.everShown && !it.fly) it.snap(0.8);
      it.drifting = false;
    } else if (!it.drifting) {
      it.drifting = true;
      it.hover = false;
      it.focused = false;
      const dir = it.base.clone().sub(state.driftFrom);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(it.base.x >= state.driftFrom.x ? 1 : -1, 0, 0);
      dir.normalize();
      const to = it.base.clone().addScaledVector(dir, 5.5).add(new THREE.Vector3(0, 0.3, -2.5));
      it.setSlot({ ...it.slot, position: to, opacity: 0, scale: it.slot.scale * 0.9 });
    }
  }
}

// ---------- camera rigs

const _pts = Array.from({ length: 64 }, () => new THREE.Vector3());
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

function groupRig(entries, v, region, el) {
  const target = new THREE.Vector3();
  let n = 0;
  for (const e of entries) {
    target.add(e.position);
    const hx = 1.2 * e.scale;
    const hz = 0.5 * e.scale;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) _pts[n++].set(e.position.x + sx * hx, e.position.y + sy * 1.2 * e.scale - (sy < 0 ? 0.3 : 0), e.position.z + sz * hz);
      }
    }
  }
  target.divideScalar(entries.length);
  const dist = fitDistance(_pts.slice(0, n), target, 0, el, FOV, v.H, region) * 1.03;
  return { target, az: 0, el, dist, ox: (region.left + region.right) / 2 - v.W / 2, oy: (region.top + region.bottom) / 2 - v.H / 2 };
}

function heroRig(v) {
  return groupRig(CATEGORIES.map((c, i) => { const L = heroLayout(i, v); return { position: L.local, scale: L.scale }; }), v, regionFor('hero', v), 0.18);
}

function galleryRig(cat, v) {
  const c = galleryCenter(cat, v);
  const n = cat.models.length;
  return groupRig(cat.models.map((m, j) => { const L = galleryLayout(j, n, v); return { position: L.local.clone().add(c), scale: L.scale }; }), v, regionFor('gallery', v), 0.16);
}

// Frames the current part stack; eases from a front view to a three-quarter view as it comes apart.
function detailRig(item, v) {
  item.stackCorners(_corners, false);
  const target = new THREE.Vector3();
  for (const c of _corners) target.add(c);
  target.multiplyScalar(1 / 8);
  target.sub(item.bobOffset);
  const k = reducedMotion ? 1 : smoothstep(0, 0.22, state.explodeP);
  const cfg = item.category.explode;
  const az = lerp(0, cfg.azimuth, k);
  const el = lerp(0.08, cfg.elevation, k);
  const region = regionFor('detail', v);
  const dist = fitDistance(_corners, target, az, el, FOV, v.H, region) * 1.05 * state.zoom.value;
  return { target, az, el, dist, ox: (region.left + region.right) / 2 - v.W / 2, oy: (region.top + region.bottom) / 2 - v.H / 2 };
}

function rigFor(view, v) {
  if (view === 'detail' && state.detail) return detailRig(state.detail, v);
  if (view === 'gallery' && state.category) return galleryRig(state.category, v);
  return heroRig(v);
}

const cloneRig = (r) => ({ ...r, target: r.target.clone() });
const lerpRig = (a, b, k) => ({
  target: a.target.clone().lerp(b.target, k), az: lerp(a.az, b.az, k), el: lerp(a.el, b.el, k),
  dist: lerp(a.dist, b.dist, k), ox: lerp(a.ox, b.ox, k), oy: lerp(a.oy, b.oy, k),
});

function computeRig(v) {
  if ((state.cartFlight || state.freeze) && state.rig) return state.rig;
  let r = rigFor(state.view, v);
  if (state.flight) {
    const f = state.flight;
    const k = clamp((state.t - f.start) / f.dur, 0, 1);
    const e = ease.inOutCubic(k);
    r = lerpRig(f.from, r, e);
    r.dist *= 1 + 0.06 * Math.sin(Math.PI * e);
    if (k >= 1) { state.flight = null; f.resolve(); }
  }
  const par = state.view === 'detail' ? 0.4 : 1;
  r.az += state.mouse.sx * 0.035 * par;
  r.el -= state.mouse.sy * 0.022 * par;
  return r;
}

// Camera fly-through between views; reduced motion gets a quick crossfade instead.
function flyTo(dur = 1.7) {
  if (!state.rig) return Promise.resolve();
  if (reducedMotion) return crossfade();
  sound.whoosh(dur);
  return new Promise((resolve) => { state.flight = { from: cloneRig(state.rig), start: state.t, dur, resolve }; });
}

async function crossfade() {
  state.freeze = true;
  ui.fade.classList.add('is-on');
  await wait(300);
  state.freeze = false;
  state.snapNext = true;
  await wait(80);
  ui.fade.classList.remove('is-on');
  await wait(280);
}

// ---------- items and names

const loader = {
  show() { ui.loader.classList.add('is-on'); this.set(0); },
  set(f) { ui.loaderBar.style.width = `${Math.round(clamp(f, 0, 1) * 100)}%`; },
  hide() { this.set(1); setTimeout(() => ui.loader.classList.remove('is-on'), 300); },
};

function makeName(item) {
  const el = document.createElement('div');
  el.className = 'name';
  el.style.opacity = '0';
  ui.names.appendChild(el);
  item.nameEl = el;
  item.nameO = 0;
  item.nameMode = null;
  setNameContent(item);
}

function setNameContent(item) {
  const mode = state.view === 'hero' ? 'hero' : 'gallery';
  if (item.nameMode === mode) return;
  item.nameMode = mode;
  const el = item.nameEl;
  el.textContent = '';
  const title = document.createElement('span');
  title.className = 'name-title';
  title.textContent = mode === 'hero' ? item.category.name : item.model.name;
  el.appendChild(title);
  if (mode === 'gallery') {
    const type = document.createElement('span');
    type.className = 'name-type';
    type.textContent = item.model.type;
    const price = document.createElement('small');
    price.textContent = formatPrice(item.model.price);
    el.append(type, price);
  }
}

async function ensureItem(cat, model, onProgress) {
  const id = itemId(cat, model);
  if (state.items.has(id)) return state.items.get(id);
  const prep = await buildModel(cat, model, stage.M, onProgress);
  const item = new Item(stage, prep, cat, model);
  item.drifting = true;
  state.items.set(id, item);
  makeName(item);
  return item;
}

// A category's models are built only when it is chosen, behind the thin progress line.
async function ensureCategory(cat) {
  const missing = cat.models.filter((m) => !getItem(cat, m));
  if (!missing.length) return;
  loader.show();
  for (let i = 0; i < missing.length; i++) {
    await nextFrame();
    await ensureItem(cat, missing[i], (f) => loader.set((i + f) / missing.length));
    loader.set((i + 1) / missing.length);
  }
  stage.compile();
  loader.hide();
}

// ---------- view chrome

function setChrome() {
  const { view, category: cat, detail } = state;
  body.classList.remove('view-hero', 'view-gallery', 'view-detail');
  body.classList.add(`view-${view}`);
  body.classList.toggle('has-cat', view !== 'hero');
  body.classList.toggle('has-model', view === 'detail');
  if (cat) {
    ui.crumbCat.textContent = cat.name;
    ui.galleryKicker.textContent = `${cat.models.length} models`;
    ui.galleryTitle.textContent = cat.name;
    ui.galleryHint.textContent = cat.blurb;
  }
  ui.crumbModel.textContent = detail ? detail.model.name : '';
  ui.back.setAttribute('aria-label', view === 'detail' && cat ? `Back to ${cat.name}` : 'Back to all timepieces');
  for (const it of state.items.values()) setNameContent(it);
  document.title = view === 'detail' ? `${detail.model.name} — Mainspring` : view === 'gallery' ? `${cat.name} — Mainspring` : 'Mainspring — See what makes it tick';
}

function fillSpec(item) {
  const m = item.model;
  ui.specType.textContent = m.type;
  ui.specName.textContent = m.name;
  ui.specPrice.textContent = formatPrice(m.price);
  ui.specDesc.textContent = m.description;
  ui.specList.textContent = '';
  for (const [k, val] of m.specs) {
    const row = document.createElement('div');
    row.className = 'spec-row';
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = val;
    row.append(dt, dd);
    ui.specList.appendChild(row);
  }
  ui.ctaPrice.textContent = formatPrice(m.price);
  ui.add.setAttribute('aria-label', `Add ${m.name} to cart, ${formatPrice(m.price)}`);
}

// Hidden buttons mirror the floating options for keyboard and screen reader users.
function buildOptions() {
  ui.options.textContent = '';
  state.options = [];
  state.focus = -1;
  for (const it of state.items.values()) it.focused = false;
  if (state.view === 'hero') {
    ui.options.setAttribute('aria-label', 'Choose a timepiece');
    for (const c of CATEGORIES) state.options.push({ item: getItem(c, signatureOf(c)), label: `${c.name}. ${c.blurb}`, act: () => goCategory(c) });
  } else if (state.view === 'gallery') {
    const cat = state.category;
    ui.options.setAttribute('aria-label', `${cat.name} models`);
    for (const m of cat.models) {
      state.options.push({ item: getItem(cat, m), label: `${m.name}, ${m.type}, ${formatPrice(m.price)}`, act: () => { const it = getItem(cat, m); if (it) goModel(it); } });
    }
  }
  state.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.addEventListener('click', o.act);
    b.addEventListener('focus', () => setFocus(i));
    b.addEventListener('blur', () => { if (state.focus === i) setFocus(-1); });
    ui.options.appendChild(b);
  });
}

function setFocus(i) {
  state.focus = i;
  state.options.forEach((o, j) => { if (o.item) o.item.focused = j === i; });
  updateSound();
}

function moveFocus(delta) {
  const n = state.options.length;
  if (!n) return;
  const i = state.focus < 0 ? (delta > 0 ? 0 : n - 1) : (state.focus + delta + n) % n;
  ui.options.children[i]?.focus();
}

function rateOf(item) {
  const b = item.prep.built;
  return b.rate || b.beats || 0;
}

function updateSound() {
  if (!sound) return;
  let item = null;
  if (state.view === 'detail') item = state.detail;
  else item = state.hovered || state.options[state.focus]?.item || null;
  const cat = item ? item.category : state.view === 'gallery' ? state.category : null;
  sound.setMechanism(cat ? cat.sound : null, item ? rateOf(item) : 0);
}

// ---------- transitions

function scrollTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}

function setTrack(on) {
  if (on && !reducedMotion) {
    const n = state.detail ? state.detail.parts.length : 12;
    document.documentElement.style.setProperty('--track-h', `${Math.round(n * 42 + 110)}vh`);
    body.classList.add('has-track');
  } else {
    body.classList.remove('has-track');
  }
  scrollTop();
  window.ScrollTrigger?.refresh();
}

async function goCategory(cat) {
  if (state.busy || state.view !== 'hero') return;
  state.busy = true;
  const sig = getItem(cat, signatureOf(cat));
  setHovered(null);
  if (sig) sig.selected = true;
  await ensureCategory(cat);
  if (sig) { sig.selected = false; state.driftFrom.copy(sig.base); }
  state.category = cat;
  state.view = 'gallery';
  state.galleryArc.snap(0);
  setChrome();
  buildOptions();
  updateSound();
  await flyTo(1.8);
  state.busy = false;
}

async function goModel(item) {
  if (state.busy || state.view !== 'gallery') return;
  state.busy = true;
  setHovered(null);
  state.detail = item;
  item.anchorPos = item.slot.position.clone();
  item.anchorScale = item.slot.scale;
  item.highlight = null;
  state.driftFrom.copy(item.base);
  state.view = 'detail';
  state.zoom.snap(1);
  state.scrollP = 0;
  state.explodeP = 0;
  fillSpec(item);
  labels.setParts(item.parts.map((p) => ({ key: p.key, label: p.label, info: p.info })));
  setChrome();
  buildOptions();
  setTrack(true);
  updateSound();
  await flyTo(1.6);
  state.settled = true;
  body.classList.add('is-settled');
  state.busy = false;
}

function leaveDetail() {
  const item = state.detail;
  state.settled = false;
  body.classList.remove('is-settled', 'at-top');
  ui.cta.classList.remove('is-in');
  ui.spec.classList.remove('is-open');
  ui.specHandle.setAttribute('aria-expanded', 'false');
  labels.setActive(null);
  labels.hideAll();
  state.scrollP = 0;
  state.muteUntil = state.t + 2.2;
  if (item) { item.highlight = null; state.driftFrom.copy(item.base); }
  state.detail = null;
  setTrack(false);
}

async function goGallery() {
  if (state.busy || state.view !== 'detail' || state.cartFlight) return;
  state.busy = true;
  leaveDetail();
  state.view = 'gallery';
  setChrome();
  buildOptions();
  updateSound();
  await flyTo(1.6);
  state.busy = false;
}

async function goHero() {
  if (state.busy || state.view === 'hero' || state.cartFlight) return;
  state.busy = true;
  if (state.view === 'detail') leaveDetail();
  else state.driftFrom.copy(galleryCenter(state.category, viewport()));
  state.view = 'hero';
  state.category = null;
  state.arc.snap(0);
  setChrome();
  buildOptions();
  updateSound();
  await flyTo(1.8);
  state.busy = false;
}

function back() {
  if (state.view === 'detail') goGallery();
  else if (state.view === 'gallery') goHero();
}

// ---------- hover and highlight

function setHovered(item) {
  if (state.hovered === item) return;
  if (state.hovered) state.hovered.hover = false;
  state.hovered = item;
  if (item) item.hover = true;
  ui.canvas.classList.toggle('is-pointer', !!item);
  updateSound();
}

function setPartHighlight(key) {
  const item = state.detail;
  if (!item || item.highlight === key) return;
  item.highlight = key;
  labels.setActive(key);
  ui.canvas.classList.toggle('is-pointer', !!key);
}

// ---------- cart

function lockScroll(on) {
  if (lenis) { if (on) lenis.stop(); else lenis.start(); }
  document.documentElement.style.overflow = on && !lenis ? 'hidden' : '';
}

// The parts collapse back together, then the whole timepiece shrinks and arcs into the cart icon.
async function addToCart() {
  const item = state.detail;
  if (!item || state.cartFlight || state.busy) return;
  state.cartFlight = true;
  state.collapse = true;
  ui.cta.classList.remove('is-in');
  setPartHighlight(null);
  sound.click();
  sound.whoosh(1.4);
  const r = ui.cartBtn.getBoundingClientRect();
  const p = new THREE.Vector3(((r.left + r.width / 2) / stage.width) * 2 - 1, -(((r.top + r.height / 2) / stage.height) * 2 - 1), 0.5);
  p.unproject(stage.camera);
  const cam = stage.camera.position;
  const to = cam.clone().add(p.sub(cam).normalize().multiplyScalar(3.2));
  await wait(reducedMotion ? 0 : 420);
  const from = item.holder.position.clone();
  const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, from.distanceTo(to) * 0.3, 0));
  await item.flyTo(state.t, reducedMotion ? 0.05 : 1.15, to, ctrl);
  shop.add(item.category, item.model);
  await wait(160);
  shop.openDrawer();
  lockScroll(true);
}

// After the cart closes, the flown model reappears assembled where it was.
function restoreAfterCart() {
  const item = state.detail;
  if (state.cartFlight && item) {
    item.restore();
    scrollTop();
    state.scrollP = 0;
    state.explodeP = 0;
    state.muteUntil = state.t + 0.8;
  }
  state.cartFlight = false;
  state.collapse = false;
}

function onDrawerClose(mode) {
  shop.closeDrawer();
  if (mode === 'explore' && shop.checkoutOpen) { shop.closeCheckout(); body.classList.remove('is-checkout'); }
  if (!shop.checkoutOpen) lockScroll(false);
  restoreAfterCart();
  if (mode === 'explore' && state.view === 'detail') goGallery();
}

function onCartButton() {
  if (shop.drawerOpen) { onDrawerClose('close'); return; }
  shop.openDrawer();
  lockScroll(true);
}

function onCheckout() {
  shop.closeDrawer();
  shop.openCheckout();
  state.checkoutAt = state.t;
  body.classList.add('is-checkout');
  lockScroll(true);
}

function closeCheckout() {
  shop.closeCheckout();
  body.classList.remove('is-checkout');
  lockScroll(false);
  restoreAfterCart();
}

function onDone() {
  shop.clear();
  closeCheckout();
  goHero();
}

// ---------- picking

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setRay(x, y) {
  ndc.set((x / stage.width) * 2 - 1, -(y / stage.height) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);
}

function pickItem(x, y) {
  setRay(x, y);
  const proxies = [];
  for (const it of state.items.values()) if (it.visible && !it.drifting && it.alpha.value > 0.5) proxies.push(it.proxy);
  const hit = raycaster.intersectObjects(proxies, false)[0];
  return hit ? hit.object.userData.item : null;
}

function pickPart(x, y) {
  const item = state.detail;
  if (!item) return null;
  setRay(x, y);
  for (const h of raycaster.intersectObject(item.prep.root, true)) {
    for (let o = h.object; o; o = o.parent) if (o.userData && o.userData.partKey) return o.userData.partKey;
  }
  return null;
}

const modalOpen = () => shop.drawerOpen || shop.checkoutOpen;

function processHover() {
  const h = state.hoverAt;
  state.hoverAt = null;
  if (state.busy || state.dragging || modalOpen() || state.cartFlight) return;
  if (state.view === 'detail') { if (state.settled) setPartHighlight(pickPart(h.x, h.y)); return; }
  setHovered(pickItem(h.x, h.y));
}

// ---------- pointer input: drag rotates (arc or model) with inertia, pinch zooms, tap selects

const pointers = new Map();
let drag = null;
let pinch = null;

function onDown(e) {
  if (modalOpen()) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { ui.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (pointers.size === 2 && state.view === 'detail') {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: state.zoom.target };
    drag = null;
    return;
  }
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false, type: e.pointerType };
}

function applyDrag(dx, dy) {
  if (state.view === 'detail' && state.detail) {
    state.detail.userYaw += dx * 0.008;
    if (drag.type === 'mouse') state.detail.userPitch += dy * 0.005;
  } else if (!state.busy) {
    const s = state.view === 'hero' ? state.arc : state.galleryArc;
    s.snap(clamp(s.value + dx * 0.0028, -0.7, 0.7));
  }
}

function onMove(e) {
  if (e.pointerType === 'mouse') {
    state.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    state.zoom.target = clamp(pinch.z0 * (pinch.d0 / (Math.hypot(a.x - b.x, a.y - b.y) || 1)), 0.5, 1.7);
    return;
  }
  if (drag && e.pointerId === drag.id) {
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dts = Math.max(1, now - drag.t) / 1000;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
      drag.moved = true;
      state.dragging = true;
      body.classList.add('is-dragging');
      setHovered(null);
    }
    if (drag.moved) {
      drag.vx = lerp(drag.vx, dx / dts, 0.5);
      drag.vy = lerp(drag.vy, dy / dts, 0.5);
      applyDrag(dx, dy);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    return;
  }
  if (e.pointerType === 'mouse' && e.target === ui.canvas) state.hoverAt = { x: e.clientX, y: e.clientY };
}

function handleTap(x, y, type) {
  if (state.busy || state.cartFlight) return;
  if (state.view === 'detail') {
    if (type !== 'mouse') {
      const key = pickPart(x, y);
      setPartHighlight(state.detail && state.detail.highlight === key ? null : key);
    }
    return;
  }
  const item = pickItem(x, y);
  if (!item) return;
  if (state.view === 'hero') goCategory(item.category);
  else if (state.view === 'gallery') goModel(item);
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  state.dragging = false;
  body.classList.remove('is-dragging');
  if (e.type === 'pointercancel') return;
  if (!d.moved) { handleTap(e.clientX, e.clientY, d.type); return; }
  if (state.view === 'detail' && state.detail) {
    state.detail.yawVel = clamp(d.vx * 0.008, -9, 9);
    if (d.type === 'mouse') state.detail.pitchVel = clamp(d.vy * 0.005, -4, 4);
  } else {
    const s = state.view === 'hero' ? state.arc : state.galleryArc;
    s.velocity = clamp(d.vx * 0.0028, -2, 2);
    s.target = 0;
  }
}

const zoomBy = (f) => { state.zoom.target = clamp(state.zoom.target * f, 0.5, 1.7); };

function onKey(e) {
  if (e.key === 'Escape') {
    if (shop.checkoutOpen) { closeCheckout(); return; }
    if (shop.drawerOpen) { onDrawerClose('close'); return; }
    if (state.view === 'detail' && state.detail && state.detail.highlight) { setPartHighlight(null); return; }
    back();
    return;
  }
  if (modalOpen()) return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (state.view === 'hero' || state.view === 'gallery') {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  } else if (state.view === 'detail' && state.detail) {
    if (e.key === '+' || e.key === '=') zoomBy(0.85);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 0.85);
    else if (e.key === 'ArrowLeft') state.detail.yawVel -= 2.5;
    else if (e.key === 'ArrowRight') state.detail.yawVel += 2.5;
  }
}

function toggleSheet(open) {
  const isOpen = open ?? !ui.spec.classList.contains('is-open');
  ui.spec.classList.toggle('is-open', isOpen);
  ui.specHandle.setAttribute('aria-expanded', String(isOpen));
}

function wireUI() {
  ui.canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  ui.canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    setHovered(null);
    if (state.view === 'detail') setPartHighlight(null);
  });
  window.addEventListener('wheel', (e) => {
    if (state.view === 'detail' && e.ctrlKey) { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.01)); }
  }, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { stage.resize(); labels.measure(); window.ScrollTrigger?.refresh(); });

  ui.back.addEventListener('click', back);
  ui.crumbHome.addEventListener('click', () => { if (shop.checkoutOpen) closeCheckout(); goHero(); });
  ui.crumbCat.addEventListener('click', () => { if (state.view === 'detail') goGallery(); });
  ui.wordmark.addEventListener('click', (e) => {
    e.preventDefault();
    if (shop.checkoutOpen) closeCheckout();
    if (shop.drawerOpen) onDrawerClose('close');
    goHero();
  });
  ui.sound.addEventListener('click', async () => {
    const on = ui.sound.getAttribute('aria-pressed') !== 'true';
    ui.sound.setAttribute('aria-pressed', String(on));
    ui.sound.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
    await sound.setEnabled(on);
    updateSound();
  });
  ui.zoomIn.addEventListener('click', () => zoomBy(0.85));
  ui.zoomOut.addEventListener('click', () => zoomBy(1 / 0.85));
  ui.add.addEventListener('click', addToCart);

  // Mobile spec sheet: tap the handle or swipe it up and down.
  let sheetY = null;
  let swiped = 0;
  ui.specHandle.addEventListener('pointerdown', (e) => { sheetY = e.clientY; });
  window.addEventListener('pointerup', (e) => {
    if (sheetY === null) return;
    const dy = e.clientY - sheetY;
    sheetY = null;
    if (Math.abs(dy) > 24) { toggleSheet(dy < 0); swiped = performance.now(); }
  });
  ui.specHandle.addEventListener('click', () => { if (performance.now() - swiped > 350) toggleSheet(); });
}

// ---------- per-frame overlays

const _s = { x: 0, y: 0, ok: true };
const _w = new THREE.Vector3();
const _c = new THREE.Vector3();
const labelStates = new Map();

function onSnap(item, part) {
  if (item !== state.detail || state.t < state.muteUntil || state.collapse) return;
  sound.click();
  stage.shimmer(item.partCenter(part, _c), 12, 0.35 * item.holder.scale.x);
}

function updateNames(dt) {
  const show = (state.view === 'hero' || state.view === 'gallery') && !state.flight;
  const hoverOnly = state.view === 'gallery' && !isTouch;
  for (const it of state.items.values()) {
    const base = show && it.visible && !it.drifting ? clamp(it.alpha.value, 0, 1) : 0;
    const target = hoverOnly && !(it.hover || it.focused) ? 0 : base;
    it.nameO = damp(it.nameO, target, target > it.nameO ? 6 : 14, dt);
    const el = it.nameEl;
    if (it.nameO < 0.01) {
      if (el.style.opacity !== '0') el.style.opacity = '0';
      continue;
    }
    const s = it.holder.scale.x;
    _w.set(it.holder.position.x, it.holder.position.y - 1.32 * s, it.holder.position.z);
    stage.toScreen(_w, _s);
    el.style.transform = `translate3d(${_s.x.toFixed(1)}px, ${(_s.y + 8).toFixed(1)}px, 0) translate(-50%, 0)`;
    el.style.opacity = it.nameO.toFixed(3);
    el.classList.toggle('is-hot', it.hover || it.focused);
    el.classList.toggle('is-focus', it.focused);
  }
}

function updateDetailUI(dt, v) {
  const item = state.detail;
  if (!item) return;
  const p = state.collapse ? 0 : state.explodeP;
  let count = 0;
  for (const part of item.parts) if (part.frac >= 0.5) count++;
  ui.progressFill.style.transform = `scaleX(${p.toFixed(4)})`;
  const txt = `${String(count).padStart(2, '0')} / ${String(item.parts.length).padStart(2, '0')}`;
  if (ui.progressCount.textContent !== txt) ui.progressCount.textContent = txt;
  body.classList.toggle('at-top', !reducedMotion && p < 0.015);
  const rows = ui.specList.children;
  for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('is-in', reducedMotion || p >= 0.05 + (i * 0.8) / rows.length);
  ui.cta.classList.toggle('is-in', state.settled && !state.cartFlight && (reducedMotion || p > 0.965));
  stage.toScreen(state.rig.target, _s);
  document.documentElement.style.setProperty('--model-x', `${Math.round(_s.x)}px`);
  if (!state.settled || state.cartFlight) { labels.hideAll(); return; }

  // Each label anchors to its part's leftmost visible edge (or a live point like the minute hand's tip).
  labelStates.clear();
  for (const part of item.parts) {
    const vis = reducedMotion ? 1 : smoothstep(0.55, 0.92, part.frac);
    if (vis < 0.02) continue;
    let ax = Infinity;
    let ay = 0;
    if (part.anchor) {
      _w.copy(part.anchor.local).applyMatrix4(part.anchor.obj.matrixWorld);
      stage.toScreen(_w, _s);
      ax = _s.x;
      ay = _s.y;
    } else {
      for (const sp of part.support) {
        _w.copy(sp).applyMatrix4(part.group.matrixWorld);
        stage.toScreen(_w, _s);
        if (_s.x < ax) { ax = _s.x; ay = _s.y; }
      }
    }
    if (ax === Infinity) continue;
    labelStates.set(part.key, { ax, ay, vis, draw: reducedMotion ? 1 : smoothstep(0.62, 1, part.frac) });
  }
  labels.update(labelStates, { top: v.bar + 16, bottom: v.H - (v.mobile ? 200 : 40), minCol: v.mobile ? 10 : 28, dt });
}

// ---------- frame loop

const env = { cameraPos: new THREE.Vector3(), reducedMotion: false, live: { now: 0, spin: 0 }, dragging: false, onSnap };

function frame(dtRaw) {
  if (!stage || document.hidden) return;
  const dt = clamp(dtRaw || 0, 0, 1 / 20);
  state.t += dt;
  if (shop.checkoutOpen && state.t - state.checkoutAt > 0.9) return;
  const v = viewport();

  state.mouse.sx = damp(state.mouse.sx, isTouch ? 0 : state.mouse.x, 2.5, dt);
  state.mouse.sy = damp(state.mouse.sy, isTouch ? 0 : state.mouse.y, 2.5, dt);
  const wantP = state.view === 'detail' ? (reducedMotion ? 1 : state.scrollP) : 0;
  state.explodeP = reducedMotion ? wantP : damp(state.explodeP, wantP, 10, dt);
  state.arc.update(dt);
  state.galleryArc.update(dt);
  state.zoom.update(dt);
  if (state.hoverAt) processHover();

  if (!state.freeze) assignSlots(v);
  if (state.snapNext && !state.freeze) {
    for (const it of state.items.values()) { it.snap(1); it.alpha.snap(it.slot.opacity); }
    state.snapNext = false;
  }

  const d = state.detail;
  for (const it of state.items.values()) {
    if (it === d && !state.collapse) {
      it.stackCorners(_corners, true);
      let minY = Infinity;
      for (const c of _corners) minY = Math.min(minY, c.y);
      it.floorOverride = minY - 0.35;
      it.shadowSizeOverride = it.shadowBase * it.holder.scale.x * 1.1;
    } else {
      it.floorOverride = null;
      it.shadowSizeOverride = null;
    }
  }

  env.cameraPos.copy(stage.camera.position);
  env.reducedMotion = reducedMotion;
  env.dragging = state.dragging;
  env.live.now = Date.now();
  for (const it of state.items.values()) {
    const active = it === d && !state.collapse;
    env.live.spin = active ? it.yawVel * 0.15 : 0;
    it.update(state.t, dt, env);
    it.updateExplode(state.t, dt, env, active ? state.explodeP : 0, active);
  }

  state.rig = computeRig(v);
  stage.applyRig(state.rig);
  stage.render(dt);
  updateNames(dt);
  if (state.view === 'detail') updateDetailUI(dt, v);
}

function startLoop() {
  if (window.gsap) {
    window.gsap.ticker.lagSmoothing(0);
    window.gsap.ticker.add((time, deltaMs) => {
      if (lenis) lenis.raf(time * 1000);
      frame(deltaMs / 1000);
    });
    return;
  }
  let last = performance.now();
  const loop = (now) => {
    if (lenis) lenis.raf(now);
    frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Lenis smooths the scroll; ScrollTrigger turns scroll position into explode progress.
function setupScroll() {
  if (window.Lenis && !reducedMotion) {
    try { lenis = new window.Lenis({ duration: 1.1, smoothWheel: true, wheelMultiplier: 0.9 }); }
    catch (err) { lenis = null; }
  }
  const fallback = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  };
  if (window.gsap && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    if (lenis) lenis.on('scroll', window.ScrollTrigger.update);
    window.ScrollTrigger.create({
      trigger: '#scroll-track', start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => { if (state.view === 'detail' && !state.cartFlight) state.scrollP = self.progress; },
    });
  } else {
    window.addEventListener('scroll', () => { if (state.view === 'detail' && !state.cartFlight) state.scrollP = fallback(); }, { passive: true });
  }
}

async function boot() {
  try {
    stage = new Stage(ui.canvas);
  } catch (err) {
    console.error(err);
    ui.webglError.hidden = false;
    ui.canvas.style.display = 'none';
    body.classList.remove('is-booting');
    return;
  }
  setRenderer(stage.renderer);
  sound = new Sound();
  labels = new Labels($('#labels'), $('#leaders'), (key) => setPartHighlight(key));
  shop = new Shop({ onDrawerClose, onCheckout, onCartButton, onDone });
  body.classList.add('view-hero');
  setupScroll();
  wireUI();
  state.rig = heroRig(viewport());
  stage.applyRig(state.rig);
  startLoop();

  loader.show();
  for (let i = 0; i < CATEGORIES.length; i++) {
    await nextFrame();
    const c = CATEGORIES[i];
    try { await ensureItem(c, signatureOf(c)); } catch (err) { console.error(`[mainspring] ${c.name} failed to build`, err); }
    loader.set((i + 1) / CATEGORIES.length);
  }
  stage.compile();
  loader.hide();
  setChrome();
  buildOptions();
  state.bootT = state.t + 0.1;
  body.classList.remove('is-booting');
  setTimeout(() => { stage.measure = true; }, 3000);
  if (window.__MS_TEST__) window.__MS_TEST__.expose({ state, stage, ui, shop });
}

boot();
