import * as THREE from 'three';

// Every part material is created with transparent: true so parts can fade and dim
// without shader recompiles. Glass is additive: it only adds reflections on top.
export function createMaterials() {
  const std = (p) => new THREE.MeshStandardMaterial({ transparent: true, ...p });

  const M = {
    steel: std({ color: 0xd3d6da, metalness: 1, roughness: 0.24 }),
    steelBrushed: std({ color: 0xc5c8cc, metalness: 1, roughness: 0.4 }),
    steelDark: std({ color: 0x6a6e74, metalness: 1, roughness: 0.36 }),
    gunmetal: std({ color: 0x3e4146, metalness: 0.9, roughness: 0.42 }),
    brass: std({ color: 0xd2ad72, metalness: 1, roughness: 0.3 }),
    brassDark: std({ color: 0xb08d57, metalness: 1, roughness: 0.38 }),
    gold: std({ color: 0xe2c48c, metalness: 1, roughness: 0.22 }),
    copper: std({ color: 0xc27b4c, metalness: 1, roughness: 0.34 }),
    blued: std({ color: 0x2f4f96, metalness: 1, roughness: 0.2 }),
    ruby: std({ color: 0xb01a36, metalness: 0.1, roughness: 0.12 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x000000, metalness: 0, roughness: 0.04, envMapIntensity: 2.4,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
    glassEdge: std({ color: 0xdfe5e4, metalness: 0, roughness: 0.12, opacity: 0.38, depthWrite: false }),
    lacquerWhite: std({ color: 0xf1eee7, metalness: 0, roughness: 0.5 }),
    lacquerBlack: std({ color: 0x1e1f21, metalness: 0, roughness: 0.38 }),
    lume: std({ color: 0xeeeadc, metalness: 0, roughness: 0.55 }),
    wood: std({ color: 0x5b3d2a, metalness: 0, roughness: 0.58 }),
    leatherBrown: std({ color: 0x5c3d2a, metalness: 0, roughness: 0.72 }),
    leatherBlack: std({ color: 0x252525, metalness: 0, roughness: 0.68 }),
    canvasOlive: std({ color: 0x55583f, metalness: 0, roughness: 0.92 }),
    rubber: std({ color: 0x202123, metalness: 0, roughness: 0.85 }),
    resin: std({ color: 0x242527, metalness: 0, roughness: 0.55 }),
    resinGray: std({ color: 0x4b4e53, metalness: 0, roughness: 0.6 }),
    plastic: std({ color: 0xe6e3dc, metalness: 0, roughness: 0.6 }),
    pcb: std({ color: 0x31493a, metalness: 0.15, roughness: 0.58 }),
    epoxy: std({ color: 0x141414, metalness: 0, roughness: 0.3 }),
    zebra: std({ color: 0xcfc3bd, metalness: 0, roughness: 0.85 }),
    ceramic: std({ color: 0xf2f0ea, metalness: 0, roughness: 0.4 }),
    backlight: std({ color: 0xe3ece2, metalness: 0, roughness: 0.25, emissive: 0x8fd1a3, emissiveIntensity: 0.0, opacity: 0.88 }),
    lcdBody: std({ color: 0x9fa395, metalness: 0, roughness: 0.4 }),
  };

  for (const [name, m] of Object.entries(M)) {
    m.name = name;
    m.userData.baseOpacity = m.opacity;
  }
  M.glass.userData.isGlass = true;
  return M;
}

// A material for a printed face (dial, LCD). Each model gets its own because the texture differs.
export function faceMaterial(texture, { roughness = 0.5, metalness = 0, transparent = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: texture, roughness, metalness, transparent: true, alphaTest: transparent ? 0.02 : 0 });
  m.userData.baseOpacity = 1;
  return m;
}

export function tinted(base, color, extra = {}) {
  const m = base.clone();
  m.color = new THREE.Color(color);
  Object.assign(m, extra);
  m.userData = { ...base.userData };
  return m;
}
