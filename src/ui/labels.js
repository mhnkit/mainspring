const NS = 'http://www.w3.org/2000/svg';

// Stack label boxes in one column without overlaps, keeping each as close to its anchor as possible.
// items: [{ desired, h }] sorted by desired (anchor y). Returns the top y of each box.
export function layoutColumn(items, top, bottom, gap) {
  const ys = items.map((it) => it.desired - it.h / 2);
  for (let i = 0; i < ys.length; i++) {
    if (i > 0) ys[i] = Math.max(ys[i], ys[i - 1] + items[i - 1].h + gap);
    ys[i] = Math.max(ys[i], top);
  }
  for (let i = ys.length - 1; i >= 0; i--) {
    const limit = i === ys.length - 1 ? bottom - items[i].h : ys[i + 1] - gap - items[i].h;
    ys[i] = Math.min(ys[i], limit);
  }
  for (let i = 0; i < ys.length; i++) {
    ys[i] = i === 0 ? Math.max(ys[i], top) : Math.max(ys[i], ys[i - 1] + items[i - 1].h + gap);
  }
  return ys;
}

// Labels sit in a column on the left, each with a leader line that draws in toward a brass dot on its part.
export class Labels {
  constructor(container, svg, onHover) {
    this.container = container;
    this.svg = svg;
    this.onHover = onHover;
    this.entries = [];
    this.active = null;
    this.colX = null;
  }

  setParts(list) {
    this.clear();
    for (const p of list) {
      const el = document.createElement('div');
      el.className = 'label';
      const title = document.createElement('span');
      title.className = 'label-title';
      title.textContent = p.label;
      const info = document.createElement('span');
      info.className = 'label-info';
      info.textContent = p.info;
      el.append(title, info);
      el.style.visibility = 'hidden';
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.onHover(p.key); });
      el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.onHover(null); });
      el.addEventListener('click', () => this.onHover(this.active === p.key ? null : p.key));
      this.container.appendChild(el);
      const path = document.createElementNS(NS, 'path');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.6');
      path.style.opacity = '0';
      dot.style.opacity = '0';
      this.svg.append(path, dot);
      this.entries.push({ key: p.key, el, title, info, path, dot, w: 0, h: 16, extra: 0, shown: false });
    }
    this.measure();
  }

  measure() {
    for (const e of this.entries) {
      e.w = e.el.offsetWidth || 120;
      e.h = e.title.offsetHeight || 16;
    }
  }

  setActive(key) {
    this.active = key;
    for (const e of this.entries) {
      const on = e.key === key;
      const dim = !!key && !on;
      e.el.classList.toggle('is-active', on);
      e.el.classList.toggle('is-dim', dim);
      e.path.classList.toggle('is-active', on);
      e.path.classList.toggle('is-dim', dim);
      e.dot.classList.toggle('is-dim', dim);
      e.extra = on ? e.info.scrollHeight + 6 : 0;
    }
  }

  clear() {
    this.container.textContent = '';
    while (this.svg.firstChild) this.svg.firstChild.remove();
    this.entries = [];
    this.active = null;
    this.colX = null;
  }

  hideAll() {
    for (const e of this.entries) this._hide(e);
  }

  _hide(e) {
    if (!e.shown) return;
    e.shown = false;
    e.el.style.visibility = 'hidden';
    e.path.style.opacity = '0';
    e.dot.style.opacity = '0';
  }

  // states: Map key → { ax, ay, vis, draw } in screen px. bounds: { top, bottom, minCol, dt }
  update(states, bounds) {
    const shown = [];
    let minAx = Infinity;
    let maxW = 0;
    for (const e of this.entries) {
      const s = states.get(e.key);
      if (!s || s.vis < 0.02) { this._hide(e); continue; }
      shown.push({ e, s, desired: s.ay, h: e.h + e.extra });
      minAx = Math.min(minAx, s.ax);
      maxW = Math.max(maxW, e.w);
    }
    if (!shown.length) return;
    const target = Math.max(bounds.minCol + maxW, minAx - 48);
    this.colX = this.colX === null ? target : this.colX + (target - this.colX) * Math.min(1, bounds.dt * 6);
    shown.sort((a, b) => a.desired - b.desired);
    const ys = layoutColumn(shown, bounds.top, bounds.bottom, 8);
    const col = this.colX;
    shown.forEach(({ e, s }, i) => {
      const y = ys[i];
      e.shown = true;
      e.el.style.visibility = 'visible';
      e.el.style.opacity = s.vis.toFixed(3);
      e.el.style.transform = `translate3d(${(col - e.w).toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const cy = y + e.h / 2;
      const ex = col + 22;
      const len = 14 + Math.hypot(s.ax - ex, s.ay - cy);
      e.path.setAttribute('d', `M${(col + 8).toFixed(1)} ${cy.toFixed(1)}L${ex.toFixed(1)} ${cy.toFixed(1)}L${s.ax.toFixed(1)} ${s.ay.toFixed(1)}`);
      e.path.style.strokeDasharray = `${len.toFixed(1)} ${len.toFixed(1)}`;
      e.path.style.strokeDashoffset = (len * (1 - s.draw)).toFixed(1);
      e.path.style.opacity = s.vis.toFixed(3);
      e.dot.setAttribute('cx', s.ax.toFixed(1));
      e.dot.setAttribute('cy', s.ay.toFixed(1));
      e.dot.style.opacity = s.draw.toFixed(3);
    });
  }
}
