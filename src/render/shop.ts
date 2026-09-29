// The Curio Shop: a warm little room behind the library, curios displayed on a long counter.
import * as THREE from 'three';
import type { View } from './engine';
import { ARTIFACTS, REAGENTS, RARITY } from '../data/artifacts';
import type { ShopItem } from '../game/run';
import { Particles } from './particles';
import { glowTex, plasterTex, woodTex } from './textures';
import { glowSprite, makeArtifactModel } from './models';
import { mulberry32 } from '../sim/rng';

interface Slot { root: THREE.Group; model: THREE.Group | null; cushion: THREE.Mesh; ring: THREE.Mesh; pick: THREE.Mesh; lift: number; spin: number; item: ShopItem | null; light: THREE.PointLight; bought: number }

export class Shop implements View {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
  bloom = { strength: 0.55, radius: 0.5, threshold: 0.86 };
  exposure = 0.92;
  vignette = 1.0;
  slots: Slot[] = [];
  hover = -1;
  pointer = new THREE.Vector2();
  pan = 0; // horizontal camera pan on narrow screens
  narrow = false;
  keeper: THREE.Group;
  keeperParts: { eyes: THREE.Mesh[]; wings: THREE.Mesh[]; antennae: THREE.Object3D[]; lantern: THREE.PointLight; body: THREE.Group };
  keeperJoy = 0;
  motes: Particles;
  sparkles: Particles;
  lanterns: { s: THREE.Sprite; L: THREE.PointLight; phase: number }[] = [];
  raycaster = new THREE.Raycaster();
  host: THREE.Object3D | null = null; // set when the room is built into the library
  private floor: THREE.Mesh;
  private camBase = new THREE.Vector3(0, 2.3, 5.8);
  private look = new THREE.Vector3(0, 1.3, 0);

