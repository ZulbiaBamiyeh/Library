// A hidden shop somewhere deep in the stacks: a table, three wares on cushions, whoever keeps it, and all the
// things they surround themselves with. Each keeper dresses the place differently.
import * as THREE from 'three';
import { ARTIFACTS, REAGENTS, RARITY } from '../data/artifacts';
import type { ShopItem } from '../game/run';
import type { StallDef, StallLook } from '../data/stalls';
import { glowSprite, makeArtifactModel, makeUnit } from './models';
import { mulberry32 } from '../sim/rng';
import { woodTex, parchmentTex } from './textures';

interface Ware { root: THREE.Group; model: THREE.Group | null; ring: THREE.Mesh; pick: THREE.Mesh; item: ShopItem | null; spin: number; lift: number; bought: number; staff: boolean }

// the colours and surfaces of each kind of stall
const LOOKS: Record<StallLook, { table: string; tableEm: string; cloth: string; cushion: string; flame: string }> = {
  demon: { table: '#1a0a0a', tableEm: '#2a0000', cloth: '#6a0a0a', cushion: '#3a0505', flame: '#ff3a1a' },
  bone: { table: '#5a5044', tableEm: '#000000', cloth: '#2a3a2a', cushion: '#1a2a1a', flame: '#7aff9a' },
  ice: { table: '#bfe6ff', tableEm: '#16324a', cloth: '#1a3a5a', cushion: '#2a4a6a', flame: '#9fdcff' },
  arcane: { table: '#3a1a4a', tableEm: '#1a0828', cloth: '#4a1a5a', cushion: '#2a0a3a', flame: '#c070ff' },
  ink: { table: '#0c0c10', tableEm: '#000000', cloth: '#e8e4d8', cushion: '#1a1a1e', flame: '#ffffff' },
};

export class Stall {
  group = new THREE.Group();
  wares: Ware[] = [];
  keeper: THREE.Group;
  hover = -1;
  def: StallDef;
  private lamp: THREE.Sprite;
  private sold = 0;
  private base = 0;
  private anim: ((t: number) => void)[] = [];

