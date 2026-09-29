// Procedural models: mages, summons and every curio in the shop. No assets, just primitives.
import * as THREE from 'three';
import type { ModelSpec } from '../data/artifacts';
import { glowTex, leatherTex, parchmentTex, woodTex, hexToRgb } from './textures';

const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });
const glowMat = (color: THREE.ColorRepresentation, intensity = 2.2) =>
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 1 });
const metal = (color: THREE.ColorRepresentation, rough = 0.35) => std(color, { metalness: 0.85, roughness: rough });
const glass = (color: THREE.ColorRepresentation, opacity = 0.35) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity, clearcoat: 1, depthWrite: false });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m;
}
function lathe(pts: [number, number][], mat: THREE.Material, seg = 24): THREE.Mesh {
  return mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
}
function at<T extends THREE.Object3D>(o: T, v: THREE.Vector3): T { o.position.copy(v); return o; }

export function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

// ------------------------------------------------------------------ staves
function shaft(len: number, color: string, rad = 0.035): THREE.Group {
  const g = new THREE.Group();
  const [r, gg, b] = hexToRgb(color);
  const wood = std(0xffffff, { map: woodTex(7, [r, gg, b], 64, 256, 3), roughness: 0.8 });
  const s = mesh(new THREE.CylinderGeometry(rad * 0.85, rad, len, 8), wood, 0, len / 2, 0);
  g.add(s);
  const band = metal(0xb8963a);
  for (const y of [0.25, len * 0.62, len - 0.05]) g.add(mesh(new THREE.TorusGeometry(rad * 1.15, 0.012, 6, 16), band, 0, y, 0).rotateX(Math.PI / 2));
  return g;
}

export function makeStaff(spec: ModelSpec): THREE.Group {
  const g = new THREE.Group();
  const L = 1.55;
  const glow = spec.glow || '#ffffff';
  const kind = spec.kind.replace('staff-', '');
  g.add(shaft(kind === 'reed' ? L + 0.05 : L, kind === 'crook' || kind === 'rod' || kind === 'crystal' ? '#5a4432' : spec.color));
  const head = new THREE.Group(); head.position.y = L; g.add(head);
  const orb = (r: number, y = 0.1) => { const o = mesh(new THREE.IcosahedronGeometry(r, 2), glowMat(glow, 3)); o.position.y = y; head.add(o); head.add(at(glowSprite(glow, r * 6, 0.7), new THREE.Vector3(0, y, 0))); return o; };
  switch (kind) {
    case 'knot': {
      const k = mesh(new THREE.DodecahedronGeometry(0.09, 0), std(spec.color, { flatShading: true }));
      k.scale.set(1, 1.3, 1); head.add(k);
      orb(0.045, 0.13);
      break;
    }
    case 'ember': {
      for (let i = 0; i < 3; i++) {
        const f = mesh(new THREE.ConeGeometry(0.025, 0.28, 5), std('#1a0e0a', { flatShading: true }));
        f.position.set(Math.cos(i * 2.1) * 0.05, 0.1, Math.sin(i * 2.1) * 0.05);
        f.rotation.set(Math.sin(i * 2.1) * 0.5, 0, -Math.cos(i * 2.1) * 0.5); head.add(f);
      }
      orb(0.07, 0.14);
      break;
    }
    case 'crystal': {
      const c = mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshPhysicalMaterial({ color: spec.color, emissive: new THREE.Color(glow), emissiveIntensity: 1.3, roughness: 0.1, transparent: true, opacity: 0.85, clearcoat: 1 }));
      c.scale.set(0.8, 2.4, 0.8); c.position.y = 0.2; head.add(c);
      head.add(at(glowSprite(glow, 0.6, 0.7), new THREE.Vector3(0, 0.2, 0)));
      for (let i = 0; i < 3; i++) { const p = mesh(new THREE.OctahedronGeometry(0.035, 0), c.material as THREE.Material); p.scale.set(0.8, 2, 0.8); p.position.set(Math.cos(i * 2.1) * 0.07, 0.06, Math.sin(i * 2.1) * 0.07); p.rotation.z = Math.cos(i * 2.1) * 0.6; p.rotation.x = Math.sin(i * 2.1) * 0.6; head.add(p); }
      break;
    }
    case 'thorn': {
      const v = mesh(new THREE.TorusKnotGeometry(0.07, 0.014, 64, 6, 2, 5), std(spec.color, { roughness: 0.9 }));
      v.position.y = 0.08; v.scale.set(1, 1.6, 1); head.add(v);
      for (let i = 0; i < 5; i++) {
        const leaf = mesh(new THREE.SphereGeometry(0.035, 6, 4), std('#6a9a3a', { flatShading: true }));
        leaf.scale.set(1, 0.3, 2); leaf.position.set(Math.cos(i * 1.3) * 0.09, 0.02 + i * 0.04, Math.sin(i * 1.3) * 0.09); leaf.rotation.y = i * 1.3; head.add(leaf);
      }
      orb(0.04, 0.14);
      break;
    }
    case 'rod': {
      const cu = metal(spec.color, 0.3);
      head.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 8), cu, 0, 0.1, 0));
      for (let i = 0; i < 6; i++) head.add(mesh(new THREE.TorusGeometry(0.05 - i * 0.004, 0.008, 6, 16), cu, 0, 0.0 + i * 0.045, 0).rotateX(Math.PI / 2));
      orb(0.05, 0.3);
      break;
    }
    case 'censer': {
      const gold = metal(spec.color, 0.25);
      const hook = mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 20, Math.PI * 1.2), gold); hook.position.set(0.06, 0.08, 0); hook.rotation.z = -0.3; head.add(hook);
      const cage = mesh(new THREE.IcosahedronGeometry(0.075, 1), new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.9, roughness: 0.3, wireframe: true }));
      cage.position.set(0.13, -0.08, 0); head.add(cage);
      const ember = mesh(new THREE.SphereGeometry(0.045, 12, 8), glowMat(glow, 3)); ember.position.copy(cage.position); head.add(ember);
      head.add(at(glowSprite(glow, 0.55, 0.8), cage.position.clone()));
      break;
    }
    case 'reed': {
      const rm = std(spec.color, { roughness: 0.6 });
      for (let i = 0; i < 5; i++) head.add(mesh(new THREE.TorusGeometry(0.037, 0.008, 6, 12), rm, 0, -0.2 - i * 0.28, 0).rotateX(Math.PI / 2));
      head.add(mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.08, 10, 1, true), rm, 0, 0.03, 0));
      orb(0.03, 0.1);
      break;
    }
    case 'crook': {
      const bone = std(spec.color, { roughness: 0.5 });
      const c = mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 24, Math.PI * 1.25), bone);
      c.position.set(0.12, 0.08, 0); c.rotation.z = -0.2; head.add(c);
      const w = mesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat(glow, 3)); w.position.set(0.2, 0.02, 0); head.add(w);
      head.add(at(glowSprite(glow, 0.45, 0.7), w.position.clone()));
      break;
    }
    case 'book': {
      const cover = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.15), std(spec.color, { map: leatherTex([90, 50, 90]) }));
      cover.position.y = 0.06; head.add(cover);
      const pages = mesh(new THREE.BoxGeometry(0.19, 0.02, 0.14), glowMat(glow, 1.6)); pages.position.y = 0.085; head.add(pages);
      head.add(at(glowSprite(glow, 0.6, 0.7), new THREE.Vector3(0, 0.12, 0)));
      const cradle = metal(0xb8963a); head.add(mesh(new THREE.TorusGeometry(0.08, 0.01, 6, 16, Math.PI), cradle, 0, 0.04, 0));
      break;
    }
    case 'loop': {
      const m = mesh(new THREE.TorusKnotGeometry(0.1, 0.022, 96, 8, 1, 2), new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.6, roughness: 0.25, emissive: new THREE.Color(glow), emissiveIntensity: 0.5 }));
      m.position.y = 0.14; head.add(m);
      orb(0.035, 0.14);
      break;
    }
  }
  g.userData.head = head;
  return g;
}

