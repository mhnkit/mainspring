import * as THREE from 'three';
import { Spring, Spring3, clamp, smoothstep, seeded, ease, lerp } from './lib/springs.js';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/*
 * Hierarchy: holder (world placement, float, sway) → spin (user drag) → tilt (explode tilt) → fit (scale, center) → model root.
 * Parts move along the model's +Z axis inside the tilt, so they rise when the model is tipped back.
 */
export class Item {
  constructor(stage, prep, category, model) {
    this.stage = stage;
    this.prep = prep;
    this.category = category;
    this.model = model;
    this.id = `${category.id}/${model.id}`;

    this.holder = new THREE.Group();
    this.spin = new THREE.Group();
    this.tilt = new THREE.Group();
    this.fit = new THREE.Group();
    this.holder.add(this.spin);
    this.spin.add(this.tilt);
    this.tilt.add(this.fit);
    this.fit.add(prep.root);
    const s = prep.fit.scale;
    this.fit.scale.setScalar(s);
    this.fit.position.copy(prep.fit.center).multiplyScalar(-s);
    this.holder.visible = false;
    stage.scene.add(this.holder);

    const size = prep.fit.size;
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.8, size.x * s), Math.max(0.8, size.y * s), 1.2), stage.proxyMaterial);
    this.proxy.visible = false;
    this.proxy.userData.item = this;
    this.holder.add(this.proxy);

    this.shadow = stage.makeShadow();
    this.shadowBase = Math.max(size.x * s, size.y * s * 0.5) * 0.95;
    this.shadowY = null;
    this.floorOverride = null;
    this.shadowSizeOverride = null;

    const rnd = seeded(this.id);
    this.bobW = 0.5 + rnd() * 0.35;
    this.bobP = rnd() * TAU;
    this.swayW = 0.15 + rnd() * 0.12;
    this.swayP = rnd() * TAU;
    this.rollW = 0.28 + rnd() * 0.2;
    this.rollP = rnd() * TAU;

    this.base = new THREE.Vector3();
    this.pos = new Spring3({ x: 0, y: 0, z: 0 }, 30, 0.88);
    this.yaw = new Spring(0, 26, 0.85);
    this.pitch = new Spring(0, 26, 0.9);
    this.scale = new Spring(1, 36, 0.78);
    this.alpha = new Spring(0, 22, 1);
    this.lift = new Spring(0, 80, 0.62);
    this.slot = { position: new THREE.Vector3(), yaw: 0, pitch: 0, scale: 1, opacity: 0, float: 0.08, sway: 0, floor: 1.55 };
    this.everShown = false;
    this.visible = false;
    this.hover = false;
    this.focused = false;
    this.selected = false;
    this.fly = null;
    this.bobOffset = new THREE.Vector3();

    this.parts = prep.parts.map((p) => ({
      ...p,
      spring: new Spring(0, 150, 0.6),
      dim: new Spring(1, 50, 1),
      frac: 0,
      out: false,
      applied: -1,
      bobW: 0.7 + rnd() * 0.6,
      bobP: rnd() * TAU,
    }));
    this.tiltS = new Spring(0, 36, 0.92);
    this.highlight = null;
    this.userYaw = 0;
    this.userPitch = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.resting = true;
  }

  setSlot(s) {
    const d = this.slot;
    d.position.copy(s.position);
    d.yaw = s.yaw ?? 0;
    d.pitch = s.pitch ?? 0;
    d.scale = s.scale ?? 1;
    d.opacity = s.opacity ?? 1;
    d.float = s.float ?? 0.08;
    d.sway = s.sway ?? 0;
    d.floor = s.floor ?? 1.55;
  }

  snap(scaleFactor = 1) {
    this.pos.snap(this.slot.position);
    this.base.copy(this.slot.position);
    this.yaw.snap(this.slot.yaw);
    this.pitch.snap(this.slot.pitch);
    this.scale.snap(this.slot.scale * scaleFactor);
  }

  update(t, dt, env) {
    const sl = this.slot;
    this.pos.setTarget(sl.position);
    this.pos.update(dt, this.base);
    this.yaw.target = sl.yaw;
    this.yaw.update(dt);
    this.pitch.target = sl.pitch;
    this.pitch.update(dt);
    this.scale.target = sl.scale;
    this.scale.update(dt);
    this.alpha.target = sl.opacity;
    this.alpha.update(dt);
    this.lift.target = this.hover || this.focused || this.selected ? 1 : 0;
    this.lift.update(dt);

    let a = clamp(this.alpha.value, 0, 1);
    let sc = Math.max(1e-3, this.scale.value * (1 + 0.045 * this.lift.value));
    const rm = env.reducedMotion;
    const bob = rm ? 0 : sl.float * Math.sin(t * this.bobW + this.bobP);
    const sway = rm ? 0 : sl.sway * Math.sin(t * this.swayW + this.swayP);
    const roll = rm ? 0 : sl.float * 0.35 * Math.sin(t * this.rollW + this.rollP);
    const L = this.lift.value;
    _v.copy(env.cameraPos).sub(this.base);
    const d = _v.length() || 1;
    const h = this.holder;
    h.position.copy(this.base).addScaledVector(_v, (L * 0.45) / d);
    h.position.y += bob + L * 0.08;
    h.rotation.set(this.pitch.value + roll, this.yaw.value + sway, roll * 0.5);
    this.bobOffset.copy(h.position).sub(this.base);
    h.scale.setScalar(sc);

    if (this.fly) {
      const f = this.fly;
      const k = clamp((t - f.start) / f.dur, 0, 1);
      const e = ease.inOutCubic(k);
      const u = 1 - e;
      h.position.set(
        u * u * f.from.x + 2 * u * e * f.ctrl.x + e * e * f.to.x,
        u * u * f.from.y + 2 * u * e * f.ctrl.y + e * e * f.to.y,
        u * u * f.from.z + 2 * u * e * f.ctrl.z + e * e * f.to.z,
      );
      sc = f.scale * lerp(1, 0.03, ease.inCubic(k));
      h.scale.setScalar(sc);
      h.rotation.y += 2.4 * ease.inCubic(k);
      a *= 1 - smoothstep(0.8, 1, k);
      if (k >= 1 && !f.done) { f.done = true; f.resolve(); }
    }

    const visible = a > 0.003;
    h.visible = visible;
    this.shadow.visible = visible && !this.fly;
    this.visible = visible;
    if (!visible) return false;
    this.everShown = true;

    // Contact shadow on an invisible floor: it shrinks and fades as the object floats up.
    const floorT = this.floorOverride ?? sl.position.y - sl.floor * sc;
    this.shadowY = this.shadowY === null ? floorT : this.shadowY + (floorT - this.shadowY) * Math.min(1, dt * 5);
    const rest = this.floorOverride != null ? this.base.y - floorT : sl.floor * sc;
    const k = clamp(1 + (h.position.y - this.shadowY - rest) * 2.0, 0.5, 1.6);
    const size = (this.shadowSizeOverride ?? this.shadowBase * sc) * (1 - 0.22 * (k - 1));
    this.shadow.position.set(h.position.x, this.shadowY, h.position.z);
    this.shadow.scale.set(size, size * 0.7, 1);
    this.shadow.material.opacity = a * 0.4 * clamp(1 - 0.6 * (k - 1), 0.2, 1.3);

    this.applyOpacity(a);
    this.prep.built.update(t, dt, env.live);
    return true;
  }

  applyOpacity(a) {
    for (const part of this.parts) {
      const o = a * part.dim.value;
      if (Math.abs(o - part.applied) < 0.002) continue;
      part.applied = o;
      for (const m of part.mats) {
        m.opacity = m.userData.base * o;
        m.depthWrite = m.userData.depthWriteBase && o > 0.985;
      }
    }
  }

  // p: explode progress 0..1. Only the detail item is `active`; others ease back to assembled.
  updateExplode(t, dt, env, p, active) {
    if (!active && this.resting) return;
    const rm = env.reducedMotion && active;
    const cfg = this.category.explode;
    this.tiltS.target = active ? cfg.tilt * (rm ? 1 : smoothstep(0, 0.14, p)) : 0;
    if (rm) this.tiltS.snap(this.tiltS.target);
    else this.tiltS.update(dt);
    this.tilt.rotation.x = this.tiltS.value;

    if (active) {
      if (!env.dragging) {
        this.userYaw += this.yawVel * dt;
        this.userPitch += this.pitchVel * dt;
        const k = Math.exp(-(rm ? 30 : 3.2) * dt);
        this.yawVel *= k;
        this.pitchVel *= k;
      }
      this.userPitch = clamp(this.userPitch, -0.6, 0.6);
    } else {
      this.userYaw = wrap(this.userYaw) * Math.exp(-4 * dt);
      this.userPitch *= Math.exp(-4 * dt);
      this.yawVel = 0;
      this.pitchVel = 0;
    }
    this.spin.rotation.set(this.userPitch, this.userYaw, 0, 'YXZ');

    let resting = !active && Math.abs(this.tiltS.value) < 1e-4 && Math.abs(this.userYaw) < 1e-4 && Math.abs(this.userPitch) < 1e-4;
    for (const part of this.parts) {
      const x = clamp((p - part.a) / (part.b - part.a), 0, 1);
      const f = rm ? 1 : 1 - (1 - x) * (1 - x);
      const target = active ? part.offset * f : 0;
      const s = part.spring;
      s.target = target;
      if (rm) s.snap(target);
      else s.update(dt);
      // A tiny overshoot past home, never more.
      const lim = Math.abs(part.offset) * 0.05;
      if (part.offset > 0 && s.value < -lim) { s.value = -lim; s.velocity = Math.abs(s.velocity) * 0.25; }
      else if (part.offset < 0 && s.value > lim) { s.value = lim; s.velocity = -Math.abs(s.velocity) * 0.25; }
      part.frac = part.offset ? clamp(s.value / part.offset, 0, 1) : 0;
      const amp = env.reducedMotion ? 0 : this.prep.bobAmp * smoothstep(0.4, 1, part.frac);
      part.group.position.z = s.value + amp * Math.sin(t * part.bobW + part.bobP);
      if (part.frac > 0.3) part.out = true;
      if (part.out && target === 0 && Math.abs(s.value) < Math.abs(part.offset) * 0.02) {
        part.out = false;
        env.onSnap(this, part);
      }
      part.dim.target = active && this.highlight && this.highlight !== part.key ? 0.14 : 1;
      part.dim.update(dt);
      if (Math.abs(s.value) > 1e-4 || Math.abs(s.velocity) > 1e-3 || target !== 0 || part.dim.value < 0.999) resting = false;
    }
    if (resting) for (const part of this.parts) part.group.position.z = 0;
    this.resting = resting;
  }

  // World-space corners of the current part stack (spin optional, so framing ignores drag rotation).
  stackCorners(out, withSpin = false) {
    const b = this.prep.fit.box;
    let lo = Infinity;
    let hi = -Infinity;
    for (const part of this.parts) {
      const z = part.spring.value;
      lo = Math.min(lo, part.minZ + z);
      hi = Math.max(hi, part.maxZ + z);
    }
    this.holder.updateMatrix();
    this.spin.updateMatrix();
    this.tilt.updateMatrix();
    this.fit.updateMatrix();
    _m.copy(this.holder.matrix);
    if (withSpin) _m.multiply(this.spin.matrix);
    _m.multiply(this.tilt.matrix).multiply(this.fit.matrix);
    let i = 0;
    for (const x of [b.min.x, b.max.x]) {
      for (const y of [b.min.y, b.max.y]) {
        for (const z of [lo, hi]) out[i++].set(x, y, z).applyMatrix4(_m);
      }
    }
    return out;
  }

  partCenter(part, out) {
    part.box.getCenter(out);
    return out.applyMatrix4(part.group.matrixWorld);
  }

  flyTo(t, dur, to, ctrl) {
    return new Promise((resolve) => {
      this.fly = { start: t, dur, from: this.holder.position.clone(), to, ctrl, scale: this.holder.scale.x, resolve, done: false };
    });
  }

  // Bring the item back after it flew into the cart: assembled, fading in at its slot.
  restore() {
    this.fly = null;
    this.alpha.snap(0);
    this.snap(0.85);
    for (const part of this.parts) {
      part.spring.snap(0);
      part.out = false;
      part.group.position.z = 0;
    }
  }
}
