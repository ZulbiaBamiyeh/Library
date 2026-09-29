// The library, walked in first person. The Curio Shop opens off its east wall.
import * as THREE from 'three';
import type { View } from './engine';
import { ESS, SCHOOL_ORDER, type Essence } from '../data/spells';
import { mulberry32, hashStr } from '../sim/rng';
import { Particles } from './particles';
import { canvas, flagstones, glowTex, plasterTex, rugTex, woodTex, parchmentTex, leatherTex } from './textures';
import { glowSprite } from './models';

const R = 10;
const H = 7;

export interface Book {
  face: number; row: number; x: number; w: number; h: number; lean: number;
  school: Essence; size: number; chained: boolean; glowing: boolean; title: string;
  pos: THREE.Vector3; quat: THREE.Quaternion; color: THREE.Color;
}
interface Face { c: THREE.Vector3; ry: number; rows: number; wall?: boolean; unit: string; tan: THREE.Vector3; nrm: THREE.Vector3; rot: THREE.Quaternion }

const TITLE_WORDS: Record<Essence, string[]> = {
  fire: ['Cinders', 'the Kiln', 'Ember Rites', 'Ash and Tallow', 'the Burning Hand', 'Pitch and Flame'],
  frost: ['Tides', 'the Frozen Well', 'Rime', 'Still Water', 'the Hailward', 'Winter Glass'],
  venom: ['Nightshade', 'the Green Hedge', 'Rot', 'the Adder', 'Foxglove', 'Mould and Mildew'],
  storm: ['Static', 'the Copper Rod', 'Thunderheads', 'Sparks', 'the Bright Wire'],
  stone: ['Moss and Stone', 'Small Familiars', 'Old Roots', 'Bones of the Hill', 'the Quarry'],
  shadow: ['Bargains', 'the Black Mark', 'Maledictions', 'Debts', 'the Hex Ledger', 'Long Nights'],
  holy: ['Mending', 'the Gilt Page', 'Consecration', 'Lamps', 'Absolution'],
  arcane: ['Mirrors', 'Transmutation', 'the Changeling', 'Echoes', 'Inverse Things', 'Blots'],
};
const TITLE_FORMS = ['On {x}', 'A Treatise on {x}', '{x}, Annotated', 'Notes toward {x}', 'The Lesser Book of {x}', 'Concerning {x}', '{x}: a Primer'];

export type Pick = { kind: 'book'; i: number } | { kind: 'door' } | { kind: 'desk' } | null;

