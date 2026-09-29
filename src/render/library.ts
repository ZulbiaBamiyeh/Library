// The library, walked in first person. It is one building: the Reading Room on top, with the Curio Shop
// off its east wall and the Duelling Ring off its west, and seven sprawling floors below it, stacked around
// an open stairwell. Each floor below is a warren of wings, corridors, galleries and little alcoves, the same
// every visit, so a reader can learn where things are kept.
import * as THREE from 'three';
import type { View } from './engine';
import { ESS, SCHOOL_ORDER, type Essence } from '../data/spells';
import { mulberry32, hashStr } from '../sim/rng';
import { Particles } from './particles';
import { canvas, flagstones, glowTex, plasterTex, rugTex, woodTex, parchmentTex, leatherTex } from './textures';
import { glowSprite } from './models';

const R = 10; // half the width of the central hall
const H = 7; // hall height
export const LH = 8; // one floor to the next
const EYE = 1.62;
const C = 2; // the floor plans are drawn on a grid of 2-unit cells
// the stairwell: a round shaft through every floor, the stair clinging to its wall, open in the middle
const WELL = new THREE.Vector3(0, 0, -6.9);
const WELL_R = 2.1; // the hole in each floor
const STAIR_IN = 1.05, STAIR_OUT = 2.05; // the steps run between these radii; inside is a straight drop
const PITCH = 4; // how far one full turn of the stair descends
const A0 = Math.PI / 2; // the landing on every floor faces south, into the hall
const STEP_UP = 0.5;
const BODY = 0.35;

export interface Book {
  face: number; row: number; x: number; w: number; h: number; lean: number;
  school: Essence; size: number; chained: boolean; glowing: boolean; title: string;
  nook: boolean; far: number; // tucked away in an alcove; how far from the stair (0..1)
  pos: THREE.Vector3; quat: THREE.Quaternion; color: THREE.Color;
}
interface Face { c: THREE.Vector3; ry: number; rows: number; width: number; wall?: boolean; unit: string; room: number; nook: boolean; far: number; tan: THREE.Vector3; nrm: THREE.Vector3; rot: THREE.Quaternion }
interface Slot { face: number; row: number; x: number; w: number; h: number; lean: number }
interface Box { x0: number; x1: number; z0: number; z1: number }

// ---- floor plans
type RoomKind = 'hall' | 'room' | 'corridor' | 'gallery' | 'nook';
interface Room { id: number; kind: RoomKind; ix0: number; iz0: number; ix1: number; iz1: number; ceil: number }
interface Edge { x: number; z: number; nx: number; nz: number; ceil: number; room: number; kind: RoomKind; shelf: boolean }
interface Plan { N: number; half: number; walk: Uint8Array; ceil: Float32Array; room: Int16Array; rooms: Room[]; edges: Edge[] }

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

export type Pick = { kind: 'book'; i: number; d: number } | { kind: 'door' } | { kind: 'desk' } | { kind: 'arena' } | null;

// Each floor down is darker, older and stranger than the one above it.
export interface LevelDef {
  name: string; sub: string;
  fog: string; near: number; far: number;
  sky: string; ground: string; hemi: number;
  wall: string; floor: string; wood: string; ceil: string;
  candle: string; flame: string; candleI: number; lantern: number;
  mote: string; spine: string; spineMix: number; titles: string[];
}
export const LEVELS: LevelDef[] = [
  { name: 'The Reading Room', sub: 'Candles, carpets and borrowed books',
    fog: '#0d0a14', near: 7, far: 26, sky: '#7a70a0', ground: '#2a1a10', hemi: 0.55,
    wall: '#ffffff', floor: '#ffffff', wood: '#ffffff', ceil: '#150f14', candle: '#ffa860', flame: '#ffb05a', candleI: 1, lantern: 0,
    mote: '#ffe2b0', spine: '#ffffff', spineMix: 0, titles: [] },
  { name: 'The Lower Stacks', sub: 'Where the dust is older than the books',
    fog: '#0a0806', near: 4, far: 22, sky: '#6a5a48', ground: '#1a1008', hemi: 0.38,
    wall: '#9a8a74', floor: '#8a7a66', wood: '#8a765e', ceil: '#100c08', candle: '#ff9040', flame: '#ff9a40', candleI: 0.85, lantern: 5,
    mote: '#c8b898', spine: '#6a5a40', spineMix: 0.45,
    titles: ['A Ledger of Unpaid Debts', 'Minutes of a Meeting Nobody Attended', 'The Index to a Lost Book', 'Marginalia, Volume IX', 'Concerning Dust', 'An Almanac of Wrong Years', 'Second Drafts of the Sun', 'Notes Found in a Wall', 'Overdue Since the Flood', 'A Catalogue of Other Catalogues'] },
  { name: 'The Ossuary Shelves', sub: 'Shelved among the bones of old readers',
    fog: '#060a07', near: 3.5, far: 20, sky: '#5a7a60', ground: '#0a100a', hemi: 0.34,
    wall: '#a8ae98', floor: '#7a8070', wood: '#b8b098', ceil: '#0a0c08', candle: '#7aff9a', flame: '#b0ffc0', candleI: 0.75, lantern: 6,
    mote: '#b8ffc8', spine: '#d8d0b8', spineMix: 0.5,
    titles: ['The Book of Knucklebones', 'Hymns for the Recently Buried', 'On the Grammar of Teeth', 'A Census of the Quiet', 'Ossuary Accounts', 'What the Marrow Knows', 'Rites of the Lesser Crypt', 'Epitaphs, Unfinished', 'Bound in Someone', 'The Last Borrower'] },
  { name: 'The Root Cellar', sub: 'Something old is growing through the shelves',
    fog: '#070a04', near: 3.5, far: 20, sky: '#7a7040', ground: '#0a0804', hemi: 0.42,
    wall: '#7a6a4a', floor: '#5a4a30', wood: '#6a5028', ceil: '#0a0804', candle: '#ffb060', flame: '#ffc890', candleI: 0.8, lantern: 7,
    mote: '#d8f07a', spine: '#4a5a20', spineMix: 0.45,
    titles: ['A Herbal of Things That Should Not Grow', 'Root and Rune', 'The Patient Seed', 'Mycelium, a Correspondence', 'What Lives Under the Stacks', 'Compost of the Old Masters', 'The Gardener Who Stayed', 'Taproots', 'Spores, Collected', 'The Green Index'] },
  { name: 'The Drowned Archive', sub: 'The sea got in, long ago, and stayed to read',
    fog: '#03101a', near: 3, far: 19, sky: '#3a6a9a', ground: '#02080f', hemi: 0.38,
    wall: '#5a7890', floor: '#3a5a70', wood: '#4a6a78', ceil: '#03080c', candle: '#5ab0ff', flame: '#a0e0ff', candleI: 0.75, lantern: 6,
    mote: '#9fdcff', spine: '#2a6a6a', spineMix: 0.5,
    titles: ['Tide Tables for a Drowned City', 'The Salt Psalter', 'Letters Written Underwater', 'The Weeping Folio', 'Concerning the Deep King', 'A Map of Where the Sea Was', 'Brine and Vellum', 'Songs the Anchor Sang', 'Waterlogged Prophecies', 'The Pearl Diver\'s Last Page'] },
  { name: 'The Inverse Stacks', sub: 'Up is a matter of opinion down here',
    fog: '#0b0414', near: 3, far: 18, sky: '#8a5ac0', ground: '#100418', hemi: 0.38,
    wall: '#8a68b0', floor: '#6a4a8a', wood: '#6a4a8a', ceil: '#0c0414', candle: '#c070ff', flame: '#e8b0ff', candleI: 0.8, lantern: 6,
    mote: '#e0c0ff', spine: '#7a3aa0', spineMix: 0.4,
    titles: ['A Book Read Backwards', 'Instructions for Falling Up', 'The Day Before Yesterday, Tomorrow', 'Recipes for Unbaking Bread', 'This Title Is Upside Down', 'On Shelves That Shelve Themselves', 'An Inventory of Absent Things', 'ǝɹǝɥ ʇou ǝɹ,noʎ', 'The Mirror\'s Diary', 'Answers, Without Questions'] },
  { name: 'The Stopped Clocks', sub: 'Time gave up down here, mid-sentence',
    fog: '#0e0a04', near: 3, far: 18, sky: '#a08a50', ground: '#0e0804', hemi: 0.4,
    wall: '#8a7a5a', floor: '#6a5a3a', wood: '#5a4a2a', ceil: '#0e0a04', candle: '#ffd070', flame: '#ffe0a0', candleI: 0.8, lantern: 7,
    mote: '#ffe8a0', spine: '#8a6a2a', spineMix: 0.45,
    titles: ['A Quarter Past Never', 'The Almanac of the Last Second', 'Escapements', 'On Waiting', 'The Clockmaker\'s Apology', 'Minutes, Unspent', 'The Hour That Was Skipped', 'Pendulum Studies', 'Late', 'Chronicle of a Single Moment'] },
  { name: 'The Unwritten', sub: 'Nothing here has been written yet. Except you',
    fog: '#000000', near: 2.5, far: 16, sky: '#ffffff', ground: '#000000', hemi: 0.14,
    wall: '#2a2a2e', floor: '#18181c', wood: '#1a1a1e', ceil: '#000000', candle: '#e8e8ff', flame: '#ffffff', candleI: 0.6, lantern: 7,
    mote: '#ffffff', spine: '#f0f0f0', spineMix: 0.75,
    titles: ['[this title has been eaten]', 'The Book That Reads You', 'Untitled', '—', 'What the Ink Remembers', 'The First Word', 'Do Not Finish This', 'The Author, Annotated', 'Blank', 'You Were Here Before'] },
];
export const DEEPEST = LEVELS.length - 1;
const HALL_CANDLES: [number, number][] = [[-6.5, -7], [6.5, -7], [-6.5, 6.5], [6.5, 6.8], [-7.6, -2.6], [0, -1.3]];
const HALL_ROWS: [number, number][] = []; // free-standing double shelves in the hall
for (const [ri, z] of [[0, -3.6], [1, 1.8]] as const) for (const x of [-5.2, -2, 2, 5.2]) if (!(ri === 1 && x === 5.2)) HALL_ROWS.push([x, z]);

// A painted sign whose text is measured to fit its frame, redrawn once the serif font has loaded.
function signTexture(lines: string[], o: { bg: string; border: string; ink: string; w?: number; h?: number }): THREE.CanvasTexture {
  const w = o.w || 1024, h = o.h || 320;
  const [cv, cx] = canvas(w, h);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = () => {
    cx.clearRect(0, 0, w, h);
    cx.fillStyle = o.bg; cx.fillRect(0, 0, w, h);
    cx.strokeStyle = o.border; cx.lineWidth = h * 0.05; cx.strokeRect(h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14);
    cx.fillStyle = o.ink; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    const maxW = w - h * 0.5;
    const n = lines.length;
    lines.forEach((line, k) => {
      let size = (h * 0.52) / Math.max(1, n * 0.8);
      const font = (px: number) => `italic ${px}px "IM Fell English", Georgia, serif`;
      cx.font = font(size);
      while (cx.measureText(line).width > maxW && size > 10) { size -= 2; cx.font = font(size); }
      cx.fillText(line, w / 2, h * (0.5 + (k - (n - 1) / 2) * (0.62 / Math.max(1, n))) + size * 0.04);
    });
    tex.needsUpdate = true;
  };
  draw();
  try { document.fonts?.load('italic 64px "IM Fell English"').then(draw, () => {}); document.fonts?.ready.then(draw, () => {}); } catch { /* no font loading API */ }
  return tex;
}