  constructor(M: StallDef) {
    this.def = M;
    const g = this.group, look = LOOKS[M.look];
    const rng = mulberry32(M.key * 31);
    const r = (a: number, b: number) => a + rng() * (b - a);
    const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
    const add = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => { o.position.set(x, y, z); g.add(o); return o; };
    const tableMat = M.look === 'bone' ? new THREE.MeshStandardMaterial({ map: woodTex(21 + M.d, [80, 70, 60], 256, 512, 1), roughness: 0.9 })
      : std(look.table, { emissive: new THREE.Color(look.tableEm), roughness: M.look === 'ice' ? 0.15 : M.look === 'ink' ? 0.2 : 0.6, transparent: M.look === 'ice', opacity: M.look === 'ice' ? 0.85 : 1, metalness: M.look === 'ink' ? 0.3 : 0 });
    // the table (for the mimic, a table made of stacked books)
    if (M.look === 'arcane') {
      for (const x of [-0.8, 0, 0.8]) {
        let y = 0;
        while (y < 0.8) { const h = r(0.1, 0.2); const b = add(new THREE.Mesh(new THREE.BoxGeometry(r(0.7, 0.85), h, r(0.8, 0.95)), std(new THREE.Color().setHSL(r(0.7, 0.95), 0.5, r(0.15, 0.35)).getStyle())), x, y + h / 2, 0.3); b.rotation.y = r(-0.15, 0.15); y += h; }
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 1.0), std('#2a1a3a')), 0, 0.86, 0.3);
    } else {
      add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.9), tableMat), 0, 0.86, 0.3);
      for (const [x, z] of [[-1.1, -0.05], [1.1, -0.05], [-1.1, 0.65], [1.1, 0.65]]) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08), tableMat), x, 0.43, z);
      add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.02), std(look.cloth, { roughness: 1 })), 0, 0.62, 0.76);
    }
    this.keeper = makeUnit(M.unit, M.tint);
    // small keepers stand on a crate behind the table so they can see over it
    if (M.lift) add(new THREE.Mesh(new THREE.BoxGeometry(0.8, M.lift, 0.8), tableMat), 0, M.lift / 2, -0.75);
    this.keeper.scale.setScalar(M.scale); this.keeper.position.set(0, M.lift || 0, -0.75); g.add(this.keeper);
    this.base = M.lift || 0;
    // a lamp on the table
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8), std('#2a2018', { metalness: 0.7, roughness: 0.4 })), 0.95, 1.05, 0.05);
    this.lamp = add(glowSprite(look.flame, 0.9, 0.8), 0.95, 1.3, 0.05);
    [-0.7, 0, 0.7].forEach(x => {
      const root = new THREE.Group(); root.position.set(x, 0.9, 0.38); g.add(root);
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.08, 18), std(look.cushion, { roughness: 1 }));
      cushion.position.y = 0.04; root.add(cushion);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.36, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; root.add(ring);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.7), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = 0.45; root.add(pick);
      this.wares.push({ root, model: null, ring, pick, item: null, spin: x * 3, lift: 0, bought: 0, staff: false });
    });
    this.dress(M.look, r, std, add);
  }

  // Everything around the table that makes the place what it is.
  private dress(lk: StallLook, r: (a: number, b: number) => number, std: (c: string, o?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial, add: <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => T) {
    const g = this.group;
    const glowMat = (c: string, o = 0.8) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const floorRing = (rad: number, c: string, o = 0.6) => { const m = add(new THREE.Mesh(new THREE.RingGeometry(rad, rad + 0.08, 64), glowMat(c, o)), 0, 0.02, -0.2); m.rotation.x = -Math.PI / 2; return m; };
    const flick = (s: THREE.Sprite, base: number, ph: number) => this.anim.push(t => s.scale.setScalar(base * (0.9 + Math.sin(t * 11 + ph) * 0.08 + Math.sin(t * 5.3 + ph) * 0.06)));
    if (lk === 'demon') {
      // a summoning circle, braziers, rubies everywhere, horns over the keeper, black-red candles
      const circle = floorRing(2.2, '#ff2a1a', 0.7); floorRing(1.7, '#ff2a1a', 0.45);
      for (let k = 0; k < 5; k++) {
        const a0 = (k / 5) * Math.PI * 2 + Math.PI / 2, a1 = ((k + 2) / 5) * Math.PI * 2 + Math.PI / 2;
        const p0 = new THREE.Vector3(Math.cos(a0) * 1.7, 0, Math.sin(a0) * 1.7), p1 = new THREE.Vector3(Math.cos(a1) * 1.7, 0, Math.sin(a1) * 1.7);
        const len = p0.distanceTo(p1), mid = p0.clone().add(p1).multiplyScalar(0.5);
        const line = add(new THREE.Mesh(new THREE.PlaneGeometry(len, 0.06), glowMat('#ff2a1a', 0.5)), mid.x, 0.021, mid.z - 0.2);
        line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.atan2(p1.z - p0.z, p1.x - p0.x);
      }
      this.anim.push(t => { (circle.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 2) * 0.2; });
      const iron = std('#1a1010', { metalness: 0.7, roughness: 0.4 });
      for (const x of [-1.75, 1.75]) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.0, 6), iron), x, 0.5, 0.1);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.18, 0.25, 10, 1, true), iron), x, 1.1, 0.1);
        add(new THREE.Mesh(new THREE.CircleGeometry(0.3, 10), std('#ff5a1a', { emissive: new THREE.Color('#ff2a00'), emissiveIntensity: 2 })), x, 1.18, 0.1).rotation.x = -Math.PI / 2;
        const fire = add(glowSprite('#ff3a10', 1.3, 0.95), x, 1.55, 0.1); flick(fire, 1.3, x);
        const core = add(glowSprite('#ffb040', 0.6, 0.9), x, 1.35, 0.1); flick(core, 0.6, x + 2);
      }
      const ruby = new THREE.MeshStandardMaterial({ color: '#d0102a', emissive: new THREE.Color('#8a0010'), emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.2, flatShading: true });
      const gem = new THREE.OctahedronGeometry(1, 0);
      const rubies = new THREE.InstancedMesh(gem, ruby, 40), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      let n = 0;
      const put = (x: number, y: number, z: number, s: number) => { q.setFromEuler(new THREE.Euler(r(0, 3), r(0, 3), r(0, 3))); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * 1.3, s)); rubies.setMatrixAt(n++, m4); };
      for (let k = 0; k < 10; k++) put(r(-1.15, 1.15), 0.93, r(-0.05, 0.1), r(0.03, 0.06)); // strewn along the back of the table
      for (let k = 0; k < 16; k++) put(1.2 + r(-0.35, 0.35), r(0.05, 0.3), -1.2 + r(-0.35, 0.35), r(0.05, 0.1)); // a heap on the floor
      for (let k = 0; k < 12; k++) put(-1.3 + r(-0.3, 0.3), r(0.04, 0.2), -1.1 + r(-0.3, 0.3), r(0.04, 0.09));
      rubies.count = n; g.add(rubies);
      add(glowSprite('#ff1a2a', 1.4, 0.35), 1.2, 0.3, -1.2); add(glowSprite('#ff1a2a', 1.2, 0.3), -1.3, 0.2, -1.1);
      const horn = std('#2a1010', { roughness: 0.5, emissive: new THREE.Color('#200000') });
      for (const s of [-1, 1]) {
        const h = add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 16, Math.PI * 0.7), horn), s * 0.55, 2.55, -1.2);
        h.rotation.set(0, 0, s > 0 ? -0.2 : Math.PI + 0.2);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), horn), s * 1.05, 2.95, -1.2).rotation.z = -s * 0.5;
      }
      add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), std('#3a0406', { roughness: 1, side: THREE.DoubleSide })), 0, 1.5, -1.45);
      for (const x of [-1.0, -0.35, 0.35]) {
        const hgt = r(0.2, 0.4);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, hgt, 8), std('#2a0206', { emissive: new THREE.Color('#200000') })), x, 0.9 + hgt / 2, 0.02);
        flick(add(glowSprite('#ff2a10', 0.35), x, 0.95 + hgt, 0.02), 0.35, x * 7);
      }
    } else if (lk === 'bone') {
      // skulls with candles on them, a heap of bones, a ribcage arching over the keeper
      const bone = std('#d8d0b8', { roughness: 0.7 }), dark = new THREE.MeshBasicMaterial({ color: '#050505' });
      const skull = (x: number, y: number, z: number, s: number, candle: boolean) => {
        const k = new THREE.Group(); k.position.set(x, y, z); k.scale.setScalar(s); k.rotation.y = r(-0.5, 0.5); g.add(k);
        k.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), bone).translateY(0.16));
        k.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.14), bone).translateY(0.04).translateZ(0.06));
        for (const sx of [-0.06, 0.06]) k.add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), dark).translateX(sx).translateY(0.18).translateZ(0.14));
        if (candle) { k.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), std('#e8e0c2')).translateY(0.42)); const f = glowSprite('#7aff9a', 0.4); f.position.set(0, 0.6, 0); k.add(f); flick(f, 0.4, x * 5); }
      };
      skull(-1.0, 0.9, 0.0, 0.8, true); skull(-0.35, 0.9, -0.05, 0.6, false);
      for (let k = 0; k < 5; k++) skull(r(-1.8, 1.8), 0, r(-1.4, -0.9), r(0.7, 1.1), k < 2);
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6), bone, 40), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let k = 0; k < 40; k++) { q.setFromEuler(new THREE.Euler(Math.PI / 2, r(0, 6), 0, 'YXZ')); m4.compose(new THREE.Vector3(r(-2, 2), 0.04 + (k % 3) * 0.05, r(-1.6, -0.8)), q, new THREE.Vector3(1, r(0.7, 1.2), 1)); bones.setMatrixAt(k, m4); }
      g.add(bones);
      for (let k = 0; k < 6; k++) { const rib = add(new THREE.Mesh(new THREE.TorusGeometry(1.3 - k * 0.08, 0.05, 6, 20, Math.PI), bone), 0, 0.2 + k * 0.28, -1.35 + k * 0.02); rib.scale.set(1, 1.4, 1); }
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8), bone), 0, 1.2, -1.45);
      floorRing(2.1, '#7aff9a', 0.25);
    } else if (lk === 'ice') {
      // frost on the floor, crystals growing round the table, icicles hanging in the air
      const snow = add(new THREE.Mesh(new THREE.CircleGeometry(2.5, 40), std('#e8f4ff', { roughness: 1, emissive: new THREE.Color('#1a2a3a') })), 0, 0.015, -0.2); snow.rotation.x = -Math.PI / 2;
      const ice = new THREE.MeshStandardMaterial({ color: '#a8e0ff', emissive: new THREE.Color('#2a6aa0'), emissiveIntensity: 0.8, transparent: true, opacity: 0.75, roughness: 0.05, flatShading: true });
      for (const [cx, cz] of [[-1.8, 0.2], [1.8, -0.2], [-1.4, -1.3], [1.5, -1.3], [0, -1.6]]) {
        for (let k = 0; k < 5; k++) {
          const h = r(0.4, 1.4);
          const c = add(new THREE.Mesh(new THREE.ConeGeometry(r(0.08, 0.18), h, 5), ice), cx + r(-0.25, 0.25), h / 2, cz + r(-0.25, 0.25));
          c.rotation.set(r(-0.35, 0.35), r(0, 3), r(-0.35, 0.35));
        }
        add(glowSprite('#9fdcff', 1.2, 0.35), cx, 0.6, cz);
      }
      for (let k = 0; k < 14; k++) {
        const h = r(0.3, 0.8), x = r(-1.4, 1.4), z = r(-1.2, 0.4);
        const ic = add(new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 5), ice), x, 2.9 - h / 2, z); ic.rotation.x = Math.PI;
        this.anim.push(t => { ic.position.y = 2.9 - h / 2 + Math.sin(t * 0.8 + x * 3) * 0.04; });
      }
      floorRing(2.3, '#9fdcff', 0.35);
    } else if (lk === 'arcane') {
      // a rune circle, and books that have come loose and circle the table on their own
      const rune = floorRing(2.2, '#c070ff', 0.6); floorRing(1.5, '#c070ff', 0.35);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const d = add(new THREE.Mesh(new THREE.CircleGeometry(0.08, 3 + (k % 4)), glowMat('#e0b0ff', 0.7)), Math.cos(a) * 1.85, 0.022, -0.2 + Math.sin(a) * 1.85); d.rotation.x = -Math.PI / 2;
      }
      this.anim.push(t => { rune.rotation.z = t * 0.2; });
      const orbit = new THREE.Group(); orbit.position.set(0, 0, -0.2); g.add(orbit);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2, rad = r(1.7, 2.1), y = r(1.2, 2.4);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.26), std(new THREE.Color().setHSL(r(0.72, 0.9), 0.55, r(0.2, 0.4)).getStyle(), { emissive: new THREE.Color('#1a0828') }));
        b.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad); orbit.add(b);
        this.anim.push(t => { b.rotation.set(Math.sin(t + k) * 0.4, t * 0.7 + k, 0); b.position.y = y + Math.sin(t * 1.1 + k) * 0.12; });
      }
      this.anim.push(t => { orbit.rotation.y = t * 0.25; });
      add(glowSprite('#c070ff', 2.4, 0.25), 0, 1.6, -0.6);
    } else {
      // the Author's desk: paper stacked everywhere, ink pots, a quill taller than a person, an ink pool
      const pool = add(new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), std('#050508', { roughness: 0.05, metalness: 0.6 })), 0, 0.012, -0.3); pool.rotation.x = -Math.PI / 2;
      const paper = std('#f0ead8', { map: parchmentTex(), roughness: 0.95 });
      for (const [x, z] of [[-1.7, 0.3], [1.7, -0.3], [-1.3, -1.3], [1.4, -1.2]]) {
        let y = 0; const n = 6 + Math.floor(r(0, 8));
        for (let k = 0; k < n; k++) { const h = r(0.03, 0.08); const p = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.55), paper), x + r(-0.05, 0.05), y + h / 2, z + r(-0.05, 0.05)); p.rotation.y = r(-0.3, 0.3); y += h; }
      }
      for (const x of [-1.0, -0.4]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 12), std('#101014', { roughness: 0.1, metalness: 0.4 })), x, 0.96, 0.05);
      const quill = add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 2.6, 8), std('#e8e4f0', { roughness: 0.6 })), 1.6, 1.3, -1.0); quill.rotation.z = 0.25;
      const leaves = new THREE.Group(); leaves.position.set(0, 0, -0.3); g.add(leaves);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, rad = r(1.2, 2.0), y = r(0.9, 2.6);
        const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), std('#f4efe0', { emissive: new THREE.Color('#3a3a4a'), side: THREE.DoubleSide }));
        pg.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad); leaves.add(pg);
        this.anim.push(t => { pg.rotation.set(Math.sin(t * 0.9 + k) * 0.5, t * 0.5 + k, Math.cos(t * 0.7 + k) * 0.3); pg.position.y = y + Math.sin(t * 0.6 + k) * 0.15; });
      }
      this.anim.push(t => { leaves.rotation.y = -t * 0.15; });
      add(glowSprite('#ffffff', 2.2, 0.18), 0, 1.4, -0.6);
    }
  }

  setStock(items: ShopItem[]) {
    this.wares.forEach((w, i) => {
      if (w.model) { w.root.remove(w.model); w.model = null; }
      const it = items[i] || null;
      w.item = it; w.bought = 0;
      w.root.visible = !!it;
      if (!it) return;
      const spec = it.kind === 'art' ? ARTIFACTS[it.id].model : REAGENTS[it.id].model;
      const m = makeArtifactModel(spec);
      // a keeper with a colour of its own sells everything in that colour
      if (this.def.ring) {
        const tint = new THREE.Color(this.def.ring);
        m.traverse(o => {
          const mesh = o as THREE.Mesh; const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
          if (!mesh.isMesh || !mat || !mat.color) return;
          const c = mat.clone(); c.color.lerp(tint, 0.65); if (c.emissive) c.emissive.lerp(tint, 0.6); mesh.material = c;
        });
        m.traverse(o => { const sp = o as THREE.Sprite; if (sp.isSprite) (sp.material as THREE.SpriteMaterial).color.lerp(tint, 0.7); });
      }
      w.staff = spec.kind.startsWith('staff');
      if (w.staff) { m.scale.setScalar(0.5); m.rotation.z = 0.25; } else m.scale.setScalar(1.0);
      w.model = m; w.root.add(m);
      (w.ring.material as THREE.MeshBasicMaterial).color.set(this.def.ring || (it.kind === 'art' ? RARITY[ARTIFACTS[it.id].rarity].color : '#8fc8ff'));
      m.visible = !it.sold;
    });
  }

  pickRay(rc: THREE.Raycaster): { i: number; dist: number } | null {
    const live = this.wares.filter(w => w.item && !w.item.sold);
    const hits = rc.intersectObjects(live.map(w => w.pick), false);
    if (!hits.length) return null;
    return { i: this.wares.findIndex(w => w.pick === hits[0].object), dist: hits[0].distance };
  }

  // Where a ware sits in the world (for its price tag and the sparkle when it sells).
  worldPos(i: number, out = new THREE.Vector3()) { return this.wares[i].root.localToWorld(out.set(0, -0.02, 0.36)); }

  markSold(i: number) { const w = this.wares[i]; if (w?.model) { w.bought = 0.001; this.sold = 1; } }

  update(dt: number, time: number, eye: THREE.Vector3) {
    this.wares.forEach((w, i) => {
      if (!w.model) return;
      w.lift += ((i === this.hover ? 1 : 0) - w.lift) * Math.min(1, dt * 8);
      w.spin += dt * (0.4 + w.lift * 1.5);
      w.model.rotation.y = w.spin;
      w.model.position.y = (w.staff ? 0.08 : 0.4) + w.lift * 0.15 + Math.sin(time * 1.4 + i) * 0.025;
      (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + w.lift * 0.5 + Math.sin(time * 2 + i) * 0.08;
      if (w.bought > 0) {
        w.bought += dt;
        const k = Math.min(1, w.bought / 0.6);
        w.model.scale.setScalar((w.staff ? 0.5 : 1) * (1 - k));
        w.model.position.y += k * 0.8;
        if (k >= 1) { w.model.visible = false; w.bought = 0; }
      }
    });
    // the keeper turns to watch you, and bows a little after a sale
    const local = this.group.worldToLocal(eye.clone());
    const want = Math.atan2(local.x - this.keeper.position.x, local.z - this.keeper.position.z);
    this.keeper.rotation.y += (Math.max(-0.9, Math.min(0.9, want)) - this.keeper.rotation.y) * Math.min(1, dt * 2);
    this.sold = Math.max(0, this.sold - dt * 0.8);
    this.keeper.rotation.x = Math.sin(this.sold * Math.PI) * 0.25;
    this.keeper.position.y = this.base + Math.sin(time * 1.3) * 0.02;
    this.lamp.scale.setScalar(0.9 + Math.sin(time * 9) * 0.05);
    for (const f of this.anim) f(time);
  }
}
