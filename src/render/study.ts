// The Study: your own little room, folded away in a pocket of somewhere else. The Binding Desk lives here, a fire
// burns, the cat sleeps, and everything you have bought sits on the shelves where you can see it.
import * as THREE from 'three';
import type { View } from './engine';
import { ARTIFACTS, REAGENTS } from '../data/artifacts';
import { Particles } from './particles';
import { glowSprite, makeArtifactModel } from './models';
import { glowTex, leatherTex, parchmentTex, plasterTex, rugTex, woodTex } from './textures';
import { mulberry32 } from '../sim/rng';

const W = 5.2, D = 4.2, HT = 4.4; // half width, half depth, height

interface Shown { id: string; kind: 'art' | 'reagent'; root: THREE.Group; model: THREE.Group; spin: number; base: number }

export class Study implements View {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.05, 60);
  bloom = { strength: 0.5, radius: 0.55, threshold: 0.82 };
  exposure = 1.05;
  vignette = 1.05;
  // walking about: the eye, where it looks, and what is held down
  pos = new THREE.Vector3(3.5, 1.62, D - 1.3);
  yaw = 0; pitch = -0.05;
  keys: Record<string, boolean> = {};
  joy = { x: 0, y: 0 };
  seated = false; // at the desk, binding: the view settles over the tome
  hoverBook = -1; // a book on your shelf under the crosshair
  private colliders: { x0: number; x1: number; z0: number; z1: number }[] = [];
  private deskPick!: THREE.Mesh;
  private door!: THREE.Mesh;
  private doorMat!: THREE.MeshBasicMaterial;
  private shelfMesh: THREE.InstancedMesh | null = null;
  private shelfSlots: { p: THREE.Vector3; w: number; h: number }[] = [];
  private shelfTitles: string[] = [];
  private shelfKey = '';
  private bob = 0;
  hover: Shown | null = null;
  shown: Shown[] = [];
  raycaster = new THREE.Raycaster();
  private fireLight: THREE.PointLight;
  private fireSprites: THREE.Sprite[] = [];
  private candles: { s: THREE.Sprite; ph: number; base: number }[] = [];
  private floaters: { g: THREE.Group; y: number; ph: number }[] = [];
  private cat: { body: THREE.Mesh; tail: THREE.Mesh };
  private stars: THREE.ShaderMaterial;
  private motes: Particles;
  private embers: Particles;
  private slots: { p: THREE.Vector3; staff: boolean; scale: number }[] = [];
  private reagentSlots: THREE.Vector3[] = [];
  private stock = new THREE.Group();
  private keyOf = '';

  constructor() {
    const S = this.scene;
    S.background = new THREE.Color('#0c0810');
    S.fog = new THREE.Fog('#140c0c', 9, 22);
    S.add(new THREE.HemisphereLight('#9a8070', '#2a160c', 0.45));
    const rng = mulberry32(2718);
    const r = (a: number, b: number) => a + rng() * (b - a);
    const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
    const add = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent: THREE.Object3D = S) => { o.position.set(x, y, z); parent.add(o); return o; };
    const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

    // ---- the room: plank floor, warm plaster above dark panelling, beams across the ceiling
    const planks = woodTex(31, [120, 78, 48], 256, 1024, 0.6); planks.repeat.set(5, 3);
    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * D), std('#ffffff', { map: planks, roughness: 0.7 })), 0, 0, 0); floor.rotation.x = -Math.PI / 2;
    const plaster = plasterTex(12, [150, 112, 84]); plaster.repeat.set(3, 1.4);
    const wallMat = std('#ffffff', { map: plaster, roughness: 1 });
    const panelTex = woodTex(33, [74, 44, 28], 256, 512, 1); panelTex.repeat.set(4, 1);
    const panelMat = std('#ffffff', { map: panelTex, roughness: 0.7 });
    const darkWood = std('#ffffff', { map: woodTex(34, [60, 36, 24], 256, 512, 1), roughness: 0.6 });
    const wood = std('#ffffff', { map: woodTex(35, [110, 70, 44], 256, 512, 1), roughness: 0.65 });
    // the back wall has a round window in it, onto nowhere in particular
    const WIN = { x: 0, y: 2.75, r: 0.95 };
    {
      const sh = new THREE.Shape([new THREE.Vector2(-W, 0), new THREE.Vector2(W, 0), new THREE.Vector2(W, HT), new THREE.Vector2(-W, HT)]);
      const hole = new THREE.Path(); hole.absarc(WIN.x, WIN.y, WIN.r, 0, Math.PI * 2, true); sh.holes.push(hole);
      const g = new THREE.ShapeGeometry(sh, 48);
      const uv = g.attributes.uv, p = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + W) / (2 * W), p.getY(i) / HT);
      add(new THREE.Mesh(g, wallMat), 0, 0, -D);
    }
    for (const sx of [-1, 1]) { const w = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * D, HT), wallMat), sx * W, HT / 2, 0); w.rotation.y = -sx * Math.PI / 2; }
    const front = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * W, HT), wallMat), 0, HT / 2, D); front.rotation.y = Math.PI;
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * D), std('#3a2418', { roughness: 1 })), 0, HT, 0); ceil.rotation.x = Math.PI / 2;
    // wainscot round three walls, with a rail on top
    add(box(2 * W, 1.1, 0.06, panelMat), 0, 0.55, -D + 0.03);
    for (const sx of [-1, 1]) add(box(0.06, 1.1, 2 * D, panelMat), sx * (W - 0.03), 0.55, 0);
    add(box(2 * W, 0.08, 0.12, darkWood), 0, 1.12, -D + 0.06);
    for (const sx of [-1, 1]) add(box(0.12, 0.08, 2 * D, darkWood), sx * (W - 0.06), 1.12, 0);
    for (let x = -W + 0.9; x < W; x += 1.8) add(box(0.3, 0.3, 2 * D, darkWood), x, HT - 0.15, 0);
    // the window: a brass ring, mullions, and the stars beyond
    const brass = std('#b08a3a', { metalness: 0.85, roughness: 0.3 });
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(WIN.r + 0.04, 0.09, 10, 48), brass), WIN.x, WIN.y, -D + 0.02);
    ring.rotation.z = 0.2;
    for (const a of [0, Math.PI / 2]) { const m = add(box(2 * WIN.r, 0.05, 0.05, brass), WIN.x, WIN.y, -D + 0.02); m.rotation.z = a; }
    add(box(2.2, 0.1, 0.35, darkWood), WIN.x, WIN.y - WIN.r - 0.08, -D + 0.15); // the sill
    this.stars = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vUv * 6.0 + vec2(uTime * 0.01, 0.0);
          float neb = n(p * 0.6) * 0.6 + n(p * 1.3 + 3.0) * 0.4;
          vec3 col = mix(vec3(0.03, 0.02, 0.08), vec3(0.28, 0.12, 0.38), smoothstep(0.35, 0.9, neb));
          col += vec3(0.1, 0.25, 0.35) * smoothstep(0.55, 1.0, n(p * 0.9 + 9.0)) * 0.6;
          vec2 g = vUv * 90.0; vec2 c = floor(g); float s = h(c);
          float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
          float star = step(0.975, s) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * tw;
          col += vec3(1.0, 0.95, 0.85) * star;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    add(new THREE.Mesh(new THREE.PlaneGeometry(5, 5), this.stars), WIN.x, WIN.y, -D - 0.6);
    add(glowSprite('#b080ff', 2.6, 0.18), WIN.x, WIN.y, -D + 0.1);

    // ---- the fireplace, on the back wall to the left
    const stone = std('#6a5a50', { roughness: 0.95, flatShading: true });
    const FX = -3.1;
    add(box(2.4, 0.2, 0.9, stone), FX, 0.1, -D + 0.45); // hearth
    for (const sx of [-1, 1]) add(box(0.4, 1.5, 0.6, stone), FX + sx * 0.8, 0.85, -D + 0.3);
    add(box(2.2, 0.35, 0.6, stone), FX, 1.7, -D + 0.3);
    add(box(2.6, 0.12, 0.75, darkWood), FX, 1.93, -D + 0.38); // mantel
    add(box(1.4, 2.4, 0.5, stone), FX, 3.2, -D + 0.25); // chimney breast
    add(box(1.2, 1.4, 0.05, std('#0a0604', { roughness: 1 })), FX, 0.9, -D + 0.05); // the dark inside
    for (const [dx, rz] of [[-0.25, 0.3], [0.2, -0.25], [0, 0.05]]) { const log = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.9, 8), std('#3a2414')), FX + dx, 0.32, -D + 0.35); log.rotation.set(0, 0, Math.PI / 2 + rz); }
    add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.3), std('#ff6a20', { emissive: new THREE.Color('#ff4a10'), emissiveIntensity: 1.6 })), FX, 0.24, -D + 0.35);
    for (let k = 0; k < 5; k++) { const s = add(glowSprite(k < 2 ? '#ffb040' : '#ff6a20', 0.7 + k * 0.12, 0.85), FX + r(-0.3, 0.3), 0.5 + k * 0.08, -D + 0.35); this.fireSprites.push(s); }
    this.fireLight = add(new THREE.PointLight('#ff9a4a', 18, 9, 1.4), FX, 0.9, -D + 1.0);
    // on the mantel: a clock, a little row of books, a candle
    const clock = add(new THREE.Group(), FX - 0.7, 2.14, -D + 0.4);
    clock.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.16), darkWood));
    clock.add(add(new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), std('#f0e6c8')), 0, 0.03, 0.081, clock));
    this.addBooks(FX + 0.15, 2.0, -D + 0.42, 0.7, 0, rng, 1);
    this.candle(FX + 0.8, 1.99, -D + 0.42, 0.22);

    // ---- the curio cabinet, on the back wall to the right: glass-fronted shelves for your trinkets
    const CX = 3.1;
    add(box(2.0, 2.9, 0.08, darkWood), CX, 1.45, -D + 0.04);
    for (const sx of [-1, 1]) add(box(0.1, 2.9, 0.5, darkWood), CX + sx * 0.95, 1.45, -D + 0.29);
    add(box(2.1, 0.12, 0.6, darkWood), CX, 2.95, -D + 0.3);
    add(box(2.0, 0.5, 0.5, darkWood), CX, 0.25, -D + 0.29);
    for (const y of [0.55, 1.35, 2.15]) {
      add(box(1.8, 0.05, 0.45, std('#b8d8e0', { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 })), CX, y, -D + 0.29);
      add(glowSprite('#ffe0a0', 1.3, 0.12), CX, y + 0.3, -D + 0.3);
    }
    // four places on each of the two upper shelves, the staff on a stand beside the cabinet, the stash below
    for (const y of [2.18, 1.38]) for (const x of [-0.62, -0.21, 0.21, 0.62]) this.slots.push({ p: new THREE.Vector3(CX + x, y, -D + 0.32), staff: false, scale: 1.7 });
    for (const x of [-0.62, -0.21, 0.21, 0.62]) this.slots.push({ p: new THREE.Vector3(CX + x, 0.58, -D + 0.32), staff: false, scale: 1.5 });
    this.slots.unshift({ p: new THREE.Vector3(CX - 1.45, 0.12, -D + 0.55), staff: true, scale: 1.5 });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.12, 16), darkWood), CX - 1.45, 0.06, -D + 0.55);
    const cabinetLight = add(new THREE.PointLight('#ffd8a0', 4, 3.5, 1.6), CX, 1.8, -D + 1.0);
    void cabinetLight;

    // ---- the writing desk, in the middle, facing you: the tome open on it, candles, ink, a crystal ball
    const DZ = -0.9;
    add(box(2.8, 0.1, 1.2, wood), 0, 0.92, DZ);
    for (const [x, z] of [[-1.3, -0.5], [1.3, -0.5], [-1.3, 0.5], [1.3, 0.5]]) add(box(0.12, 0.9, 0.12, darkWood), x, 0.45, DZ + z);
    add(box(0.8, 0.72, 1.0, darkWood), -0.95, 0.46, DZ); add(box(0.8, 0.72, 1.0, darkWood), 0.95, 0.46, DZ);
    for (const [x, y] of [[-0.95, 0.66], [-0.95, 0.32], [0.95, 0.66], [0.95, 0.32]]) add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), brass), x, y, DZ + 0.51);
    const tome = add(new THREE.Group(), 0, 0.99, DZ + 0.1);
    for (const s of [-1, 1]) {
      const pg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.66), std('#e0d4b0', { map: parchmentTex(), roughness: 0.9, emissive: new THREE.Color('#ffd898'), emissiveIntensity: 0.12 }));
      pg.position.x = s * 0.26; pg.rotation.z = s * -0.07; tome.add(pg);
    }
    tome.add(add(new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.03, 0.72), std('#5a2030')), 0, -0.03, 0, tome));
    add(glowSprite('#ffe8b0', 1.2, 0.16), 0, 1.15, DZ + 0.1);
    for (const [x, z, h] of [[-1.15, -0.3, 0.3], [-0.95, -0.4, 0.2], [1.2, -0.35, 0.26]] as const) this.candle(x, 0.97, DZ + z, h);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12), std('#141018', { roughness: 0.1, metalness: 0.3 })), 0.75, 1.03, DZ - 0.15);
    const quill = add(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.55, 6), std('#e8e0d0')), 0.8, 1.25, DZ - 0.12); quill.rotation.z = -0.4;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.06, 12), brass), -0.7, 1.0, DZ - 0.35);
    const orb = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#c8b8ff', roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.7, emissive: new THREE.Color('#4a2a8a'), emissiveIntensity: 0.6 })), -0.7, 1.19, DZ - 0.35);
    void orb;
    add(glowSprite('#a080ff', 0.7, 0.35), -0.7, 1.19, DZ - 0.35);
    for (let k = 0; k < 5; k++) { const p = add(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), std('#e8dcc0', { map: parchmentTex(), side: THREE.DoubleSide })), r(-1.2, 1.2), 0.975, DZ + r(-0.45, 0.45)); p.rotation.set(-Math.PI / 2, 0, r(-0.6, 0.6)); }
    // reagents stand in little jars along the back of the desk
    for (let k = 0; k < 6; k++) this.reagentSlots.push(new THREE.Vector3(-0.55 + k * 0.22, 0.97, DZ - 0.42));
    // and the chair you sit in
    const chair = add(new THREE.Group(), 0, 0, DZ - 1.0); chair.rotation.y = Math.PI; // tucked in behind the desk, facing the room
    chair.add(add(box(0.7, 0.1, 0.65, wood), 0, 0.5, 0, chair));
    chair.add(add(box(0.7, 0.9, 0.08, wood), 0, 1.0, 0.3, chair));
    chair.add(add(box(0.62, 0.08, 0.56, std('#6a2230', { roughness: 1 })), 0, 0.57, 0, chair));
    for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]]) chair.add(add(box(0.06, 0.5, 0.06, darkWood), x, 0.25, z, chair));

    // ---- the fireside: a rug, an armchair, a side table with tea, and the cat
    const rug = add(new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), std('#ffffff', { map: rugTex(), roughness: 1 })), -2.9, 0.01, -1.7); rug.rotation.x = -Math.PI / 2; rug.scale.set(1.2, 0.9, 1);
    const velvet = std('#7a2a2a', { roughness: 1 });
    const arm = add(new THREE.Group(), -4.0, 0, -0.6); arm.rotation.y = 0.9;
    arm.add(add(box(1.0, 0.45, 0.95, velvet), 0, 0.3, 0, arm));
    arm.add(add(box(1.0, 1.1, 0.25, velvet), 0, 0.85, -0.4, arm));
    for (const sx of [-1, 1]) arm.add(add(box(0.2, 0.7, 0.95, velvet), sx * 0.5, 0.5, 0, arm));
    arm.add(add(box(0.7, 0.14, 0.6, std('#8a3a3a', { roughness: 1 })), 0, 0.58, 0.05, arm));
    const throwB = add(box(0.9, 0.04, 0.5, std('#c8a060', { roughness: 1 })), 0.05, 1.0, -0.28, arm); throwB.rotation.x = 0.6; arm.add(throwB);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 16), darkWood), -3.3, 0.62, 0.4);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.6, 8), darkWood), -3.3, 0.31, 0.4);
    const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.08, 12), std('#e8e0d8', { roughness: 0.3 })), -3.25, 0.68, 0.38); void cup;
    for (let k = 0; k < 3; k++) { const st = add(glowSprite('#ffffff', 0.18, 0.12), -3.25, 0.8 + k * 0.1, 0.38); this.floaters.push({ g: st as unknown as THREE.Group, y: 0.8 + k * 0.1, ph: k * 2 }); }
    // the cat, curled up asleep on the rug
    const fur = std('#3a2c24', { roughness: 1 });
    const cat = add(new THREE.Group(), -2.6, 0, -1.5); cat.rotation.y = 0.6;
    const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), fur), 0, 0.16, 0, cat); body.scale.set(1.3, 0.62, 1); cat.add(body);
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), fur), 0.3, 0.14, 0.12, cat); cat.add(head);
    for (const s of [-1, 1]) { const ear = add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4), fur), 0.32 + s * 0.02, 0.26, 0.12 + s * 0.07, cat); ear.rotation.x = s * 0.3; cat.add(ear); }
    const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.3, 0.08, 0), new THREE.Vector3(-0.3, 0.06, 0.25), new THREE.Vector3(0, 0.05, 0.33), new THREE.Vector3(0.22, 0.05, 0.28)]);
    const tail = add(new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 16, 0.04, 6), fur), 0, 0, 0, cat); cat.add(tail);
    this.cat = { body, tail };

    // ---- bookshelves along both side walls, and a ladder
    for (const sx of [-1, 1]) {
      const x = sx * (W - 0.25);
      const z0 = sx < 0 ? 1.0 : -0.4, z1 = sx < 0 ? 3.8 : 3.8;
      const len = z1 - z0, zc = (z0 + z1) / 2;
      add(box(0.45, 3.4, 0.08, darkWood), x, 1.7, z0); add(box(0.45, 3.4, 0.08, darkWood), x, 1.7, z1);
      for (let k = 0; k <= 4; k++) add(box(0.45, 0.05, len, darkWood), x, 0.1 + k * 0.8, zc);
      for (let k = 0; k < 4; k++) this.addBooks(x, 0.13 + k * 0.8, zc, len - 0.2, Math.PI / 2, rng, sx);
    }
    // potted plants and a hanging one
    const pot = std('#9a5a3a', { roughness: 0.9 }), leaf = std('#4a7a3a', { roughness: 0.9, side: THREE.DoubleSide });
    for (const [x, z, sc] of [[-1.7, -D + 0.4, 1], [4.5, -0.9, 1.3], [1.8, -D + 0.45, 0.8]] as const) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.2 * sc, 0.15 * sc, 0.35 * sc, 12), pot), x, 0.18 * sc, z);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const l = add(new THREE.Mesh(new THREE.ConeGeometry(0.08 * sc, 0.6 * sc, 4), leaf), x + Math.cos(a) * 0.1 * sc, 0.55 * sc, z + Math.sin(a) * 0.1 * sc); l.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); }
    }
    {
      const hx = 1.6, hz = -2.4;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.9, 4), std('#3a2a1a')), hx, HT - 0.45, hz);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), pot), hx, HT - 0.9, hz);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2, len = r(0.4, 0.9);
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(hx, HT - 0.9, hz), new THREE.Vector3(hx + Math.cos(a) * 0.3, HT - 0.95, hz + Math.sin(a) * 0.3), new THREE.Vector3(hx + Math.cos(a) * 0.35, HT - 0.9 - len, hz + Math.sin(a) * 0.35)]);
        S.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.012, 4), leaf));
        for (let j = 1; j < 5; j++) { const p = curve.getPoint(j / 5); const lf = add(new THREE.Mesh(new THREE.CircleGeometry(0.045, 6), leaf), p.x, p.y, p.z); lf.rotation.set(r(0, 3), r(0, 3), 0); }
      }
    }
    // a lantern over the desk, and candles that float up near the beams
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.0, 4), std('#2a2018')), 0, HT - 0.5, DZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.32, 6, 1, true), std('#2a2018', { metalness: 0.8, roughness: 0.4, wireframe: true })), 0, HT - 1.15, DZ);
    add(glowSprite('#ffc070', 1.2, 0.7), 0, HT - 1.15, DZ);
    add(new THREE.PointLight('#ffc890', 9, 7, 1.5), 0, HT - 1.3, DZ);
    for (let k = 0; k < 7; k++) {
      const g = add(new THREE.Group(), r(-4, 4), r(3.1, 3.8), r(-3.2, 2.5));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, r(0.14, 0.26), 8), std('#f0e6cc', { emissive: new THREE.Color('#3a2a14') })));
      const f = glowSprite('#ffc070', 0.3, 0.9); f.position.y = 0.16; g.add(f);
      this.floaters.push({ g, y: g.position.y, ph: r(0, 6) });
    }
    // a door-shaped shimmer on the front wall: the way back to the library
    // the way back to the library: a doorway in the front wall, full of shimmering nothing
    for (const sx of [-1, 1]) add(box(0.18, 2.5, 0.2, darkWood), 3.5 + sx * 0.72, 1.25, D - 0.08);
    add(box(1.64, 0.2, 0.22, darkWood), 3.5, 2.55, D - 0.08);
    this.doorMat = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.door = add(new THREE.Mesh(new THREE.PlaneGeometry(1.26, 2.42), this.doorMat), 3.5, 1.23, D - 0.05); this.door.rotation.y = Math.PI;
    add(glowSprite('#8fd8ff', 2.4, 0.3), 3.5, 1.3, D - 0.3);
    // your own bookcase, on the front wall: every book you have ever borrowed ends up here
    {
      const bx = -1.6, bw = 3.0, bz = D - 0.28;
      add(box(bw + 0.1, 3.3, 0.06, darkWood), bx, 1.65, D - 0.03);
      for (const sx of [-1, 1]) add(box(0.1, 3.3, 0.5, darkWood), bx + sx * bw / 2, 1.65, bz);
      add(box(bw + 0.25, 0.12, 0.6, darkWood), bx, 3.33, bz);
      for (let k = 0; k < 5; k++) add(box(bw, 0.05, 0.46, darkWood), bx, 0.12 + k * 0.78, bz);
      // slots for up to 5 shelves of books, left to right, top shelf first
      const r2 = mulberry32(99);
      for (let k = 3; k >= 0; k--) {
        let x = -bw / 2 + 0.08;
        while (x < bw / 2 - 0.1) { const w = 0.05 + r2() * 0.05; this.shelfSlots.push({ p: new THREE.Vector3(bx + x + w / 2, 0.15 + k * 0.78, bz), w, h: 0.36 + r2() * 0.28 }); x += w + 0.006; }
      }
      // a reading lamp on top, lighting the shelves
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.3, 10), brass), bx + 1.1, 3.54, bz);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 16, 1, true), std('#2a4a3a', { side: THREE.DoubleSide, emissive: new THREE.Color('#0a1a10') })), bx + 1.1, 3.78, bz);
      add(glowSprite('#ffd8a0', 0.8, 0.8), bx + 1.1, 3.7, bz);
      const shelfLight = add(new THREE.SpotLight('#ffd8a8', 14, 7, 0.9, 0.7, 1.3), bx + 0.4, 3.9, bz - 1.4);
      shelfLight.target.position.set(bx, 1.4, bz); S.add(shelfLight.target);
      this.colliders.push({ x0: bx - bw / 2 - 0.1, x1: bx + bw / 2 + 0.1, z0: D - 0.6, z1: D });
    }

    this.stock.name = 'your curios'; S.add(this.stock);
    // what you cannot walk through: the desk and its chair, the fireplace, cabinet, armchair, side table, the cat,
    // the side bookshelves and the plants
    const DZ2 = -0.9;
    this.colliders.push(
      { x0: -1.45, x1: 1.45, z0: DZ2 - 0.65, z1: DZ2 + 0.65 }, { x0: -0.4, x1: 0.4, z0: DZ2 - 1.4, z1: DZ2 - 0.65 },
      { x0: -4.4, x1: -1.8, z0: -D, z1: -D + 0.95 }, { x0: 1.7, x1: 4.2, z0: -D, z1: -D + 0.8 },
      { x0: -4.7, x1: -3.3, z0: -1.3, z1: 0.1 }, { x0: -3.6, x1: -3.0, z0: 0.1, z1: 0.7 }, { x0: -2.95, x1: -2.25, z0: -1.8, z1: -1.2 },
      { x0: -W, x1: -W + 0.5, z0: 1.0, z1: 3.8 }, { x0: W - 0.5, x1: W, z0: -0.4, z1: 3.8 },
      { x0: 4.2, x1: 4.8, z0: -1.2, z1: -0.6 }, { x0: -1.95, x1: -1.45, z0: -D, z1: -D + 0.65 },
    );
    this.deskPick = add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.3, 1.3), new THREE.MeshBasicMaterial({ visible: false })), 0, 0.65, DZ2);
    this.motes = new Particles(300, glowTex(), true);
    this.embers = new Particles(200, glowTex(), true);
    S.add(this.motes.points, this.embers.points);
    for (let i = 0; i < 80; i++) this.motes.emit({ x: r(-W, W), y: r(0.2, HT - 0.3), z: r(-D, D), color: '#ffe2b0', size: 0.03 + rng() * 0.03, life: 4 + rng() * 8, drag: 0, jitter: 0.12, alpha: 0.6 });
    this.onResize(window.innerWidth, window.innerHeight);
  }

  private candle(x: number, y: number, z: number, h: number) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, h, 10), new THREE.MeshStandardMaterial({ color: '#f0e6cc', emissive: new THREE.Color('#3a2a14'), roughness: 0.6 }));
    c.position.set(x, y + h / 2, z); this.scene.add(c);
    const s = glowSprite('#ffb85a', 0.34, 0.95); s.position.set(x, y + h + 0.07, z); this.scene.add(s);
    this.candles.push({ s, ph: x * 7 + z * 3, base: 0.34 });
  }

  // a row of books standing on a shelf, along x (ry 0) or along z (ry π/2)
  private addBooks(x: number, y: number, z: number, len: number, ry: number, rng: () => number, facing: number) {
    const books: { w: number; h: number; c: THREE.Color; lean: number }[] = [];
    let t = 0;
    while (t < len) { const w = 0.04 + rng() * 0.06; const h = 0.3 + rng() * 0.32; books.push({ w, h, c: new THREE.Color().setHSL(rng() < 0.5 ? rng() * 0.1 : 0.55 + rng() * 0.35, 0.35 + rng() * 0.3, 0.15 + rng() * 0.25), lean: rng() < 0.08 ? (rng() - 0.5) * 0.4 : 0 }); t += w + 0.006; if (rng() < 0.05) t += 0.12; }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: leatherTex([255, 255, 255]), roughness: 0.75 }), books.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    let a = -len / 2;
    books.forEach((b, i) => {
      const along = a + b.w / 2; a += b.w + 0.006;
      q.setFromEuler(new THREE.Euler(0, ry, b.lean));
      const p = ry === 0 ? new THREE.Vector3(x + along, y + b.h / 2, z) : new THREE.Vector3(x - facing * 0.03, y + b.h / 2, z + along);
      m4.compose(p, q, new THREE.Vector3(b.w, b.h, 0.26)); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, b.c);
    });
    this.scene.add(mesh);
  }

  // Put what you own on display: the staff on its stand, trinkets on the upper shelves, the stash below,
  // reagents in a row on the desk. Only rebuilt when what you own changes.
  setOwned(staff: string | null, trinkets: (string | null)[], stash: string[], reagents: string[]) {
    const key = JSON.stringify([staff, trinkets, stash, reagents]);
    if (key === this.keyOf) return;
    this.keyOf = key;
    for (const s of this.shown) this.stock.remove(s.root);
    this.shown = [];
    const place = (id: string, kind: 'art' | 'reagent', p: THREE.Vector3, scale: number) => {
      const spec = kind === 'art' ? ARTIFACTS[id].model : REAGENTS[id].model;
      const root = new THREE.Group(); root.position.copy(p); this.stock.add(root);
      const model = makeArtifactModel(spec);
      const isStaff = spec.kind.startsWith('staff');
      model.scale.setScalar(isStaff ? scale * 0.9 : scale);
      model.traverse(o => { const sp = o as THREE.Sprite; if (sp.isSprite) (sp.material as THREE.SpriteMaterial).opacity *= 0.55; });
      root.add(model);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.34, isStaff ? 1.6 : 0.5, 0.34), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = isStaff ? 0.8 : 0.2; root.add(pick);
      pick.userData.shown = this.shown.length;
      this.shown.push({ id, kind, root, model, spin: Math.random() * 6, base: isStaff ? 0 : 0.06 });
    };
    const trinketList = [...trinkets.filter((t): t is string => !!t)];
    if (staff) place(staff, 'art', this.slots[0].p, this.slots[0].scale);
    trinketList.slice(0, 8).forEach((id, i) => place(id, 'art', this.slots[1 + i].p, this.slots[1 + i].scale));
    stash.slice(0, 4).forEach((id, i) => place(id, 'art', this.slots[9 + i].p, this.slots[9 + i].scale));
    const seen: Record<string, boolean> = {};
    reagents.filter(id => !seen[id] && (seen[id] = true)).slice(0, 6).forEach((id, i) => place(id, 'reagent', this.reagentSlots[i], 1.1));
  }

  // Your borrowed books, spine by spine, on your own bookcase.
  setShelf(books: { t: string; c: string }[]) {
    const key = books.length + ':' + (books[books.length - 1]?.t || '');
    if (key === this.shelfKey) return;
    this.shelfKey = key;
    if (this.shelfMesh) { this.scene.remove(this.shelfMesh); this.shelfMesh.dispose(); }
    const list = books.slice(-this.shelfSlots.length);
    this.shelfTitles = list.map(b => b.t);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: leatherTex([255, 255, 255]), roughness: 0.7 }), Math.max(1, list.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    list.forEach((b, i) => {
      const s = this.shelfSlots[i];
      m4.compose(new THREE.Vector3(s.p.x, s.p.y + s.h / 2, s.p.z), q, new THREE.Vector3(s.w, s.h, 0.3));
      mesh.setMatrixAt(i, m4); mesh.setColorAt(i, new THREE.Color(b.c));
    });
    mesh.count = list.length;
    mesh.computeBoundingSphere();
    this.shelfMesh = mesh; this.scene.add(mesh);
  }

  // What the crosshair (or a tap) is on: the desk, the door home, a curio, or one of your books.
  pick(clientX: number, clientY: number): { kind: 'desk' } | { kind: 'door' } | { kind: 'curio'; s: Shown } | { kind: 'book'; i: number; title: string } | null {
    this.raycaster.setFromCamera(new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1), this.camera);
    this.raycaster.far = 4.5;
    const picks: THREE.Object3D[] = [this.deskPick, this.door];
    for (const s of this.shown) s.root.children.forEach(c => { if (c.userData.shown !== undefined) picks.push(c); });
    if (this.shelfMesh) picks.push(this.shelfMesh);
    const hit = this.raycaster.intersectObjects(picks, false)[0];
    if (!hit) return null;
    if (hit.object === this.deskPick) return { kind: 'desk' };
    if (hit.object === this.door) return { kind: 'door' };
    if (hit.object === this.shelfMesh && hit.instanceId !== undefined) return { kind: 'book', i: hit.instanceId, title: this.shelfTitles[hit.instanceId] };
    return { kind: 'curio', s: this.shown[hit.object.userData.shown as number] };
  }

  // Put you just inside the door, looking into the room.
  arrive() { this.pos.set(3.5, 1.62, D - 1.3); this.yaw = 0.35; this.pitch = -0.08; this.seated = false; this.keys = {}; this.joy = { x: 0, y: 0 }; }
  atDoor() { return !this.seated && this.pos.z > D - 0.75 && Math.abs(this.pos.x - 3.5) < 0.6; }

  private collide(p: THREE.Vector3) {
    const B = 0.3;
    p.x = Math.max(-W + B, Math.min(W - B, p.x)); p.z = Math.max(-D + B, Math.min(D - B, p.z));
    if (Math.abs(p.x - 3.5) < 0.55) p.z = Math.min(D - 0.1, p.z + 0); // (the doorway lets you right up to it)
    for (const b of this.colliders) {
      const x0 = b.x0 - B, x1 = b.x1 + B, z0 = b.z0 - B, z1 = b.z1 + B;
      if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
        const dx = Math.min(p.x - x0, x1 - p.x), dz = Math.min(p.z - z0, z1 - p.z);
        if (dx < dz) p.x = p.x - x0 < x1 - p.x ? x0 : x1; else p.z = p.z - z0 < z1 - p.z ? z0 : z1;
      }
    }
  }

  onResize(w: number, h: number) {
    const narrow = w / h < 0.9;
    this.camera.fov = narrow ? 72 : 52;
    this.camera.updateProjectionMatrix();
    this.motes.setScale(h, this.camera.fov); this.embers.setScale(h, this.camera.fov);
  }

  update(dt: number, time: number) {
    const cam = this.camera;
    if (this.seated) {
      // in the chair behind the desk, looking down at the open tome and the room beyond it
      cam.position.lerp(new THREE.Vector3(0, 1.62, -2.05), 1 - Math.exp(-dt * 4));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.42, Math.PI, 0, 'YXZ'));
      cam.quaternion.slerp(q, 1 - Math.exp(-dt * 4));
    } else {
      const k = this.keys; let fx = 0, fz = 0;
      if (k.KeyW || k.ArrowUp) fz += 1; if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1; if (k.KeyD || k.ArrowRight) fx += 1;
      fx += this.joy.x; fz -= this.joy.y;
      const len = Math.hypot(fx, fz);
      if (len > 0.05) {
        const sp = (k.ShiftLeft || k.ShiftRight ? 3.6 : 2.4) * dt / Math.max(1, len);
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.pos.x += (-sy * fz + cy * fx) * sp; this.pos.z += (-cy * fz - sy * fx) * sp;
        this.collide(this.pos);
        this.bob += dt * 8;
      }
      // getting up from the desk: ease back to where you stood
      cam.position.lerp(new THREE.Vector3(this.pos.x, this.pos.y + Math.sin(this.bob) * 0.02, this.pos.z), 1 - Math.exp(-dt * 12));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      cam.quaternion.slerp(q, 1 - Math.exp(-dt * 14));
    }
    this.doorMat.opacity = 0.28 + Math.sin(time * 1.7) * 0.08;
    // fire and candles
    const f = 0.75 + Math.sin(time * 9) * 0.1 + Math.sin(time * 13.7) * 0.08 + Math.sin(time * 3.1) * 0.07;
    this.fireLight.intensity = 18 * f;
    this.fireSprites.forEach((s, i) => { const k = 0.7 + i * 0.12; s.scale.set(k * (0.8 + Math.sin(time * 11 + i) * 0.12), k * (1 + Math.sin(time * 8 + i * 2) * 0.18), 1); });
    for (const c of this.candles) { const k = c.base * (1 + Math.sin(time * 10 + c.ph) * 0.07); c.s.scale.set(k * 0.75, k, k); }
    for (const fl of this.floaters) fl.g.position.y = fl.y + Math.sin(time * 0.8 + fl.ph) * 0.08;
    if (Math.random() < 0.25) this.embers.emit({ x: -3.1 + (Math.random() - 0.5) * 0.6, y: 0.5, z: -D + 0.35, vy: 0.6 + Math.random() * 0.5, color: Math.random() < 0.5 ? '#ffb040' : '#ff6a20', size: 0.035, life: 1.6, jitter: 0.3, alpha: 0.9 });
    if (Math.random() < 0.15) this.motes.emit({ x: (Math.random() - 0.5) * 2 * W, y: Math.random() * HT, z: (Math.random() - 0.5) * 2 * D, color: '#ffe2b0', size: 0.03 + Math.random() * 0.03, life: 8, drag: 0, jitter: 0.12, alpha: 0.6 });
    // the cat breathes and, now and then, its tail twitches
    const br = 1 + Math.sin(time * 1.6) * 0.035;
    this.cat.body.scale.set(1.3 * br, 0.62 * br, 1 * br);
    this.cat.tail.rotation.y = Math.sin(time * 0.7) > 0.95 ? Math.sin(time * 18) * 0.08 : 0;
    // your curios turn slowly on their shelves; the one under the pointer lifts
    for (const s of this.shown) {
      const on = s === this.hover ? 1 : 0;
      s.spin += dt * (0.3 + on * 1.2);
      s.model.rotation.y = s.spin;
      s.model.position.y += ((s.base + on * 0.06 + Math.sin(time * 1.2 + s.spin) * 0.01) - s.model.position.y) * Math.min(1, dt * 6);
    }
    this.stars.uniforms.uTime.value = time;
    this.motes.update(dt); this.embers.update(dt);
  }
}