function holedSquare(half: number, holeR: number): THREE.ShapeGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-half, -half), new THREE.Vector2(half, -half), new THREE.Vector2(half, half), new THREE.Vector2(-half, half)]);
  if (holeR > 0) { const hole = new THREE.Path(); hole.absarc(WELL.x, -WELL.z, holeR, 0, Math.PI * 2, true); s.holes.push(hole); }
  return new THREE.ShapeGeometry(s, 48);
}

// Draw the plan of one floor: the central hall with the stair, then wings grown outward from it.
// The same floor always has the same plan.
function makePlan(d: number): Plan {
  const N = d === 0 ? 10 : 2 * Math.round((34 + 3 * d) / 2); // even, so the hall sits on whole cells
  const half = (N * C) / 2;
  const walk = new Uint8Array(N * N), ceil = new Float32Array(N * N), room = new Int16Array(N * N).fill(-1);
  const rooms: Room[] = [];
  const idx = (ix: number, iz: number) => iz * N + ix;
  const inside = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < N && iz < N;
  const carve = (r: Room) => {
    for (let iz = r.iz0; iz < r.iz1; iz++) for (let ix = r.ix0; ix < r.ix1; ix++) {
      const k = idx(ix, iz);
      if (walk[k]) continue;
      walk[k] = 1; ceil[k] = r.ceil; room[k] = r.id;
    }
  };
  const hall: Room = { id: 0, kind: 'hall', ix0: N / 2 - 5, iz0: N / 2 - 5, ix1: N / 2 + 5, iz1: N / 2 + 5, ceil: H };
  rooms.push(hall); carve(hall);
  if (d > 0) {
    const rng = mulberry32(7700 + d * 131);
    const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
    const target = 40 + d * 9;
    for (let attempt = 0; attempt < 6000 && rooms.length < target; attempt++) {
      // pick a wall cell of what exists and push outward from it
      const ix = ri(1, N - 2), iz = ri(1, N - 2);
      if (!walk[idx(ix, iz)]) continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => inside(ix + dx, iz + dz) && !walk[idx(ix + dx, iz + dz)]);
      if (!dirs.length) continue;
      const [dx, dz] = dirs[Math.floor(rng() * dirs.length)];
      const px = -dz, pz = dx; // perpendicular
      const roll = rng();
      const kind: RoomKind = roll < 0.24 ? 'nook' : roll < 0.4 ? 'gallery' : 'room';
      const L = kind === 'nook' ? ri(0, 1) : ri(1, 4 + Math.floor(d / 2));
      const cw = rng() < 0.6 ? 1 : 2;
      // the room at the far end of the corridor
      let along: number, across: number;
      if (kind === 'nook') { along = ri(1, 2); across = ri(1, 2); }
      else if (kind === 'gallery') { along = ri(2, 3); across = ri(6, 11); if (rng() < 0.5) [along, across] = [across, along]; }
      else { along = ri(3, 6 + Math.floor(d / 2)); across = ri(3, 6 + Math.floor(d / 2)); }
      const cells: [number, number][] = [];
      for (let k = 1; k <= L; k++) for (let w = 0; w < cw; w++) cells.push([ix + dx * k + px * w, iz + dz * k + pz * w]);
      const off = ri(-(across - 1), 0);
      const roomCells: [number, number][] = [];
      for (let a = 1; a <= along; a++) for (let b = 0; b < across; b++) roomCells.push([ix + dx * (L + a) + px * (off + b), iz + dz * (L + a) + pz * (off + b)]);
      const all = [...cells, ...roomCells];
      if (all.some(([x, z]) => x < 1 || z < 1 || x > N - 2 || z > N - 2)) continue;
      const overlap = roomCells.filter(([x, z]) => walk[idx(x, z)]).length;
      if (overlap > 0 && !(rng() < 0.12 && overlap < roomCells.length / 3)) continue; // now and then two wings meet, making a loop
      if (cells.some(([x, z]) => walk[idx(x, z)])) continue;
      const box = (list: [number, number][]) => ({ ix0: Math.min(...list.map(c => c[0])), iz0: Math.min(...list.map(c => c[1])), ix1: Math.max(...list.map(c => c[0])) + 1, iz1: Math.max(...list.map(c => c[1])) + 1 });
      if (cells.length) {
        const cor: Room = { id: rooms.length, kind: 'corridor', ...box(cells), ceil: 2.7 + rng() * 0.9 };
        rooms.push(cor); carve(cor);
      }
      const ceilH = kind === 'nook' ? 2.45 + rng() * 0.3 : kind === 'gallery' ? H : 3.2 + rng() * 3.8;
      const rm: Room = { id: rooms.length, kind, ...box(roomCells), ceil: ceilH };
      rooms.push(rm); carve(rm);
    }
  }
  // every place a walkable cell meets solid wall is a wall edge; most get a bookcase
  const edges: Edge[] = [];
  const erng = mulberry32(99 + d * 17);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const k = idx(ix, iz);
    if (!walk[k]) continue;
    const solid = (dx: number, dz: number) => !inside(ix + dx, iz + dz) || !walk[idx(ix + dx, iz + dz)];
    let shelvedAxis = -1; // a one-cell passage only ever gets bookcases on one side, so it stays passable
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!solid(dx, dz)) continue;
      const cx = (ix - N / 2) * C + C / 2, cz = (iz - N / 2) * C + C / 2;
      const rm = rooms[room[k]];
      let shelf = erng() < (rm.kind === 'nook' ? 1 : rm.kind === 'corridor' ? 0.35 : 0.72);
      const axis = dx !== 0 ? 0 : 1;
      if (rm.kind !== 'nook' && solid(-dx, -dz)) { if (shelf && shelvedAxis === axis) shelf = false; if (shelf) shelvedAxis = axis; }
      edges.push({ x: cx + dx * C / 2, z: cz + dz * C / 2, nx: -dx, nz: -dz, ceil: ceil[k], room: room[k], kind: rm.kind, shelf });
    }
  }
  return { N, half, walk, ceil, room, rooms, edges };
}

// One floor of the library.
interface Floor {
  d: number;
  y0: number;
  plan: Plan;
  group: THREE.Group;
  faces: Face[];
  slots: Slot[];
  colliders: Box[];
  stands: THREE.Vector3[];
  books: Book[];
  bookMesh: THREE.InstancedMesh;
  bandMesh: THREE.InstancedMesh;
  glows: THREE.Sprite[];
  flames: THREE.Sprite[];
  taken: Record<number, boolean>;
  laid: string; // which run and round the books were laid out for
}