// ------------------------------------------------------------------ trinkets
function gemGeo(kind: string): THREE.BufferGeometry {
  if (kind === 'gem-big') return new THREE.DodecahedronGeometry(0.22, 0);
  const g = new THREE.OctahedronGeometry(0.18, 0);
  g.scale(1, 1.25, 0.8);
  return g;
}

export function makeTrinket(spec: ModelSpec): THREE.Group {
  const g = new THREE.Group();
  const glow = spec.glow || '#ffffff';
  const add = (m: THREE.Object3D) => { g.add(m); return m; };
  const sprite = (size: number, y = 0, op = 0.6, c = glow) => add(at(glowSprite(c, size, op), new THREE.Vector3(0, y, 0)));
  switch (spec.kind) {
    case 'gem': case 'gem-big': {
      const m = mesh(gemGeo(spec.kind), new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: 0.08, metalness: 0.1, clearcoat: 1, flatShading: true, emissive: new THREE.Color(glow), emissiveIntensity: 0.35, transparent: true, opacity: 0.92 }));
      add(m); sprite(spec.kind === 'gem-big' ? 1.4 : 0.9, 0, 0.5);
      if (spec.kind === 'gem-big') add(mesh(new THREE.OctahedronGeometry(0.08, 0), glowMat(glow, 3)));
      break;
    }
    case 'pearl':
      add(mesh(new THREE.SphereGeometry(0.15, 32, 24), new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: 0.15, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color('#ffd8f0'), iridescence: 0.6 })));
      sprite(0.7, 0, 0.3);
      break;
    case 'rock': {
      const r = mesh(new THREE.DodecahedronGeometry(0.17, 1), std(spec.color, { roughness: 0.95, flatShading: true }));
      r.scale.set(1.2, 0.8, 1); add(r);
      for (let i = 0; i < 5; i++) { const s = mesh(new THREE.OctahedronGeometry(0.025, 0), glowMat(glow, 2.5)); s.position.set(Math.cos(i * 1.7) * 0.16, Math.sin(i * 2.3) * 0.1, Math.sin(i * 1.7) * 0.13); add(s); }
      sprite(0.6, 0, 0.35);
      break;
    }
    case 'vial': {
      add(lathe([[0, -0.2], [0.09, -0.2], [0.1, -0.15], [0.1, 0.05], [0.05, 0.12], [0.04, 0.2], [0.045, 0.22]], glass(0xddeeff, 0.3)));
      add(lathe([[0, -0.19], [0.085, -0.19], [0.09, -0.15], [0.09, 0.02], [0, 0.02]], new THREE.MeshStandardMaterial({ color: spec.color, emissive: new THREE.Color(glow), emissiveIntensity: 0.9, roughness: 0.2 })));
      add(mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.06, 10), std('#8a6040'), 0, 0.24, 0));
      sprite(0.7, -0.08, 0.5);
      break;
    }
    case 'thimble':
      add(lathe([[0, 0.2], [0.07, 0.19], [0.1, 0.12], [0.11, -0.1], [0.12, -0.12], [0.1, -0.12], [0.09, -0.1]], metal(spec.color, 0.45)));
      break;
    case 'seal': {
      const wax = std(spec.color, { roughness: 0.4, flatShading: true });
      const d = mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.05, 11), wax); add(d);
      add(mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 20), wax, 0, 0.03, 0).rotateX(Math.PI / 2));
      add(mesh(new THREE.OctahedronGeometry(0.05, 0), glowMat(glow, 1.4), 0, 0.04, 0));
      g.rotation.x = 1.1;
      break;
    }
    case 'bone': {
      const b = std(spec.color, { roughness: 0.55 });
      add(mesh(new THREE.CapsuleGeometry(0.04, 0.22, 4, 8), b)).rotateZ(Math.PI / 2);
      for (const x of [-0.14, 0.14]) for (const z of [-0.035, 0.035]) add(mesh(new THREE.SphereGeometry(0.05, 10, 8), b, x, 0, z));
      break;
    }
    case 'chalice': {
      add(lathe([[0, -0.2], [0.12, -0.2], [0.1, -0.17], [0.025, -0.12], [0.02, 0], [0.04, 0.03], [0.13, 0.1], [0.15, 0.2], [0.14, 0.2], [0.12, 0.11], [0.02, 0.05]], metal(spec.color, 0.3)));
      add(mesh(new THREE.CircleGeometry(0.13, 20), glowMat(glow, 2.5), 0, 0.17, 0).rotateX(-Math.PI / 2));
      sprite(0.8, 0.22, 0.6);
      break;
    }
    case 'tooth': case 'fang': {
      const pts: [number, number][] = [[0, 0.22], [0.02, 0.18], [0.05, 0.05], [0.07, -0.08], [0.065, -0.14], [0.03, -0.18], [0, -0.19]];
      const t = lathe(pts, std(spec.color, { roughness: 0.35 }), 10);
      t.rotation.z = 0.35; add(t);
      if (spec.kind === 'fang') { const tip = mesh(new THREE.ConeGeometry(0.022, 0.07, 8), glowMat(glow, 2)); tip.position.set(0.075, 0.19, 0); tip.rotation.z = 0.35; add(tip); }
      else sprite(0.6, 0, 0.3);
      break;
    }
    case 'scale': {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.2); sh.quadraticCurveTo(0.18, 0.12, 0.14, -0.08); sh.quadraticCurveTo(0.07, -0.2, 0, -0.22); sh.quadraticCurveTo(-0.07, -0.2, -0.14, -0.08); sh.quadraticCurveTo(-0.18, 0.12, 0, 0.2);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
      geo.center();
      add(mesh(geo, new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: 0.25, metalness: 0.3, iridescence: 1, emissive: new THREE.Color(glow), emissiveIntensity: 0.4, clearcoat: 1 })));
      sprite(0.8, 0, 0.35);
      break;
    }
    case 'locket': {
      const silver = metal(spec.color, 0.25);
      const d = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.045, 24), silver); d.rotation.x = Math.PI / 2; d.scale.set(1, 1, 1.25); add(d);
      add(mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12), silver, 0, 0.19, 0));
      add(mesh(new THREE.OctahedronGeometry(0.05, 0), glowMat(glow, 2), 0, 0, 0.035));
      sprite(0.6, 0, 0.35);
      break;
    }
    case 'glove': {
      const lm = std(spec.color, { map: leatherTex(hexToRgb(spec.color)), roughness: 0.85 });
      add(mesh(new THREE.BoxGeometry(0.22, 0.2, 0.07), lm, 0, -0.04, 0));
      for (let i = 0; i < 4; i++) add(mesh(new THREE.CapsuleGeometry(0.024, 0.12 - Math.abs(i - 1.5) * 0.02, 4, 6), lm, -0.08 + i * 0.053, 0.14, 0));
      const th = mesh(new THREE.CapsuleGeometry(0.026, 0.09, 4, 6), lm, 0.14, 0.0, 0); th.rotation.z = -0.8; add(th);
      add(mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.08, 12), lm, 0, -0.18, 0)).scale.set(1, 1, 0.5);
      const stain = mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: '#1a1206', roughness: 0.1, metalness: 0.4 })); stain.position.set(0.02, 0.0, 0.03); stain.scale.set(1.2, 0.8, 0.3); add(stain);
      break;
    }
    case 'bell': {
      add(lathe([[0, 0.16], [0.04, 0.15], [0.07, 0.1], [0.09, -0.04], [0.14, -0.12], [0.15, -0.14], [0.13, -0.14]], metal(spec.color, 0.3)));
      add(mesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat(glow, 1.8), 0, -0.12, 0));
      add(mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12), metal(spec.color), 0, 0.19, 0));
      break;
    }
    case 'jar': case 'jar-tongue': {
      add(lathe([[0, -0.2], [0.13, -0.2], [0.14, -0.15], [0.14, 0.12], [0.11, 0.16], [0.11, 0.18]], glass(0xcfe8d8, 0.25)));
      add(mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 20), metal('#8a7040'), 0, 0.2, 0));
      if (spec.kind === 'jar') {
        const imp = makeUnit('imp', null); imp.scale.setScalar(0.28); imp.position.y = -0.1; imp.userData.bobless = true; add(imp);
      } else {
        const tongue = mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), std('#e07888', { roughness: 0.3 })); tongue.rotation.z = 0.9; tongue.position.y = -0.08; add(tongue);
        add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#c8e0a0', transparent: true, opacity: 0.25 }), 0, -0.14, 0));
      }
      sprite(0.7, -0.05, 0.35);
      break;
    }
    case 'quill': {
      const sh = new THREE.Shape();
      sh.moveTo(0, -0.25); sh.quadraticCurveTo(0.08, 0.0, 0.03, 0.26); sh.quadraticCurveTo(-0.07, 0.05, 0, -0.25);
      const vane = mesh(new THREE.ShapeGeometry(sh, 12), new THREE.MeshStandardMaterial({ color: spec.color, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.3, emissive: new THREE.Color(glow), emissiveIntensity: 0.25 }));
      add(vane);
      add(mesh(new THREE.ConeGeometry(0.012, 0.08, 6), metal('#e0c060'), 0, -0.29, 0)).rotateZ(Math.PI);
      g.rotation.z = -0.5;
      break;
    }
    case 'hourglass': {
      const wood = std('#5a3a22');
      add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16), wood, 0, 0.21, 0));
      add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16), wood, 0, -0.21, 0));
      for (let i = 0; i < 3; i++) add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), wood, Math.cos(i * 2.1) * 0.11, 0, Math.sin(i * 2.1) * 0.11));
      add(lathe([[0.001, -0.2], [0.09, -0.19], [0.08, -0.08], [0.012, 0], [0.08, 0.08], [0.09, 0.19], [0.001, 0.2]], glass(0xffffff, 0.2)));
      add(lathe([[0.001, -0.19], [0.08, -0.18], [0.05, -0.1], [0.001, -0.08]], new THREE.MeshStandardMaterial({ color: spec.color, emissive: new THREE.Color(glow), emissiveIntensity: 0.6 })));
      add(lathe([[0.001, 0.05], [0.05, 0.1], [0.07, 0.16], [0.001, 0.16]], new THREE.MeshStandardMaterial({ color: spec.color, emissive: new THREE.Color(glow), emissiveIntensity: 0.6 })));
      break;
    }
    case 'candle': {
      add(lathe([[0, -0.2], [0.07, -0.2], [0.065, 0.12], [0.05, 0.15], [0.02, 0.14], [0, 0.14]], std(spec.color, { roughness: 0.5 })));
      add(mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.03, 16), metal('#6a5a3a'), 0, -0.2, 0));
      const f = mesh(new THREE.SphereGeometry(0.03, 10, 8), glowMat(glow, 3)); f.scale.set(1, 2, 1); f.position.y = 0.21; add(f);
      sprite(0.5, 0.22, 0.8);
      break;
    }
    case 'idol': {
      const moss = std(spec.color, { roughness: 1, flatShading: true });
      add(lathe([[0, -0.2], [0.1, -0.2], [0.09, -0.05], [0.07, 0.02], [0.1, 0.06], [0.06, 0.1], [0, 0.1]], moss, 7));
      add(mesh(new THREE.DodecahedronGeometry(0.07, 0), moss, 0, 0.16, 0));
      for (const x of [-0.025, 0.025]) add(mesh(new THREE.SphereGeometry(0.012, 6, 6), glowMat(glow, 2.5), x, 0.17, 0.06));
      break;
    }
    case 'feather': {
      const sh = new THREE.Shape();
      sh.moveTo(0, -0.26); sh.quadraticCurveTo(0.12, -0.05, 0.05, 0.27); sh.quadraticCurveTo(-0.1, 0.05, 0, -0.26);
      const geo = new THREE.ShapeGeometry(sh, 16);
      const col = geo.attributes.position;
      const colors = new Float32Array(col.count * 3);
      const a = new THREE.Color('#ffd040'), b = new THREE.Color('#ff3010');
      for (let i = 0; i < col.count; i++) { const t = (col.getY(i) + 0.26) / 0.53; const c = a.clone().lerp(b, t); colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      add(mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: new THREE.Color('#ff5010'), emissiveIntensity: 0.8, roughness: 0.6 })));
      sprite(0.9, 0.05, 0.5);
      g.rotation.z = -0.4;
      break;
    }
    case 'mirror': {
      const frame = metal('#b8963a', 0.3);
      add(mesh(new THREE.TorusGeometry(0.14, 0.02, 8, 28), frame, 0, 0.06, 0));
      add(mesh(new THREE.CircleGeometry(0.135, 28), new THREE.MeshStandardMaterial({ color: spec.color, metalness: 1, roughness: 0.02, emissive: new THREE.Color(glow), emissiveIntensity: 0.25, side: THREE.DoubleSide }), 0, 0.06, 0));
      add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.17, 8), frame, 0, -0.16, 0));
      const crack = mesh(new THREE.BoxGeometry(0.005, 0.2, 0.002), glowMat('#ffffff', 2)); crack.position.set(0.02, 0.06, 0.003); crack.rotation.z = 0.5; add(crack);
      break;
    }
    case 'crown': {
      const iron = std(spec.color, { metalness: 0.6, roughness: 0.5 });
      add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 20, 1, true), iron)).scale.set(1, 1, 1);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = mesh(new THREE.ConeGeometry(0.025, 0.14, 5), iron); s.position.set(Math.cos(a) * 0.17, 0.09, Math.sin(a) * 0.17); add(s);
        const e = mesh(new THREE.SphereGeometry(0.018, 6, 6), glowMat(glow, 3)); e.position.set(Math.cos(a) * 0.17, 0.17, Math.sin(a) * 0.17); add(e);
      }
      sprite(0.9, 0.1, 0.45);
      break;
    }
    case 'gear': {
      const sh = new THREE.Shape();
      const teeth = 10;
      for (let i = 0; i <= teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2, r = i % 2 ? 0.14 : 0.18;
        const a2 = a + Math.PI / teeth / 2;
        if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        sh.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
      }
      const hole = new THREE.Path(); hole.absarc(0, 0, 0.07, 0, Math.PI * 2, true); sh.holes.push(hole);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 });
      geo.center();
      add(mesh(geo, metal(spec.color, 0.3)));
      const heart = mesh(new THREE.SphereGeometry(0.06, 16, 12), glowMat(glow, 2.4)); add(heart);
      sprite(0.7, 0, 0.5);
      break;
    }
    case 'die': {
      const geo = new THREE.BoxGeometry(0.24, 0.24, 0.24, 1, 1, 1);
      add(mesh(geo, std(spec.color, { roughness: 0.3 })));
      const pip = std('#1a1a1a');
      const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
        [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
      ];
      for (const [n, u, v] of faces) for (const [a, b] of [[-1, -1], [1, 1], [0, 0], [-1, 1], [1, -1]]) {
        const p = mesh(new THREE.SphereGeometry(0.02, 8, 6), pip);
        p.position.copy(n.clone().multiplyScalar(0.12).addScaledVector(u, a * 0.065).addScaledVector(v, b * 0.065)); add(p);
      }
      g.rotation.set(0.5, 0.6, 0);
      break;
    }
    case 'bottle': case 'bottle-dark': {
      const dark = spec.kind === 'bottle-dark';
      add(lathe([[0, -0.2], [0.13, -0.2], [0.14, -0.1], [0.12, 0.04], [0.05, 0.1], [0.04, 0.2], [0.05, 0.22]], glass(dark ? 0x2a1a3a : 0xc8d8f0, dark ? 0.6 : 0.25)));
      add(mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.06, 10), std('#6a4a30'), 0, 0.24, 0));
      if (dark) {
        add(mesh(new THREE.SphereGeometry(0.07, 16, 12), std('#000000', { roughness: 1 }), 0, -0.06, 0));
        add(mesh(new THREE.TorusGeometry(0.08, 0.012, 8, 32), glowMat(glow, 3), 0, -0.06, 0));
        sprite(0.8, -0.06, 0.6);
      } else {
        const core = mesh(new THREE.IcosahedronGeometry(0.05, 1), glowMat(glow, 3)); core.position.y = -0.07; add(core);
        const shell = mesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: glow, wireframe: true, transparent: true, opacity: 0.6 })); shell.position.y = -0.07; add(shell);
        sprite(0.9, -0.07, 0.7);
      }
      break;
    }
    case 'pouch': {
      const cloth = std(spec.color, { roughness: 1 });
      const b = mesh(new THREE.SphereGeometry(0.16, 16, 12), cloth); b.scale.set(1, 0.85, 1); b.position.y = -0.05; add(b);
      add(mesh(new THREE.ConeGeometry(0.08, 0.12, 10, 1, true), cloth, 0, 0.12, 0)).rotateX(Math.PI);
      add(mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), std('#c8b890'), 0, 0.09, 0)).rotateX(Math.PI / 2);
      for (let i = 0; i < 4; i++) { const d = mesh(new THREE.SphereGeometry(0.012, 5, 4), glowMat(glow, 2)); d.position.set((i - 1.5) * 0.03, 0.2 + i * 0.02, 0); add(d); }
      break;
    }
    case 'ring': {
      add(mesh(new THREE.TorusGeometry(0.13, 0.03, 12, 36), metal(spec.color, 0.25))).rotateX(1.2);
      const head = mesh(new THREE.ConeGeometry(0.04, 0.08, 6), metal(spec.color)); head.position.set(0.12, 0.05, 0); head.rotation.z = -1.2; add(head);
      add(mesh(new THREE.OctahedronGeometry(0.04, 0), glowMat(glow, 2), 0, 0.12, 0));
      break;
    }
    case 'heart': {
      const clay = std(spec.color, { roughness: 0.9, flatShading: true, emissive: new THREE.Color(glow), emissiveIntensity: 0.25 });
      add(mesh(new THREE.SphereGeometry(0.1, 12, 10), clay, -0.07, 0.06, 0));
      add(mesh(new THREE.SphereGeometry(0.1, 12, 10), clay, 0.07, 0.06, 0));
      const c = mesh(new THREE.ConeGeometry(0.15, 0.22, 12), clay); c.rotation.z = Math.PI; c.position.y = -0.1; add(c);
      add(mesh(new THREE.SphereGeometry(0.07, 12, 10), glowMat(glow, 3), 0, 0.02, 0.05));
      sprite(1.0, 0, 0.6);
      break;
    }
    case 'eye': {
      add(mesh(new THREE.SphereGeometry(0.14, 24, 18), std('#f4efe4', { roughness: 0.2 })));
      const iris = mesh(new THREE.CircleGeometry(0.065, 24), glowMat(glow, 2)); iris.position.z = 0.138; add(iris);
      const pupil = mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshBasicMaterial({ color: 0x000000 })); pupil.position.z = 0.142; add(pupil);
      for (let i = 0; i < 5; i++) { const v = mesh(new THREE.TorusGeometry(0.139, 0.002, 4, 20, 0.6), new THREE.MeshBasicMaterial({ color: '#c04040' })); v.rotation.set(i, i * 2, 0); add(v); }
      break;
    }
    case 'coin': {
      const gold = metal(spec.color, 0.25);
      const c = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 32), gold); c.rotation.x = Math.PI / 2; add(c);
      for (const z of [-0.014, 0.014]) add(mesh(new THREE.TorusGeometry(0.12, 0.008, 6, 28), gold, 0, 0, z));
      for (const z of [-0.016, 0.016]) add(mesh(new THREE.SphereGeometry(0.05, 10, 8), gold, 0, 0, z)).scale.set(1, 1, 0.3);
      sprite(0.7, 0, 0.3);
      break;
    }
    case 'page': {
      const geo = new THREE.PlaneGeometry(0.3, 0.38, 10, 10);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.15) * 6) * 0.03 + p.getY(i) * p.getY(i) * 0.2);
      geo.computeVertexNormals();
      add(mesh(geo, new THREE.MeshStandardMaterial({ map: parchmentTex(), side: THREE.DoubleSide, emissive: new THREE.Color(glow), emissiveIntensity: 0.35, roughness: 0.9 })));
      sprite(1.0, 0, 0.4);
      break;
    }
    case 'skull': {
      const bone = std(spec.color, { roughness: 0.6 });
      const s = mesh(new THREE.SphereGeometry(0.14, 20, 16), bone); s.scale.set(1, 1, 1.1); add(s);
      add(mesh(new THREE.BoxGeometry(0.14, 0.07, 0.12), bone, 0, -0.12, 0.04));
      for (const x of [-0.05, 0.05]) { add(mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }), x, -0.01, 0.12)); add(mesh(new THREE.SphereGeometry(0.015, 8, 6), glowMat(glow, 3), x, -0.01, 0.135)); }
      break;
    }
    case 'inkwell': {
      add(lathe([[0, -0.14], [0.15, -0.14], [0.16, -0.05], [0.1, 0.05], [0.05, 0.06], [0.05, 0.1]], std(spec.color, { roughness: 0.15, metalness: 0.3 })));
      const f = mesh(new THREE.SphereGeometry(0.04, 10, 8), glowMat(glow, 3)); f.scale.set(1, 2, 1); f.position.y = 0.16; add(f);
      sprite(0.6, 0.17, 0.8);
      break;
    }
    case 'spool': {
      const wood = std('#6a4a30');
      add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 18), wood, 0, 0.12, 0));
      add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 18), wood, 0, -0.12, 0));
      add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 18), new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.9, roughness: 0.3, emissive: new THREE.Color(glow), emissiveIntensity: 0.25 })));
      break;
    }
    case 'knife': {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.05, 0.02); sh.quadraticCurveTo(0.06, 0.25, 0, 0.34); sh.lineTo(-0.01, 0.02); sh.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 1 });
      add(mesh(geo, new THREE.MeshStandardMaterial({ color: spec.color, metalness: 1, roughness: 0.15, emissive: new THREE.Color(glow), emissiveIntensity: 0.2 })));
      add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), std('#3a2a22'), 0.02, -0.08, 0.005));
      g.rotation.z = -0.6; g.position.y = -0.05;
      break;
    }
    default:
      add(mesh(new THREE.IcosahedronGeometry(0.15, 0), std(spec.color)));
  }
  return g;
}

