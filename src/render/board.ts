// The duel board: a top-down arena that plays back the simulation's event log.
import * as THREE from 'three';
import type { View } from './engine';
import { ESS, type Essence } from '../data/spells';
import { ARTIFACTS } from '../data/artifacts';
import { STATUSES } from '../data/codex';
import type { DuelEvent, Snap, UnitSnap } from '../sim/types';
import { Particles, Ribbon } from './particles';
import { flagstones, glowTex, noiseTex, ringTex, runeCircleTex, sigilTex, smokeTex, sparkTex } from './textures';
import { glowSprite, makeIceBlock, makeMage, makeSheep, makeUnit, setMageStaff, type MageRig } from './models';

const MAGE_Z = 5.4;

// Free GPU memory for a removed object (textures are shared and cached, so they stay).
function disposeObj(o: THREE.Object3D) {
  o.traverse(n => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
  });
}
const col = (e: Essence | null | undefined) => new THREE.Color(e ? ESS[e].color : '#ffffff');
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface UnitView {
  id: number; side: 0 | 1; kind: string; group: THREE.Group; model: THREE.Group; target: THREE.Vector3; height: number;
  alive: boolean; dying: number; lunge: number; lungeDir: THREE.Vector3; spawnT: number; flash: number;
  ice: THREE.Mesh | null; morph: THREE.Group | null; snap: UnitSnap | null; hover: number; phase: number;
}
interface ProjView {
  id: number; from: THREE.Vector3; toId: number; to: THREE.Vector3; t0: number; flight: number; ess: Essence; style: string; size: number;
  head: THREE.Object3D; ribbon: Ribbon | null; done: boolean; side: number; last: THREE.Vector3;
}
interface FieldView { id: number; on: 0 | 1; kind: string; ess: Essence; mesh: THREE.Mesh; age: number; dur: number; ending: number; clouds: THREE.Sprite[] }
interface Flash { light: THREE.PointLight; t: number; dur: number; power: number }
interface Transient { obj: THREE.Object3D; t: number; dur: number; update: (k: number, o: THREE.Object3D) => void; dispose?: () => void }
interface Sigil { key: number; side: 0 | 1; sprite: THREE.Sprite; ess: Essence; pulse: number; dying: number }

export interface BoardHooks {
  onNumber(pos: THREE.Vector3, text: string, cls: string, color?: string): void;
  onBigText(pos: THREE.Vector3, text: string, color: string): void;
}

const FIELD_KIND: Record<string, number> = { oil: 5, rain: 6, blizzard: 1, miasma: 2, smog: 2, smoke: 2, seed: 2, thunder: 4, consecration: 3, fire: 0 };

export class Board implements View {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  bloom = { strength: 0.8, radius: 0.5, threshold: 0.78 };
  exposure = 1.05;
  vignette = 1.05;
  glow: Particles; spark: Particles; smoke: Particles;
  mages: MageRig[] = [];
  mageState = [{ read: 0, ess: 'arcane' as Essence, reading: false, castFlash: 0, recoil: 0, dead: 0, flash: 0, morph: null as THREE.Group | null, ice: null as THREE.Mesh | null, alpha: 1 }, { read: 0, ess: 'arcane' as Essence, reading: false, castFlash: 0, recoil: 0, dead: 0, flash: 0, morph: null as THREE.Group | null, ice: null as THREE.Mesh | null, alpha: 1 }];
  mageLights: THREE.PointLight[] = [];
  units = new Map<number, UnitView>();
  projs = new Map<number, ProjView>();
  fields = new Map<number, FieldView>();
  sigils: Sigil[] = [];
  wards: THREE.Group[] = [];
  auraRings: THREE.Mesh[] = [];
  flashes: Flash[] = [];
  transients: Transient[] = [];
  braziers: { pos: THREE.Vector3; light: THREE.PointLight }[] = [];
  runeFloor: THREE.Mesh;
  divide: THREE.Mesh;
  shake = 0;
  camBase = new THREE.Vector3(0, 14.5, 9.2);
  camLook = new THREE.Vector3(0, 0, 0.5);
  time = 0;
  hooks: BoardHooks | null = null;
  snap: Snap | null = null;
  sudden = 0;
  private tmpV = new THREE.Vector3();