export class Library implements View {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, 1, 0.05, 80);
  bloom = { strength: 0.75, radius: 0.6, threshold: 0.78 };
  exposure = 1.15;
  vignette = 1.0;
  books: Book[] = [];
  faces: Face[] = [];
  colliders: { x0: number; x1: number; z0: number; z1: number }[] = [];
  bookMesh!: THREE.InstancedMesh;
  bandMesh!: THREE.InstancedMesh;
  highlight: THREE.Mesh;
  yaw = 0; pitch = 0; pos = new THREE.Vector3(0, 1.62, 6.6);
  keys: Record<string, boolean> = {};
  joy = { x: 0, y: 0 };
  titleSpin = true;
  lights: THREE.PointLight[] = [];
  flames: THREE.Sprite[] = [];
  glows: THREE.Sprite[] = [];
  motes: Particles;
  embers: Particles;
  door: THREE.Mesh;
  doorGlow: THREE.Sprite;
  desk: THREE.Group;
  deskPick: THREE.Mesh;
  taken: Record<number, boolean> = {};
  hover: Pick = null;
  raycaster = new THREE.Raycaster();
  private candlePos: THREE.Vector3[] = [];

  constructor() {
    const S = this.scene;
    S.background = new THREE.Color('#0d0a14');
    S.fog = new THREE.Fog('#0d0a14', 7, 26);
    S.add(new THREE.HemisphereLight('#7a70a0', '#2a1a10', 0.55));
    const moon = new THREE.DirectionalLight('#8aa0ff', 0.35); moon.position.set(-4, 10, 3); S.add(moon);
    // floor, walls, ceiling
    const fs = flagstones(3, [58, 48, 52], 1024, 6);
    for (const t of [fs.map, fs.normal, fs.rough]) t.repeat.set(4, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), new THREE.MeshStandardMaterial({ map: fs.map, normalMap: fs.normal, roughnessMap: fs.rough }));
    floor.rotation.x = -Math.PI / 2; S.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 12), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, 1); S.add(rug);
    const rug2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7.4), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }));
    rug2.rotation.set(-Math.PI / 2, 0, Math.PI / 2); rug2.position.set(5.9, 0.013, 0); S.add(rug2);
    const pl = plasterTex(5, [70, 58, 70]); pl.repeat.set(4, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ map: pl, roughness: 0.95 });
    for (const [x, z, ry] of [[0, -R, 0], [0, R, Math.PI], [-R, 0, Math.PI / 2]] as const) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, H), wallMat); w.position.set(x, H / 2, z); w.rotation.y = ry; S.add(w);
    }
    // east wall with a doorway to the Curio Shop
    const doorW = 3, doorH = 4.2;
    const eastParts: [number, number, number, number][] = [[-(R + doorW / 2) / 2, H / 2, R - doorW / 2, H], [(R + doorW / 2) / 2, H / 2, R - doorW / 2, H], [0, doorH + (H - doorH) / 2, doorW, H - doorH]];
    for (const [z, y, w, h] of eastParts) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(R, y, z); m.rotation.y = -Math.PI / 2; S.add(m);
    }
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(4, [96, 64, 44], 256, 512, 1), roughness: 0.8 });
    // door frame and arch
    for (const z of [-doorW / 2 - 0.15, doorW / 2 + 0.15]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, doorH, 0.3), wood); post.position.set(R - 0.1, doorH / 2, z); S.add(post); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, doorW + 0.7), wood); lintel.position.set(R - 0.1, doorH + 0.2, 0); S.add(lintel);
    // light spilling from the shop
    this.door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), new THREE.MeshBasicMaterial({ color: '#ffb060', transparent: true, opacity: 0.85 }));
    this.door.position.set(R + 0.6, doorH / 2, 0); this.door.rotation.y = -Math.PI / 2; S.add(this.door);
    this.doorGlow = glowSprite('#ffa050', 7, 0.55); this.doorGlow.position.set(R - 0.2, 2.2, 0); S.add(this.doorGlow);
    const doorLight = new THREE.PointLight('#ffa860', 30, 12, 1.6); doorLight.position.set(R - 1.2, 2.6, 0); S.add(doorLight); this.lights.push(doorLight);
    // hanging sign
    const [sc, sx] = canvas(512, 160);
    sx.fillStyle = '#2a1a12'; sx.fillRect(0, 0, 512, 160);
    sx.strokeStyle = '#c9a13b'; sx.lineWidth = 8; sx.strokeRect(10, 10, 492, 140);
    sx.fillStyle = '#f1d98a'; sx.font = 'italic 64px "IM Fell English", Georgia, serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle';
    sx.fillText('Curios & Oddments', 256, 84);
    const signTex = new THREE.CanvasTexture(sc); signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: signTex, emissive: new THREE.Color('#ffd080'), emissiveIntensity: 0.25, emissiveMap: signTex }));
    sign.position.set(R - 0.45, doorH + 0.9, 0); sign.rotation.y = -Math.PI / 2; S.add(sign);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), new THREE.MeshStandardMaterial({ color: '#150f14', roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; S.add(ceil);
    for (let i = -3; i <= 3; i++) { const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * R, 0.4, 0.35), wood); beam.position.set(0, H - 0.2, i * 3); S.add(beam); }

    // shelves
    const faces: Omit<Face, 'tan' | 'nrm' | 'rot'>[] = [];
    const wallXs = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
    wallXs.forEach((x, i) => {
      faces.push({ c: new THREE.Vector3(x, 0, -R + 0.35), ry: 0, rows: 5, wall: true, unit: 'n' + i });
      faces.push({ c: new THREE.Vector3(-x, 0, R - 0.35), ry: Math.PI, rows: 5, wall: true, unit: 's' + i });
      if (Math.abs(x) > 2) faces.push({ c: new THREE.Vector3(R - 0.35, 0, x), ry: -Math.PI / 2, rows: 5, wall: true, unit: 'e' + i });
      faces.push({ c: new THREE.Vector3(-R + 0.35, 0, -x), ry: Math.PI / 2, rows: 5, wall: true, unit: 'w' + i });
    });
    [-4, 1.8].forEach((z, ri) => [-5.2, -2, 2, 5.2].forEach((x, i) => {
      if (ri === 1 && x === 5.2) return; // keep the path to the shop clear
      faces.push({ c: new THREE.Vector3(x, 0, z + 0.33), ry: 0, rows: 4, unit: 'f' + ri + i });
      faces.push({ c: new THREE.Vector3(x, 0, z - 0.33), ry: Math.PI, rows: 4, unit: 'f' + ri + i });
      this.colliders.push({ x0: x - 1.5, x1: x + 1.5, z0: z - 0.5, z1: z + 0.5 });
    }));
    const woodParts: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
    const done: Record<string, boolean> = {};
    this.faces = faces.map(f => {
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.ry);
      const tan = new THREE.Vector3(1, 0, 0).applyQuaternion(rot), nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
      const topY = f.rows * 0.8 + 0.2;
      for (let r = 0; r <= f.rows; r++) woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, 0.1 + r * 0.8, 0)).addScaledVector(nrm, 0.18), q: rot, s: new THREE.Vector3(3.0, 0.06, 0.38) });
      for (const sx2 of [-1.5, 1.5]) woodParts.push({ p: f.c.clone().addScaledVector(tan, sx2).add(new THREE.Vector3(0, topY / 2, 0)).addScaledVector(nrm, 0.18), q: rot, s: new THREE.Vector3(0.1, topY, 0.42) });
      woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, topY + 0.08, 0)).addScaledVector(nrm, 0.2), q: rot, s: new THREE.Vector3(3.2, 0.16, 0.48) });
      if (!done[f.unit]) { done[f.unit] = true; woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, topY / 2, 0)).addScaledVector(nrm, f.wall ? -0.02 : -0.33), q: rot, s: new THREE.Vector3(3.0, topY, 0.04) }); }
      return { ...f, tan, nrm, rot };
    });
    const woodMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wood, woodParts.length);
    const m4 = new THREE.Matrix4();
    woodParts.forEach((w, i) => { m4.compose(w.p, w.q, w.s); woodMesh.setMatrixAt(i, m4); });
    S.add(woodMesh);

    // book slots
    const rng = mulberry32(99);
    this.faces.forEach((f, fi) => {
      for (let r = 0; r < f.rows; r++) {
        let x = -1.42;
        for (;;) {
          const w = 0.05 + rng() * 0.08;
          if (x + w > 1.42) break;
          const h = 0.36 + rng() * 0.3;
          this.books.push({ face: fi, row: r, x: x + w / 2, w, h, lean: rng() < 0.04 ? (rng() - 0.5) * 0.3 : 0, school: 'fire', size: 0, chained: false, glowing: false, title: '', pos: new THREE.Vector3(), quat: new THREE.Quaternion(), color: new THREE.Color() });
          x += w + 0.004 + (rng() < 0.03 ? 0.08 : 0);
        }
      }
    });
    const spineTex = leatherTex([255, 255, 255]);
    this.bookMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, map: spineTex, roughness: 0.75 }), this.books.length);
    this.bookMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.add(this.bookMesh);
    this.bandMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#8a8a92', metalness: 0.9, roughness: 0.35 }), 160);
    this.bandMesh.count = 0; S.add(this.bandMesh);
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#9fe3d6', wireframe: true, transparent: true, opacity: 0.9 }));
    this.highlight.visible = false; S.add(this.highlight);

    // candle stands
    const iron = new THREE.MeshStandardMaterial({ color: '#2c2420', metalness: 0.6, roughness: 0.5 });
    const wax = new THREE.MeshStandardMaterial({ color: '#eae0c2', emissive: new THREE.Color('#332a18'), roughness: 0.6 });
    [[-6.5, -7], [6.5, -7], [-6.5, 6.5], [6.5, 6.8], [-7.5, -0.7], [0, -1.3]].forEach(([x, z], i) => {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 1.3, 8), iron); stand.position.set(x, 0.65, z); S.add(stand);
      for (const dx of [-0.12, 0, 0.12]) {
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22 + Math.abs(dx), 8), wax); candle.position.set(x + dx, 1.42 + Math.abs(dx) / 2, z); S.add(candle);
        const flame = glowSprite('#ffb05a', 0.4); flame.position.set(x + dx, 1.62 + Math.abs(dx), z); S.add(flame); this.flames.push(flame);
        this.candlePos.push(flame.position.clone());
      }
      const L = new THREE.PointLight('#ffa860', 14, 12, 1.7); L.position.set(x, 2.1, z); S.add(L); this.lights.push(L);
      if (i < 5) this.colliders.push({ x0: x - 0.25, x1: x + 0.25, z0: z - 0.25, z1: z + 0.25 });
    });
    // the Binding Desk
    this.desk = new THREE.Group(); this.desk.position.set(0, 0, 8.4); S.add(this.desk);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 1.3), wood); top.position.y = 0.95; this.desk.add(top);
    for (const [dx, dz] of [[-1.35, -0.5], [1.35, -0.5], [-1.35, 0.5], [1.35, 0.5]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), wood); leg.position.set(dx, 0.47, dz); this.desk.add(leg); }
    const tome = new THREE.Group(); tome.position.set(0, 1.03, -0.05); this.desk.add(tome);
    for (const s of [-1, 1]) {
      const pg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.85), new THREE.MeshStandardMaterial({ map: parchmentTex(), emissive: new THREE.Color('#ffd898'), emissiveIntensity: 0.35 }));
      pg.position.x = s * 0.32; pg.rotation.z = s * -0.06; tome.add(pg);
    }
    const tl = new THREE.PointLight('#ffd090', 8, 4, 1.8); tl.position.set(0, 1.6, 8.3); S.add(tl);
    const quill = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#f0ece0' })); quill.position.set(0.9, 1.3, 0); quill.rotation.z = -0.5; this.desk.add(quill);
    const inkwell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 12), new THREE.MeshStandardMaterial({ color: '#141018', roughness: 0.1, metalness: 0.3 })); inkwell.position.set(0.9, 1.08, 0.1); this.desk.add(inkwell);
    this.deskPick = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 1.5), new THREE.MeshBasicMaterial({ visible: false })); this.deskPick.position.y = 0.8; this.desk.add(this.deskPick);
    const deskGlow = glowSprite('#ffe0a0', 2.2, 0.35); deskGlow.position.set(0, 1.25, 0); this.desk.add(deskGlow);
    this.colliders.push({ x0: -1.7, x1: 1.7, z0: 7.6, z1: 9.2 });

    // particles
    this.motes = new Particles(600, glowTex(), true);
    this.embers = new Particles(400, glowTex(), true);
    S.add(this.motes.points, this.embers.points);
    for (let i = 0; i < 300; i++) this.motes.emit({ x: (rng() - 0.5) * 18, y: rng() * 5, z: (rng() - 0.5) * 18, color: '#ffe2b0', size: 0.05 + rng() * 0.05, life: 3 + rng() * 6, drag: 0, jitter: 0.25, alpha: 0.7 });
    this.layout(0, 0);
    this.onResize(window.innerWidth, window.innerHeight);
  }

  onResize(_w: number, h: number) {
    this.motes.setScale(h, this.camera.fov); this.embers.setScale(h, this.camera.fov);
  }

  // Per-round library content: school, size class, chains, glow, and placement.
  layout(runId: number, round: number, taken: Record<number, boolean> = {}) {
    this.taken = taken;
    const seed = hashStr(`${runId}:${round}`);
    const rng = mulberry32(seed);
    const faceSchool = this.faces.map(() => SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let bands = 0;
    this.glows.forEach(g => this.scene.remove(g)); this.glows = [];
    const glowCandidates: number[] = [];
    const bm = new THREE.Matrix4();
    this.books.forEach((b, i) => {
      const f = this.faces[b.face];
      b.school = rng() < 0.72 ? faceSchool[b.face] : SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)];
      b.size = b.w > 0.115 ? 2 : (b.w > 0.085 || rng() < 0.15 ? 1 : 0);
      b.chained = rng() < (round >= 4 ? 0.022 : 0.012);
      b.glowing = false;
      const tr = mulberry32(seed ^ Math.imul(i, 2654435761));
      const words = TITLE_WORDS[b.school];
      b.title = TITLE_FORMS[Math.floor(tr() * TITLE_FORMS.length)].replace('{x}', words[Math.floor(tr() * words.length)]);
      if (!b.chained && rng() < 0.006) glowCandidates.push(i);
      const p = f.c.clone().addScaledVector(f.tan, b.x).add(new THREE.Vector3(0, 0.13 + b.row * 0.8 + b.h / 2, 0)).addScaledVector(f.nrm, 0.2 + (rng() - 0.5) * 0.02);
      e.set(0, f.ry, b.lean); q.setFromEuler(e);
      b.pos.copy(p); b.quat.copy(q);
      m4.compose(p, q, taken[i] ? new THREE.Vector3(0.0001, 0.0001, 0.0001) : new THREE.Vector3(b.w, b.h, 0.3));
      this.bookMesh.setMatrixAt(i, m4);
      const base = new THREE.Color(ESS[b.school].spine);
      const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
      col.setHSL(hsl.h, Math.min(1, hsl.s * (0.85 + rng() * 0.3)), Math.max(0.05, Math.min(0.9, hsl.l * (0.8 + rng() * 0.45))));
      b.color.copy(col);
      this.bookMesh.setColorAt(i, col);
      if (b.chained && !taken[i] && bands < 158) {
        bm.compose(p, q, new THREE.Vector3(b.w + 0.014, 0.035, 0.31)); this.bandMesh.setMatrixAt(bands++, bm);
        bm.compose(p.clone().add(new THREE.Vector3(0, b.h * 0.3, 0)), q, new THREE.Vector3(b.w + 0.014, 0.035, 0.31)); this.bandMesh.setMatrixAt(bands++, bm);
      }
    });
    glowCandidates.slice(0, 7).forEach(i => {
      const b = this.books[i]; b.glowing = true;
      if (taken[i]) return;
      const s = glowSprite('#fff0b0', 0.55, 0.6); s.position.copy(b.pos).addScaledVector(this.faces[b.face].nrm, 0.2); s.userData.phase = rng() * 6; this.scene.add(s); this.glows.push(s);
    });
    this.bandMesh.count = bands;
    this.bandMesh.instanceMatrix.needsUpdate = true;
    this.bookMesh.instanceMatrix.needsUpdate = true;
    if (this.bookMesh.instanceColor) this.bookMesh.instanceColor.needsUpdate = true;
  }

  hideBook(i: number) {
    const b = this.books[i], m4 = new THREE.Matrix4();
    m4.compose(b.pos, b.quat, new THREE.Vector3(0.0001, 0.0001, 0.0001));
    this.bookMesh.setMatrixAt(i, m4); this.bookMesh.instanceMatrix.needsUpdate = true;
    this.glows.forEach(g => { if (g.position.distanceTo(b.pos) < 0.35) g.visible = false; });
    this.taken[i] = true;
  }

  collide(p: THREE.Vector3) {
    const r = 0.35;
    const inDoor = Math.abs(p.z) < 1.3;
    p.x = Math.max(-R + 0.95, Math.min(inDoor ? R + 0.5 : R - 0.95, p.x));
    p.z = Math.max(-R + 0.95, Math.min(R - 0.95, p.z));
    for (const c of this.colliders) {
      const x0 = c.x0 - r, x1 = c.x1 + r, z0 = c.z0 - r, z1 = c.z1 + r;
      if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
        const dx = Math.min(p.x - x0, x1 - p.x), dz = Math.min(p.z - z0, z1 - p.z);
        if (dx < dz) p.x = (p.x - x0 < x1 - p.x) ? x0 : x1; else p.z = (p.z - z0 < z1 - p.z) ? z0 : z1;
      }
    }
  }

  // true when the reader walks into the shop doorway
  atDoor() { return this.pos.x > R - 0.6 && Math.abs(this.pos.z) < 1.3; }

  // Try the exact point first, then a few nearby points, so clicks in the gap above a row still find a book.
  pick(clientX: number, clientY: number): Pick {
    for (const [dx, dy] of [[0, 0], [0, 8], [0, -8], [6, 0], [-6, 0], [0, 16]]) {
      const p = this.pickAt(clientX + dx, clientY + dy);
      if (p) return p;
    }
    return null;
  }

  pickAt(clientX: number, clientY: number): Pick {
    const v = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    this.raycaster.far = 7;
    const hits = this.raycaster.intersectObjects([this.bookMesh, this.door, this.deskPick], false);
    for (const h of hits) {
      if (h.object === this.bookMesh && h.instanceId !== undefined) {
        if (this.taken[h.instanceId] || h.distance > 5.5) continue;
        return { kind: 'book', i: h.instanceId };
      }
      if (h.object === this.door) return { kind: 'door' };
      if (h.object === this.deskPick) return { kind: 'desk' };
    }
    return null;
  }

  setHover(p: Pick) {
    this.hover = p;
    if (!p || p.kind !== 'book') { this.highlight.visible = false; return; }
    const b = this.books[p.i];
    this.highlight.visible = true; this.highlight.position.copy(b.pos); this.highlight.quaternion.copy(b.quat);
    this.highlight.scale.set(b.w + 0.02, b.h + 0.02, 0.32);
  }

  update(dt: number, time: number) {
    const cam = this.camera;
    if (this.titleSpin) {
      this.yaw += dt * 0.05; this.pos.set(Math.sin(time * 0.05) * 2, 1.75, 5.5); this.pitch = 0.06;
    } else {
      const k = this.keys; let fx = 0, fz = 0;
      if (k.KeyW || k.ArrowUp) fz += 1; if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1; if (k.KeyD || k.ArrowRight) fx += 1;
      fx += this.joy.x; fz += -this.joy.y;
      const len = Math.hypot(fx, fz);
      if (len > 0.05) {
        const sp = 3.4 * dt / Math.max(1, len);
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.pos.x += (-sy * fz + cy * fx) * sp; this.pos.z += (-cy * fz - sy * fx) * sp;
        this.collide(this.pos);
      }
      this.pos.y = 1.62 + (len > 0.05 ? Math.sin(time * 9) * 0.025 : 0);
    }
    cam.position.copy(this.pos);
    cam.rotation.order = 'YXZ'; cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;
    this.lights.forEach((L, i) => { if (i === 0) { L.intensity = 28 + Math.sin(time * 2) * 3; return; } L.intensity = 13 + Math.sin(time * 7 + i * 2.1) * 1.2 + Math.sin(time * 13 + i) * 0.8; });
    this.flames.forEach((f, i) => { const s = 0.38 + Math.sin(time * 9 + i) * 0.04; f.scale.set(s * 0.7, s, s); });
    this.glows.forEach(g => { (g.material as THREE.SpriteMaterial).opacity = 0.35 + Math.sin(time * 2 + (g.userData.phase as number)) * 0.2; });
    (this.doorGlow.material as THREE.SpriteMaterial).opacity = 0.45 + Math.sin(time * 1.7) * 0.08;
    if (Math.random() < 0.3) { const p = this.candlePos[Math.floor(Math.random() * this.candlePos.length)]; this.embers.emit({ x: p.x, y: p.y + 0.1, z: p.z, vy: 0.4, color: '#ffc070', size: 0.04, life: 1.2, jitter: 0.6 }); }
    if (Math.random() < 0.4) this.motes.emit({ x: (Math.random() - 0.5) * 18, y: Math.random() * 5, z: (Math.random() - 0.5) * 18, color: '#ffe2b0', size: 0.05 + Math.random() * 0.05, life: 4 + Math.random() * 5, drag: 0, jitter: 0.25, alpha: 0.7 });
    if (Math.random() < 0.5) this.motes.emit({ x: R - 0.5 - Math.random() * 3, y: 0.5 + Math.random() * 3, z: (Math.random() - 0.5) * 2.6, vx: -0.3, color: '#ffc080', size: 0.06, life: 4, drag: 0, jitter: 0.3, alpha: 0.8 });
    this.motes.update(dt); this.embers.update(dt);
  }
}