export function makeArtifactModel(spec: ModelSpec): THREE.Group {
  return spec.kind.startsWith('staff') ? makeStaff(spec) : makeTrinket(spec);
}

// ------------------------------------------------------------------ mages
export interface MageRig {
  root: THREE.Group;
  body: THREE.Group;
  staffHand: THREE.Group;
  staff: THREE.Group | null;
  book: THREE.Group;
  pages: THREE.Mesh[];
  runes: THREE.Mesh;
  eyes: THREE.Mesh[];
  robeMat: THREE.MeshStandardMaterial;
  aura: THREE.Sprite;
}

export function makeMage(robe: string, trim: string, eyeColor: string, hat: 'pointed' | 'hood'): MageRig {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const robeMat = std(robe, { roughness: 0.85, map: leatherTex(hexToRgb('#ffffff')) });
  robeMat.map!.repeat.set(2, 2);
  const trimMat = metal(trim, 0.4);
  const r = lathe([[0.001, 0], [0.44, 0], [0.42, 0.08], [0.34, 0.45], [0.27, 0.8], [0.22, 1.02], [0.19, 1.14], [0.12, 1.22], [0.001, 1.24]], robeMat, 28);
  body.add(r);
  body.add(mesh(new THREE.TorusGeometry(0.43, 0.03, 8, 32), trimMat, 0, 0.04, 0).rotateX(Math.PI / 2));
  body.add(mesh(new THREE.TorusGeometry(0.265, 0.035, 8, 28), std('#2a1e18'), 0, 0.8, 0).rotateX(Math.PI / 2));
  body.add(mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), trimMat, 0, 0.8, 0.27));
  // cape/mantle
  const mantle = mesh(new THREE.SphereGeometry(0.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), robeMat); mantle.position.y = 1.0; mantle.scale.set(1.05, 0.7, 0.9); body.add(mantle);
  // head
  const face = mesh(new THREE.SphereGeometry(0.15, 16, 12), std('#0c0a10', { roughness: 1 })); face.position.set(0, 1.33, 0.02); body.add(face);
  const eyes: THREE.Mesh[] = [];
  for (const x of [-0.055, 0.055]) { const e = mesh(new THREE.SphereGeometry(0.026, 10, 8), glowMat(eyeColor, 4)); e.position.set(x, 1.35, 0.14); e.scale.set(1, 0.7, 0.6); body.add(e); eyes.push(e); }
  if (hat === 'pointed') {
    const brim = mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.03, 28), robeMat); brim.position.y = 1.46; body.add(brim);
    const cone = new THREE.ConeGeometry(0.2, 0.75, 20, 6);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.375; p.setX(i, p.getX(i) + y * y * 0.35); }
    cone.computeVertexNormals();
    const c = mesh(cone, robeMat); c.position.y = 1.83; body.add(c);
    body.add(mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 24), trimMat, 0, 1.5, 0).rotateX(Math.PI / 2));
    const star = mesh(new THREE.OctahedronGeometry(0.04, 0), glowMat(eyeColor, 2.5)); star.position.set(0, 1.5, 0.21); body.add(star);
  } else {
    const hood = mesh(new THREE.SphereGeometry(0.22, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), robeMat); hood.position.set(0, 1.34, -0.03); hood.rotation.x = -0.35; body.add(hood);
    const tip = mesh(new THREE.ConeGeometry(0.12, 0.3, 12), robeMat); tip.position.set(0, 1.5, -0.16); tip.rotation.x = -1.1; body.add(tip);
  }
  // arms
  const sleeve = (side: number) => {
    const a = new THREE.Group(); a.position.set(side * 0.27, 1.08, 0.02);
    const s = mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.45, 10), robeMat); s.position.y = -0.2; a.add(s);
    const hand = mesh(new THREE.SphereGeometry(0.055, 10, 8), std('#d8c0a8')); hand.position.y = -0.45; a.add(hand);
    body.add(a); return a;
  };
  const right = sleeve(1); right.rotation.set(-0.5, 0, 0.25);
  const left = sleeve(-1); left.rotation.set(-0.9, 0, -0.35);
  const staffHand = new THREE.Group(); staffHand.position.set(0, -0.45, 0); right.add(staffHand);
  // floating tome
  const book = new THREE.Group(); book.position.set(-0.05, 0.95, 0.55); root.add(book);
  const cover = mesh(new THREE.BoxGeometry(0.52, 0.02, 0.36), std('#4a1f28', { map: leatherTex([120, 40, 50]) })); book.add(cover);
  const pages: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const pg = mesh(new THREE.BoxGeometry(0.24, 0.02, 0.33), new THREE.MeshStandardMaterial({ map: parchmentTex(), emissive: new THREE.Color('#ffe7b0'), emissiveIntensity: 0.15, roughness: 0.9 }));
    pg.position.set(s * 0.125, 0.025, 0); pg.rotation.z = s * -0.12; book.add(pg); pages.push(pg);
  }
  book.rotation.x = -0.9;
  // rune circle on the floor
  const runes = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff }));
  runes.rotation.x = -Math.PI / 2; runes.position.y = 0.03; root.add(runes);
  const aura = glowSprite('#ffffff', 2.5, 0); aura.position.y = 0.8; root.add(aura);
  return { root, body, staffHand, staff: null, book, pages, runes, eyes, robeMat, aura };
}