  constructor() {
    const S = this.scene;
    S.background = new THREE.Color('#120c0c');
    S.fog = new THREE.Fog('#120c0c', 8, 20);
    S.add(new THREE.HemisphereLight('#9a7a8a', '#2a1a10', 0.5));
    // floor and walls
    const planks = woodTex(12, [110, 70, 44], 256, 1024, 0.6); planks.repeat.set(6, 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.rotation.z = Math.PI / 2; S.add(floor); this.floor = floor;
    const pl = plasterTex(8, [104, 78, 66]); pl.repeat.set(3, 1.2);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshStandardMaterial({ map: pl, roughness: 1 }));
    wall.position.set(0, 3, -2.6); S.add(wall);
    for (const x of [-5.5, 5.5]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), new THREE.MeshStandardMaterial({ map: pl, roughness: 1 })); side.position.set(x, 3, 1.4); side.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; S.add(side); }
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(4, [96, 60, 40], 256, 512, 1), roughness: 0.7 });
    const darkWood = new THREE.MeshStandardMaterial({ map: woodTex(9, [60, 36, 26], 256, 512, 1), roughness: 0.6 });
    // back shelves crowded with jars and boxes
    const rng = mulberry32(5);
    const shelfYs = [0.9, 1.65, 2.4, 3.15, 3.9];
    for (const y of shelfYs) { const sh = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.08, 0.6), darkWood); sh.position.set(0, y, -2.3); S.add(sh); }
    for (const x of [-4.8, -1.6, 1.6, 4.8]) { const up = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 0.6), darkWood); up.position.set(x, 2.3, -2.3); S.add(up); }
    const jarGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const glassMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 });
    const clutter: { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: THREE.Color; glow: boolean }[] = [];
    const palette = ['#6a8a5a', '#8a4a3a', '#4a6a8a', '#a08a4a', '#6a4a7a', '#c8b890', '#3a5a4a', '#9a6a3a'];
    for (const y of shelfYs) {
      let x = -4.6;
      while (x < 4.6) {
        const jar = rng() < 0.65;
        const w = jar ? 0.1 + rng() * 0.12 : 0.18 + rng() * 0.2;
        const h = jar ? 0.2 + rng() * 0.35 : 0.12 + rng() * 0.2;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x + w, y + 0.04 + h / 2, -2.25 + (rng() - 0.5) * 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 3, 0)), new THREE.Vector3(jar ? w : w * 1.5, h, jar ? w : w));
        clutter.push({ geo: jar ? jarGeo : boxGeo, m, c: new THREE.Color(palette[Math.floor(rng() * palette.length)]), glow: jar && rng() < 0.12 });
        x += w * 2 + 0.05 + rng() * 0.12;
      }
    }
    for (const kind of ['jar', 'box'] as const) {
      const list = clutter.filter(c => (c.geo === jarGeo) === (kind === 'jar'));
      const im = new THREE.InstancedMesh(kind === 'jar' ? jarGeo : boxGeo, kind === 'jar' ? glassMat : wood.clone(), list.length);
      list.forEach((c, i) => { im.setMatrixAt(i, c.m); im.setColorAt(i, c.c); });
      S.add(im);
      for (const c of list) if (c.glow) {
        const p = new THREE.Vector3().setFromMatrixPosition(c.m);
        const s = glowSprite(c.c.clone().offsetHSL(0, 0.3, 0.2), 0.5, 0.55); s.position.copy(p); S.add(s);
      }
    }
    // the counter
    const counter = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.05, 1.2), wood); counter.position.set(0, 0.52, 0.35); S.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(8.7, 0.08, 1.35), darkWood); top.position.set(0, 1.08, 0.35); S.add(top);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#c9a13b', metalness: 0.9, roughness: 0.3 }));
    trim.position.set(0, 0.95, 0.97); S.add(trim);
    // hanging lanterns
    [[-3.2, 3.6, 0.6], [0, 3.8, 1.0], [3.2, 3.6, 0.6], [-5, 3.3, -1.2], [5, 3.3, -1.2]].forEach(([x, y, z], i) => {
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.36, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2018', metalness: 0.8, roughness: 0.4, wireframe: true }));
      cage.position.set(x, y, z); S.add(cage);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.5, 4), new THREE.MeshStandardMaterial({ color: '#2a2018' })); chain.position.set(x, y + 1.4, z); S.add(chain);
      const s = glowSprite('#ffb060', 1.1, 0.95); s.position.set(x, y, z); S.add(s);
      const L = new THREE.PointLight('#ffb070', i < 3 ? 10 : 6, 9, 1.6); L.position.set(x, y - 0.1, z); S.add(L);
      this.lanterns.push({ s, L, phase: i * 1.7 });
    });
    const key = new THREE.SpotLight('#ffe0c0', 14, 12, 0.7, 0.6, 1.4); key.position.set(0, 5.5, 3.5); key.target.position.set(0, 1.1, 0.3); S.add(key, key.target);
    // the keeper
    this.keeper = new THREE.Group(); this.keeper.position.set(0, 0, -1.1); S.add(this.keeper);
    this.keeperParts = this.buildKeeper();
    // display slots along the counter
    const xs = [-3.0, -2.0, -1.0, 0, 1.0, 2.0, 3.0];
    xs.forEach((x, i) => {
      const root = new THREE.Group(); root.position.set(x, 1.12, 0.45); S.add(root);
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.1, 20), new THREE.MeshStandardMaterial({ color: i >= 5 ? '#2a3a4a' : '#5a1a2a', roughness: 1 }));
      cushion.position.y = 0.05; cushion.scale.set(1, 1, 0.8); root.add(cushion);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.11; root.add(ring);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.4, 0.9), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = 0.6; root.add(pick);
      const L = new THREE.PointLight('#ffffff', 0, 2.2, 1.5); L.position.y = 0.6; root.add(L);
      this.slots.push({ root, model: null, cushion, ring, pick, lift: 0, spin: rng() * 6, item: null, light: L, bought: 0 });
    });
    this.motes = new Particles(500, glowTex(), true);
    this.sparkles = new Particles(800, glowTex(), true);
    S.add(this.motes.points, this.sparkles.points);
    this.onResize(window.innerWidth, window.innerHeight);
  }

  buildKeeper() {
    const g = this.keeper;
    const body = new THREE.Group(); g.add(body);
    const robe = new THREE.MeshStandardMaterial({ color: '#3a4a3a', roughness: 0.9 });
    const fur = new THREE.MeshStandardMaterial({ color: '#9a8a70', roughness: 1 });
    const pts = [[0.001, 0], [0.55, 0], [0.5, 0.5], [0.4, 1.2], [0.32, 1.7], [0.2, 1.95], [0.001, 2.0]].map(([r, y]) => new THREE.Vector2(r, y));
    body.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24), robe));
    const ruff = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 10, 24), fur); ruff.position.y = 1.9; ruff.rotation.x = Math.PI / 2; body.add(ruff);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), fur); head.position.y = 2.2; head.scale.set(1, 0.95, 0.9); body.add(head);
    const eyes: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color('#ffb040'), emissiveIntensity: 2.2, roughness: 0.2 }));
      e.position.set(s * 0.13, 2.24, 0.2); body.add(e); eyes.push(e);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#1a0a00' })); pupil.position.set(s * 0.13, 2.24, 0.3); body.add(pupil);
    }
    const antennae: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 0.1, 2.45, 0.05); body.add(a);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.5, 5), new THREE.MeshStandardMaterial({ color: '#8a7a5a' })); stalk.position.y = 0.25; a.add(stalk);
      for (let i = 0; i < 7; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.16 - i * 0.015, 0.012, 0.01), fur); f.position.y = 0.12 + i * 0.055; a.add(f); }
      a.rotation.z = -s * 0.45; antennae.push(a);
    }
    // wings, painted with an eye pattern
    const wings: THREE.Mesh[] = [];
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(128, 128, 10, 128, 128, 128); grd.addColorStop(0, '#c8a060'); grd.addColorStop(1, '#5a4030');
    x.fillStyle = grd; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#2a1a10'; x.beginPath(); x.arc(150, 110, 40, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#4aa396'; x.beginPath(); x.arc(150, 110, 26, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#f1d98a'; x.beginPath(); x.arc(145, 104, 8, 0, Math.PI * 2); x.fill();
    const wt = new THREE.CanvasTexture(c); wt.colorSpace = THREE.SRGBColorSpace;
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(0.6, 0.9, 1.4, 0.8, 1.3, 0.1); sh.bezierCurveTo(1.2, -0.5, 0.6, -0.9, 0, -0.2);
      const geo = new THREE.ShapeGeometry(sh, 16);
      const uv = geo.attributes.uv; const p = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 1.4, (p.getY(i) + 0.9) / 1.8);
      const w = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: wt, side: THREE.DoubleSide, roughness: 0.9, emissive: new THREE.Color('#4aa396'), emissiveIntensity: 0.15 }));
      w.position.set(s * 0.15, 1.7, -0.3); w.scale.set(s * 1.1, 1.1, 1); w.rotation.y = s * 0.5; body.add(w); wings.push(w);
    }
    // lantern held low
    const lanternG = new THREE.Group(); lanternG.position.set(0.72, 1.55, 0.3); body.add(lanternG);
    lanternG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#3a2a18', metalness: 0.8, wireframe: true })));
    const ls = glowSprite('#9fe3d6', 0.9, 0.9); lanternG.add(ls);
    const lantern = new THREE.PointLight('#9fe3d6', 6, 4, 1.6); lanternG.add(lantern);
    return { eyes, wings, antennae, lantern, body };
  }

  onResize(w: number, h: number) {
    const aspect = w / h;
    this.narrow = aspect < 0.8;
    this.camera.fov = this.narrow ? 60 : 44;
    this.camBase.set(0, this.narrow ? 2.5 : 2.3, this.narrow ? 6.2 : 5.8);
    this.camera.updateProjectionMatrix();
    this.motes.setScale(h, this.camera.fov); this.sparkles.setScale(h, this.camera.fov);
  }

  setStock(items: ShopItem[]) {
    this.slots.forEach((s, i) => {
      if (s.model) { s.root.remove(s.model); s.model = null; }
      const it = items[i] || null;
      s.item = it; s.bought = 0;
      s.root.visible = !!it;
      if (!it) return;
      const spec = it.kind === 'art' ? ARTIFACTS[it.id].model : REAGENTS[it.id].model;
      const m = makeArtifactModel(spec);
      if (spec.kind.startsWith('staff')) { m.scale.setScalar(0.62); m.position.y = 0.1; m.rotation.z = 0.25; }
      else { m.scale.setScalar(1.25); m.position.y = 0.48; }
      s.model = m; s.root.add(m);
      const color = it.kind === 'art' ? RARITY[ARTIFACTS[it.id].rarity].color : '#8fc8ff';
      (s.ring.material as THREE.MeshBasicMaterial).color.set(color);
      s.light.color.set(spec.glow || '#ffffff');
      m.visible = !it.sold;
    });
  }

  // Move this room into another scene (the library), open side towards the parent's doorway.
  // The hall's own lights stay behind, except a few lanterns, so the library's light count stays small.
  embedIn(parent: THREE.Object3D, pos: THREE.Vector3, rotY: number): THREE.Group {
    const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = rotY; parent.add(g);
    for (const c of [...this.scene.children]) {
      if ((c as THREE.Light).isLight && !(c as THREE.SpotLight).isSpotLight && !(c as THREE.PointLight).isPointLight) continue; // hemisphere
      g.add(c);
    }
    for (const s of this.slots) s.root.remove(s.light);
    this.lanterns.forEach((l, i) => { if (i >= 3) l.L.parent?.remove(l.L); });
    const pl = plasterTex(8, [104, 78, 66]); pl.repeat.set(1, 1.2);
    const wallMat = new THREE.MeshStandardMaterial({ map: pl, roughness: 1 });
    // the front wall, with the doorway back into the library
    for (const [x, w] of [[-3.5, 4], [3.5, 4]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 6), wallMat); m.position.set(x, 3, 5.38); m.rotation.y = Math.PI; g.add(m); }
    const over = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), wallMat); over.position.set(0, 5.1, 5.38); over.rotation.y = Math.PI; g.add(over);
    // floor and ceiling cut to the room, so neither pokes through the doorway into the library
    this.floor.geometry.dispose(); this.floor.geometry = new THREE.PlaneGeometry(8, 11);
    this.floor.position.set(0, 0.002, 1.4);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(11, 8), new THREE.MeshStandardMaterial({ color: '#1a100c', roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 6, 1.4); g.add(ceil);
    this.host = g;
    return g;
  }

  // world position -> this room's own space (for particles, once the room is built into the library)
  private local(p: THREE.Vector3) { if (this.host) this.host.worldToLocal(p); return p; }

  pickRay(rc: THREE.Raycaster): number {
    const hits = rc.intersectObjects(this.slots.filter(s => s.item && !s.item.sold).map(s => s.pick), false);
    if (!hits.length) return -1;
    return this.slots.findIndex(s => s.pick === hits[0].object);
  }

  markSold(i: number) {
    const s = this.slots[i];
    if (!s || !s.model) return;
    s.bought = 0.001;
    const p = new THREE.Vector3(); s.model.getWorldPosition(p); this.local(p);
    this.sparkles.burst(p.x, p.y, p.z, 60, '#ffe7a0', 3, 0.12, 1, { gravity: 0.5 });
    this.keeperJoy = 1;
  }

  pick(clientX: number, clientY: number): number {
    const v = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.slots.filter(s => s.item && !s.item.sold).map(s => s.pick), false);
    if (!hits.length) return -1;
    return this.slots.findIndex(s => s.pick === hits[0].object);
  }

  screenPos(i: number, cam: THREE.Camera = this.camera): { x: number; y: number; visible: boolean } {
    const s = this.slots[i];
    const p = new THREE.Vector3(0, -0.02, 0.45); s.root.localToWorld(p);
    p.project(cam);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, visible: p.z < 1 };
  }

  update(dt: number, time: number) {
    const px = this.narrow ? this.pan : this.pointer.x * 0.35;
    this.camera.position.set(this.camBase.x + px, this.camBase.y + (this.narrow ? 0 : this.pointer.y * 0.12), this.camBase.z);
    this.camera.lookAt(this.look.x + (this.narrow ? this.pan : 0), this.look.y, this.look.z);
    this.slots.forEach((s, i) => {
      if (!s.model) return;
      const target = i === this.hover ? 1 : 0;
      s.lift += (target - s.lift) * Math.min(1, dt * 8);
      s.spin += dt * (0.5 + s.lift * 1.5);
      s.model.rotation.y = s.spin;
      const isStaff = s.item?.kind === 'art' && ARTIFACTS[s.item.id].slot === 'staff';
      s.model.position.y = (isStaff ? 0.1 : 0.48) + s.lift * 0.18 + Math.sin(time * 1.6 + i) * 0.03;
      s.light.intensity = 0.6 + s.lift * 3;
      (s.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + s.lift * 0.5 + Math.sin(time * 2 + i) * 0.08;
      if (s.bought > 0) {
        s.bought += dt;
        const k = Math.min(1, s.bought / 0.6);
        s.model.scale.setScalar((isStaff ? 0.62 : 1.25) * (1 - k));
        s.model.position.y += k * 0.8;
        if (k >= 1) { s.model.visible = false; s.bought = 0; }
      }
      if (Math.random() < 0.08 + s.lift * 0.3) {
        const p = new THREE.Vector3(); s.root.getWorldPosition(p); this.local(p);
        const c = s.item?.kind === 'art' ? RARITY[ARTIFACTS[s.item.id].rarity].color : '#8fc8ff';
        if (!s.item?.sold) this.sparkles.emit({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + 0.15, z: p.z + (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.5, color: c, size: 0.05, life: 1.2, drag: 0.2 });
      }
    });
    // keeper idles
    const k = this.keeperParts;
    this.keeperJoy = Math.max(0, this.keeperJoy - dt * 0.7);
    k.body.rotation.y = Math.sin(time * 0.4) * 0.12 + this.pointer.x * 0.15;
    k.body.position.y = Math.sin(time * 1.1) * 0.03;
    k.antennae.forEach((a, i) => { a.rotation.x = Math.sin(time * 2.3 + i) * 0.12 - this.keeperJoy * 0.3; });
    k.wings.forEach((w, i) => { const s = i === 0 ? -1 : 1; w.rotation.y = s * (0.5 + Math.sin(time * 1.3) * 0.06 + this.keeperJoy * 0.7 * Math.abs(Math.sin(time * 14))); });
    for (const e of k.eyes) (e.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 + this.keeperJoy * 3 + (Math.sin(time * 0.7) > 0.97 ? -2 : 0);
    k.lantern.intensity = 5 + Math.sin(time * 5) * 0.6;
    this.lanterns.forEach(l => { l.L.intensity = (l.phase < 5 ? 10 : 6) + Math.sin(time * 6 + l.phase) * 0.8; l.s.scale.setScalar(1.05 + Math.sin(time * 9 + l.phase) * 0.05); });
    if (Math.random() < 0.5) this.motes.emit({ x: (Math.random() - 0.5) * 10, y: Math.random() * 4, z: (Math.random() - 0.5) * 5, color: '#ffe0b0', size: 0.03 + Math.random() * 0.03, life: 5, drag: 0, jitter: 0.2, alpha: 0.7 });
    this.motes.update(dt); this.sparkles.update(dt);
  }
}
