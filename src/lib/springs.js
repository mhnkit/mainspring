// Damped springs used for every movement. dampingRatio < 1 gives a soft overshoot before settling.
export class Spring {
  constructor(value = 0, stiffness = 90, dampingRatio = 0.82) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.dampingRatio = dampingRatio;
  }

  snap(v = this.target) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
    return this;
  }

  update(dt) {
    const k = this.stiffness;
    const c = 2 * this.dampingRatio * Math.sqrt(k);
    const steps = Math.min(16, Math.max(1, Math.ceil(dt / 0.008)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  settled(eps = 1e-3) {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps;
  }
}

export class Spring3 {
  constructor(v = { x: 0, y: 0, z: 0 }, stiffness = 90, dampingRatio = 0.82) {
    this.x = new Spring(v.x, stiffness, dampingRatio);
    this.y = new Spring(v.y, stiffness, dampingRatio);
    this.z = new Spring(v.z, stiffness, dampingRatio);
  }
  setTarget(v) { this.x.target = v.x; this.y.target = v.y; this.z.target = v.z; }
  snap(v) { this.x.snap(v.x); this.y.snap(v.y); this.z.snap(v.z); }
  setParams(stiffness, dampingRatio) {
    for (const s of [this.x, this.y, this.z]) { s.stiffness = stiffness; s.dampingRatio = dampingRatio; }
  }
  update(dt, out) {
    out.set(this.x.update(dt), this.y.update(dt), this.z.update(dt));
    return out;
  }
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export const ease = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
};

// Deterministic pseudo-random so floating phases are stable per object.
export function seeded(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