export function setMageStaff(rig: MageRig, spec: ModelSpec | null) {
  if (rig.staff) { rig.staffHand.remove(rig.staff); rig.staff = null; }
  if (!spec) return;
  const s = makeStaff(spec);
  s.position.set(0, -0.62, 0); s.rotation.x = 0.5; s.scale.setScalar(1.05);
  rig.staffHand.add(s); rig.staff = s;
}

// ------------------------------------------------------------------ units
export function makeUnit(kind: string, tint: string | null): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Object3D) => { g.add(m); return m; };
  const eye = (c: string, x: number, y: number, z: number, r = 0.03) => add(mesh(new THREE.SphereGeometry(r, 8, 6), glowMat(c, 4), x, y, z));
  const accent = tint || null;
  switch (kind) {
    case 'imp': case 'pitlord': {
      const big = kind === 'pitlord';
      const skin = std(big ? '#5a1010' : '#c0402a', { roughness: 0.6, emissive: new THREE.Color(big ? '#ff3a10' : '#401008'), emissiveIntensity: big ? 0.35 : 0.2 });
      const belly = std(big ? '#8a3010' : '#e8a070');
      const b = mesh(new THREE.SphereGeometry(0.22, 16, 12), skin); b.position.y = 0.55; b.scale.set(1, 1.1, 0.9); add(b);
      const bb = mesh(new THREE.SphereGeometry(0.16, 12, 10), belly); bb.position.set(0, 0.52, 0.09); bb.scale.set(1, 1.1, 0.6); add(bb);
      const h = mesh(new THREE.SphereGeometry(0.17, 16, 12), skin); h.position.y = 0.86; add(h);
      for (const s of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.04, 0.2, 8), std('#2a1a14')); horn.position.set(s * 0.1, 1.02, -0.02); horn.rotation.z = -s * 0.5; add(horn);
        if (big) { const h2 = mesh(new THREE.ConeGeometry(0.035, 0.26, 8), std('#1a0a08')); h2.position.set(s * 0.16, 0.95, -0.06); h2.rotation.z = -s * 1.1; add(h2); }
        const ws = new THREE.Shape(); ws.moveTo(0, 0); ws.lineTo(0.35, 0.18); ws.lineTo(0.3, 0.02); ws.lineTo(0.38, -0.08); ws.lineTo(0.22, -0.06); ws.lineTo(0.18, -0.16); ws.lineTo(0, -0.05);
        const wing = mesh(new THREE.ShapeGeometry(ws), std('#5a1a1a', { side: THREE.DoubleSide, roughness: 0.8 }));
        wing.position.set(s * 0.12, 0.66, -0.12); wing.scale.set(s, 1, 1); wing.rotation.y = s * 0.6; wing.userData.wing = s; add(wing);
        const leg = mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 6), skin); leg.position.set(s * 0.09, 0.32, 0); add(leg);
      }
      eye(accent || (big ? '#ff6a10' : '#ffd040'), -0.06, 0.9, 0.14); eye(accent || (big ? '#ff6a10' : '#ffd040'), 0.06, 0.9, 0.14);
      const tail = mesh(new THREE.TorusGeometry(0.18, 0.02, 6, 16, Math.PI), skin); tail.position.set(0, 0.45, -0.2); tail.rotation.y = Math.PI / 2; add(tail);
      if (big) { g.scale.setScalar(1.9); add(at(glowSprite('#ff5a1a', 1.6, 0.35), new THREE.Vector3(0, 0.6, 0))); }
      g.userData.hover = big ? 0.1 : 0.35;
      break;
    }
    case 'cherub': {
      const gold = std('#f0d8a0', { roughness: 0.5, emissive: new THREE.Color('#ffe0a0'), emissiveIntensity: 0.25 });
      const b = mesh(new THREE.SphereGeometry(0.18, 16, 12), gold); b.position.y = 0.55; add(b);
      add(mesh(new THREE.SphereGeometry(0.15, 16, 12), gold, 0, 0.83, 0));
      add(mesh(new THREE.TorusGeometry(0.13, 0.018, 8, 24), glowMat('#ffeaa0', 3), 0, 1.04, 0)).rotateX(Math.PI / 2);
      for (const s of [-1, 1]) {
        const w = mesh(new THREE.SphereGeometry(0.16, 12, 8), std('#ffffff', { roughness: 0.9 })); w.scale.set(0.3, 1, 1.6); w.position.set(s * 0.2, 0.7, -0.1); w.rotation.y = s * 0.5; w.userData.wing = s; add(w);
      }
      eye(accent || '#80c0ff', -0.05, 0.86, 0.13, 0.02); eye(accent || '#80c0ff', 0.05, 0.86, 0.13, 0.02);
      add(at(glowSprite('#ffeaa0', 1.2, 0.4), new THREE.Vector3(0, 0.7, 0)));
      g.userData.hover = 0.45;
      break;
    }
    case 'skeleton': case 'frostlich': {
      const lich = kind === 'frostlich';
      const bone = std(lich ? '#c8e0f0' : '#e8e0cc', { roughness: 0.55 });
      add(mesh(new THREE.SphereGeometry(0.14, 14, 10), bone, 0, 1.22, 0));
      add(mesh(new THREE.BoxGeometry(0.12, 0.06, 0.1), bone, 0, 1.1, 0.03));
      const ec = accent || (lich ? '#80e0ff' : '#6ab0ff');
      eye(ec, -0.05, 1.22, 0.12, 0.028); eye(ec, 0.05, 1.22, 0.12, 0.028);
      add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6), bone, 0, 0.8, 0));
      for (let i = 0; i < 4; i++) { const r = mesh(new THREE.TorusGeometry(0.13 - i * 0.012, 0.018, 5, 14, Math.PI * 1.3), bone); r.position.set(0, 0.98 - i * 0.08, 0.02); r.rotation.set(Math.PI / 2, 0, Math.PI * 0.85); add(r); }
      add(mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 12), bone, 0, 0.52, 0)).rotateX(Math.PI / 2);
      for (const s of [-1, 1]) {
        const arm = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5), bone); arm.position.set(s * 0.2, 0.8, 0.05); arm.rotation.z = s * 0.25; arm.rotation.x = -0.4; add(arm);
        const leg = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.52, 5), bone); leg.position.set(s * 0.08, 0.26, 0); add(leg);
      }
      if (lich) {
        const ice = new THREE.MeshStandardMaterial({ color: '#a0e0ff', emissive: new THREE.Color('#60c0ff'), emissiveIntensity: 1.2, transparent: true, opacity: 0.9, roughness: 0.1 });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const sp = mesh(new THREE.ConeGeometry(0.03, 0.18, 5), ice); sp.position.set(Math.cos(a) * 0.12, 1.38, Math.sin(a) * 0.12); add(sp); }
        const robe = lathe([[0.001, 0.05], [0.35, 0.05], [0.25, 0.5], [0.18, 1.0], [0.001, 1.05]], new THREE.MeshStandardMaterial({ color: '#1a2a4a', transparent: true, opacity: 0.75, roughness: 0.9, side: THREE.DoubleSide }), 12);
        add(robe);
        const staff = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), std('#c8e0f0')); staff.position.set(0.3, 0.7, 0.1); add(staff);
        add(at(glowSprite('#80e0ff', 0.7, 0.9), new THREE.Vector3(0.3, 1.45, 0.1)));
        g.scale.setScalar(1.35);
      } else {
        const sword = mesh(new THREE.BoxGeometry(0.03, 0.45, 0.01), metal('#8a8a90')); sword.position.set(0.3, 0.6, 0.2); sword.rotation.x = -0.6; add(sword);
      }
      break;
    }
    case 'treant': case 'sapling': case 'worldroot': {
      const scale = kind === 'sapling' ? 0.55 : kind === 'worldroot' ? 1.45 : 1;
      const bark = std('#5a4030', { roughness: 1, map: woodTex(11, [110, 80, 60], 64, 256, 2), flatShading: true });
      const trunk = lathe([[0.001, 0], [0.34, 0], [0.26, 0.15], [0.22, 0.6], [0.2, 1.1], [0.24, 1.3], [0.001, 1.35]], bark, 9);
      add(trunk);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const root = mesh(new THREE.ConeGeometry(0.07, 0.5, 5), bark); root.position.set(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3); root.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3); add(root);
      }
      for (const s of [-1, 1]) {
        const arm = mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6), bark); arm.position.set(s * 0.35, 1.0, 0.05); arm.rotation.z = s * 1.0; add(arm);
      }
      const leafCol = kind === 'worldroot' ? '#4a8a3a' : '#5a9a3a';
      const leaves = std(leafCol, { flatShading: true, roughness: 0.9 });
      for (let i = 0; i < 6; i++) {
        const l = mesh(new THREE.IcosahedronGeometry(0.28 + (i % 3) * 0.05, 0), leaves);
        l.position.set(Math.cos(i * 1.1) * 0.3, 1.45 + Math.sin(i * 2.3) * 0.15, Math.sin(i * 1.1) * 0.25); add(l);
      }
      const ec = accent || (kind === 'worldroot' ? '#b0ff80' : '#ffc040');
      eye(ec, -0.08, 1.0, 0.2, 0.035); eye(ec, 0.08, 1.0, 0.2, 0.035);
      if (kind === 'worldroot') {
        for (let i = 0; i < 4; i++) { const v = mesh(new THREE.TorusGeometry(0.28, 0.012, 5, 24), glowMat('#a6e86a', 2)); v.position.y = 0.2 + i * 0.3; v.rotation.x = Math.PI / 2 + i * 0.2; add(v); }
      }
      g.scale.setScalar(scale);
      break;
    }
    case 'rat': {
      const fur = std('#6a6a58', { roughness: 1 });
      const b = mesh(new THREE.SphereGeometry(0.22, 14, 10), fur); b.scale.set(0.8, 0.7, 1.3); b.position.y = 0.2; add(b);
      const h = mesh(new THREE.ConeGeometry(0.13, 0.3, 10), fur); h.rotation.x = Math.PI / 2; h.position.set(0, 0.24, 0.35); add(h);
      for (const s of [-1, 1]) { add(mesh(new THREE.SphereGeometry(0.06, 8, 6), std('#c08080'), s * 0.09, 0.36, 0.26)).scale.set(1, 1, 0.3); }
      eye(accent || '#94e36a', -0.06, 0.29, 0.38, 0.022); eye(accent || '#94e36a', 0.06, 0.29, 0.38, 0.022);
      const tail = mesh(new THREE.TorusGeometry(0.25, 0.015, 5, 16, Math.PI * 0.8), std('#c08080')); tail.position.set(0, 0.15, -0.4); tail.rotation.set(0, Math.PI / 2, 0); add(tail);
      for (let i = 0; i < 3; i++) add(mesh(new THREE.SphereGeometry(0.03, 6, 5), glowMat('#94e36a', 1.6), Math.sin(i * 2) * 0.12, 0.35, Math.cos(i * 2) * 0.12 - 0.05));
      break;
    }
    case 'salamander': {
      const sk = std('#e0601a', { roughness: 0.5, emissive: new THREE.Color('#ff4010'), emissiveIntensity: 0.3 });
      const b = mesh(new THREE.CapsuleGeometry(0.13, 0.45, 6, 10), sk); b.rotation.x = Math.PI / 2; b.position.y = 0.2; add(b);
      const h = mesh(new THREE.SphereGeometry(0.13, 12, 10), sk); h.scale.set(1, 0.7, 1.3); h.position.set(0, 0.24, 0.38); add(h);
      const t = mesh(new THREE.ConeGeometry(0.1, 0.6, 8), sk); t.rotation.x = -Math.PI / 2; t.position.set(0, 0.18, -0.55); add(t);
      for (const s of [-1, 1]) for (const z of [-0.18, 0.18]) { const l = mesh(new THREE.CapsuleGeometry(0.035, 0.12, 3, 6), sk); l.position.set(s * 0.16, 0.1, z); l.rotation.z = s * 1.0; add(l); }
      for (let i = 0; i < 5; i++) add(mesh(new THREE.SphereGeometry(0.03, 6, 5), glowMat('#ffd040', 3), (i % 2 ? 0.06 : -0.06), 0.32, -0.25 + i * 0.12));
      eye(accent || '#ffff80', -0.07, 0.29, 0.48, 0.025); eye(accent || '#ffff80', 0.07, 0.29, 0.48, 0.025);
      add(at(glowSprite('#ff7a3d', 1.4, 0.4), new THREE.Vector3(0, 0.3, 0)));
      break;
    }
    case 'ball': {
      const core = mesh(new THREE.IcosahedronGeometry(0.22, 2), glowMat('#fff4a0', 4)); core.position.y = 0.7; add(core);
      const shell = mesh(new THREE.IcosahedronGeometry(0.36, 1), new THREE.MeshBasicMaterial({ color: '#ffe066', wireframe: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending })); shell.position.y = 0.7; shell.userData.spin = 1; add(shell);
      add(at(glowSprite('#ffe066', 2.4, 0.9), new THREE.Vector3(0, 0.7, 0)));
      g.userData.hover = 0.2;
      break;
    }
    case 'decoy': {
      const ghost = new THREE.MeshStandardMaterial({ color: '#c59bff', emissive: new THREE.Color('#8a5acf'), emissiveIntensity: 0.9, transparent: true, opacity: 0.45, depthWrite: false });
      add(lathe([[0.001, 0], [0.4, 0], [0.3, 0.5], [0.2, 1.0], [0.12, 1.2], [0.001, 1.25]], ghost, 16));
      add(mesh(new THREE.SphereGeometry(0.15, 12, 10), ghost, 0, 1.35, 0));
      add(mesh(new THREE.ConeGeometry(0.2, 0.6, 12), ghost, 0, 1.75, 0));
      break;
    }
    default:
      add(mesh(new THREE.SphereGeometry(0.3, 12, 10), std('#888888'), 0, 0.3, 0));
  }
  if (tint && kind !== 'ball' && kind !== 'decoy') {
    add(at(glowSprite(tint, 1.3, 0.28), new THREE.Vector3(0, 0.6, 0)));
  }
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  return g;
}