export class Library implements View {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, 1, 0.05, 80);
  bloom = { strength: 0.75, radius: 0.6, threshold: 0.78 };
  exposure = 1.15;
  vignette = 1.0;
  floors: Floor[] = [];
  deskCollider: Box = { x0: -1.7, x1: 1.7, z0: 7.6, z1: 9.2 };
  highlight: THREE.Mesh;
  yaw = 0; pitch = 0; pos = new THREE.Vector3(0, EYE, 6.6); // pos is the eye
  vy = 0;
  grounded = true;
  level = 0; // the floor you are on (or falling past)
  onLand?: (speed: number) => void;
  onLevel?: (d: number) => void;
  keys: Record<string, boolean> = {};
  joy = { x: 0, y: 0 };
  titleSpin = true;
  candleLights: THREE.PointLight[] = [];
  doorLight: THREE.PointLight;
  arenaLight: THREE.PointLight;
  deskLight: THREE.PointLight;
  wellLight = new THREE.PointLight('#ffffff', 0, 12, 1.4);
  lantern = new THREE.PointLight('#ffd8a0', 0, 9, 1.5);
  hemi: THREE.HemisphereLight;
  motes: Particles;
  embers: Particles;
  door: THREE.Mesh;
  doorGlow: THREE.Sprite;
  desk: THREE.Group;
  deskPick: THREE.Mesh;
  arena: THREE.Mesh;
  arenaMat: THREE.ShaderMaterial;
  arenaGlow: THREE.Sprite;
  arenaRunes: THREE.MeshBasicMaterial;
  hover: Pick = null;
  raycaster = new THREE.Raycaster();
  private env = { fog: new THREE.Color('#0d0a14'), sky: new THREE.Color('#7a70a0'), ground: new THREE.Color('#2a1a10'), hemi: 0.55, near: 7, far: 26, lantern: 0, exposure: 1.15, vignette: 1 };
  private layoutArgs = { runId: 0, round: 0, taken: {} as Record<number, boolean> };
  private floaters: { mesh: THREE.InstancedMesh; base: { p: THREE.Vector3; r: THREE.Euler; ph: number }[] } | null = null;
  private eyes: THREE.Group[] = [];
  private kelp: THREE.Mesh[] = [];
  private gears: THREE.Mesh[] = [];
  private clockHands: THREE.Mesh[] = [];
  private water: THREE.ShaderMaterial | null = null;
  private bobT = 0;
  private landDip = 0;
  private lightT = 0;
  private spineTex: THREE.Texture;

  constructor() {
    const S = this.scene;
    S.background = new THREE.Color('#0d0a14');
    S.fog = new THREE.Fog('#0d0a14', 7, 26);
    this.hemi = new THREE.HemisphereLight('#7a70a0', '#2a1a10', 0.55); S.add(this.hemi);
    const moon = new THREE.DirectionalLight('#8aa0ff', 0.35); moon.position.set(-4, 10, 3); S.add(moon);
    S.add(this.lantern, this.wellLight);
    // a fixed pool of candle lights that follows you to the nearest candles, so the light count never changes
    for (const [x, z] of HALL_CANDLES) { const L = new THREE.PointLight('#ffa860', 14, 12, 1.7); L.position.set(x, 2.1, z); S.add(L); this.candleLights.push(L); }

    // ---- shared materials and textures
    const fs = flagstones(3, [58, 48, 52], 1024, 6);
    for (const t of [fs.map, fs.normal, fs.rough]) t.repeat.set(0.2, 0.2);
    const pl = plasterTex(5, [70, 58, 70]); pl.repeat.set(4, 1.5);
    const plSeg = pl.clone(); plSeg.repeat.set(0.4, 1.5); plSeg.needsUpdate = true;
    const woodMap = woodTex(4, [96, 64, 44], 256, 512, 1);
    this.spineTex = leatherTex([255, 255, 255]);
    const iron = new THREE.MeshStandardMaterial({ color: '#2c2420', metalness: 0.6, roughness: 0.5 });
    const stone = new THREE.MeshStandardMaterial({ color: '#4a4452', roughness: 0.95, flatShading: true });
    const brass = new THREE.MeshStandardMaterial({ color: '#8a6a30', metalness: 0.8, roughness: 0.35 });
    const shaftTex = plasterTex(9, [58, 52, 64]); shaftTex.repeat.set(3, 0.5);
    const doorW = 3, doorH = 4.2;
    const sideParts: [number, number, number, number][] = [[-(R + doorW / 2) / 2, H / 2, R - doorW / 2, H], [(R + doorW / 2) / 2, H / 2, R - doorW / 2, H], [0, doorH + (H - doorH) / 2, doorW, H - doorH]];

    for (let d = 0; d < LEVELS.length; d++) {
      const L = LEVELS[d];
      const plan = makePlan(d);
      const g = new THREE.Group(); g.position.y = -d * LH; S.add(g);
      const floorMat = new THREE.MeshStandardMaterial({ map: fs.map, normalMap: fs.normal, roughnessMap: fs.rough, color: L.floor });
      const wallMat = new THREE.MeshStandardMaterial({ map: pl, roughness: 0.95, color: L.wall });
      const segMat = new THREE.MeshStandardMaterial({ map: plSeg, roughness: 0.95, color: L.wall, side: THREE.DoubleSide });
      const woodMat = new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.8, color: L.wood });
      const ceilMat = new THREE.MeshStandardMaterial({ color: L.ceil, roughness: 1, side: THREE.DoubleSide });
      const floor = new THREE.Mesh(holedSquare(plan.half, d < DEEPEST ? WELL_R : 0), floorMat); floor.rotation.x = -Math.PI / 2; g.add(floor);
      const faces: Omit<Face, 'tan' | 'nrm' | 'rot'>[] = [];
      const colliders: Box[] = [];
      const stands: THREE.Vector3[] = [];
      const addFace = (c: THREE.Vector3, ry: number, rows: number, width: number, wall: boolean, unit: string, room: number, nook: boolean) => {
        faces.push({ c, ry, rows, width, wall, unit, room, nook, far: Math.min(1, Math.hypot(c.x - WELL.x, c.z - WELL.z) / Math.max(20, plan.half)) });
      };

      if (d === 0) {
        // the Reading Room: one hall, with doorways east and west
        const ceil = new THREE.Mesh(holedSquare(R, 0), ceilMat); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; g.add(ceil);
        for (const [x, z, ry] of [[0, -R, 0], [0, R, Math.PI]] as const) { const w = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, H), wallMat); w.position.set(x, H / 2, z); w.rotation.y = ry; g.add(w); }
        for (const [x, ry, sign] of [[R, -Math.PI / 2, 1], [-R, Math.PI / 2, -1]] as const) for (const [z, y, w, h] of sideParts) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(x, y, z * sign); m.rotation.y = ry; g.add(m); }
        [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].forEach((x, i) => {
          addFace(new THREE.Vector3(x, 0, -R + 0.35), 0, 5, 3, true, 'n' + i, 0, false);
          addFace(new THREE.Vector3(-x, 0, R - 0.35), Math.PI, 5, 3, true, 's' + i, 0, false);
          if (Math.abs(x) > 2) addFace(new THREE.Vector3(R - 0.35, 0, x), -Math.PI / 2, 5, 3, true, 'e' + i, 0, false);
          if (Math.abs(x) > 2) addFace(new THREE.Vector3(-R + 0.35, 0, -x), Math.PI / 2, 5, 3, true, 'w' + i, 0, false);
        });
      } else {
        // a generated floor: ceilings cell by cell (each wing has its own height), walls where the plan ends,
        // and short walls where a low ceiling meets a higher one
        const N = plan.N;
        const cellX = (ix: number) => (ix - N / 2) * C + C / 2;
        const cellCount = plan.walk.reduce((a, b) => a + b, 0);
        const ceilMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(C, C).rotateX(Math.PI / 2), ceilMat, cellCount);
        const m4 = new THREE.Matrix4();
        let n = 0;
        for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
          const k = iz * N + ix; if (!plan.walk[k]) continue;
          const x = cellX(ix), z = cellX(iz);
          if (Math.hypot(x - WELL.x, z - WELL.z) < WELL_R + 1.1) { m4.makeScale(0.0001, 0.0001, 0.0001); ceilMesh.setMatrixAt(n++, m4); continue; }
          m4.makeTranslation(x, plan.ceil[k], z); ceilMesh.setMatrixAt(n++, m4);
        }
        g.add(ceilMesh);
        // the hall's ceiling has a round hole for the stair
        const ring = new THREE.Mesh(new THREE.RingGeometry(WELL_R, WELL_R + 2.9, 48).rotateX(Math.PI / 2), ceilMat); ring.position.set(WELL.x, H - 0.012, WELL.z); g.add(ring);
        const walls = new THREE.InstancedMesh(new THREE.PlaneGeometry(C, 1).translate(0, 0.5, 0), segMat, plan.edges.length);
        const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
        plan.edges.forEach((e, i) => {
          q.setFromAxisAngle(up, Math.atan2(e.nx, e.nz));
          m4.compose(new THREE.Vector3(e.x, 0, e.z), q, new THREE.Vector3(1, H, 1));
          walls.setMatrixAt(i, m4);
        });
        g.add(walls);
        const soffits: { x: number; z: number; ry: number; lo: number; hi: number }[] = [];
        for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
          const k = iz * N + ix; if (!plan.walk[k]) continue;
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            const j = (iz + dz) * N + ix + dx; if (ix + dx >= N || iz + dz >= N || !plan.walk[j]) continue;
            const a = plan.ceil[k], b = plan.ceil[j]; if (Math.abs(a - b) < 0.05) continue;
            const lowIsK = a < b;
            soffits.push({ x: cellX(ix) + dx * C / 2, z: cellX(iz) + dz * C / 2, ry: Math.atan2(lowIsK ? -dx : dx, lowIsK ? -dz : dz), lo: Math.min(a, b), hi: Math.max(a, b) });
          }
        }
        const sof = new THREE.InstancedMesh(new THREE.PlaneGeometry(C, 1).translate(0, 0.5, 0), segMat, Math.max(1, soffits.length));
        soffits.forEach((s, i) => { q.setFromAxisAngle(up, s.ry); m4.compose(new THREE.Vector3(s.x, s.lo, s.z), q, new THREE.Vector3(1, s.hi - s.lo, 1)); sof.setMatrixAt(i, m4); });
        sof.count = soffits.length; g.add(sof);
        // bookcases along the walls: 1.6 wide, as tall as the ceiling allows
        plan.edges.forEach((e, i) => {
          if (!e.shelf || e.ceil < 2.4) return;
          const rows = Math.max(1, Math.min(5, Math.floor((e.ceil - 0.45) / 0.8)));
          const c = new THREE.Vector3(e.x + e.nx * 0.35, 0, e.z + e.nz * 0.35);
          addFace(c, Math.atan2(e.nx, e.nz), rows, 1.6, true, 'w' + i, e.room, e.kind === 'nook');
          // the case itself stands in the way
          const tx = Math.abs(e.nz) * 0.85, tz = Math.abs(e.nx) * 0.85;
          const ox = e.x + e.nx * 0.31, oz = e.z + e.nz * 0.31;
          colliders.push({ x0: ox - tx - Math.abs(e.nx) * 0.31, x1: ox + tx + Math.abs(e.nx) * 0.31, z0: oz - tz - Math.abs(e.nz) * 0.31, z1: oz + tz + Math.abs(e.nz) * 0.31 });
        });
        // free-standing cases in the bigger rooms, and a candle stand in most rooms
        const frng = mulberry32(555 + d * 71);
        plan.rooms.forEach(rm => {
          if (rm.kind === 'hall' || rm.kind === 'corridor') return;
          const x0 = (rm.ix0 - N / 2) * C, x1 = (rm.ix1 - N / 2) * C, z0 = (rm.iz0 - N / 2) * C, z1 = (rm.iz1 - N / 2) * C;
          if (rm.kind === 'nook') {
            // a single candle on the floor at the back of the alcove
            const f = glowSprite(L.flame, 0.3); f.position.set((x0 + x1) / 2, 0.25, (z0 + z1) / 2); g.add(f);
            return;
          }
          const w = x1 - x0, dd = z1 - z0;
          if (w >= 6 && dd >= 6 && frng() < 0.6) {
            const rows = Math.max(1, Math.min(4, Math.floor((rm.ceil - 0.45) / 0.8)));
            const alongX = w >= dd;
            const [a0, a1, b0, b1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
            for (let b = b0 + 2.3; b <= b1 - 2.3; b += 3) for (let a = a0 + 2.1; a + 1.6 <= a1 - 2.1 + 0.01; a += 1.9) {
              if (frng() < 0.12) continue; // a gap, now and then
              const cx = alongX ? a + 0.8 : b, cz = alongX ? b : a + 0.8;
              const ry = alongX ? 0 : Math.PI / 2;
              const off = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.33);
              addFace(new THREE.Vector3(cx, 0, cz).add(off), ry, rows, 1.6, false, `f${rm.id}:${a.toFixed(1)}:${b.toFixed(1)}`, rm.id, false);
              addFace(new THREE.Vector3(cx, 0, cz).sub(off), ry + Math.PI, rows, 1.6, false, `f${rm.id}:${a.toFixed(1)}:${b.toFixed(1)}`, rm.id, false);
              colliders.push(alongX ? { x0: cx - 0.85, x1: cx + 0.85, z0: cz - 0.5, z1: cz + 0.5 } : { x0: cx - 0.5, x1: cx + 0.5, z0: cz - 0.85, z1: cz + 0.85 });
            }
          }
          if (w * dd >= 16 && frng() < 0.85) {
            const sx = x0 + 1.15 + (frng() < 0.5 ? 0 : w - 2.3), sz = z0 + 1.15 + (frng() < 0.5 ? 0 : dd - 2.3);
            stands.push(new THREE.Vector3(sx, 0, sz));
            colliders.push({ x0: sx - 0.25, x1: sx + 0.25, z0: sz - 0.25, z1: sz + 0.25 });
          }
        });
      }
      // the hall is the same on every floor: two rows of free-standing cases and six candle stands
      HALL_ROWS.forEach(([x, z], i) => {
        addFace(new THREE.Vector3(x, 0, z + 0.33), 0, 4, 3, false, 'h' + i, 0, false);
        addFace(new THREE.Vector3(x, 0, z - 0.33), Math.PI, 4, 3, false, 'h' + i, 0, false);
        colliders.push({ x0: x - 1.5, x1: x + 1.5, z0: z - 0.5, z1: z + 0.5 });
      });
      HALL_CANDLES.forEach(([x, z], i) => { stands.push(new THREE.Vector3(x, 0, z)); if (i < 5) colliders.push({ x0: x - 0.25, x1: x + 0.25, z0: z - 0.25, z1: z + 0.25 }); });

      // shelves: planks, sides, tops and backs, all in one instanced mesh
      const woodParts: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
      const done: Record<string, boolean> = {};
      const fullFaces: Face[] = faces.map(f => {
        const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.ry);
        const tan = new THREE.Vector3(1, 0, 0).applyQuaternion(rot), nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
        const topY = f.rows * 0.8 + 0.2, W = f.width;
        for (let r = 0; r <= f.rows; r++) woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, 0.1 + r * 0.8, 0)).addScaledVector(nrm, 0.18), q: rot, s: new THREE.Vector3(W, 0.06, 0.38) });
        for (const sx2 of [-W / 2, W / 2]) woodParts.push({ p: f.c.clone().addScaledVector(tan, sx2).add(new THREE.Vector3(0, topY / 2, 0)).addScaledVector(nrm, 0.18), q: rot, s: new THREE.Vector3(0.1, topY, 0.42) });
        woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, topY + 0.08, 0)).addScaledVector(nrm, 0.2), q: rot, s: new THREE.Vector3(W + 0.2, 0.16, 0.48) });
        if (!done[f.unit]) { done[f.unit] = true; woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, topY / 2, 0)).addScaledVector(nrm, f.wall ? -0.02 : -0.33), q: rot, s: new THREE.Vector3(W, topY, 0.04) }); }
        return { ...f, tan, nrm, rot };
      });
      const woodMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), woodMat, Math.max(1, woodParts.length));
      { const m4 = new THREE.Matrix4(); woodParts.forEach((w, i) => { m4.compose(w.p, w.q, w.s); woodMesh.setMatrixAt(i, m4); }); }
      g.add(woodMesh);
      const srng = mulberry32(99 + d * 1009);
      const slots: Slot[] = [];
      fullFaces.forEach((f, fi) => {
        const lim = f.width / 2 - 0.08;
        for (let r = 0; r < f.rows; r++) {
          let x = -lim;
          for (;;) {
            const w = 0.05 + srng() * 0.08;
            if (x + w > lim) break;
            const h = 0.36 + srng() * 0.3;
            slots.push({ face: fi, row: r, x: x + w / 2, w, h, lean: srng() < 0.04 ? (srng() - 0.5) * 0.3 : 0 });
            x += w + 0.004 + (srng() < 0.03 ? 0.08 : 0);
          }
        }
      });
      const bookMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.spineTex, roughness: 0.75, emissive: new THREE.Color(d === DEEPEST ? '#1c1c20' : '#000000') }), Math.max(1, slots.length));
      bookMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bookMesh.count = 0; // filled in when the floor is first laid out
      S.add(bookMesh);
      const bandMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#8a8a92', metalness: 0.9, roughness: 0.35 }), 400);
      bandMesh.count = 0; S.add(bandMesh);
      // candle stands
      const wax = new THREE.MeshStandardMaterial({ color: '#eae0c2', emissive: new THREE.Color('#332a18'), roughness: 0.6 });
      const flames: THREE.Sprite[] = [];
      for (const s of stands) {
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 1.3, 8), iron); stand.position.set(s.x, 0.65, s.z); g.add(stand);
        for (const dx of [-0.12, 0, 0.12]) {
          const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22 + Math.abs(dx), 8), wax); candle.position.set(s.x + dx, 1.42 + Math.abs(dx) / 2, s.z); g.add(candle);
          const flame = glowSprite(L.flame, 0.4); flame.position.set(s.x + dx, 1.62 + Math.abs(dx), s.z); g.add(flame); flames.push(flame);
        }
      }
      // beams across the hall
      for (let i = -3; i <= 3; i++) { if (d > 0 && i === -2) continue; const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * R, 0.4, 0.35), woodMat); beam.position.set(0, H - 0.2, i * 3); g.add(beam); }
      // the stairwell as it passes this floor: a stone rim, a brass rail open on the landing side, the shaft through the slab
      if (d < DEEPEST) {
        const wg = new THREE.Group(); wg.position.set(WELL.x, 0, WELL.z); g.add(wg);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(WELL_R + 0.02, 0.1, 8, 56), stone); rim.rotation.x = Math.PI / 2; rim.position.y = 0.03; wg.add(rim);
        const gap = 0.55;
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2;
          if (Math.abs(Math.atan2(Math.sin(a - A0), Math.cos(a - A0))) < gap) continue;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.8, 6), brass); post.position.set(Math.cos(a) * (WELL_R + 0.05), 0.4, Math.sin(a) * (WELL_R + 0.05)); wg.add(post);
        }
        const railG = new THREE.Group(); railG.rotation.y = gap - A0; railG.position.y = 0.8; wg.add(railG);
        const rail = new THREE.Mesh(new THREE.TorusGeometry(WELL_R + 0.05, 0.03, 6, 56, Math.PI * 2 - gap * 2), brass); rail.rotation.x = -Math.PI / 2; railG.add(rail);
        const slab = new THREE.Mesh(new THREE.CylinderGeometry(WELL_R, WELL_R, LH - H, 40, 1, true), new THREE.MeshStandardMaterial({ map: shaftTex, color: L.wall, roughness: 1, side: THREE.BackSide }));
        slab.position.y = -(LH - H) / 2; wg.add(slab);
        const glow = glowSprite(LEVELS[d + 1].flame, 4, 0.25); glow.position.y = -LH * 0.6; wg.add(glow);
      }
      this.floors.push({ d, y0: -d * LH, plan, group: g, faces: fullFaces, slots, colliders, stands, books: [], bookMesh, bandMesh, glows: [], flames, taken: {}, laid: '' });
    }

    // ---- the stair: one long helix of steps from the Reading Room to the bottom
    {
      const perTurn = 24;
      const total = Math.round((DEEPEST * LH / PITCH) * perTurn);
      const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(STAIR_OUT - STAIR_IN, 0.14, 0.52), new THREE.MeshStandardMaterial({ color: '#5a5460', roughness: 0.9, flatShading: true }), total + 1);
      const lip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.3, 0.52), brass, total + 1);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), rmid = (STAIR_IN + STAIR_OUT) / 2;
      for (let k = 0; k <= total; k++) {
        const phi = (k / perTurn) * Math.PI * 2, a = A0 + phi, y = -(phi / (Math.PI * 2)) * PITCH;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        m4.compose(new THREE.Vector3(WELL.x + Math.cos(a) * rmid, y - 0.07, WELL.z + Math.sin(a) * rmid), q, new THREE.Vector3(1, 1, 1)); steps.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(WELL.x + Math.cos(a) * STAIR_IN, y + 0.1, WELL.z + Math.sin(a) * STAIR_IN), q, new THREE.Vector3(1, 1, 1)); lip.setMatrixAt(k, m4);
      }
      S.add(steps, lip);
    }

    // ---- the Reading Room's own things: doorways, rugs, the desk
    const L0 = this.floors[0].group;
    const wood0 = new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.8 });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9.4), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, 2.3); L0.add(rug);
    for (const x of [5.9, -5.9]) { const r2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7.4), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 })); r2.rotation.set(-Math.PI / 2, 0, Math.PI / 2); r2.position.set(x, 0.013, 0); L0.add(r2); }
    for (const z of [-doorW / 2 - 0.15, doorW / 2 + 0.15]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, doorH, 0.3), wood0); post.position.set(R - 0.1, doorH / 2, z); L0.add(post); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, doorW + 0.7), wood0); lintel.position.set(R - 0.1, doorH + 0.2, 0); L0.add(lintel);
    this.door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), new THREE.MeshBasicMaterial({ color: '#ffb060', transparent: true, opacity: 0.85 }));
    this.door.position.set(R + 0.6, doorH / 2, 0); this.door.rotation.y = -Math.PI / 2; L0.add(this.door);
    this.doorGlow = glowSprite('#ffa050', 7, 0.55); this.doorGlow.position.set(R - 0.2, 2.2, 0); L0.add(this.doorGlow);
    this.doorLight = new THREE.PointLight('#ffa860', 30, 12, 1.6); this.doorLight.position.set(R - 1.2, 2.6, 0); S.add(this.doorLight);
    const signTex = signTexture(['Curios & Oddments'], { bg: '#2a1a12', border: '#c9a13b', ink: '#f1d98a' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: signTex, emissive: new THREE.Color('#ffd080'), emissiveIntensity: 0.25, emissiveMap: signTex }));
    sign.position.set(R - 0.45, doorH + 0.9, 0); sign.rotation.y = -Math.PI / 2; L0.add(sign);
    for (const z of [-doorW / 2 - 0.25, doorW / 2 + 0.25]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, doorH, 0.5), stone); pillar.position.set(-R + 0.1, doorH / 2, z); L0.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.25, 0.65), stone); cap.position.set(-R + 0.1, 0.12, z); L0.add(cap);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(doorW / 2 + 0.25, 0.28, 6, 18, Math.PI), stone);
    arch.rotation.y = Math.PI / 2; arch.position.set(-R + 0.1, doorH, 0); L0.add(arch);
    this.arenaRunes = new THREE.MeshBasicMaterial({ color: '#7fe0d0', transparent: true, opacity: 0.8 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      const rune = new THREE.Mesh(new THREE.CircleGeometry(0.09, 3 + (i % 3)), this.arenaRunes);
      rune.position.set(-R + 0.42, doorH + Math.sin(a) * (doorW / 2 + 0.25), Math.cos(a) * (doorW / 2 + 0.25)); rune.rotation.y = Math.PI / 2; L0.add(rune);
    }
    for (const z of [-doorW / 2 - 0.25, doorW / 2 + 0.25]) for (let k = 0; k < 4; k++) {
      const rune = new THREE.Mesh(new THREE.CircleGeometry(0.08, 3 + k), this.arenaRunes);
      rune.position.set(-R + 0.42, 0.8 + k * 0.9, z); rune.rotation.y = Math.PI / 2; L0.add(rune);
    }
    // the Ring itself, a swirl of verdigris and violet light filling the arch
    this.arenaMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 c = (vUv - vec2(0.5, 0.42)) * vec2(1.0, 1.35);
          float r = length(c), a = atan(c.y, c.x);
          float sw = sin(a * 5.0 + r * 18.0 - uTime * 2.2) * 0.5 + 0.5;
          float sw2 = sin(a * 3.0 - r * 11.0 + uTime * 1.3) * 0.5 + 0.5;
          vec3 teal = vec3(0.3, 0.88, 0.8), violet = vec3(0.55, 0.3, 0.95), core = vec3(0.95, 0.98, 1.0);
          vec3 col = mix(violet, teal, sw) * (0.35 + 0.65 * sw2);
          col = mix(col, core, smoothstep(0.2, 0.0, r) * 0.6);
          float edge = smoothstep(0.62, 0.35, r);
          gl_FragColor = vec4(col * (0.3 + 0.45 * edge), 0.3 + 0.7 * edge);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.arena = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH + 1.0), this.arenaMat);
    this.arena.position.set(-R - 0.3, (doorH + 1.0) / 2, 0); this.arena.rotation.y = Math.PI / 2; L0.add(this.arena);
    this.arenaGlow = glowSprite('#7fe0d0', 6, 0.3); this.arenaGlow.position.set(-R + 0.3, 2.2, 0); L0.add(this.arenaGlow);
    this.arenaLight = new THREE.PointLight('#8ac8ff', 26, 12, 1.6); this.arenaLight.position.set(-R + 1.3, 2.6, 0); S.add(this.arenaLight);
    {
      const t = signTexture(['The Duelling Ring'], { bg: '#1c1826', border: '#7fe0d0', ink: '#d8fff6' });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color('#9fe3d6'), emissiveIntensity: 0.35, emissiveMap: t }));
      plate.position.set(-R + 0.45, doorH + 1.35, 0); plate.rotation.y = Math.PI / 2; L0.add(plate);
    }
    this.desk = new THREE.Group(); this.desk.position.set(0, 0, 8.4); L0.add(this.desk);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 1.3), wood0); top.position.y = 0.95; this.desk.add(top);
    for (const [dx, dz] of [[-1.35, -0.5], [1.35, -0.5], [-1.35, 0.5], [1.35, 0.5]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), wood0); leg.position.set(dx, 0.47, dz); this.desk.add(leg); }
    const tome = new THREE.Group(); tome.position.set(0, 1.03, -0.05); this.desk.add(tome);
    for (const s of [-1, 1]) {
      const pg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.85), new THREE.MeshStandardMaterial({ map: parchmentTex(), color: '#cfc3a4', roughness: 0.9, emissive: new THREE.Color('#ffd898'), emissiveIntensity: 0.06 }));
      pg.position.x = s * 0.32; pg.rotation.z = s * -0.06; tome.add(pg);
    }
    this.deskLight = new THREE.PointLight('#ffd090', 2.5, 4, 1.8); this.deskLight.position.set(0, 1.6, 8.3); S.add(this.deskLight);
    const quill = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#a8a090', roughness: 0.8 })); quill.position.set(0.9, 1.3, 0); quill.rotation.z = -0.5; this.desk.add(quill);
    const inkwell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 12), new THREE.MeshStandardMaterial({ color: '#141018', roughness: 0.1, metalness: 0.3 })); inkwell.position.set(0.9, 1.08, 0.1); this.desk.add(inkwell);
    this.deskPick = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 1.5), new THREE.MeshBasicMaterial({ visible: false })); this.deskPick.position.y = 0.8; this.desk.add(this.deskPick);
    const deskGlow = glowSprite('#ffe0a0', 1.6, 0.1); deskGlow.position.set(0, 1.25, 0); this.desk.add(deskGlow);

    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#9fe3d6', wireframe: true, transparent: true, opacity: 0.9 }));
    this.highlight.visible = false; S.add(this.highlight);
    this.buildDecor();

    this.motes = new Particles(900, glowTex(), true);
    this.embers = new Particles(400, glowTex(), true);
    S.add(this.motes.points, this.embers.points);
    const rng = mulberry32(7);
    for (let i = 0; i < 300; i++) this.motes.emit({ x: (rng() - 0.5) * 18, y: rng() * 5, z: (rng() - 0.5) * 18, color: '#ffe2b0', size: 0.05 + rng() * 0.05, life: 3 + rng() * 6, drag: 0, jitter: 0.25, alpha: 0.7 });
    this.layoutAll(0, 0);
    this.applyLevel(0, true);
    this.onResize(window.innerWidth, window.innerHeight);
  }

  // ---------------------------------------------------------------- what lives on each floor
  // Spots on a floor where something can sit on the floor: room middles, away from the stair.
  private spots(d: number, rng: () => number, n: number): [number, number][] {
    const F = this.floors[d], P = F.plan, out: [number, number][] = [];
    const rooms = P.rooms.filter(r => r.kind !== 'corridor');
    for (let k = 0; k < n * 4 && out.length < n; k++) {
      const rm = rooms[Math.floor(rng() * rooms.length)];
      const x = ((rm.ix0 + rng() * (rm.ix1 - rm.ix0)) - P.N / 2) * C, z = ((rm.iz0 + rng() * (rm.iz1 - rm.iz0)) - P.N / 2) * C;
      if (Math.hypot(x - WELL.x, z - WELL.z) < WELL_R + 1.2) continue;
      if (F.colliders.some(b => x > b.x0 - 0.4 && x < b.x1 + 0.4 && z > b.z0 - 0.4 && z < b.z1 + 0.4)) continue;
      out.push([x, z]);
    }
    return out;
  }

  // Wall edges without a bookcase, high enough to hang something on.
  private bareWalls(d: number, minCeil: number): Edge[] { return this.floors[d].plan.edges.filter(e => !e.shelf && e.ceil >= minCeil); }

  private buildDecor() {
    const rng = mulberry32(4242);
    const r = (a: number, b: number) => a + rng() * (b - a);
    const G = (d: number) => this.floors[d].group;
    // 1: dust, fallen books and cobwebs
    {
      const g = G(1);
      const spots = this.spots(1, rng, 26);
      const piles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: leatherTex([255, 255, 255]), roughness: 0.9 }), 260);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      let n = 0;
      for (const [x, z] of spots) {
        let y = 0;
        const k = 4 + Math.floor(rng() * 6);
        for (let j = 0; j < k && n < 260; j++, n++) {
          const w = r(0.35, 0.6), h = r(0.06, 0.12), dd = r(0.25, 0.45);
          q.setFromEuler(new THREE.Euler(r(-0.05, 0.05), r(0, Math.PI), r(-0.05, 0.05)));
          m4.compose(new THREE.Vector3(x + r(-0.1, 0.1), y + h / 2, z + r(-0.1, 0.1)), q, new THREE.Vector3(w, h, dd));
          piles.setMatrixAt(n, m4); piles.setColorAt(n, col.setHSL(r(0.02, 0.1), r(0.2, 0.4), r(0.12, 0.3)));
          y += h;
        }
      }
      piles.count = n; g.add(piles);
      const web = new THREE.MeshBasicMaterial({ color: '#d8d0c0', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
      const edges = this.floors[1].plan.edges;
      for (let k = 0; k < 60; k++) {
        const e = edges[Math.floor(rng() * edges.length)];
        const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(r(0.6, 1.3), 0), new THREE.Vector2(0, -r(0.6, 1.3))]);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), web);
        m.position.set(e.x + e.nx * 0.05, e.ceil - 0.02, e.z + e.nz * 0.05); m.rotation.y = Math.atan2(e.nx, e.nz);
        g.add(m);
      }
    }
    // 2: bones
    {
      const g = G(2);
      const bone = new THREE.MeshStandardMaterial({ color: '#d8d0b8', roughness: 0.7 });
      const dark = new THREE.MeshBasicMaterial({ color: '#050505' });
      const skull = (x: number, y: number, z: number, ry: number, sc = 1) => {
        const k = new THREE.Group(); k.position.set(x, y, z); k.rotation.y = ry; k.scale.setScalar(sc);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), bone); head.scale.set(1, 0.95, 1.1); head.position.y = 0.16; k.add(head);
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.14), bone); jaw.position.set(0, 0.04, 0.06); k.add(jaw);
        for (const sx of [-0.06, 0.06]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), dark); e.position.set(sx, 0.18, 0.14); k.add(e); }
        g.add(k);
      };
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6), bone, 300);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      let n = 0;
      for (const [x, z] of this.spots(2, rng, 30)) {
        skull(x, 0, z, r(0, 6), r(0.9, 1.3));
        for (let j = 0; j < 8 && n < 300; j++, n++) { q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, r(0, 6), 'YXZ')); m4.compose(new THREE.Vector3(x + r(-0.6, 0.6), 0.04, z + r(-0.6, 0.6)), q, new THREE.Vector3(1, r(0.7, 1.2), 1)); bones.setMatrixAt(n, m4); }
      }
      bones.count = n; g.add(bones);
      // skulls keeping watch on top of the cases
      for (const f of this.floors[2].faces) if (rng() < 0.08) skull(f.c.x, f.rows * 0.8 + 0.36, f.c.z, f.ry + r(-0.4, 0.4), 1.1);
    }
    // 3: roots through everything, and glowing mushrooms
    {
      const g = G(3);
      const bark = new THREE.MeshStandardMaterial({ color: '#4a3a22', roughness: 1, flatShading: true });
      for (const [x0, z0] of this.spots(3, rng, 34)) {
        const top = 3.4 + rng() * 3;
        const pts = [new THREE.Vector3(x0, top, z0), new THREE.Vector3(x0 + r(-1.2, 1.2), top * 0.66, z0 + r(-1.2, 1.2)), new THREE.Vector3(x0 + r(-1.5, 1.5), top * 0.3, z0 + r(-1.5, 1.5)), new THREE.Vector3(x0 + r(-2, 2), -0.1, z0 + r(-2, 2))];
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, r(0.08, 0.22), 6), bark));
      }
      const cap = new THREE.MeshStandardMaterial({ color: '#c8f07a', emissive: new THREE.Color('#9ad040'), emissiveIntensity: 1.2 });
      const stem = new THREE.MeshStandardMaterial({ color: '#e8e0c8' });
      const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap, 400);
      const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.03, 1, 5), stem, 400);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      let n = 0;
      for (const [x, z] of this.spots(3, rng, 60)) for (let j = 0; j < 6 && n < 400; j++, n++) {
        const sx = x + r(-0.6, 0.6), sz = z + r(-0.6, 0.6), h = r(0.1, 0.3), cr = r(0.06, 0.13);
        m4.compose(new THREE.Vector3(sx, h / 2, sz), q, new THREE.Vector3(1, h, 1)); stems.setMatrixAt(n, m4);
        m4.compose(new THREE.Vector3(sx, h, sz), q, new THREE.Vector3(cr, cr, cr)); caps.setMatrixAt(n, m4);
      }
      caps.count = stems.count = n; g.add(caps, stems);
    }
    // 4: the drowned archive: standing water over the whole floor, and kelp
    {
      const g = G(4);
      this.water = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: /* glsl */`
          uniform float uTime; varying vec2 vP;
          void main(){
            float w = sin(vP.x * 1.7 + uTime * 0.9) * 0.5 + sin(vP.y * 2.3 - uTime * 0.7) * 0.5 + sin((vP.x + vP.y) * 3.1 + uTime * 1.3) * 0.35;
            float hi = smoothstep(0.75, 1.1, w);
            vec3 c = mix(vec3(0.02, 0.1, 0.14), vec3(0.2, 0.55, 0.62), hi);
            gl_FragColor = vec4(c, 0.62 + hi * 0.2);
          }`,
        transparent: true, depthWrite: false,
      });
      const water = new THREE.Mesh(holedSquare(this.floors[4].plan.half, WELL_R + 0.12), this.water); water.rotation.x = -Math.PI / 2; water.position.y = 0.32; g.add(water);
      const kelpMat = new THREE.MeshStandardMaterial({ color: '#2a6a4a', emissive: new THREE.Color('#0a3a2a'), transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      for (const [x, z] of this.spots(4, rng, 40)) {
        const hgt = r(1.4, 2.8);
        const geo = new THREE.PlaneGeometry(0.18, hgt); geo.translate(0, hgt / 2, 0);
        const m = new THREE.Mesh(geo, kelpMat);
        m.position.set(x, 0, z); m.rotation.y = r(0, 6); m.userData.ph = r(0, 6);
        g.add(m); this.kelp.push(m);
      }
    }
    // 5: books that have come loose and float, candles burning on the ceiling
    {
      const g = G(5);
      const spots = this.spots(5, rng, 90);
      const n = spots.length;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: leatherTex([255, 255, 255]), roughness: 0.7, emissive: new THREE.Color('#1a0828') }), Math.max(1, n));
      const base: { p: THREE.Vector3; r: THREE.Euler; ph: number }[] = [];
      const col = new THREE.Color();
      spots.forEach(([x, z], k) => {
        base.push({ p: new THREE.Vector3(x, r(2.2, 2.9), z), r: new THREE.Euler(r(0, 6), r(0, 6), r(0, 6)), ph: r(0, 6) });
        mesh.setColorAt(k, col.setHSL(r(0.72, 0.92), r(0.3, 0.6), r(0.15, 0.4)));
      });
      g.add(mesh); this.floaters = { mesh, base };
      const wax = new THREE.MeshStandardMaterial({ color: '#e0d0f0', emissive: new THREE.Color('#2a1a3a') });
      const P = this.floors[5].plan;
      for (const [x, z] of this.spots(5, rng, 14)) {
        const ix = Math.floor(x / C + P.N / 2), iz = Math.floor(z / C + P.N / 2), top = P.ceil[iz * P.N + ix] || H;
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), wax); c.position.set(x, top - 0.2, z); g.add(c);
        const f = glowSprite('#e8b0ff', 0.45); f.position.set(x, top - 0.48, z); g.add(f);
      }
    }
    // 6: clocks that stopped, pendulums frozen mid-swing, gears adrift
    {
      const g = G(6);
      const brass = new THREE.MeshStandardMaterial({ color: '#b08a3a', metalness: 0.85, roughness: 0.35 });
      const [fc, fx] = canvas(512, 512);
      fx.fillStyle = '#e8dcb8'; fx.beginPath(); fx.arc(256, 256, 250, 0, Math.PI * 2); fx.fill();
      fx.strokeStyle = '#3a2a10'; fx.lineWidth = 10; fx.stroke();
      fx.fillStyle = '#2a1a08'; fx.font = '52px Georgia, serif'; fx.textAlign = 'center'; fx.textBaseline = 'middle';
      ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((t, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; fx.fillText(t, 256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190); });
      const faceTex = new THREE.CanvasTexture(fc); faceTex.colorSpace = THREE.SRGBColorSpace;
      const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, emissive: new THREE.Color('#ffe0a0'), emissiveMap: faceTex, emissiveIntensity: 0.25 });
      const hand = new THREE.MeshStandardMaterial({ color: '#1a1008' });
      const walls = this.bareWalls(6, 3.4);
      for (let k = 0; k < 26 && walls.length; k++) {
        const e = walls[Math.floor(rng() * walls.length)];
        const s = r(0.6, 1.3);
        const c = new THREE.Group(); c.position.set(e.x + e.nx * 0.08, Math.min(e.ceil - s - 0.2, r(1.8, 4.5)), e.z + e.nz * 0.08); c.rotation.y = Math.atan2(e.nx, e.nz); c.scale.setScalar(s * 0.8); g.add(c);
        c.add(new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), faceMat).translateZ(0.02));
        c.add(new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.06, 8, 40), brass));
        for (const [len, w] of [[0.55, 0.05], [0.75, 0.03]]) {
          const hg = new THREE.BoxGeometry(w, len, 0.02); hg.translate(0, len / 2, 0);
          const hm = new THREE.Mesh(hg, hand); hm.position.z = 0.05; hm.rotation.z = r(0, 6); c.add(hm); this.clockHands.push(hm);
        }
      }
      const P = this.floors[6].plan;
      for (const [x, z] of this.spots(6, rng, 16)) {
        const ix = Math.floor(x / C + P.N / 2), iz = Math.floor(z / C + P.N / 2), top = P.ceil[iz * P.N + ix] || H;
        if (top < 5) continue;
        const p = new THREE.Group(); p.position.set(x, top, z); p.rotation.z = r(-0.4, 0.4); g.add(p);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, top - 2.6, 6), brass); rod.position.y = -(top - 2.6) / 2; p.add(rod);
        const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24), brass); bob.rotation.x = Math.PI / 2; bob.position.y = -(top - 2.5); p.add(bob);
      }
      for (const [x, z] of this.spots(6, rng, 30)) {
        const gear = new THREE.Mesh(new THREE.TorusGeometry(r(0.3, 0.7), r(0.06, 0.12), 6, 14), brass);
        gear.position.set(x, r(2.4, 3), z); gear.rotation.set(r(0, 6), r(0, 6), 0); gear.userData.spin = r(-0.3, 0.3);
        g.add(gear); this.gears.push(gear);
      }
    }
    // 7: the unwritten: eyes in the walls, pale script on the floor
    {
      const g = G(7);
      const white = new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.3, emissive: new THREE.Color('#3a3a3a') });
      const iris = new THREE.MeshBasicMaterial({ color: '#7a1020' });
      const pupil = new THREE.MeshBasicMaterial({ color: '#000000' });
      const walls = this.bareWalls(7, 3.2);
      for (let k = 0; k < 34 && walls.length; k++) {
        const e = walls[Math.floor(rng() * walls.length)];
        const eye = new THREE.Group(); eye.position.set(e.x + e.nx * 0.3, r(1.7, Math.min(4.8, e.ceil - 0.6)), e.z + e.nz * 0.3); eye.scale.setScalar(r(0.5, 1.3));
        eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16), white));
        eye.add(new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), iris).translateZ(0.395));
        eye.add(new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), pupil).translateZ(0.4));
        eye.userData.ph = r(0, 20);
        g.add(eye); this.eyes.push(eye);
      }
      const script = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
      for (const [x, z] of this.spots(7, rng, 10)) { const rr = r(0.8, 1.8); const ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr + 0.06, 48), script); ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.02, z); g.add(ring); }
    }
  }

  onResize(_w: number, h: number) {
    this.motes.setScale(h, this.camera.fov); this.embers.setScale(h, this.camera.fov);
  }

  // ---------------------------------------------------------------- books
  // Per-round contents: school, size class, chains, glow and placement. A floor is laid out the first
  // time you come near it. `taken` is keyed by book index plus 100000 per floor below the Reading Room.
  layoutAll(runId: number, round: number, taken: Record<number, boolean> = {}) {
    this.layoutArgs = { runId, round, taken };
    for (const F of this.floors) F.laid = '';
    this.ensureLaid(this.level);
  }

  private ensureLaid(d: number) {
    for (const k of [d - 1, d, d + 1, d + 2]) {
      const F = this.floors[k]; if (!F) continue;
      const key = `${this.layoutArgs.runId}:${this.layoutArgs.round}`;
      if (F.laid === key) continue;
      const mine: Record<number, boolean> = {};
      for (const t in this.layoutArgs.taken) { const n = +t; if (Math.floor(n / 100000) === F.d) mine[n % 100000] = true; }
      this.layoutFloor(F, this.layoutArgs.runId, this.layoutArgs.round, mine);
      F.laid = key;
    }
  }

  private layoutFloor(F: Floor, runId: number, round: number, taken: Record<number, boolean>) {
    const depth = F.d, lvl = LEVELS[depth];
    if (!F.books.length) F.books = F.slots.map(s => ({ face: s.face, row: s.row, x: s.x, w: s.w, h: s.h, lean: s.lean, school: 'fire', size: 0, chained: false, glowing: false, title: '', nook: false, far: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), color: new THREE.Color() }));
    F.bookMesh.count = F.books.length;
    F.taken = taken;
    const tint = new THREE.Color(lvl.spine);
    const seed = hashStr(depth ? `${runId}:${round}:d${depth}` : `${runId}:${round}`);
    const rng = mulberry32(seed);
    // each wing keeps mostly one school; the hall mixes them case by case
    const roomSchool = F.plan.rooms.map(() => SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)]);
    const faceSchool = F.faces.map(f => (f.room === 0 ? SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)] : roomSchool[f.room]));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let bands = 0;
    F.glows.forEach(g => this.scene.remove(g)); F.glows = [];
    const glowCandidates: number[] = [];
    const bm = new THREE.Matrix4();
    F.books.forEach((b, i) => {
      const f = F.faces[b.face];
      b.school = rng() < (f.room === 0 ? 0.72 : 0.8) ? faceSchool[b.face] : SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)];
      b.size = b.w > 0.115 ? 2 : (b.w > 0.085 || rng() < 0.15 ? 1 : 0);
      b.chained = rng() < (round >= 4 ? 0.022 : 0.012) + depth * 0.004 + (f.nook ? 0.05 : 0);
      b.glowing = false; b.nook = f.nook; b.far = f.far;
      const tr = mulberry32(seed ^ Math.imul(i, 2654435761));
      const words = TITLE_WORDS[b.school];
      b.title = TITLE_FORMS[Math.floor(tr() * TITLE_FORMS.length)].replace('{x}', words[Math.floor(tr() * words.length)]);
      if (depth) b.title = lvl.titles[Math.floor(tr() * lvl.titles.length)];
      if (!b.chained && rng() < 0.004 * (1 + depth * 0.4) * (f.nook ? 6 : 1 + f.far)) glowCandidates.push(i);
      const p = f.c.clone().addScaledVector(f.tan, b.x).add(new THREE.Vector3(0, F.y0 + 0.13 + b.row * 0.8 + b.h / 2, 0)).addScaledVector(f.nrm, 0.2 + (rng() - 0.5) * 0.02);
      let lean = b.lean;
      if (depth === 5 || depth === DEEPEST) {
        const tw = mulberry32(seed ^ Math.imul(i + 7, 40503));
        if (tw() < (depth === 5 ? 0.5 : 0.25)) lean = (tw() - 0.5) * (depth === 5 ? 0.9 : 0.4);
        if (depth === 5) p.y += tw() * 0.14;
      } else if (depth >= 2 && b.lean === 0) {
        const tw = mulberry32(seed ^ Math.imul(i + 7, 40503));
        if (tw() < 0.06 * depth) lean = (tw() - 0.5) * 0.35;
      }
      e.set(0, f.ry, lean); q.setFromEuler(e);
      b.pos.copy(p); b.quat.copy(q);
      m4.compose(p, q, taken[i] ? new THREE.Vector3(0.0001, 0.0001, 0.0001) : new THREE.Vector3(b.w, b.h, 0.3));
      F.bookMesh.setMatrixAt(i, m4);
      const base = new THREE.Color(ESS[b.school].spine);
      const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
      col.setHSL(hsl.h, Math.min(1, hsl.s * (0.85 + rng() * 0.3)), Math.max(0.05, Math.min(0.9, hsl.l * (0.8 + rng() * 0.45))));
      if (depth) {
        col.lerp(tint, lvl.spineMix);
        if (depth === DEEPEST && mulberry32(seed ^ Math.imul(i + 3, 9973))() < 0.35) col.setRGB(0.05, 0.05, 0.06);
      }
      b.color.copy(col);
      F.bookMesh.setColorAt(i, col);
      if (b.chained && !taken[i] && bands < 398) {
        bm.compose(p, q, new THREE.Vector3(b.w + 0.014, 0.035, 0.31)); F.bandMesh.setMatrixAt(bands++, bm);
        bm.compose(p.clone().add(new THREE.Vector3(0, b.h * 0.3, 0)), q, new THREE.Vector3(b.w + 0.014, 0.035, 0.31)); F.bandMesh.setMatrixAt(bands++, bm);
      }
    });
    glowCandidates.slice(0, 8 + depth * 4).forEach(i => {
      const b = F.books[i]; b.glowing = true;
      if (taken[i]) return;
      const s = glowSprite('#fff0b0', 0.55, 0.6); s.position.copy(b.pos).addScaledVector(F.faces[b.face].nrm, 0.2); s.userData.phase = rng() * 6; this.scene.add(s); F.glows.push(s);
    });
    F.bandMesh.count = bands;
    F.bandMesh.instanceMatrix.needsUpdate = true;
    F.bookMesh.instanceMatrix.needsUpdate = true;
    if (F.bookMesh.instanceColor) F.bookMesh.instanceColor.needsUpdate = true;
    F.bookMesh.computeBoundingSphere();
  }

  hideBook(d: number, i: number) {
    const F = this.floors[d], b = F.books[i], m4 = new THREE.Matrix4();
    m4.compose(b.pos, b.quat, new THREE.Vector3(0.0001, 0.0001, 0.0001));
    F.bookMesh.setMatrixAt(i, m4); F.bookMesh.instanceMatrix.needsUpdate = true;
    F.glows.forEach(g => { if (g.position.distanceTo(b.pos) < 0.35) { g.visible = false; g.userData.hidden = true; } });
    F.taken[i] = true;
  }

  book(d: number, i: number): Book { return this.floors[d].books[i]; }

  // ---------------------------------------------------------------- movement
  get feet() { return this.pos.y - EYE; }
  levelOf(feet: number) { return Math.max(0, Math.min(DEEPEST, Math.ceil((-feet - 0.5) / LH))); }

  // The highest thing to stand on beneath (feet + a step) at x, z: a floor, or the stair.
  groundAt(x: number, z: number, feet: number): number {
    const dx = x - WELL.x, dz = z - WELL.z, r = Math.hypot(dx, dz);
    let best = -1e9;
    const reach = feet + STEP_UP;
    for (let k = 0; k <= DEEPEST; k++) {
      const fy = -k * LH;
      if (fy > reach || (k < DEEPEST && r < WELL_R)) continue;
      best = fy; break; // the first floor at or below you is the highest one
    }
    if (r >= STAIR_IN - 0.05 && r <= STAIR_OUT + 0.05) {
      let base = Math.atan2(dz, dx) - A0; base = ((base % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const hTop = -(base / (Math.PI * 2)) * PITCH;
      const k = Math.max(0, Math.ceil((hTop - reach) / PITCH - 1e-9));
      const h = hTop - k * PITCH;
      if (h >= -DEEPEST * LH - 1e-6) best = Math.max(best, h);
    }
    return best;
  }

  jump() { if (this.grounded && !this.titleSpin) { this.vy = 6.4; this.grounded = false; } }

  private push(p: THREE.Vector3, b: Box) {
    const x0 = b.x0 - BODY, x1 = b.x1 + BODY, z0 = b.z0 - BODY, z1 = b.z1 + BODY;
    if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
      const dx = Math.min(p.x - x0, x1 - p.x), dz = Math.min(p.z - z0, z1 - p.z);
      if (dx < dz) p.x = (p.x - x0 < x1 - p.x) ? x0 : x1; else p.z = (p.z - z0 < z1 - p.z) ? z0 : z1;
    }
  }

  collide(p: THREE.Vector3, feet: number) {
    const d = this.levelOf(feet);
    const F = this.floors[d];
    if (d === 0) {
      const onTop = feet > -0.6; // the doorways only exist in the Reading Room
      const inDoor = onTop && Math.abs(p.z) < 1.3;
      p.x = Math.max(inDoor ? -R - 0.5 : -R + 0.95, Math.min(inDoor ? R + 0.5 : R - 0.95, p.x));
      p.z = Math.max(-R + 0.95, Math.min(R - 0.95, p.z));
      if (onTop) this.push(p, this.deskCollider);
    } else {
      // solid cells of the plan are walls
      const P = F.plan;
      for (let pass = 0; pass < 2; pass++) {
        const cix = Math.floor(p.x / C + P.N / 2), ciz = Math.floor(p.z / C + P.N / 2);
        for (let iz = ciz - 1; iz <= ciz + 1; iz++) for (let ix = cix - 1; ix <= cix + 1; ix++) {
          const solid = ix < 0 || iz < 0 || ix >= P.N || iz >= P.N || !P.walk[iz * P.N + ix];
          if (!solid) continue;
          const x0 = (ix - P.N / 2) * C, z0 = (iz - P.N / 2) * C;
          this.push(p, { x0, x1: x0 + C, z0, z1: z0 + C });
        }
      }
    }
    for (const b of F.colliders) if (Math.abs(p.x - (b.x0 + b.x1) / 2) < 3 && Math.abs(p.z - (b.z0 + b.z1) / 2) < 3) this.push(p, b);
  }

  // The brass rail round each floor's hole: walk in through the landing, or jump over it.
  private rails(prev: THREE.Vector3, p: THREE.Vector3, feet: number) {
    const rPrev = Math.hypot(prev.x - WELL.x, prev.z - WELL.z), r = Math.hypot(p.x - WELL.x, p.z - WELL.z);
    const RR = WELL_R + 0.05;
    if (!(rPrev >= RR - 0.02 && r < RR + 0.15)) return;
    const k = Math.round(-feet / LH);
    if (k >= DEEPEST || feet - (-k * LH) > 0.72 || feet < -k * LH - 0.1) return; // jumped high enough to clear it
    const a = Math.atan2(p.z - WELL.z, p.x - WELL.x);
    if (Math.abs(Math.atan2(Math.sin(a - A0), Math.cos(a - A0))) < 0.5) return; // the open landing
    const s = (RR + 0.18) / Math.max(r, 0.001);
    p.x = WELL.x + (p.x - WELL.x) * s; p.z = WELL.z + (p.z - WELL.z) * s;
  }

  // Inside the stairwell, between floors, the shaft wall holds you in.
  private shaftWall(prev: THREE.Vector3, p: THREE.Vector3, feet: number) {
    const rPrev = Math.hypot(prev.x - WELL.x, prev.z - WELL.z), r = Math.hypot(p.x - WELL.x, p.z - WELL.z);
    if (rPrev > WELL_R - 0.25 || r <= WELL_R - 0.25) return;
    const head = feet + 1.75;
    for (let k = 1; k <= DEEPEST; k++) {
      const top = -(k - 1) * LH, bottom = top - (LH - H); // the slab under floor k-1
      if (head > bottom && feet < top - 0.05) {
        const s = (WELL_R - 0.25) / r;
        p.x = WELL.x + (p.x - WELL.x) * s; p.z = WELL.z + (p.z - WELL.z) * s;
        return;
      }
    }
  }

  // true when the reader walks into the shop doorway
  atDoor() { return this.feet > -0.6 && this.pos.x > R - 0.6 && Math.abs(this.pos.z) < 1.3; }
  // true when the reader steps into the Duelling Ring's arch
  atArena() { return this.feet > -0.6 && this.pos.x < -R + 0.6 && Math.abs(this.pos.z) < 1.3; }

  // ---------------------------------------------------------------- picking
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
    const F = this.floors[this.level];
    const targets: THREE.Object3D[] = [F.bookMesh];
    if (this.level === 0) targets.push(this.door, this.deskPick, this.arena);
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      if (h.object === F.bookMesh && h.instanceId !== undefined) {
        if (F.taken[h.instanceId] || h.distance > 5.5) continue;
        return { kind: 'book', i: h.instanceId, d: F.d };
      }
      if (h.object === this.door) return { kind: 'door' };
      if (h.object === this.deskPick) return { kind: 'desk' };
      if (h.object === this.arena) return { kind: 'arena' };
    }
    return null;
  }

  setHover(p: Pick) {
    this.hover = p;
    if (!p || p.kind !== 'book') { this.highlight.visible = false; return; }
    const b = this.floors[p.d].books[p.i];
    this.highlight.visible = true; this.highlight.position.copy(b.pos); this.highlight.quaternion.copy(b.quat);
    this.highlight.scale.set(b.w + 0.02, b.h + 0.02, 0.32);
  }

  // ---------------------------------------------------------------- per frame
  // Show the floors around you, lay out their books and let the air change colour.
  private applyLevel(d: number, snap = false) {
    const L = LEVELS[d];
    this.ensureLaid(d);
    this.setVisible();
    this.candleLights.forEach(l => l.color.set(L.candle));
    this.placeLights();
    const next = LEVELS[Math.min(DEEPEST, d + 1)];
    this.wellLight.color.set(next.candle); this.wellLight.position.set(WELL.x, -d * LH - LH * 0.55, WELL.z);
    this.wellLight.intensity = d < DEEPEST ? 6 : 0;
    if (snap) {
      this.env.fog.set(L.fog); this.env.sky.set(L.sky); this.env.ground.set(L.ground);
      this.env.hemi = L.hemi; this.env.near = L.near; this.env.far = L.far; this.env.lantern = L.lantern;
      this.env.exposure = 1.15 - d * 0.025; this.env.vignette = 1 + d * 0.1;
    }
  }

  // Only the floor you're on is drawn, plus the ones above and below when you're near enough to the
  // stairwell to see them through it.
  private nearShaft = true;
  private setVisible() {
    const d = this.level;
    this.floors.forEach(F => {
      const vis = F.d === d || (this.nearShaft && F.d >= d - 1 && F.d <= d + 2);
      F.group.visible = vis; F.bookMesh.visible = vis; F.bandMesh.visible = vis;
      F.glows.forEach(g => { g.visible = vis && !(g.userData.hidden as boolean); });
    });
  }

  // The candle-light pool sits on the stands nearest to you.
  private placeLights() {
    const F = this.floors[this.level];
    const near = F.stands.map(s => ({ s, dist: (s.x - this.pos.x) ** 2 + (s.z - this.pos.z) ** 2 })).sort((a, b) => a.dist - b.dist);
    this.candleLights.forEach((l, i) => {
      const s = near[i]?.s;
      if (s) { l.position.set(s.x, F.y0 + 2.1, s.z); l.userData.on = 1; } else l.userData.on = 0;
    });
  }

  update(dt: number, time: number) {
    const cam = this.camera;
    const prev = this.pos.clone();
    if (this.titleSpin) {
      this.yaw += dt * 0.05; this.pos.set(Math.sin(time * 0.05) * 2, 1.75, 5.5); this.pitch = 0.06; this.vy = 0; this.grounded = true;
    } else {
      const k = this.keys; let fx = 0, fz = 0;
      if (k.KeyW || k.ArrowUp) fz += 1; if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1; if (k.KeyD || k.ArrowRight) fx += 1;
      fx += this.joy.x; fz += -this.joy.y;
      const len = Math.hypot(fx, fz);
      const feet0 = this.feet;
      if (len > 0.05) {
        const sp = (k.ShiftLeft || k.ShiftRight ? 5.2 : 3.4) * dt / Math.max(1, len);
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.pos.x += (-sy * fz + cy * fx) * sp; this.pos.z += (-cy * fz - sy * fx) * sp;
        this.collide(this.pos, feet0);
        this.rails(prev, this.pos, feet0);
        this.shaftWall(prev, this.pos, feet0);
        if (this.grounded) this.bobT += dt * 9;
      }
      // gravity, the stair and the floors
      const wasGrounded = this.grounded;
      this.vy = Math.max(-34, this.vy - 22 * dt);
      let feet = feet0 + this.vy * dt;
      const g = this.groundAt(this.pos.x, this.pos.z, feet0);
      if (feet <= g || (wasGrounded && this.vy <= 0 && feet - g < 0.4 && feet0 - g < 0.6)) {
        if (!wasGrounded && this.vy < -9) { this.landDip = Math.min(0.5, -this.vy * 0.018); this.onLand?.(-this.vy); }
        feet = g; this.vy = 0; this.grounded = true;
      } else this.grounded = false;
      // a low ceiling stops a jump
      const lv = this.levelOf(feet), P = this.floors[lv].plan;
      if (lv > 0) {
        const ix = Math.floor(this.pos.x / C + P.N / 2), iz = Math.floor(this.pos.z / C + P.N / 2);
        const top = -lv * LH + (P.ceil[iz * P.N + ix] || H);
        if (feet + 1.8 > top && this.vy > 0 && Math.hypot(this.pos.x - WELL.x, this.pos.z - WELL.z) > WELL_R + 1) { feet = top - 1.8; this.vy = 0; }
      }
      this.pos.y = feet + EYE;
    }
    // which floor are we on?
    const lvl = this.levelOf(this.feet);
    if (lvl !== this.level) { this.level = lvl; this.applyLevel(lvl); this.onLevel?.(lvl); }
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.3; this.placeLights();
      const near = Math.hypot(this.pos.x - WELL.x, this.pos.z - WELL.z) < 14;
      if (near !== this.nearShaft) { this.nearShaft = near; this.setVisible(); }
    }
    // the air shifts towards this floor's colour
    const L = LEVELS[this.level], kk = 1 - Math.exp(-dt * 3);
    const E = this.env;
    E.fog.lerp(new THREE.Color(L.fog), kk); E.sky.lerp(new THREE.Color(L.sky), kk); E.ground.lerp(new THREE.Color(L.ground), kk);
    E.hemi += (L.hemi - E.hemi) * kk; E.near += (L.near - E.near) * kk; E.far += (L.far - E.far) * kk; E.lantern += (L.lantern - E.lantern) * kk;
    E.exposure += (1.15 - this.level * 0.025 - E.exposure) * kk; E.vignette += (1 + this.level * 0.1 - E.vignette) * kk;
    (this.scene.background as THREE.Color).copy(E.fog);
    const fog = this.scene.fog as THREE.Fog; fog.color.copy(E.fog); fog.near = E.near; fog.far = E.far;
    this.hemi.color.copy(E.sky); this.hemi.groundColor.copy(E.ground); this.hemi.intensity = E.hemi;
    this.exposure = E.exposure; this.vignette = E.vignette;
    this.lantern.position.copy(this.pos).add(new THREE.Vector3(0.3, -0.2, 0));
    this.lantern.intensity = E.lantern > 0.05 ? E.lantern + Math.sin(time * 11) * 0.3 + Math.sin(time * 5.3) * 0.2 : 0;
    const top = this.level === 0 ? 1 : 0;
    this.doorLight.intensity = 30 * top; this.arenaLight.intensity = (24 + Math.sin(time * 2.3) * 4) * top; this.deskLight.intensity = 2.5 * top;

    // camera: bob while walking, dip on landing
    this.landDip = Math.max(0, this.landDip - dt * 1.6);
    cam.position.copy(this.pos);
    cam.position.y += (this.grounded ? Math.sin(this.bobT) * 0.025 : 0) - Math.sin(Math.min(1, this.landDip * 2) * Math.PI) * this.landDip * 0.6;
    cam.rotation.order = 'YXZ'; cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;

    // candles and glows
    this.candleLights.forEach((Lt, i) => { Lt.intensity = (Lt.userData.on ? 1 : 0) * (13 + Math.sin(time * 7 + i * 2.1) * 1.2 + Math.sin(time * 13 + i) * 0.8) * L.candleI; });
    for (const d of [this.level - 1, this.level, this.level + 1]) {
      const F = this.floors[d]; if (!F) continue;
      F.flames.forEach((f, i) => { const s = 0.38 + Math.sin(time * 9 + i) * 0.04; f.scale.set(s * 0.7, s, s); });
      F.glows.forEach(g => { (g.material as THREE.SpriteMaterial).opacity = 0.35 + Math.sin(time * 2 + (g.userData.phase as number)) * 0.2; });
    }
    (this.doorGlow.material as THREE.SpriteMaterial).opacity = 0.45 + Math.sin(time * 1.7) * 0.08;
    this.arenaMat.uniforms.uTime.value = time;
    (this.arenaGlow.material as THREE.SpriteMaterial).opacity = 0.26 + Math.sin(time * 1.3) * 0.06;
    this.arenaRunes.opacity = 0.6 + Math.sin(time * 3) * 0.3;
    this.updateFloorLife(dt, time);
    this.motes.update(dt); this.embers.update(dt);
  }

  private updateFloorLife(dt: number, time: number) {
    const d = this.level, L = LEVELS[d], y0 = -d * LH;
    const rnd = Math.random;
    const r = rnd();
    const ex = () => this.pos.x + (rnd() - 0.5) * 14, ez = () => this.pos.z + (rnd() - 0.5) * 14;
    if (d === 0) {
      if (r < 0.3) { const [x, z] = HALL_CANDLES[Math.floor(rnd() * HALL_CANDLES.length)]; this.embers.emit({ x: x + (rnd() - 0.5) * 0.2, y: 1.8, z, vy: 0.4, color: '#ffc070', size: 0.04, life: 1.2, jitter: 0.6 }); }
      if (rnd() < 0.4) this.motes.emit({ x: (rnd() - 0.5) * 18, y: rnd() * 5, z: (rnd() - 0.5) * 18, color: '#ffe2b0', size: 0.05 + rnd() * 0.05, life: 4 + rnd() * 5, drag: 0, jitter: 0.25, alpha: 0.7 });
      if (rnd() < 0.5) this.motes.emit({ x: R - 0.5 - rnd() * 3, y: 0.5 + rnd() * 3, z: (rnd() - 0.5) * 2.6, vx: -0.3, color: '#ffc080', size: 0.06, life: 4, drag: 0, jitter: 0.3, alpha: 0.8 });
      if (rnd() < 0.5) this.motes.emit({ x: -R + 0.3 + rnd() * 2, y: 0.4 + rnd() * 3.6, z: (rnd() - 0.5) * 2.6, vx: 0.35, color: rnd() < 0.5 ? '#7fe0d0' : '#b89aff', size: 0.06, life: 4, drag: 0, jitter: 0.3, alpha: 0.8 });
    } else if (r < 0.4) {
      // each floor's air has its own drift
      const vy = d === 4 ? 0.6 : d === 5 ? 0.45 : d === DEEPEST ? -0.25 : d === 3 ? 0.12 : d === 6 ? 0 : -0.04;
      this.motes.emit({ x: ex(), y: y0 + (d === DEEPEST ? 3 + rnd() * 2 : d === 4 ? 0.35 : rnd() * 3.5), z: ez(), vy, color: L.mote, size: d === DEEPEST ? 0.08 : 0.045, life: d === DEEPEST ? 10 : 5, drag: 0, jitter: d === 6 ? 0.02 : 0.15, alpha: 0.65 });
    }
    // falling through the shaft: streaks of light rushing past
    if (this.vy < -12 && rnd() < 0.8) this.motes.emit({ x: this.pos.x + (rnd() - 0.5) * 3, y: this.pos.y - 3 - rnd() * 4, z: this.pos.z + (rnd() - 0.5) * 3, vy: 6, color: L.flame, size: 0.05, life: 0.6, drag: 0, alpha: 0.6 });
    if (Math.abs(d - 4) <= 1) {
      if (this.water) this.water.uniforms.uTime.value = time;
      for (const k of this.kelp) k.rotation.z = Math.sin(time * 0.8 + (k.userData.ph as number)) * 0.18;
    }
    if (Math.abs(d - 5) <= 1 && this.floaters) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(0.36, 0.5, 0.1), p = new THREE.Vector3();
      this.floaters.base.forEach((b, k) => {
        p.copy(b.p); p.y += Math.sin(time * 0.6 + b.ph) * 0.25;
        e.set(b.r.x + time * 0.12, b.r.y + time * 0.2 + b.ph * 0.1, b.r.z); q.setFromEuler(e);
        m4.compose(p, q, sc); this.floaters!.mesh.setMatrixAt(k, m4);
      });
      this.floaters.mesh.instanceMatrix.needsUpdate = true;
    }
    if (Math.abs(d - 6) <= 1) {
      for (const g of this.gears) g.rotation.z += dt * (g.userData.spin as number) * 0.2;
      for (const h of this.clockHands) if (rnd() < 0.004) h.rotation.z += (rnd() < 0.5 ? -1 : 1) * 0.1;
    }
    if (d >= DEEPEST - 1) {
      for (const eye of this.eyes) {
        eye.lookAt(this.camera.position);
        const ph = ((time + (eye.userData.ph as number)) % 9);
        eye.scale.y = eye.scale.x * (ph < 0.18 ? Math.abs(ph - 0.09) / 0.09 : 1);
      }
    }
  }
}