  constructor() {
    const S = this.scene;
    S.background = new THREE.Color('#0b0912');
    S.fog = new THREE.Fog('#0b0912', 18, 38);
    S.add(new THREE.HemisphereLight('#6a6490', '#1a1210', 0.9));
    const moon = new THREE.DirectionalLight('#b8c4ff', 1.3);
    moon.position.set(-5, 14, 6); moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.02;
    S.add(moon);

    // ground
    const fs = flagstones(7, [64, 58, 72], 1024, 7);
    for (const t of [fs.map, fs.normal, fs.rough]) t.repeat.set(3, 3);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9.6, 72), new THREE.MeshStandardMaterial({ map: fs.map, normalMap: fs.normal, roughnessMap: fs.rough, roughness: 0.9, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; S.add(ground);
    const outer = new THREE.Mesh(new THREE.RingGeometry(9.6, 40, 72), new THREE.MeshStandardMaterial({ color: '#0e0b14', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.6; S.add(outer);
    // stone rim
    const rim = new THREE.Mesh(new THREE.TorusGeometry(9.7, 0.35, 10, 96), new THREE.MeshStandardMaterial({ map: fs.map, color: '#8a8098', roughness: 0.9 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.05; rim.receiveShadow = true; rim.castShadow = true; S.add(rim);
    // wall below rim
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.4, 1.2, 72, 1, true), new THREE.MeshStandardMaterial({ map: fs.map, color: '#5a5068', roughness: 1, side: THREE.DoubleSide }));
    wall.position.y = -0.55; S.add(wall);
    // rune circle inlaid in the floor
    this.runeFloor = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshBasicMaterial({ map: runeCircleTex(2), color: '#3a9a8c', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.runeFloor.rotation.x = -Math.PI / 2; this.runeFloor.position.y = 0.02; S.add(this.runeFloor);
    this.divide = new THREE.Mesh(new THREE.PlaneGeometry(18, 0.35), new THREE.MeshBasicMaterial({ map: glowTex(), color: '#6a5aa0', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.divide.rotation.x = -Math.PI / 2; this.divide.position.y = 0.03; S.add(this.divide);
    // side washes
    for (const side of [0, 1] as const) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: glowTex(), color: side === 0 ? '#2a8a80' : '#9a2a40', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      w.rotation.x = -Math.PI / 2; w.position.set(0, 0.015, side === 0 ? 5 : -5); S.add(w);
    }
    // pillars and braziers
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 10.6, z = Math.sin(a) * 10.6;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 3.2, 10), new THREE.MeshStandardMaterial({ map: fs.map, color: '#7a7088', roughness: 0.95 }));
      pillar.position.set(x, 1.0, z); pillar.castShadow = true; S.add(pillar);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.3, 0.4, 12), new THREE.MeshStandardMaterial({ color: '#3a2a20', metalness: 0.7, roughness: 0.4 }));
      bowl.position.set(x, 2.8, z); S.add(bowl);
      const coal = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), new THREE.MeshBasicMaterial({ color: '#ff7a30' }));
      coal.rotation.x = -Math.PI / 2; coal.position.set(x, 2.98, z); S.add(coal);
      if (i % 2 === 0) {
        const L = new THREE.PointLight('#ff9a50', 26, 16, 1.8); L.position.set(x * 0.95, 3.6, z * 0.95); S.add(L);
        this.braziers.push({ pos: new THREE.Vector3(x, 3.0, z), light: L });
      } else this.braziers.push({ pos: new THREE.Vector3(x, 3.0, z), light: null as unknown as THREE.PointLight });
    }
    // particles
    this.glow = new Particles(7000, glowTex(), true);
    this.spark = new Particles(2500, sparkTex(), true);
    this.smoke = new Particles(2000, smokeTex(), false);
    this.smoke.points.renderOrder = 1; this.glow.points.renderOrder = 2; this.spark.points.renderOrder = 3;
    S.add(this.smoke.points, this.glow.points, this.spark.points);
    // flash lights pool
    for (let i = 0; i < 6; i++) {
      const L = new THREE.PointLight('#ffffff', 0, 9, 2); L.position.y = 1.2; S.add(L);
      this.flashes.push({ light: L, t: 1, dur: 1, power: 0 });
    }
    // mages
    this.mages = [makeMage('#1f3f6a', '#c9a13b', '#7fe8ff', 'pointed'), makeMage('#5a1424', '#9a9aa8', '#ff5a78', 'hood')];
    this.mages.forEach((m, i) => {
      m.root.position.set(0, 0, i === 0 ? MAGE_Z : -MAGE_Z);
      m.root.scale.setScalar(1.35);
      m.root.rotation.y = i === 0 ? Math.PI : 0;
      S.add(m.root);
      (m.runes.material as THREE.MeshBasicMaterial).map = runeCircleTex(1);
      const L = new THREE.PointLight('#ffffff', 0, 7, 2); L.position.set(0, 1.6, i === 0 ? MAGE_Z - 0.6 : -MAGE_Z + 0.6); S.add(L);
      this.mageLights.push(L);
      const ward = new THREE.Group(); ward.position.copy(m.root.position); ward.scale.setScalar(1.35); S.add(ward); this.wards.push(ward);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.05, 48), new THREE.MeshBasicMaterial({ map: ringTex(), color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(m.root.position).setY(0.06); S.add(ring); this.auraRings.push(ring);
    });
    this.onResize(window.innerWidth, window.innerHeight);
  }

  setup(opts: { robes: [string, string]; staffs: [string | null, string | null] }) {
    this.mages.forEach((m, i) => {
      m.robeMat.color.set(opts.robes[i]);
      const s = opts.staffs[i];
      setMageStaff(m, s && ARTIFACTS[s] ? ARTIFACTS[s].model : null);
    });
    this.reset();
  }

  reset() {
    for (const u of this.units.values()) { this.scene.remove(u.group); disposeObj(u.group); }
    this.units.clear();
    for (const p of this.projs.values()) this.killProj(p);
    this.projs.clear();
    for (const f of this.fields.values()) { this.scene.remove(f.mesh); f.clouds.forEach(c => this.scene.remove(c)); }
    this.fields.clear();
    for (const s of this.sigils) this.scene.remove(s.sprite);
    this.sigils = [];
    for (const t of this.transients) { this.scene.remove(t.obj); t.dispose?.(); }
    this.transients = [];
    this.glow.clear(); this.spark.clear(); this.smoke.clear();
    this.mageState.forEach((st, i) => {
      st.read = 0; st.reading = false; st.castFlash = 0; st.recoil = 0; st.dead = 0; st.flash = 0; st.alpha = 1;
      if (st.morph) { this.scene.remove(st.morph); st.morph = null; }
      if (st.ice) { this.mages[i].root.remove(st.ice); st.ice = null; }
      this.mages[i].root.visible = true; this.mages[i].body.visible = true;
      this.mages[i].root.position.y = 0; this.mages[i].root.rotation.x = 0;
    });
    this.wards.forEach(w => w.clear());
    this.sudden = 0; this.shake = 0; this.snap = null;
  }

  onResize(w: number, h: number) {
    const aspect = w / h;
    this.camera.fov = aspect < 0.8 ? 52 : 40;
    // fit roughly 15 units of board width
    const needW = aspect < 0.8 ? 12.5 : 17;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = Math.max(aspect < 0.8 ? 17 : 19, (needW / 2) / Math.tan(hfov / 2));
    const pitch = aspect < 0.8 ? 1.12 : 0.98; // radians down from horizontal
    this.camLook.set(0, 0, aspect < 0.8 ? 0.9 : 0.1);
    this.camBase.set(0, Math.sin(pitch) * dist, this.camLook.z + Math.cos(pitch) * dist);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
    for (const p of [this.glow, this.spark, this.smoke]) p.setScale(h, this.camera.fov);
  }

  // ---------------------------------------------------------------- positions
  bodyPos(id: number, out = new THREE.Vector3()): THREE.Vector3 {
    if (id < 2) {
      const m = this.mages[id];
      return out.copy(m.root.position).setY(1.35);
    }
    const u = this.units.get(id);
    if (!u) return out.set(0, 0.6, 0);
    return out.copy(u.group.position).setY(u.group.position.y + u.height * 0.6);
  }
  castPos(id: number, out = new THREE.Vector3()): THREE.Vector3 {
    if (id < 2) {
      const m = this.mages[id];
      const head = m.staff?.userData.head as THREE.Object3D | undefined;
      if (head) { head.getWorldPosition(out); return out; }
      return this.bodyPos(id, out).setY(1.8);
    }
    return this.bodyPos(id, out);
  }
  sideCenter(side: number) { return new THREE.Vector3(0, 0.6, side === 0 ? 3.6 : -3.6); }

  // ---------------------------------------------------------------- FX primitives
  lightFlash(pos: THREE.Vector3, color: THREE.ColorRepresentation, power = 30, dur = 0.35) {
    const f = this.flashes.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    f.light.color.set(color); f.light.position.copy(pos).setY(pos.y + 0.6); f.t = 0; f.dur = dur; f.power = power;
  }

  ring(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, dur = 0.5, flat = true) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    if (flat) m.rotation.x = -Math.PI / 2; else m.lookAt(this.camera.position);
    m.position.copy(pos);
    this.scene.add(m);
    this.transients.push({ obj: m, t: 0, dur, update: (k, o) => { o.scale.setScalar(0.2 + size * Math.pow(k, 0.6)); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.95; }, dispose: () => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  }

  flare(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, dur = 0.3) {
    const s = glowSprite(color, size, 1);
    s.position.copy(pos); this.scene.add(s);
    this.transients.push({ obj: s, t: 0, dur, update: (k, o) => { o.scale.setScalar(size * (0.6 + k * 0.8)); ((o as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 1 - k; }, dispose: () => (s.material as THREE.Material).dispose() });
  }

  lightning(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation, width = 0.12, dur = 0.28) {
    const pts: THREE.Vector3[] = [];
    const n = 14;
    const dir = b.clone().sub(a);
    const len = dir.length();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = a.clone().addScaledVector(dir, t);
      if (i > 0 && i < n - 1) { p.addScaledVector(perp, rand(-1, 1) * len * 0.06); p.y += rand(-1, 1) * len * 0.05; }
      pts.push(p);
    }
    const r = new Ribbon(n, width, color);
    r.setPoints(pts.reverse());
    r.update(this.camera);
    this.scene.add(r.mesh);
    this.transients.push({ obj: r.mesh, t: 0, dur, update: (k) => { r.fade = (1 - k) * (Math.random() > 0.25 ? 1 : 0.3); r.update(this.camera); }, dispose: () => r.dispose() });
  }

  emitEss(ess: Essence, pos: THREE.Vector3, n: number, spread = 0.4, power = 1) {
    const c = ESS[ess].color;
    for (let i = 0; i < n; i++) {
      const x = pos.x + rand(-spread, spread), y = pos.y + rand(-spread, spread) * 0.6, z = pos.z + rand(-spread, spread);
      switch (ess) {
        case 'fire':
          this.glow.emit({ x, y, z, vx: rand(-0.6, 0.6), vy: rand(1, 3) * power, vz: rand(-0.6, 0.6), color: i % 3 ? c : '#ffd070', size: rand(0.35, 0.7), sizeEnd: 0.05, life: rand(0.4, 0.9), drag: 1.5, gravity: 1.5 });
          if (i % 3 === 0) this.smoke.emit({ x, y: y + 0.3, z, vy: rand(0.6, 1.2), color: '#2a2020', size: rand(0.5, 0.9), sizeEnd: 1.4, life: rand(0.8, 1.4), alpha: 0.45 });
          break;
        case 'frost':
          this.spark.emit({ x, y, z, vx: rand(-1, 1), vy: rand(-0.2, 1), vz: rand(-1, 1), color: i % 2 ? '#ffffff' : c, size: rand(0.2, 0.4), life: rand(0.5, 1.1), drag: 2, gravity: -0.6, spin: rand(-3, 3) });
          break;
        case 'venom':
          this.glow.emit({ x, y, z, vx: rand(-0.8, 0.8), vy: rand(0, 1.5) * power, vz: rand(-0.8, 0.8), color: c, size: rand(0.25, 0.45), sizeEnd: 0.12, life: rand(0.6, 1.2), drag: 1.2, gravity: -3 });
          if (i % 3 === 0) this.smoke.emit({ x, y, z, vy: 0.3, color: '#4a7a2a', size: 0.6, sizeEnd: 1.3, life: 1.2, alpha: 0.35 });
          break;
        case 'storm':
          this.spark.emit({ x, y, z, vx: rand(-3, 3), vy: rand(-1, 3), vz: rand(-3, 3), color: i % 2 ? '#ffffff' : c, size: rand(0.25, 0.5), life: rand(0.15, 0.4), drag: 4, jitter: 60 });
          break;
        case 'stone':
          this.smoke.emit({ x, y: y * 0.5, z, vx: rand(-1.2, 1.2), vy: rand(0.2, 1), vz: rand(-1.2, 1.2), color: '#8a7a68', size: rand(0.5, 0.9), sizeEnd: 1.5, life: rand(0.7, 1.3), alpha: 0.6, drag: 2.5 });
          this.glow.emit({ x, y, z, vx: rand(-2, 2), vy: rand(1, 4), vz: rand(-2, 2), color: c, size: 0.18, life: 0.6, gravity: -9, drag: 0.5 });
          break;
        case 'shadow':
          this.smoke.emit({ x, y, z, vx: rand(-0.6, 0.6), vy: rand(0.2, 1), vz: rand(-0.6, 0.6), color: '#140810', size: rand(0.5, 0.8), sizeEnd: 1.3, life: rand(0.6, 1.1), alpha: 0.7 });
          this.glow.emit({ x, y, z, vx: rand(-1, 1), vy: rand(0, 1.4), vz: rand(-1, 1), color: c, size: rand(0.2, 0.4), life: rand(0.5, 0.9) });
          break;
        case 'holy':
          this.glow.emit({ x, y, z, vx: rand(-0.4, 0.4), vy: rand(0.8, 2.2), vz: rand(-0.4, 0.4), color: i % 2 ? '#ffffff' : c, size: rand(0.25, 0.5), life: rand(0.6, 1.2), drag: 1 });
          if (i % 2 === 0) this.spark.emit({ x, y, z, vy: rand(0.5, 1.5), color: c, size: 0.35, life: 0.8, spin: 2 });
          break;
        case 'arcane': {
          const a = Math.random() * Math.PI * 2;
          this.spark.emit({ x, y, z, vx: Math.cos(a) * 1.4, vy: rand(0, 1.2), vz: Math.sin(a) * 1.4, color: i % 2 ? '#ffffff' : c, size: rand(0.2, 0.4), life: rand(0.5, 0.9), drag: 2, spin: 4 });
          break;
        }
      }
    }
  }

  impact(pos: THREE.Vector3, ess: Essence, scale = 1) {
    const c = col(ess);
    this.flare(pos, c, 2.2 * scale, 0.25);
    this.ring(pos.clone().setY(0.08), c, 2.6 * scale, 0.45);
    this.glow.burst(pos.x, pos.y, pos.z, Math.round(26 * scale), c, 5 * scale, 0.42, 0.55, { gravity: -3 });
    this.spark.burst(pos.x, pos.y, pos.z, Math.round(10 * scale), '#ffffff', 6 * scale, 0.35, 0.35);
    this.emitEss(ess, pos, Math.round(10 * scale), 0.35);
    this.lightFlash(pos, c, 34 * scale, 0.35);
  }

  addShake(a: number) { this.shake = Math.min(1.4, this.shake + a); }

  // ---------------------------------------------------------------- units
  addUnit(u: UnitSnap, temp = false) {
    if (this.units.has(u.id)) return;
    const group = new THREE.Group();
    const model = makeUnit(u.kind, u.tint ? ESS[u.tint].color : null);
    if (u.kind === 'rat' || u.kind === 'salamander') model.scale.multiplyScalar(1.35);
    if (u.side === 1) model.rotation.y = 0; else model.rotation.y = Math.PI;
    if (temp) model.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && 'transparent' in m) { m.transparent = true; m.opacity = 0.8; } });
    model.scale.multiplyScalar(1.2);
    group.add(model);
    group.position.set(u.x, 0, u.z + (u.side === 0 ? 1.2 : -1.2));
    group.scale.setScalar(0.01);
    this.scene.add(group);
    const height = 1.2 * ({ imp: 1.0, pitlord: 1.9, cherub: 1.1, skeleton: 1.35, frostlich: 1.8, treant: 1.8, worldroot: 2.5, sapling: 1.0, rat: 0.5, salamander: 0.5, ball: 1.2, decoy: 1.8 } as Record<string, number>)[u.kind] || 1;
    const v: UnitView = { id: u.id, side: u.side, kind: u.kind, group, model, target: new THREE.Vector3(u.x, 0, u.z), height, alive: true, dying: 0, lunge: 0, lungeDir: new THREE.Vector3(), spawnT: 0, flash: 0, ice: null, morph: null, snap: u, hover: (model.userData.hover as number) || 0, phase: Math.random() * 6 };
    this.units.set(u.id, v);
    const p = new THREE.Vector3(u.x, 0.05, u.z);
    const c = u.tint ? col(u.tint) : new THREE.Color(u.side === 0 ? '#5cc0b0' : '#e0486e');
    this.ring(p, c, 3, 0.7);
    this.glow.burst(p.x, 0.3, p.z, 30, c, 3, 0.35, 0.8, { vy: 2, gravity: 0.5 });
    this.lightFlash(p, c, 20, 0.5);
  }

  killUnit(id: number, how?: string) {
    const u = this.units.get(id);
    if (!u || !u.alive) return;
    u.alive = false; u.dying = 0.001;
    const p = this.bodyPos(id);
    const c = u.snap?.tint ? col(u.snap.tint) : new THREE.Color(u.kind === 'ball' ? '#ffe066' : '#c8b8a0');
    if (how === 'fade') { this.glow.burst(p.x, p.y, p.z, 14, c, 1.5, 0.3, 0.7, { vy: 1 }); return; }
    this.glow.burst(p.x, p.y, p.z, 30, c, 4, 0.4, 0.8);
    this.smoke.burst(p.x, p.y * 0.6, p.z, 10, '#3a3040', 1.8, 0.8, 1.2, { gravity: 0.5, sizeEnd: 1.6, alpha: 0.6 });
  }

  // ---------------------------------------------------------------- projectiles
  addProj(ev: Extract<DuelEvent, { type: 'proj' }>, T: number) {
    const from = this.castPos(ev.from);
    const to = this.bodyPos(ev.to);
    const c = col(ev.ess);
    let head: THREE.Object3D;
    let ribbon: Ribbon | null = null;
    const size = ev.size;
    switch (ev.style) {
      case 'heavy': {
        const g = new THREE.Group();
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 * size, 0), new THREE.MeshStandardMaterial({ color: '#8a7a6a', roughness: 1, flatShading: true, emissive: c, emissiveIntensity: ev.ess === 'stone' ? 0.1 : 0.6 }));
        rock.castShadow = true; g.add(rock); g.add(glowSprite(c, 1.2 * size, 0.5));
        head = g; ribbon = new Ribbon(18, 0.14 * size, c);
        break;
      }
      case 'curse': case 'hex': {
        const g = new THREE.Group();
        g.add(glowSprite(c, 1.6 * size, 0.9));
        const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: sigilTex(ev.id % 7), color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        core.scale.setScalar(0.8 * size); g.add(core);
        head = g; ribbon = new Ribbon(22, 0.12 * size, c);
        break;
      }
      case 'seed': {
        const g = new THREE.Group();
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: '#4a3a1a', emissive: c, emissiveIntensity: 0.6 }));
        s.scale.set(1, 1.4, 1); g.add(s); g.add(glowSprite(c, 0.8, 0.6));
        head = g; ribbon = new Ribbon(14, 0.06, c);
        break;
      }
      case 'minor': {
        head = glowSprite(c, 0.7 * size + 0.3, 1);
        ribbon = new Ribbon(10, 0.08, c);
        break;
      }
      case 'lightning': case 'spark': {
        const g = new THREE.Group();
        g.add(glowSprite('#ffffff', 0.6 * size, 1)); g.add(glowSprite(c, 1.6 * size, 0.9));
        head = g; ribbon = new Ribbon(16, 0.1 * size, c);
        break;
      }
      default: {
        const g = new THREE.Group();
        g.add(glowSprite('#ffffff', 0.55 * size, 1)); g.add(glowSprite(c, 1.5 * size, 0.95));
        head = g; ribbon = new Ribbon(24, 0.2 * size, c);
      }
    }
    head.position.copy(from);
    this.scene.add(head);
    if (ribbon) this.scene.add(ribbon.mesh);
    this.projs.set(ev.id, { id: ev.id, from, toId: ev.to, to, t0: T, flight: ev.flight, ess: ev.ess, style: ev.style, size, head, ribbon, done: false, side: ev.from < 2 ? ev.from : (this.units.get(ev.from)?.side ?? 0), last: from.clone() });
    this.flare(from, c, 1.2 * size, 0.25);
    if (ev.from < 2 && ev.style !== 'minor') {
      this.mageState[ev.from].castFlash = 1; this.mageState[ev.from].recoil = 1;
      this.glow.burst(from.x, from.y, from.z, 16, c, 2.6, 0.35, 0.4, { gravity: 0 });
    }
  }

  projPos(p: ProjView, T: number, out: THREE.Vector3): number {
    const k = Math.min(1.05, Math.max(0, (T - p.t0) / p.flight));
    this.bodyPos(p.toId, p.to);
    out.lerpVectors(p.from, p.to, k);
    const arc = p.style === 'heavy' ? 3.2 : p.style === 'seed' ? 2.4 : p.style === 'curse' || p.style === 'hex' ? 1.4 : p.style === 'minor' ? 0.5 : p.style === 'lightning' || p.style === 'spark' ? 0.2 : 0.9;
    out.y += arc * 4 * k * (1 - k);
    if (p.style === 'curse' || p.style === 'hex') { out.x += Math.sin(k * 14 + p.id) * 0.25 * (1 - k); }
    if (p.style === 'spark' || p.style === 'lightning') { out.x += (Math.random() - 0.5) * 0.25; out.y += (Math.random() - 0.5) * 0.2; }
    return k;
  }

  endProj(id: number, outcome: string) {
    const p = this.projs.get(id);
    if (!p) return;
    p.done = true;
    const pos = p.head.position.clone();
    switch (outcome) {
      case 'hit': {
        const big = p.style === 'heavy' ? 1.4 : p.style === 'minor' ? 0.5 : p.style === 'spark' ? 0.7 : 1;
        this.impact(pos, p.ess, big * Math.min(1.6, p.size));
        if (p.style === 'heavy') { this.addShake(0.35); this.emitEss('stone', pos.clone().setY(0.2), 12, 0.6); }
        break;
      }
      case 'block': {
        this.flare(pos, '#bfe8ff', 2.4, 0.35); this.ring(pos, '#bfe8ff', 2.5, 0.4, false);
        this.spark.burst(pos.x, pos.y, pos.z, 26, '#e0f6ff', 5, 0.4, 0.5);
        break;
      }
      case 'reflect': {
        this.flare(pos, '#e8d8ff', 2.4, 0.35); this.ring(pos, '#c59bff', 2.2, 0.35, false);
        this.spark.burst(pos.x, pos.y, pos.z, 20, '#ffffff', 4, 0.4, 0.4);
        break;
      }
      default:
        this.glow.burst(pos.x, pos.y, pos.z, 12, col(p.ess), 1.5, 0.3, 0.5);
        this.smoke.burst(pos.x, pos.y, pos.z, 4, '#40384a', 1, 0.6, 0.8, { gravity: 0.3, sizeEnd: 1.2, alpha: 0.5 });
    }
    this.killProj(p);
    this.projs.delete(id);
  }

  killProj(p: ProjView) {
    this.scene.remove(p.head);
    p.head.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.dispose(); const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
    if (p.ribbon) {
      const r = p.ribbon;
      // let the trail fade out instead of vanishing
      this.transients.push({ obj: r.mesh, t: 0, dur: 0.3, update: (k) => { r.fade = 1 - k; r.update(this.camera); }, dispose: () => { this.scene.remove(r.mesh); r.dispose(); } });
    }
  }

  // ---------------------------------------------------------------- fields
  addField(ev: Extract<DuelEvent, { type: 'field' }>) {
    const kindIdx = FIELD_KIND[ev.kind] ?? 0;
    const w = ev.kind === 'seed' ? 1.6 : 15, d = ev.kind === 'seed' ? 1.6 : 6.4;
    const zc = ev.on === 0 ? 3.5 : -3.5;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uKind: { value: kindIdx }, uColor: { value: col(ev.ess) }, uNoise: { value: noiseTex() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime, uAlpha, uKind; uniform vec3 uColor; uniform sampler2D uNoise; varying vec2 vUv;
        void main(){
          vec2 uv = vUv;
          vec2 c = uv - 0.5;
          float edge = smoothstep(0.5, 0.28, length(c * vec2(1.0, 1.15)));
          float n = texture2D(uNoise, uv * vec2(2.6, 1.2) + vec2(uTime * 0.03, uTime * 0.05)).r;
          float n2 = texture2D(uNoise, uv * vec2(6.0, 2.6) - vec2(uTime * 0.08, 0.0)).g;
          float n3 = texture2D(uNoise, uv * vec2(1.5, 0.7) + vec2(0.0, uTime * 0.02)).b;
          float v;
          vec3 colr = uColor;
          if (uKind < 0.5) { v = smoothstep(0.45, 0.85, n * 0.7 + n2 * 0.5); colr = mix(uColor, vec3(1.0, 0.85, 0.4), v); }
          else if (uKind < 1.5) { float cr = smoothstep(0.55, 0.75, n2) * smoothstep(0.3, 0.7, n); v = 0.25 + 0.75 * cr; colr = mix(uColor, vec3(0.9, 0.97, 1.0), 0.4 * v); }
          else if (uKind < 2.5) { v = smoothstep(0.42, 0.62, n * 0.8 + n3 * 0.4); colr = mix(uColor * 0.6, uColor, v); }
          else if (uKind < 3.5) { v = 0.5 + 0.5 * sin(length(c) * 40.0 - uTime * 3.0); v = v * 0.5 + 0.5 * n; colr = mix(uColor, vec3(1.0), 0.3); }
          else if (uKind < 4.5) { v = smoothstep(0.6, 0.95, n2) + 0.25 * n3; }
          else if (uKind < 5.5) { v = smoothstep(0.35, 0.6, n3 + n * 0.3); colr = vec3(0.2, 0.15, 0.08); }
          else { float rip = 0.5 + 0.5 * sin(n3 * 30.0 + uTime * 2.0); v = 0.2 + 0.5 * rip * n; colr = uColor * 0.7; }
          float a = edge * uAlpha * (0.12 + 0.6 * v);
          gl_FragColor = vec4(colr * (0.35 + 0.8 * v), a);
        }`,
      transparent: true, depthWrite: false, blending: ev.kind === 'oil' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI / 2;
    const pos = ev.kind === 'seed' ? this.bodyPos(ev.on).setY(0.04) : new THREE.Vector3(0, 0.04, zc);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const clouds: THREE.Sprite[] = [];
    if (ev.kind === 'rain' || ev.kind === 'thunder' || ev.kind === 'blizzard') {
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color: ev.kind === 'thunder' ? '#2a2838' : ev.kind === 'blizzard' ? '#8a9ab0' : '#4a5a70', transparent: true, opacity: 0, depthWrite: false }));
        s.scale.setScalar(rand(3, 4.5));
        s.position.set(rand(-6, 6), rand(4.2, 5.0), zc + rand(-1.5, 1.5));
        s.userData.base = s.position.clone();
        this.scene.add(s); clouds.push(s);
      }
    }
    this.fields.set(ev.id, { id: ev.id, on: ev.on, kind: ev.kind, ess: ev.ess, mesh, age: 0, dur: ev.dur, ending: 0, clouds });
    if (ev.kind === 'consecration') this.ring(pos.clone().setY(0.1), '#ffeaa0', 8, 0.9);
    if (ev.kind === 'oil') for (const b of this.bodiesOnSide(ev.on)) this.emitEss('stone', b, 6, 0.4);
    if (ev.kind === 'smoke') this.smoke.burst(0, 1, zc, 30, '#5a8a3a', 2, 1.4, 2.5, { gravity: 0.2, sizeEnd: 3, alpha: 0.5 });
  }

  bodiesOnSide(side: number): THREE.Vector3[] {
    const out = [this.bodyPos(side)];
    for (const u of this.units.values()) if (u.alive && u.side === side) out.push(this.bodyPos(u.id));
    return out;
  }

  endField(id: number) { const f = this.fields.get(id); if (f) f.ending = 0.001; }

  // ---------------------------------------------------------------- curses and wards
  addSigil(side: 0 | 1, key: number, ess: Essence) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sigilTex(key % 7), color: col(ess), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(0.01);
    this.scene.add(s);
    this.sigils.push({ key, side, sprite: s, ess, pulse: 1, dying: 0 });
    const p = this.bodyPos(side);
    this.emitEss('shadow', p, 16, 0.5);
    this.ring(p.clone().setY(0.08), col(ess), 3, 0.6);
  }

  pulseSigil(key: number) {
    const s = this.sigils.find(x => x.key === key);
    if (!s) return;
    s.pulse = 1;
    const p = s.sprite.position;
    this.glow.burst(p.x, p.y, p.z, 8, col(s.ess), 1.4, 0.3, 0.4, { gravity: -1 });
  }

  endSigil(key: number, how: string) {
    const s = this.sigils.find(x => x.key === key);
    if (!s) return;
    s.dying = 0.001;
    const p = s.sprite.position;
    this.spark.burst(p.x, p.y, p.z, how === 'doom' ? 40 : 16, col(s.ess), how === 'doom' ? 6 : 3, 0.4, 0.6);
  }

  wardVisual(side: 0 | 1, snap: Snap['m'][0]) {
    const g = this.wards[side];
    const want: Record<string, boolean> = { block: snap.block > 0, mirror: snap.mirror > 0, counter: snap.counter > 0, sanctuary: snap.sanctuary, angel: snap.angel };
    for (const k of Object.keys(want)) {
      let o = g.getObjectByName(k);
      if (want[k] && !o) { o = this.makeWard(k, side); o.name = k; g.add(o); o.scale.setScalar(0.01); o.userData.target = 1; }
      if (o) o.userData.target = want[k] ? 1 : 0;
    }
  }

  makeWard(kind: string, side: number): THREE.Object3D {
    const facing = side === 0 ? -1 : 1;
    switch (kind) {
      case 'block': {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), new THREE.MeshStandardMaterial({ color: '#bfe8ff', emissive: '#5ab0ff', emissiveIntensity: 0.5, transparent: true, opacity: 0.12, wireframe: true, depthWrite: false }));
        m.position.y = 1.0; m.userData.spin = 0.3; return m;
      }
      case 'mirror': {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshStandardMaterial({ color: '#e8e0ff', metalness: 1, roughness: 0.05, emissive: '#8a6acf', emissiveIntensity: 0.6, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
        m.position.set(0, 1.3, facing * 1.1); m.userData.bob = 1; return m;
      }
      case 'counter': {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: runeCircleTex(1), color: '#c59bff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.position.set(0, 2.4, 0); s.scale.setScalar(1); s.userData.spinSprite = 1; return s;
      }
      case 'sanctuary': {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffeaa0', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        return m;
      }
      case 'angel': {
        const g = new THREE.Group();
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 32), new THREE.MeshBasicMaterial({ color: '#fff4c0' }));
        halo.rotation.x = Math.PI / 2; halo.position.y = 2.25; g.add(halo);
        const gl = glowSprite('#ffeaa0', 1.2, 0.5); gl.position.y = 2.25; g.add(gl);
        return g;
      }
    }
    return new THREE.Group();
  }

  morph(id: number, form: string) {
    const target = id < 2 ? this.mages[id].root : this.units.get(id)?.group;
    if (!target) return;
    const pos = this.bodyPos(id);
    this.spark.burst(pos.x, pos.y, pos.z, 40, '#e8c8ff', 4, 0.4, 0.6);
    this.smoke.burst(pos.x, pos.y, pos.z, 14, '#d8c8f0', 2, 0.8, 0.9, { gravity: 0.3, sizeEnd: 1.8, alpha: 0.6 });
    const m = form === 'imp' ? makeUnit('imp', '#c59bff') : makeSheep();
    if (id < 2) {
      const st = this.mageState[id];
      if (st.morph) this.scene.remove(st.morph);
      m.position.copy(this.mages[id].root.position); m.rotation.y = id === 0 ? Math.PI : 0;
      m.scale.setScalar(form === 'imp' ? 1.3 : 1.2);
      this.scene.add(m); st.morph = m;
      this.mages[id].body.visible = false;
    } else {
      const u = this.units.get(id)!;
      if (u.morph) u.group.remove(u.morph);
      u.morph = m; u.group.add(m); u.model.visible = false;
    }
  }

  unmorph(id: number) {
    const pos = this.bodyPos(id);
    this.smoke.burst(pos.x, pos.y, pos.z, 10, '#d8c8f0', 2, 0.7, 0.8, { gravity: 0.3, sizeEnd: 1.6, alpha: 0.5 });
    if (id < 2) {
      const st = this.mageState[id];
      if (st.morph) { this.scene.remove(st.morph); disposeObj(st.morph); st.morph = null; }
      this.mages[id].body.visible = true;
    } else {
      const u = this.units.get(id);
      if (u && u.morph) { u.group.remove(u.morph); u.morph = null; u.model.visible = true; }
    }
  }

  setFrozen(id: number, on: boolean) {
    if (id < 2) {
      const st = this.mageState[id];
      if (on && !st.ice) { st.ice = makeIceBlock(); this.mages[id].root.add(st.ice); }
      if (!on && st.ice) { this.mages[id].root.remove(st.ice); st.ice = null; this.shatterFx(id); }
    } else {
      const u = this.units.get(id); if (!u) return;
      if (on && !u.ice) { u.ice = makeIceBlock(); u.ice.scale.multiplyScalar(u.height / 1.9); u.ice.position.y = u.height * 0.5; u.group.add(u.ice); }
      if (!on && u.ice) { u.group.remove(u.ice); u.ice = null; this.shatterFx(id); }
    }
  }

  shatterFx(id: number) {
    const p = this.bodyPos(id);
    for (let i = 0; i < 26; i++) this.spark.emit({ x: p.x, y: p.y, z: p.z, vx: rand(-4, 4), vy: rand(1, 5), vz: rand(-4, 4), color: i % 2 ? '#ffffff' : '#9fdcff', size: rand(0.25, 0.5), life: rand(0.5, 0.9), gravity: -9, drag: 0.8, spin: rand(-8, 8) });
  }

  // ---------------------------------------------------------------- event handling
  handle(ev: DuelEvent, T: number) {
    switch (ev.type) {
      case 'read': {
        const st = this.mageState[ev.side]; st.reading = true; st.ess = ev.ess; st.read = 0;
        break;
      }
      case 'cast': {
        const st = this.mageState[ev.side]; st.reading = false; st.castFlash = 1;
        const p = this.castPos(ev.side);
        if (ev.form !== 'bolt' && ev.form !== 'burst' && ev.form !== 'curse' && ev.form !== 'hex') {
          this.flare(p, col(ev.ess), 2.2, 0.35);
          this.emitEss(ev.ess, p, 14, 0.3);
          this.ring(this.mages[ev.side].root.position.clone().setY(0.08), col(ev.ess), 3.4, 0.6);
        }
        if (ev.legendary) { this.addShake(0.5); this.ring(this.mages[ev.side].root.position.clone().setY(0.1), '#ffd070', 7, 1.2); }
        break;
      }
      case 'fizzle': {
        const p = this.castPos(ev.side);
        this.smoke.burst(p.x, p.y, p.z, 10, '#5a5070', 1.2, 0.6, 0.9, { gravity: 0.4, sizeEnd: 1.3, alpha: 0.6 });
        this.mageState[ev.side].reading = false;
        break;
      }
      case 'proj': this.addProj(ev, T); break;
      case 'projEnd': this.endProj(ev.id, ev.outcome); break;
      case 'burst': {
        const from = ev.from < 2 ? this.castPos(ev.from) : this.bodyPos(ev.from);
        const to = this.sideCenter(ev.side);
        if (ev.flight <= 0) {
          const at = ev.from >= 2 ? from : this.bodyPos(ev.from);
          this.impact(at, ev.ess, 1.6);
          this.ring(at.clone().setY(0.1), col(ev.ess), 5, 0.6);
          this.addShake(0.35);
          break;
        }
        const orb = new THREE.Group();
        orb.add(glowSprite('#ffffff', 0.8, 1)); orb.add(glowSprite(col(ev.ess), 2.4, 0.95));
        orb.position.copy(from); this.scene.add(orb);
        const r = new Ribbon(22, 0.3, col(ev.ess)); this.scene.add(r.mesh);
        const ess = ev.ess, all = !!ev.all, side = ev.side;
        this.transients.push({ obj: orb, t: 0, dur: ev.flight, update: (k, o) => {
          o.position.lerpVectors(from, to, k); o.position.y += 3.5 * 4 * k * (1 - k);
          r.push(o.position); r.update(this.camera);
          this.emitEss(ess, o.position, 2, 0.15);
          if (k >= 1) {
            this.impact(to, ess, 2);
            this.ring(to.clone().setY(0.1), col(ess), all ? 20 : 11, all ? 1 : 0.7);
            for (const b of this.bodiesOnSide(side)) this.impact(b, ess, 0.8);
            this.addShake(all ? 1.2 : 0.55);
          }
        }, dispose: () => { this.scene.remove(r.mesh); r.dispose(); } });
        break;
      }
      case 'dmg': {
        const p = this.bodyPos(ev.tgt);
        if (ev.tgt < 2) {
          if (ev.amt >= 3) this.mageState[ev.tgt].flash = Math.min(1, ev.amt / 20 + 0.3);
          if (ev.amt >= 12) this.addShake(Math.min(0.8, ev.amt / 40));
        } else { const u = this.units.get(ev.tgt); if (u) u.flash = 1; }
        if (ev.kind === 'dot') this.emitEss(ev.ess || 'fire', p, 3, 0.3);
        if (ev.crit) { this.addShake(0.8); this.impact(p, 'frost', 1.6); }
        this.hooks?.onNumber(p.clone().setY(p.y + 1.0), `${Math.round(ev.amt)}`, ev.crit ? 'crit' : ev.kind === 'dot' || ev.kind === 'curse' ? 'dot' : 'dmg', ev.ess ? ESS[ev.ess].color : undefined);
        break;
      }
      case 'heal': {
        const p = this.bodyPos(ev.tgt);
        if (ev.amt >= 1) this.hooks?.onNumber(p.clone().setY(p.y + 1.1), `+${Math.round(ev.amt)}`, 'heal');
        for (let i = 0; i < Math.min(14, 3 + ev.amt); i++) this.glow.emit({ x: p.x + rand(-0.4, 0.4), y: p.y - 0.6 + rand(0, 0.5), z: p.z + rand(-0.4, 0.4), vy: rand(1, 2.2), color: i % 2 ? '#bff3de' : '#ffeaa0', size: rand(0.25, 0.45), life: rand(0.7, 1.1), drag: 0.8 });
        break;
      }
      case 'status': {
        if (ev.n > 0) this.emitEss(({ burn: 'fire', chill: 'frost', wet: 'frost', poison: 'venom', oil: 'stone', charge: 'storm', hex: 'shadow' } as Record<string, Essence>)[ev.s], this.bodyPos(ev.tgt), 4, 0.4);
        break;
      }
      case 'react': {
        const p = this.bodyPos(ev.tgt);
        const color = ({ frozen: '#9fdcff', shatter: '#e0f6ff', blaze: '#ff7a3d', conduct: '#ffe066', douse: '#6fb6ff', steam: '#f0f0f0', smoke: '#94e36a', congeal: '#c9a86a', exorcism: '#ffeaa0', resist: '#9fdcff', split: '#c59bff' } as Record<string, string>)[ev.id] || '#f6e7a8';
        if (ev.id !== 'resist') {
          this.hooks?.onBigText(p.clone().setY(p.y + 1.6), ev.name, color);
          this.flare(p, color, 3.5, 0.4);
          this.ring(p.clone().setY(0.1), color, 4.5, 0.6);
          this.lightFlash(p, color, 40, 0.5);
        }
        if (ev.id === 'blaze') { this.emitEss('fire', p, 40, 0.8, 2); this.addShake(0.5); }
        if (ev.id === 'conduct') { for (let i = 0; i < 3; i++) this.lightning(p.clone().setY(6), p, '#ffe066', 0.16, 0.3); this.addShake(0.4); }
        if (ev.id === 'steam' || ev.id === 'douse') this.smoke.burst(p.x, p.y, p.z, 24, '#e8e8f0', 2, 1, 1.6, { gravity: 0.6, sizeEnd: 2.4, alpha: 0.55 });
        if (ev.id === 'shatter') this.shatterFx(ev.tgt);
        if (ev.id === 'exorcism') this.emitEss('holy', p, 40, 0.7, 2);
        break;
      }
      case 'spawn': this.addUnit(ev.unit, ev.temp); break;
      case 'unitAtk': {
        const u = this.units.get(ev.id);
        if (u) { u.lunge = 1; u.lungeDir.copy(this.bodyPos(ev.tgt)).sub(u.group.position).setY(0).normalize(); }
        if (ev.tgt < 2 && u?.kind === 'cherub') this.emitEss('holy', this.bodyPos(ev.tgt), 10, 0.5);
        break;
      }
      case 'death': {
        if (ev.tgt < 2) {
          const st = this.mageState[ev.tgt]; st.dead = 0.001;
          const p = this.bodyPos(ev.tgt);
          this.smoke.burst(p.x, p.y, p.z, 40, '#0a0610', 2.5, 1.2, 2.2, { gravity: 0.3, sizeEnd: 2.5, alpha: 0.85 });
          this.glow.burst(p.x, p.y, p.z, 60, ev.tgt === 0 ? '#7fe8ff' : '#ff5a78', 5, 0.4, 1.2);
          this.addShake(1);
        } else this.killUnit(ev.tgt, ev.how);
        break;
      }
      case 'field': this.addField(ev); break;
      case 'fieldEnd': this.endField(ev.id); break;
      case 'strike': {
        const p = this.bodyPos(ev.tgt);
        const c = col(ev.ess);
        if (ev.ess === 'holy') {
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 8, 16, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
          beam.position.copy(p).setY(4); this.scene.add(beam);
          this.transients.push({ obj: beam, t: 0, dur: 0.5, update: (k, o) => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k); o.scale.set(1 - k * 0.6, 1, 1 - k * 0.6); }, dispose: () => { beam.geometry.dispose(); (beam.material as THREE.Material).dispose(); } });
          this.emitEss('holy', p, 14, 0.4);
        } else {
          this.lightning(p.clone().add(new THREE.Vector3(rand(-1, 1), 7, rand(-1, 1))), p.clone().setY(0.1), c, 0.2, 0.3);
          this.lightning(p.clone().add(new THREE.Vector3(rand(-1, 1), 7, rand(-1, 1))), p.clone().setY(0.1), '#ffffff', 0.08, 0.2);
          this.impact(p, ev.ess, 0.9);
          this.engineFlash?.('#fff6c0', 0.12);
        }
        break;
      }
      case 'arc': this.lightning(this.bodyPos(ev.from), this.bodyPos(ev.to), col(ev.ess), 0.12, 0.3); break;
      case 'curse': this.addSigil(ev.side, ev.key, ev.ess); break;
      case 'cursePulse': this.pulseSigil(ev.key); break;
      case 'curseEnd': this.endSigil(ev.key, ev.how); break;
      case 'aura': {
        const p = this.mages[ev.side].root.position.clone().setY(0.1);
        this.ring(p, col(ev.ess), 4, 0.8);
        this.emitEss(ev.ess, p.setY(0.8), 24, 0.6);
        break;
      }
      case 'ward': {
        const p = this.bodyPos(ev.side);
        this.flare(p, '#e8e0ff', 3, 0.4);
        this.ring(p.clone().setY(0.1), '#c8d8ff', 3.5, 0.5);
        break;
      }
      case 'wardUse': {
        const p = this.bodyPos(ev.side);
        if (ev.kind === 'angel') { this.emitEss('holy', p, 60, 1, 2); this.ring(p.clone().setY(0.1), '#ffeaa0', 8, 1); this.lightFlash(p, '#ffeaa0', 60, 0.8); }
        break;
      }
      case 'freeze': this.setFrozen(ev.tgt, true); break;
      case 'thaw': this.setFrozen(ev.tgt, false); break;
      case 'morph': this.morph(ev.tgt, ev.form); break;
      case 'unmorph': this.unmorph(ev.tgt); break;
      case 'backfire': { const p = this.bodyPos(ev.side); this.emitEss('arcane', p, 20, 0.5); break; }
      case 'shake': this.addShake(ev.amt * 0.6); break;
      case 'sudden': this.sudden = 1; break;
      case 'art': { const p = this.bodyPos(ev.side); p.y += 1.4; const a = ARTIFACTS[ev.id]; this.flare(p, a?.model.glow || '#ffffff', 1.8, 0.5); this.glow.burst(p.x, p.y, p.z, 12, a?.model.glow || '#ffffff', 1.6, 0.3, 0.6, { gravity: 0.5 }); break; }
    }
  }

  engineFlash?: (c: string, s: number) => void;

  // ---------------------------------------------------------------- per-frame
  applySnap(s: Snap) {
    this.snap = s;
    for (const u of s.u) {
      let v = this.units.get(u.id);
      if (!v) { this.addUnit(u); v = this.units.get(u.id)!; }
      v.snap = u;
      v.target.set(u.x, 0, u.z);
      if (u.frozen && !v.ice) this.setFrozen(u.id, true);
      if (!u.frozen && v.ice) this.setFrozen(u.id, false);
    }
    const live = new Set(s.u.map(u => u.id));
    for (const v of this.units.values()) if (v.alive && !live.has(v.id)) this.killUnit(v.id, 'fade');
    s.m.forEach((m, i) => {
      this.wardVisual(i as 0 | 1, m);
      const st = this.mageState[i];
      if (m.frozen && !st.ice) this.setFrozen(i, true);
      if (!m.frozen && st.ice) this.setFrozen(i, false);
      const ring = this.auraRings[i];
      const mat = ring.material as THREE.MeshBasicMaterial;
      if (m.auras.length) { mat.color.set(ESS[m.auras[m.auras.length - 1].ess].color); mat.opacity = 0.4 + 0.15 * Math.sin(this.time * 3); }
      else mat.opacity = 0;
    });
    const keys = new Set<number>();
    s.m.forEach(m => m.curses.forEach(c => keys.add(c.key)));
    for (const sg of this.sigils) if (!keys.has(sg.key) && !sg.dying) sg.dying = 0.001;
  }

  update(dt: number, time: number) {
    this.time = time;
    this.runeFloor.rotation.z += dt * 0.03;
    (this.divide.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.15 * Math.sin(time * 1.3) + this.sudden * 0.3 * (0.5 + 0.5 * Math.sin(time * 6));
    (this.runeFloor.material as THREE.MeshBasicMaterial).color.set(this.sudden ? '#a03040' : '#3a9a8c');
    // braziers
    this.braziers.forEach((b, i) => {
      if (Math.random() < 0.9) this.glow.emit({ x: b.pos.x + rand(-0.3, 0.3), y: b.pos.y, z: b.pos.z + rand(-0.3, 0.3), vx: rand(-0.3, 0.3), vy: rand(1.2, 2.6), vz: rand(-0.3, 0.3), color: Math.random() < 0.3 ? '#ffd070' : '#ff7a30', size: rand(0.5, 0.95), sizeEnd: 0.05, life: rand(0.4, 0.8), drag: 1, gravity: 1 });
      if (Math.random() < 0.15) this.smoke.emit({ x: b.pos.x, y: b.pos.y + 1, z: b.pos.z, vy: 1, color: '#1a1418', size: 0.9, sizeEnd: 2, life: 2, alpha: 0.4 });
      if (b.light) b.light.intensity = 24 + Math.sin(time * 9 + i) * 3 + Math.sin(time * 23 + i * 2) * 2;
    });
    // ambient motes
    if (Math.random() < 0.5) this.glow.emit({ x: rand(-9, 9), y: rand(0.2, 3), z: rand(-8, 8), vy: rand(0.05, 0.2), color: '#ffe2b0', size: rand(0.08, 0.16), life: rand(3, 6), drag: 0, jitter: 0.5, alpha: 0.6 });
    // mages
    this.mages.forEach((m, i) => {
      const st = this.mageState[i];
      const snapM = this.snap?.m[i];
      const c = col(st.ess);
      const readK = snapM && snapM.phase === 'reading' ? Math.min(1, snapM.prog / Math.max(0.01, snapM.total)) : 0;
      const runeMat = m.runes.material as THREE.MeshBasicMaterial;
      runeMat.color.copy(c);
      runeMat.opacity += ((st.reading ? 0.25 + readK * 0.4 : 0) - runeMat.opacity) * Math.min(1, dt * 6);
      m.runes.rotation.z += dt * (0.4 + readK * 2.5) * (i === 0 ? 1 : -1);
      m.runes.scale.setScalar(0.85 + readK * 0.3);
      for (const pg of m.pages) { const pm = pg.material as THREE.MeshStandardMaterial; pm.emissive.copy(st.reading ? c : new THREE.Color('#ffe7b0')); pm.emissiveIntensity = st.reading ? 0.4 + readK * 1.4 : 0.1; }
      m.book.position.y = 0.95 + Math.sin(time * 2 + i) * 0.05;
      m.book.rotation.z = Math.sin(time * 1.3 + i) * 0.05;
      const L = this.mageLights[i];
      L.color.copy(c);
      L.intensity += ((st.reading ? 3 + readK * 8 : 0) + st.castFlash * 14 - L.intensity) * Math.min(1, dt * 10);
      st.castFlash = Math.max(0, st.castFlash - dt * 3);
      st.recoil = Math.max(0, st.recoil - dt * 4);
      if (st.reading && Math.random() < 0.5 + readK) {
        const tip = this.castPos(i);
        this.glow.emit({ x: tip.x + rand(-0.15, 0.15), y: tip.y + rand(-0.1, 0.1), z: tip.z + rand(-0.15, 0.15), vy: rand(0.2, 0.8), color: c, size: rand(0.15, 0.3) * (0.6 + readK), life: 0.5, drag: 1 });
        const a = Math.random() * Math.PI * 2, r = 1.2 * (1 - readK * 0.5);
        this.glow.emit({ x: m.root.position.x + Math.cos(a) * r, y: 0.1, z: m.root.position.z + Math.sin(a) * r, vx: -Math.cos(a) * 0.6, vy: rand(0.8, 1.8), vz: -Math.sin(a) * 0.6, color: c, size: rand(0.18, 0.32), life: 0.8, drag: 0.5 });
      }
      // body animation
      m.body.position.y = Math.sin(time * 1.6 + i * 2) * 0.03;
      m.body.rotation.x = -st.recoil * 0.12 * (1);
      for (const e of m.eyes) (e.material as THREE.MeshStandardMaterial).emissiveIntensity = 3 + st.castFlash * 6;
      const flash = st.flash;
      m.robeMat.emissive.setRGB(flash * 0.45, flash * 0.1, flash * 0.08);
      st.flash = Math.max(0, st.flash - dt * 5);
      // statuses shown as particles
      if (snapM) this.statusFx(this.bodyPos(i, this.tmpV).clone(), snapM.st, dt, 1);
      if (st.morph) st.morph.position.y = Math.abs(Math.sin(time * 5)) * 0.1;
      if (st.dead > 0) {
        st.dead += dt;
        m.root.position.y = -Math.min(1.8, st.dead * 0.9);
        m.root.rotation.x = Math.min(0.5, st.dead * 0.4) * (i === 0 ? 1 : -1);
        if (Math.random() < 0.8) { const p = this.bodyPos(i); this.smoke.emit({ x: p.x + rand(-0.4, 0.4), y: 0.4, z: p.z + rand(-0.4, 0.4), vy: rand(0.4, 1), color: '#0a0610', size: 1, sizeEnd: 2, life: 1.5, alpha: 0.7 }); }
      }
      // wards
      const wg = this.wards[i];
      for (const o of wg.children) {
        const t = (o.userData.target as number) ?? 1;
        const s = o.scale.x + (t - o.scale.x) * Math.min(1, dt * 8);
        o.scale.setScalar(Math.max(0.001, s));
        if (o.userData.spin) o.rotation.y += dt * (o.userData.spin as number);
        if (o.userData.bob) o.position.y = 1.3 + Math.sin(time * 2) * 0.08;
        if (o.userData.spinSprite) ((o as THREE.Sprite).material as THREE.SpriteMaterial).rotation += dt;
        if (t === 0 && s < 0.02) { wg.remove(o); }
      }
    });
    // units
    for (const u of this.units.values()) {
      if (u.spawnT < 1) { u.spawnT = Math.min(1, u.spawnT + dt * 2.5); const k = 1 - Math.pow(1 - u.spawnT, 3); u.group.scale.setScalar(Math.max(0.01, k * (1 + Math.sin(u.spawnT * Math.PI) * 0.2))); }
      u.group.position.x += (u.target.x - u.group.position.x) * Math.min(1, dt * 3);
      u.group.position.z += (u.target.z - u.group.position.z) * Math.min(1, dt * 3);
      const hover = u.hover ? u.hover + Math.sin(time * 3 + u.phase) * 0.08 : 0;
      u.group.position.y = hover;
      if (u.lunge > 0) {
        u.lunge = Math.max(0, u.lunge - dt * 3.5);
        const k = Math.sin(u.lunge * Math.PI) * 0.5;
        u.model.position.set(u.lungeDir.x * k, 0, u.lungeDir.z * k);
      } else u.model.position.set(0, 0, 0);
      u.model.traverse(o => { if (o.userData.wing) o.rotation.y = (o.userData.wing as number) * (0.6 + Math.sin(time * 16 + u.phase) * 0.4); if (o.userData.spin) { o.rotation.y += dt * 2; o.rotation.x += dt * 1.3; } });
      if (u.flash > 0) {
        u.flash = Math.max(0, u.flash - dt * 5);
        u.model.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && m.emissive && !m.userData.baseE) { m.userData.baseE = m.emissive.clone(); } if (m && m.emissive) m.emissive.copy((m.userData.baseE as THREE.Color)).lerp(new THREE.Color('#ff4030'), u.flash * 0.7); });
      }
      if (u.kind === 'ball' && Math.random() < 0.6) { const p = this.bodyPos(u.id); this.spark.emit({ x: p.x + rand(-0.4, 0.4), y: p.y + rand(-0.4, 0.4), z: p.z + rand(-0.4, 0.4), vx: rand(-2, 2), vy: rand(-2, 2), vz: rand(-2, 2), color: '#ffe066', size: 0.3, life: 0.2, jitter: 40 }); }
      if (u.alive && u.snap) this.statusFx(this.bodyPos(u.id, this.tmpV).clone(), u.snap.st, dt, 0.45);
      if (!u.alive) {
        u.dying += dt;
        const k = u.dying / 0.6;
        u.group.scale.setScalar(Math.max(0.001, 1 - k));
        u.group.position.y -= dt * 0.8;
        if (k >= 1) { this.scene.remove(u.group); disposeObj(u.group); this.units.delete(u.id); }
      }
    }
    // projectiles are moved by the player (needs duel time); here we only update trails
    // fields
    for (const f of this.fields.values()) {
      f.age += dt;
      const mat = f.mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = time;
      const fadeIn = Math.min(1, f.age / 0.5);
      let a = fadeIn;
      if (f.ending > 0) { f.ending += dt; a = Math.max(0, 1 - f.ending / 0.8); }
      mat.uniforms.uAlpha.value = a * (f.kind === 'seed' ? 1.2 : 0.95);
      for (const c of f.clouds) {
        const b = c.userData.base as THREE.Vector3;
        c.position.x = b.x + Math.sin(time * 0.3 + b.z) * 0.6;
        (c.material as THREE.SpriteMaterial).opacity = a * (f.kind === 'thunder' ? 0.85 : 0.6);
      }
      const zc = f.on === 0 ? 3.5 : -3.5;
      if (a > 0.3) {
        const r = Math.random();
        switch (f.kind) {
          case 'rain': for (let i = 0; i < 3; i++) this.glow.emit({ x: rand(-6.5, 6.5), y: 4.4, z: zc + rand(-2.4, 2.4), vy: -16, color: '#4a7ab0', size: 0.12, sizeEnd: 0.1, life: 0.28, drag: 0, alpha: 0.5 }); break;
          case 'blizzard': if (r < 0.7) this.glow.emit({ x: rand(-6.5, 6.5), y: 4.2, z: zc + rand(-2.4, 2.4), vx: 1.5, vy: -2.5, color: '#8aa8c8', size: rand(0.1, 0.18), sizeEnd: 0.1, life: 1.8, drag: 0, jitter: 3, alpha: 0.55 }); break;
          case 'miasma': case 'smog': case 'smoke': if (r < 0.5) this.smoke.emit({ x: rand(-6, 6), y: 0.3, z: zc + rand(-2.2, 2.2), vy: rand(0.1, 0.4), color: f.kind === 'smoke' ? '#3a5a2a' : '#4a7a2a', size: rand(1.2, 2), sizeEnd: 2.8, life: 2.2, alpha: 0.4 }); break;
          case 'consecration': if (r < 0.6) this.glow.emit({ x: rand(-6, 6), y: 0.1, z: zc + rand(-2.2, 2.2), vy: rand(0.6, 1.4), color: '#ffeaa0', size: rand(0.2, 0.4), life: 1.4, drag: 0 }); break;
          case 'thunder': if (r < 0.02) { const x = rand(-6, 6), z = zc + rand(-2, 2); this.lightning(new THREE.Vector3(x, 4.5, z), new THREE.Vector3(x + rand(-1, 1), 3, z), '#ffe066', 0.08, 0.2); } break;
          case 'oil': if (r < 0.2) this.glow.emit({ x: rand(-6, 6), y: 0.1, z: zc + rand(-2.2, 2.2), vy: 0.2, color: '#8a6a3a', size: 0.3, life: 1, alpha: 0.4 }); break;
        }
      }
      if (f.ending > 0.8) {
        this.scene.remove(f.mesh); f.mesh.geometry.dispose(); mat.dispose();
        for (const c of f.clouds) { this.scene.remove(c); (c.material as THREE.Material).dispose(); }
        this.fields.delete(f.id);
      }
    }
    // curse sigils orbit above their victim
    const bySide: Sigil[][] = [[], []];
    for (const s of this.sigils) bySide[s.side].push(s);
    bySide.forEach((list, side) => {
      const p = this.bodyPos(side);
      list.forEach((s, k) => {
        const a = time * 0.8 + (k / Math.max(1, list.length)) * Math.PI * 2;
        s.sprite.position.set(p.x + Math.cos(a) * 0.95, 2.35 + Math.sin(time * 2 + k) * 0.08, p.z + Math.sin(a) * 0.95);
        s.pulse = Math.max(0, s.pulse - dt * 3);
        let sc = 0.55 + s.pulse * 0.45;
        if (s.dying > 0) { s.dying += dt; sc *= Math.max(0, 1 - s.dying * 2.5); }
        s.sprite.scale.setScalar(Math.max(0.001, s.sprite.scale.x + (sc - s.sprite.scale.x) * Math.min(1, dt * 10)));
        (s.sprite.material as THREE.SpriteMaterial).opacity = 0.75 + s.pulse * 0.25;
        if (Math.random() < 0.15) this.glow.emit({ x: s.sprite.position.x, y: s.sprite.position.y, z: s.sprite.position.z, vy: -0.4, color: ESS[s.ess].color, size: 0.2, life: 0.6 });
      });
    });
    this.sigils = this.sigils.filter(s => { if (s.dying > 0.5) { this.scene.remove(s.sprite); (s.sprite.material as THREE.Material).dispose(); return false; } return true; });
    // transients
    this.transients = this.transients.filter(t => {
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.update(k, t.obj);
      if (k >= 1) { this.scene.remove(t.obj); t.dispose?.(); return false; }
      return true;
    });
    for (const f of this.flashes) {
      f.t += dt;
      f.light.intensity = f.t < f.dur ? f.power * (1 - f.t / f.dur) : 0;
    }
    this.glow.update(dt); this.spark.update(dt); this.smoke.update(dt);
    // camera
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.35;
    this.camera.position.set(this.camBase.x + (Math.random() - 0.5) * s, this.camBase.y + (Math.random() - 0.5) * s, this.camBase.z + (Math.random() - 0.5) * s);
    this.camera.lookAt(this.camLook);
  }

  // Called by the player each frame with duel time, so projectile motion follows playback speed.
  updateProjectiles(T: number) {
    for (const p of this.projs.values()) {
      const k = this.projPos(p, T, p.head.position);
      p.head.rotation.x += 0.2; p.head.rotation.z += 0.13;
      if (p.ribbon) { p.ribbon.push(p.head.position); p.ribbon.update(this.camera); }
      const moved = p.head.position.distanceTo(p.last);
      if (moved > 0.05) {
        const n = p.style === 'minor' ? 1 : 2;
        this.emitEss(p.ess, p.head.position, n, 0.08 * p.size, 0.5);
        p.last.copy(p.head.position);
      }
      if (k >= 1.05) this.endProj(p.id, 'hit');
    }
  }

  statusFx(p: THREE.Vector3, st: number[], dt: number, scale: number) {
    // STATUSES order: oil, wet, burn, chill, poison, charge, hex
    const [oil, wet, burn, chill, poison, charge, hex] = STATUSES.map((_, i) => st[i] || 0);
    const r = () => Math.random();
    if (burn > 0 && r() < Math.min(1, burn * 0.35) * scale * dt * 60 / 2) this.glow.emit({ x: p.x + rand(-0.35, 0.35), y: p.y - 0.6 + rand(0, 1), z: p.z + rand(-0.35, 0.35), vy: rand(1, 2.5), color: r() < 0.3 ? '#ffd070' : '#ff6a20', size: rand(0.3, 0.6), sizeEnd: 0.05, life: rand(0.35, 0.7), gravity: 1.5 });
    if (chill > 0 && r() < chill * 0.12 * scale) this.spark.emit({ x: p.x + rand(-0.5, 0.5), y: p.y + rand(-0.6, 0.8), z: p.z + rand(-0.5, 0.5), vy: rand(-0.3, 0.2), color: '#cfeeff', size: 0.25, life: 1, spin: 2 });
    if (wet > 0 && r() < wet * 0.1 * scale) this.glow.emit({ x: p.x + rand(-0.4, 0.4), y: p.y + rand(0, 0.8), z: p.z + rand(-0.4, 0.4), vy: -2, color: '#6fb6ff', size: 0.18, life: 0.6, gravity: -6 });
    if (poison > 0 && r() < poison * 0.08 * scale) this.glow.emit({ x: p.x + rand(-0.4, 0.4), y: p.y + rand(-0.3, 0.6), z: p.z + rand(-0.4, 0.4), vy: rand(0.2, 0.8), color: '#94e36a', size: rand(0.18, 0.32), life: 1.1, drag: 0.5 });
    if (oil > 0 && r() < oil * 0.06 * scale) this.glow.emit({ x: p.x + rand(-0.4, 0.4), y: p.y, z: p.z + rand(-0.4, 0.4), vy: -1.2, color: '#6a4a1a', size: 0.22, life: 0.8, gravity: -4, alpha: 0.7 });
    if (charge > 0 && r() < charge * 0.12 * scale) this.spark.emit({ x: p.x + rand(-0.5, 0.5), y: p.y + rand(-0.5, 0.8), z: p.z + rand(-0.5, 0.5), vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(-3, 3), color: '#ffe066', size: 0.3, life: 0.15, jitter: 50 });
    if (hex > 0 && r() < hex * 0.08 * scale) { const a = r() * 6.28; this.glow.emit({ x: p.x + Math.cos(a) * 0.7, y: p.y + rand(-0.3, 0.6), z: p.z + Math.sin(a) * 0.7, vx: -Math.sin(a) * 1.2, vz: Math.cos(a) * 1.2, color: '#e0486e', size: 0.26, life: 0.8, drag: 0.5 }); }
  }
}