export function makeSheep(): THREE.Group {
  const g = new THREE.Group();
  const wool = std('#f4f0e8', { roughness: 1 });
  const dark = std('#2a2420', { roughness: 0.8 });
  const pts = [[0, 0.55, 0], [0.2, 0.6, 0.1], [-0.2, 0.6, 0.1], [0.18, 0.58, -0.2], [-0.18, 0.58, -0.2], [0, 0.72, -0.05], [0, 0.6, -0.3], [0.15, 0.75, 0.15], [-0.15, 0.75, 0.15]];
  for (const [x, y, z] of pts) g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), wool, x, y, z));
  const head = mesh(new THREE.SphereGeometry(0.14, 12, 10), dark); head.position.set(0, 0.7, 0.36); head.scale.set(0.9, 1, 1.2); g.add(head);
  for (const s of [-1, 1]) { const e = mesh(new THREE.SphereGeometry(0.06, 8, 6), dark); e.position.set(s * 0.14, 0.75, 0.3); e.scale.set(1.4, 0.5, 0.8); g.add(e); }
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.025, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), s * 0.06, 0.76, 0.48));
  for (const x of [-0.14, 0.14]) for (const z of [-0.18, 0.18]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.4, 6), dark, x, 0.2, z));
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), wool, 0, 0.62, 0.42 - 0.84));
  return g;
}

export function makeIceBlock(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), new THREE.MeshPhysicalMaterial({
    color: '#bfe8ff', roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, emissive: new THREE.Color('#5ab0ff'), emissiveIntensity: 0.3, flatShading: true, depthWrite: false,
  }));
  m.scale.set(0.9, 1.25, 0.9);
  m.position.y = 0.95;
  return m;
}
