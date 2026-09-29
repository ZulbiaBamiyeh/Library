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
import type { Shop } from './shop';
import { quality, Q } from './quality';
import { Stall } from './stall';
import { STALLS } from '../data/stalls';

const R = 10; // half the width of the central hall
const H = 7; // hall height
export const LH = 8; // one floor to the next
const EYE = 1.62;
const H0 = 19; // the Reading Room rises through two galleries to a ceiling this high
const T1 = 6.6, T2 = 12.8; // the galleries' floors
const C = 2; // the floor plans are drawn on a grid of 2-unit cells
// the stairwell: a round shaft through every floor, the stair clinging to its wall, open in the middle
const WELL = new THREE.Vector3(0, 0, -16); // in its own stair tower, north of the hall on every floor
const WELL_R = 4.4; // the hole in each floor
const STAIR_IN = 2.3, STAIR_OUT = 4.38; // the steps run between these radii; inside is a straight drop
const CASE_IN = 3.95; // a bookcase winds down the outer edge of the stair, from here to STAIR_OUT
const CASE_H = 2.6; // and stands this tall above the steps
const CASE_GAP = 0.42; // the case opens this far (radians) either side of each landing
const LAND_GAP = 0.34; // and so does the brass rail round the hole
const LEVELS_COUNT = 8;
const PITCH = LH; // one full turn of the stair per floor
const A0 = Math.PI / 2; // the landing on every floor faces south, into the hall
const STEP_UP = 0.5;
const BODY = 0.35;
const EYE_LOW = 0.95; // eye height when crouching
const STAND = 1.9; // a ceiling lower than this has to be crawled under
const SECTOR = 16; // books and shelves are drawn in blocks this wide, so far-off blocks can be skipped
export const TAKEN_KEY = 1000000; // taken books are keyed by index plus this much per floor down
// on the Reading Room's south wall, either side of the desk: the Curio Shop's door and the Duelling Ring's arch
const SHOP_X = 6, RING_X = -6;
const SHOP_DEPTH = 4.1; // how far you can walk into the shop, past the doorway
const ARCH_W = 2.5, ARCH_H = 6; // the arch through to the stair tower, in the north wall
const TOWER = { x0: -6, x1: 6, z0: -22, z1: -10 };

export interface Book {
  face: number; row: number; x: number; w: number; h: number; lean: number;
  school: Essence; size: number; chained: boolean; glowing: boolean; title: string;
  nook: boolean; far: number; // tucked away in an alcove; how far from the stair (0..1)
  hidden: boolean; flat: boolean; // in a hidden room or a loose pile; lying flat on a pile
  sec: number; j: number; // which block of shelves draws it, and where in that block
  pos: THREE.Vector3; quat: THREE.Quaternion; color: THREE.Color;
}
interface Face { c: THREE.Vector3; ry: number; rows: number; width: number; wall?: boolean; unit: string; room: number; nook: boolean; far: number; hidden: boolean; pile: boolean; tan: THREE.Vector3; nrm: THREE.Vector3; rot: THREE.Quaternion }
// a book's place: on a shelf row, or (y, yaw, dz) lying flat in a pile
interface Slot { face: number; row: number; x: number; w: number; h: number; lean: number; y?: number; yaw?: number; dz?: number }
interface Sector { cx: number; cz: number; ids: number[]; mesh: THREE.InstancedMesh; wood: THREE.InstancedMesh | null }
// Something that blocks the way. With lo/hi it only stops a reader whose feet (above their floor) are in [lo, hi).
interface Box { x0: number; x1: number; z0: number; z1: number; lo?: number; hi?: number }
// A deck to stand on (balconies, galleries, daises), and a straight stair between heights; y is above the floor.
interface Deck { x0: number; x1: number; z0: number; z1: number; y: number }
interface Ramp { x0: number; x1: number; z0: number; z1: number; axis: 0 | 1; from: number; to: number; y0: number; y1: number }
type Part = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };

// ---- floor plans
type RoomKind = 'hall' | 'room' | 'corridor' | 'gallery' | 'nook' | 'crawl' | 'hidden';
interface Room { id: number; kind: RoomKind; ix0: number; iz0: number; ix1: number; iz1: number; ceil: number }
interface Edge { x: number; z: number; nx: number; nz: number; ceil: number; room: number; kind: RoomKind; shelf: boolean }
interface Plan { N: number; half: number; walk: Uint8Array; ceil: Float32Array; room: Int16Array; rooms: Room[]; edges: Edge[]; shops: number[] } // shops: the rooms the stalls on this floor took, in STALLS order

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

export type Pick = { kind: 'book'; i: number; d: number } | { kind: 'ware'; shop: number; i: number } | { kind: 'desk' } | { kind: 'arena' } | null;
// the floors where someone keeps a shop of their own, somewhere out of the way
export const SECRET_FLOORS = [...new Set(STALLS.map(s => s.d))];

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
    fog: '#0d0a14', near: 10, far: 36, sky: '#7a70a0', ground: '#2a1a10', hemi: 0.55,
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
const HALL_CANDLES: [number, number][] = [[-5, -7.8], [5, -7.8], [-5, 4.4], [5, 4.4], [-8.6, 5], [8.6, 5]];
// free-standing double shelves in the middle of the hall, two rows of four with an aisle down the centre
const HALL_ROWS: [number, number][] = [];
for (const z of [-4.2, 1.2]) for (const x of [-4.8, -2, 2, 4.8]) HALL_ROWS.push([x, z]);

// A spiral stair between floors: the great one in the stair tower, and smaller ones out in the wings.
// It descends `pitch` per turn from floor `top` to floor `bot`, landing at angle a0 on each floor it meets.
export interface Spiral {
  x: number; z: number; rIn: number; rOut: number; rHole: number; pitch: number; a0: number;
  top: number; bot: number; main: boolean; sq: number; // sq: half the width of the ceiling patch cut for it
  gap: number; // the rail's opening at the landing, in radians
  slab: number[]; // per floor from top to bot - 1: the height of the shaft between that floor and the ceiling below
}
const MAIN_SPIRAL: Spiral = { x: WELL.x, z: WELL.z, rIn: STAIR_IN, rOut: STAIR_OUT, rHole: WELL_R, pitch: PITCH, a0: A0, top: 0, bot: LEVELS_COUNT - 1, main: true, sq: 6, gap: LAND_GAP, slab: [] };

// a rectangle of floor or ceiling with round holes cut in it (x, z in the floor's own coordinates)
function holedRect(x0: number, x1: number, z0: number, z1: number, holes: { x: number; z: number; r: number }[]): THREE.ShapeGeometry {
  const s = new THREE.Shape([new THREE.Vector2(x0, -z1), new THREE.Vector2(x1, -z1), new THREE.Vector2(x1, -z0), new THREE.Vector2(x0, -z0)]);
  for (const h of holes) { const p = new THREE.Path(); p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true); s.holes.push(p); }
  return new THREE.ShapeGeometry(s, 40);
}

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


// Draw the plan of one floor: the central hall with the stair, then wings grown outward from it. Some wings
// are only reached by crawling: a low passage into a hidden room. The same floor always has the same plan.
function makePlan(d: number): Plan {
  const N = d === 0 ? 10 : 2 * Math.round((40 + 5 * d) / 2); // even, so the hall sits on whole cells
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
  // the stair tower, a square room north of the hall around the great spiral stair
  if (d > 0) { const tower: Room = { id: 1, kind: 'hall', ix0: N / 2 - 3, iz0: N / 2 - 11, ix1: N / 2 + 3, iz1: N / 2 - 5, ceil: H }; rooms.push(tower); carve(tower); }
  const shops: number[] = [];
  const secret = new Uint8Array(N * N); // cells of crawlspaces and hidden rooms: nothing else may touch them
  if (d > 0) {
    const rng = mulberry32(7700 + d * 131);
    const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
    const target = 48 + d * 12;
    for (let attempt = 0; attempt < 12000 && rooms.length < target; attempt++) {
      // pick a wall cell of what exists and push outward from it
      const ix = ri(1, N - 2), iz = ri(1, N - 2);
      const from = idx(ix, iz);
      if (!walk[from] || secret[from]) continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => inside(ix + dx, iz + dz) && !walk[idx(ix + dx, iz + dz)]);
      if (!dirs.length) continue;
      const [dx, dz] = dirs[Math.floor(rng() * dirs.length)];
      const px = -dz, pz = dx; // perpendicular
      // the further out, the bigger and odder the wings
      const far = Math.min(1, Math.hypot(ix - N / 2, iz - N / 2) / (N / 2));
      const grow = Math.floor(d / 2 + far * 3);
      const roll = rng();
      const kind: RoomKind = roll < 0.2 ? 'nook' : roll < 0.33 ? 'gallery' : roll < 0.33 + 0.06 + far * 0.12 ? 'hidden' : 'room';
      const L = kind === 'nook' ? ri(0, 1) : kind === 'hidden' ? ri(2, 4) : ri(1, 4 + Math.floor(d / 2));
      const cw = kind === 'hidden' ? 1 : rng() < 0.6 ? 1 : 2;
      // the room at the far end of the corridor
      let along: number, across: number;
      if (kind === 'nook') { along = ri(1, 2); across = ri(1, 2); }
      else if (kind === 'hidden') { along = ri(3, 4); across = ri(3, 4); }
      else if (kind === 'gallery') { along = ri(2, 3); across = ri(6, 11 + grow); if (rng() < 0.5) [along, across] = [across, along]; }
      else { along = ri(3, 6 + grow); across = ri(3, 6 + grow); }
      const cells: [number, number][] = [];
      for (let k = 1; k <= L; k++) for (let w = 0; w < cw; w++) cells.push([ix + dx * k + px * w, iz + dz * k + pz * w]);
      const off = ri(-(across - 1), 0);
      const roomCells: [number, number][] = [];
      for (let a = 1; a <= along; a++) for (let b = 0; b < across; b++) roomCells.push([ix + dx * (L + a) + px * (off + b), iz + dz * (L + a) + pz * (off + b)]);
      const all = [...cells, ...roomCells];
      if (all.some(([x, z]) => x < 1 || z < 1 || x > N - 2 || z > N - 2)) continue;
      const overlap = roomCells.filter(([x, z]) => walk[idx(x, z)]).length;
      // now and then two wings meet, making a loop; a hidden room never does, or it would not be hidden
      if (overlap > 0 && (kind === 'hidden' || !(rng() < 0.12 && overlap < roomCells.length / 3))) continue;
      if (cells.some(([x, z]) => walk[idx(x, z)])) continue;
      // a hidden room's passage must not brush past anything else, or it would have a second way in;
      // and nothing new may be built against a hidden room either
      if (all.some(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, az]) => {
        const nx = x + ax, nz = z + az;
        if (nx === ix && nz === iz) return false;
        const k = idx(nx, nz);
        return (kind === 'hidden' ? walk[k] : secret[k]) && !all.some(([cx, cz]) => cx === nx && cz === nz);
      }))) continue;
      const box = (list: [number, number][]) => ({ ix0: Math.min(...list.map(c => c[0])), iz0: Math.min(...list.map(c => c[1])), ix1: Math.max(...list.map(c => c[0])) + 1, iz1: Math.max(...list.map(c => c[1])) + 1 });
      if (cells.length) {
        const cor: Room = kind === 'hidden'
          ? { id: rooms.length, kind: 'crawl', ...box(cells), ceil: 1.3 + rng() * 0.12 }
          : { id: rooms.length, kind: 'corridor', ...box(cells), ceil: 2.7 + rng() * 0.9 };
        rooms.push(cor); carve(cor);
      }
      const ceilH = kind === 'nook' ? 2.45 + rng() * 0.3 : kind === 'hidden' ? 2.35 + rng() * 0.35 : kind === 'gallery' ? H : Math.min(H, 3.2 + rng() * 3.8 + (far > 0.6 && rng() < 0.3 ? 2 : 0));
      const rm: Room = { id: rooms.length, kind, ...box(roomCells), ceil: ceilH };
      rooms.push(rm); carve(rm);
      if (kind === 'hidden') for (const [x, z] of all) secret[idx(x, z)] = 1;
    }
    // the shopkeepers of this floor take the furthest hidden rooms (or plain ones), well apart from each other
    const want = STALLS.filter(st => st.d === d).length;
    if (want) {
      const mid = (r: Room) => [(r.ix0 + r.ix1) / 2, (r.iz0 + r.iz1) / 2];
      const dist = (r: Room) => Math.hypot(mid(r)[0] - N / 2, mid(r)[1] - N / 2);
      const area = (r: Room) => (r.ix1 - r.ix0) * (r.iz1 - r.iz0);
      const fits = (r: Room) => area(r) >= 9 && area(r) <= 40 && r.ix1 - r.ix0 >= 3 && r.iz1 - r.iz0 >= 3;
      const cands = [...rooms.filter(r => r.kind === 'hidden' && fits(r)).sort((a, b) => dist(b) - dist(a)), ...rooms.filter(r => r.kind === 'room' && fits(r)).sort((a, b) => dist(b) - dist(a))];
      for (const apart of [N / 3, N / 6, 0]) for (const r of cands) {
        if (shops.length >= want) break;
        if (shops.includes(r.id) || shops.some(id => Math.hypot(mid(rooms[id])[0] - mid(r)[0], mid(rooms[id])[1] - mid(r)[1]) < apart)) continue;
        shops.push(r.id);
      }
      for (const id of shops) {
        rooms[id].ceil = 3.3;
        for (let k = 0; k < N * N; k++) if (room[k] === id) ceil[k] = 3.3;
      }
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
      let shelf = rm.kind !== 'crawl' && erng() < (rm.kind === 'nook' || rm.kind === 'hidden' ? 1 : rm.kind === 'corridor' ? 0.35 : 0.72);
      const axis = dx !== 0 ? 0 : 1;
      if (rm.kind !== 'nook' && rm.kind !== 'hidden' && solid(-dx, -dz)) { if (shelf && shelvedAxis === axis) shelf = false; if (shelf) shelvedAxis = axis; }
      edges.push({ x: cx + dx * C / 2, z: cz + dz * C / 2, nx: -dx, nz: -dz, ceil: ceil[k], room: room[k], kind: rm.kind, shelf });
    }
  }
  return { N, half, walk, ceil, room, rooms, edges, shops };
}

// Find places for the smaller spiral stairs: a square of open floor on one level with an open room of even
// height straight below it, out in the wings, well away from the great stair and from each other.
function findSpirals(plans: Plan[]): Spiral[] {
  const out: Spiral[] = [];
  const cellAt = (P: Plan, x: number, z: number) => {
    const ix = Math.floor(x / C + P.N / 2), iz = Math.floor(z / C + P.N / 2);
    return ix < 0 || iz < 0 || ix >= P.N || iz >= P.N ? -1 : iz * P.N + ix;
  };
  const SQ = 4; // half the square that must be clear
  const ok = (P: Plan, x: number, z: number, below: boolean) => {
    let ceil = -1, rid = -2;
    for (let dz = -SQ + 1; dz < SQ; dz += C) for (let dx = -SQ + 1; dx < SQ; dx += C) {
      const k = cellAt(P, x + dx, z + dz);
      if (k < 0 || !P.walk[k]) return false;
      const rm = P.rooms[P.room[k]];
      if (rm.kind !== 'room' && rm.kind !== 'gallery' && rm.kind !== 'corridor') return false;
      if (P.shops.includes(rm.id)) return false;
      if (below) { if (ceil < 0) ceil = P.ceil[k]; else if (Math.abs(ceil - P.ceil[k]) > 0.01) return false; if (P.ceil[k] < 3.2) return false; }
      if (rid === -2) rid = rm.id;
    }
    return below ? ceil : true;
  };
  for (let d = 1; d < plans.length - 1; d++) {
    const A = plans[d], B = plans[d + 1];
    const rng = mulberry32(4401 + d * 97);
    const cands: [number, number, number][] = [];
    const half = Math.min(A.half, B.half) - SQ - 2;
    for (let z = -half; z <= half; z += C) for (let x = -half; x <= half; x += C) {
      if (Math.hypot(x - WELL.x, z - WELL.z) < 22 || Math.hypot(x, z) < 16) continue;
      if (!ok(A, x, z, false)) continue;
      const c = ok(B, x, z, true) as number | false;
      if (c === false) continue;
      cands.push([x, z, c]);
    }
    const mine: Spiral[] = [];
    for (let tries = 0; tries < 60 && mine.length < 2 && cands.length; tries++) {
      const [x, z, c] = cands[Math.floor(rng() * cands.length)];
      if ([...mine, ...out].some(sp => Math.hypot(sp.x - x, sp.z - z) < 26)) continue;
      mine.push({ x, z, rIn: 0.34, rOut: 2.0, rHole: 2.05, pitch: 4, a0: Math.floor(rng() * 4) * Math.PI / 2, top: d, bot: d + 1, main: false, sq: SQ, gap: 0.62, slab: [LH - c] });
    }
    out.push(...mine);
  }
  return out;
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
  decks: Deck[];
  ramps: Ramp[];
  books: Book[];
  secs: Sector[];
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
  spirals: Spiral[] = [];
  deskCollider: Box = { x0: -1.7, x1: 1.7, z0: 7.6, z1: 9.2 };
  private qLevel = -1; // the graphics quality last applied
  private drawScale = 1;
  private lit: { d: number; i: number } | null = null; // the book under the crosshair, drawn pulled out a little
  yaw = 0; pitch = 0; pos = new THREE.Vector3(0, EYE, 6.6); // pos is the eye
  eyeH = EYE; // lower while crouching
  crouch = false; // held (keyboard) or toggled (touch)
  shop: Shop | null = null;
  stalls: Record<number, Stall> = {};
  private shopLights: { L: THREE.Light }[] = [];
  vy = 0;
  grounded = true;
  level = 0; // the floor you are on (or falling past)
  onLand?: (speed: number) => void;
  onLevel?: (d: number) => void;
  keys: Record<string, boolean> = {};
  joy = { x: 0, y: 0 };
  titleSpin = true;
  candleLights: THREE.PointLight[] = [];
  private hallLights: THREE.PointLight[] = [];
  arenaLight: THREE.PointLight;
  deskLight: THREE.PointLight;
  wellLight = new THREE.PointLight('#ffffff', 0, 12, 1.4);
  lantern = new THREE.PointLight('#ffd8a0', 0, 9, 1.5);
  hemi: THREE.HemisphereLight;
  motes: Particles;
  embers: Particles;
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
    // two warm lights hung in the Reading Room's open middle, so the galleries are not left in the dark
    for (const [x, y, z] of [[0, 14.5, -1.5], [0, 9.5, 2]]) { const Lh = new THREE.PointLight('#ffc890', 0, 26, 1.1); Lh.position.set(x, y, z); S.add(Lh); this.hallLights.push(Lh); }
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
    const clothMat = new THREE.MeshStandardMaterial({ color: '#6a2230', roughness: 1 });

    // every floor's plan first, so the smaller stairs can be put where there is room both above and below
    const plans = LEVELS.map((_, d) => makePlan(d));
    const main: Spiral = { ...MAIN_SPIRAL, bot: DEEPEST, slab: LEVELS.map(() => LH - H) };
    this.spirals = [main, ...findSpirals(plans)];
    for (let d = 0; d < LEVELS.length; d++) {
      const L = LEVELS[d];
      const plan = plans[d];
      const holesHere = this.spirals.filter(sp => sp.top <= d && d < sp.bot); // stairs going down through this floor
      const passing = this.spirals.filter(sp => sp.top < d && d <= sp.bot); // stairs coming down into this floor
      const nearSpiral = (x: number, z: number, pad: number) => this.spirals.some(sp => !sp.main && sp.top <= d && d <= sp.bot && Math.hypot(x - sp.x, z - sp.z) < sp.rHole + pad);
      const g = new THREE.Group(); g.position.y = -d * LH; S.add(g);
      const floorMat = new THREE.MeshStandardMaterial({ map: fs.map, normalMap: fs.normal, roughnessMap: fs.rough, color: L.floor });
      const wallMat = new THREE.MeshStandardMaterial({ map: pl, roughness: 0.95, color: L.wall });
      const segMat = new THREE.MeshStandardMaterial({ map: plSeg, roughness: 0.95, color: L.wall, side: THREE.DoubleSide });
      const woodMat = new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.8, color: L.wood });
      const ceilMat = new THREE.MeshStandardMaterial({ color: L.ceil, roughness: 1, side: THREE.DoubleSide });
      const floorGeo = d === 0 ? holedRect(-R, R, -R, R, []) : holedRect(-plan.half, plan.half, -plan.half, plan.half, holesHere.map(sp => ({ x: sp.x, z: sp.z, r: sp.rHole })));
      const floor = new THREE.Mesh(floorGeo, floorMat); floor.rotation.x = -Math.PI / 2; g.add(floor);
      const faces: Omit<Face, 'tan' | 'nrm' | 'rot'>[] = [];
      const colliders: Box[] = [];
      const stands: THREE.Vector3[] = [];
      const addFace = (c: THREE.Vector3, ry: number, rows: number, width: number, wall: boolean, unit: string, room: number, nook: boolean, pile = false) => {
        const kind = plan.rooms[room]?.kind;
        faces.push({ c, ry, rows, width, wall, unit, room, nook, pile, hidden: pile || kind === 'hidden', far: Math.min(1, Math.hypot(c.x - WELL.x, c.z - WELL.z) / Math.max(20, plan.half)) });
      };
      // a loose heap of books on the floor, one to three stacks
      const addPile = (x: number, z: number, room: number, rng: () => number, y = 0) => {
        addFace(new THREE.Vector3(x, y, z), rng() * Math.PI * 2, 1 + Math.floor(rng() * 3), 1, false, 'p' + faces.length, room, false, true);
        colliders.push({ x0: x - 0.45, x1: x + 0.45, z0: z - 0.45, z1: z + 0.45 });
      };

      // ---- things to climb: decks, stairs, railings and reading nooks, all drawn in a few instanced meshes
      const decks: Deck[] = [], ramps: Ramp[] = [];
      const woodB: Part[] = [], brassB: Part[] = [], clothB: Part[] = [];
      const Q0 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
      const part = (list: Part[], x: number, y: number, z: number, sx: number, sy: number, sz: number, q = Q0) => list.push({ p: new THREE.Vector3(x, y, z), q, s: new THREE.Vector3(sx, sy, sz) });
      const addDeck = (x0: number, x1: number, z0: number, z1: number, y: number, solid = false) => {
        decks.push({ x0, x1, z0, z1, y });
        if (solid) part(woodB, (x0 + x1) / 2, y / 2, (z0 + z1) / 2, x1 - x0, y, z1 - z0);
        else part(woodB, (x0 + x1) / 2, y - 0.13, (z0 + z1) / 2, x1 - x0, 0.26, z1 - z0);
      };
      const post = (x: number, z: number, top: number) => { part(woodB, x, top / 2, z, 0.28, top, 0.28); colliders.push({ x0: x - 0.14, x1: x + 0.14, z0: z - 0.14, z1: z + 0.14, hi: top - 0.2 }); };
      // a straight stair rising along x (axis 0) or z (axis 1) from `from` (height y0) to `to` (height y1)
      const addRamp = (x0: number, x1: number, z0: number, z1: number, axis: 0 | 1, from: number, to: number, y0: number, y1: number) => {
        ramps.push({ x0, x1, z0, z1, axis, from, to, y0, y1 });
        const n = Math.max(2, Math.ceil(Math.abs(y1 - y0) / 0.21)), step = (to - from) / n, across = axis === 0 ? z1 - z0 : x1 - x0;
        const cA = axis === 0 ? (z0 + z1) / 2 : (x0 + x1) / 2;
        for (let k = 0; k < n; k++) {
          const a = from + step * (k + 0.5), h = y0 + (y1 - y0) * ((k + 1) / n);
          if (axis === 0) part(woodB, a, h - 0.07, cA, Math.abs(step) + 0.03, 0.14, across); else part(woodB, cA, h - 0.07, a, across, 0.14, Math.abs(step) + 0.03);
        }
        // the two sloping sides
        const len = Math.hypot(to - from, y1 - y0), th = Math.atan2(y1 - y0, to - from);
        const q = new THREE.Quaternion().setFromAxisAngle(axis === 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), axis === 0 ? th : -th);
        for (const side of axis === 0 ? [z0, z1] : [x0, x1]) {
          const mid = (from + to) / 2, my = (y0 + y1) / 2 - 0.2;
          if (axis === 0) part(woodB, mid, my, side, len, 0.34, 0.08, q); else part(woodB, side, my, mid, 0.08, 0.34, len, q);
        }
        // nobody walks under the low end
        if (Math.min(y0, y1) < 0.5) {
          // (from where it is too high to step onto to where there is headroom under it)
          const lowAt = y0 < y1 ? from : to, highAt = y0 < y1 ? to : from, top = Math.max(y0, y1);
          // (pushed on by a body's width, so someone climbing the first steps isn't caught by it)
          const dirA = Math.sign(highAt - lowAt);
          const b = lowAt + (highAt - lowAt) * Math.min(1, (STEP_UP + 0.05) / top) + dirA * (BODY + 0.1), e = lowAt + (highAt - lowAt) * Math.min(1, 2 / top);
          const a0 = Math.min(b, e), a1 = Math.max(b, e);
          colliders.push(axis === 0 ? { x0: a0, x1: a1, z0, z1, hi: 0.3 } : { x0, x1, z0: a0, z1: a1, hi: 0.3 });
        }
      };
      // a railing along an axis-aligned line whose walking surface goes from ya to yb; lo is the lowest feet it stops
      const addRail = (xa: number, za: number, xb: number, zb: number, ya: number, yb: number, lo = Math.min(ya, yb) - 0.6) => {
        const len = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(len / 0.9));
        for (let k = 0; k <= n; k++) { const t = k / n; part(brassB, xa + (xb - xa) * t, ya + (yb - ya) * t + 0.45, za + (zb - za) * t, 0.05, 0.9, 0.05); }
        const dir = new THREE.Vector3(xb - xa, yb - ya, zb - za);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
        part(brassB, (xa + xb) / 2, (ya + yb) / 2 + 0.92, (za + zb) / 2, dir.length(), 0.06, 0.06, q);
        colliders.push({ x0: Math.min(xa, xb) - 0.05, x1: Math.max(xa, xb) + 0.05, z0: Math.min(za, zb) - 0.05, z1: Math.max(za, zb) + 0.05, lo: Math.max(0.35, lo), hi: Math.max(ya, yb) + 0.75 });
      };
      // a reading nook: an armchair, a little table with an open book, and a candle; ry is the way the chair faces
      const addNook = (x: number, z: number, y: number, ry: number) => {
        const q = new THREE.Quaternion().setFromAxisAngle(UP, ry);
        const at = (dx: number, dz: number) => new THREE.Vector3(dx, 0, dz).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
        const put = (list: Part[], dx: number, dy: number, dz: number, sx: number, sy: number, sz: number) => { const p = at(dx, dz); part(list, p.x, y + dy, p.z, sx, sy, sz, q); };
        put(clothB, 0, 0.24, 0, 0.8, 0.22, 0.75); put(clothB, 0, 0.62, -0.34, 0.8, 0.72, 0.16);
        put(clothB, -0.38, 0.42, 0, 0.12, 0.3, 0.72); put(clothB, 0.38, 0.42, 0, 0.12, 0.3, 0.72);
        put(woodB, 0, 0.07, 0, 0.72, 0.14, 0.68);
        put(woodB, 0.85, 0.3, 0.1, 0.46, 0.6, 0.46); put(clothB, 0.85, 0.63, 0.1, 0.36, 0.05, 0.26);
        const st = at(-0.75, -0.45); stands.push(new THREE.Vector3(st.x, y, st.z));
        const lo = y - 0.3, hi = y + 1.2;
        colliders.push({ x0: x - 0.45, x1: x + 0.45, z0: z - 0.45, z1: z + 0.45, lo, hi }); // the chair; the table is small enough to squeeze past
      };

      if (d === 0) {
        // the Reading Room: a tall hall with two galleries round it, bookcases down the middle, the stair tower
        // through an arch to the north, and the Curio Shop and the Duelling Ring on the south wall
        const ceil = new THREE.Mesh(holedRect(-R, R, -R, R, []), ceilMat); ceil.rotation.x = -Math.PI / 2; ceil.position.y = H0; g.add(ceil);
        const wallZ = (x0: number, x1: number, y0: number, y1: number, z: number, ry: number) => { const w = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), wallMat); w.position.set((x0 + x1) / 2, (y0 + y1) / 2, z); w.rotation.y = ry; g.add(w); };
        const wallX = (z0: number, z1: number, y0: number, y1: number, x: number, ry: number) => { const w = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, y1 - y0), wallMat); w.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2); w.rotation.y = ry; g.add(w); };
        wallZ(-R, -ARCH_W, 0, H0, -R, 0); wallZ(ARCH_W, R, 0, H0, -R, 0); wallZ(-ARCH_W, ARCH_W, ARCH_H, H0, -R, 0);
        const dl = doorW / 2;
        wallZ(-R, RING_X - dl, 0, H0, R, Math.PI); wallZ(RING_X + dl, SHOP_X - dl, 0, H0, R, Math.PI); wallZ(SHOP_X + dl, R, 0, H0, R, Math.PI);
        for (const x of [RING_X, SHOP_X]) wallZ(x - dl, x + dl, doorH, H0, R, Math.PI);
        wallX(-R, R, 0, H0, R, -Math.PI / 2); wallX(-R, R, 0, H0, -R, Math.PI / 2);
        // the stair tower: its own floor with the great stair's hole, walls lined low with books, and a high ceiling
        const T = TOWER;
        const tf = new THREE.Mesh(holedRect(T.x0, T.x1, T.z0, T.z1, [{ x: WELL.x, z: WELL.z, r: WELL_R }]), floorMat); tf.rotation.x = -Math.PI / 2; g.add(tf);
        const tc = new THREE.Mesh(holedRect(T.x0, T.x1, T.z0, T.z1, []), ceilMat); tc.rotation.x = -Math.PI / 2; tc.position.y = H0; g.add(tc);
        wallZ(T.x0, T.x1, 0, H0, T.z0, 0); wallX(T.z0, T.z1, 0, H0, T.x0, Math.PI / 2); wallX(T.z0, T.z1, 0, H0, T.x1, -Math.PI / 2);
        wallZ(T.x0, -ARCH_W, 0, H0, T.z1, Math.PI); wallZ(ARCH_W, T.x1, 0, H0, T.z1, Math.PI); wallZ(-ARCH_W, ARCH_W, ARCH_H, H0, T.z1, Math.PI);
        [-4.5, -1.5, 1.5, 4.5].forEach((x, i) => addFace(new THREE.Vector3(x, 0, T.z0 + 0.35), 0, 5, 3, true, 'tn' + i, 0, false));
        for (const [z, i] of [[-20.5, 0], [-11.5, 1]] as const) {
          addFace(new THREE.Vector3(T.x0 + 0.35, 0, z), Math.PI / 2, 5, 3, true, 'tw' + i, 0, false);
          addFace(new THREE.Vector3(T.x1 - 0.35, 0, z), -Math.PI / 2, 5, 3, true, 'te' + i, 0, false);
        }
        // the arch itself: two stone piers and a lintel
        for (const sx of [-1, 1]) { const pier = new THREE.Mesh(new THREE.BoxGeometry(0.7, ARCH_H, 0.9), stone); pier.position.set(sx * (ARCH_W + 0.2), ARCH_H / 2, -R); g.add(pier); }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * ARCH_W + 1.2, 0.6, 1.0), stone); lintel.position.set(0, ARCH_H + 0.3, -R); g.add(lintel);
        // books along the walls below the galleries (not over the doors, nor across the arch)
        [-7.5, -4.5, 4.5, 7.5].forEach((x, i) => addFace(new THREE.Vector3(x, 0, -R + 0.35), 0, 5, 3, true, 'n' + i, 0, false));
        for (const [x, w, i] of [[-8.85, 1.6, 0], [-3.4, 1.6, 1], [-1.3, 2.4, 2], [1.3, 2.4, 3], [3.4, 1.6, 4], [8.85, 1.6, 5]] as const) addFace(new THREE.Vector3(x, 0, R - 0.35), Math.PI, 5, w, true, 's' + i, 0, false);
        [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].forEach((z, i) => {
          addFace(new THREE.Vector3(R - 0.35, 0, z), -Math.PI / 2, 5, 3, true, 'e' + i, 0, false);
          addFace(new THREE.Vector3(-R + 0.35, 0, z), Math.PI / 2, 5, 3, true, 'w' + i, 0, false);
        });
        // the galleries: a walkway round all four walls on each, cased with books floor to ceiling
        for (const [ty, rows] of [[T1, Math.floor((T2 - 0.25 - T1 - 0.45) / 0.8)], [T2, Math.floor((H0 - T2 - 0.45) / 0.8)]] as const) {
          const G = 7.6;
          addDeck(-R, R, -R, -G, ty); addDeck(-R, R, G, R, ty); addDeck(G, R, -G, G, ty); addDeck(-R, -G, -G, G, ty);
          [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].forEach((x, i) => {
            addFace(new THREE.Vector3(x, ty, -R + 0.35), 0, rows, 3, true, `gn${ty}:${i}`, 0, false);
            addFace(new THREE.Vector3(-x, ty, R - 0.35), Math.PI, rows, 3, true, `gs${ty}:${i}`, 0, false);
          });
          [-4.5, -1.5, 1.5, 4.5].forEach((z, i) => {
            addFace(new THREE.Vector3(R - 0.35, ty, z), -Math.PI / 2, rows, 3, true, `ge${ty}:${i}`, 0, false);
            addFace(new THREE.Vector3(-R + 0.35, ty, -z), Math.PI / 2, rows, 3, true, `gw${ty}:${i}`, 0, false);
          });
          for (const [x, z] of [[-G - 0.15, -G - 0.15], [G + 0.15, -G - 0.15], [-G - 0.15, G + 0.15], [G + 0.15, G + 0.15], [-3.2, -G - 0.15], [3.2, -G - 0.15], [-3, G + 0.15], [3, G + 0.15]]) if (ty === T1) post(x, z, T2);
        }
        // a stair up each side wall, climbing south from the tower end, and a flight from the east gallery
        // along the south side up to the second
        for (const sx of [1, -1]) {
          const xi = sx * 6.2, xo = sx * 7.6, [xa, xb] = sx > 0 ? [6.2, 7.6] : [-7.6, -6.2];
          addRamp(xa, xb, -6.9, 0.7, 1, -6.9, 0.7, 0, T1);
          addDeck(xa, xb, 0.7, 2.1, T1); // the landing at the top
          addRail(xi, -6.9, xi, 0.7, 0, T1, 0.35);
          addRail(xo, -6.9, xo, 0.5, 0, T1 * 7.4 / 7.6, 0.35);
          addRail(xi, 0.7, xi, 2.1, T1, T1); addRail(xi, 2.1, xo, 2.1, T1, T1);
          addRail(xo, -7.6, xo, -6.9, T1, T1);
          addRail(xo, 2.3, xo, sx > 0 ? 6.2 : 7.6, T1, T1);
        }
        addRamp(-2.4, 7.6, 6.2, 7.6, 0, 7.6, -2.4, T1, T2);
        addDeck(-3.8, -2.4, 6.2, 7.6, T2);
        addRail(7.6, 6.2, -2.4, 6.2, T1, T2, T1 + 0.35); addRail(7.6, 7.6, -2.4, 7.6, T1, T2, T1 + 0.8);
        addRail(-3.8, 6.2, -2.4, 6.2, T2, T2); addRail(-3.8, 6.2, -3.8, 7.6, T2, T2);
        addRail(-7.6, -7.6, 7.6, -7.6, T1, T1); addRail(-7.6, 7.6, 7.6, 7.6, T1, T1);
        addRail(-7.6, -7.6, 7.6, -7.6, T2, T2); addRail(-7.6, 7.6, -3.8, 7.6, T2, T2); addRail(-2.2, 7.6, 7.6, 7.6, T2, T2);
        addRail(7.6, -7.6, 7.6, 7.6, T2, T2); addRail(-7.6, -7.6, -7.6, 7.6, T2, T2);
        // candles along both galleries, against the shelves
        for (const ty of [T1, T2]) for (const [x, z] of [[0, -9.1], [0, 9.1], [9.1, -3], [-9.1, -3], [9.1, 4], [-9.1, 4], [-4.5, 9.1], [4.5, -9.1]]) {
          stands.push(new THREE.Vector3(x, ty, z));
          colliders.push({ x0: x - 0.12, x1: x + 0.12, z0: z - 0.12, z1: z + 0.12, lo: ty - 0.4, hi: ty + 1.4 });
        }
        // reading nooks in the gallery corners, and candles in the tower
        addNook(9.0, -8.8, T1, 0.7); addNook(-9.0, -8.8, T1, -0.7);
        addNook(9.0, 8.8, T2, Math.PI + 0.7); addNook(-9.0, -8.8, T2, -0.7); addNook(9.0, -8.8, T2, 0.7);
        for (const [x, z] of [[-5.1, -21.1], [5.1, -21.1], [-5.1, -10.9], [5.1, -10.9]]) { stands.push(new THREE.Vector3(x, 0, z)); colliders.push({ x0: x - 0.2, x1: x + 0.2, z0: z - 0.2, z1: z + 0.2 }); }
        // chandeliers in the open middle, and banners hanging from the first gallery's rails
        for (const [x, y, z, sz] of [[0, 15.5, -1.5, 2.6], [-3.5, 13, 3, 1.6], [3.5, 13.5, -4.5, 1.6], [0, 14, -16, 2.2]] as const) {
          const c = glowSprite(L.flame, sz, 0.85); c.position.set(x, y, z); g.add(c);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(sz * 0.32, 0.04, 6, 24), brass); ring.rotation.x = Math.PI / 2; ring.position.set(x, y - 0.1, z); g.add(ring);
          const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, H0 - y, 4), iron); chain.position.set(x, (H0 + y) / 2, z); g.add(chain);
        }
        const bannerMat = (c1: string, c2: string) => {
          const [cv, cx] = canvas(128, 320);
          cx.fillStyle = c1; cx.fillRect(0, 0, 128, 320);
          cx.fillStyle = c2; cx.fillRect(10, 0, 8, 290); cx.fillRect(110, 0, 8, 290);
          cx.beginPath(); cx.moveTo(0, 290); cx.lineTo(64, 320); cx.lineTo(128, 290); cx.lineTo(128, 320); cx.lineTo(0, 320); cx.fillStyle = '#000'; cx.globalCompositeOperation = 'destination-out'; cx.fill(); cx.globalCompositeOperation = 'source-over';
          cx.strokeStyle = c2; cx.lineWidth = 6; cx.beginPath(); cx.arc(64, 120, 34, 0, Math.PI * 2); cx.stroke();
          cx.beginPath(); cx.moveTo(64, 80); cx.lineTo(64, 160); cx.moveTo(34, 120); cx.lineTo(94, 120); cx.stroke();
          const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
          return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
        };
        for (const [x, z, ry, c1, c2] of [[-4.5, -7.66, 0, '#5a1a24', '#c9a13b'], [4.5, -7.66, 0, '#1a2a5a', '#c9a13b'], [-1.5, -7.66, 0, '#1a4a3a', '#d8c890'], [1.5, -7.66, 0, '#4a1a5a', '#d8c890'], [7.66, 4.6, -Math.PI / 2, '#5a1a24', '#c9a13b'], [-7.66, 4.6, Math.PI / 2, '#1a2a5a', '#c9a13b']] as const) {
          const b = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.8), bannerMat(c1, c2)); b.position.set(x, T1 - 1.45, z); b.rotation.y = ry; g.add(b);
        }
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
          if (passing.some(sp => Math.abs(x - sp.x) < sp.sq && Math.abs(z - sp.z) < sp.sq)) { m4.makeScale(0.0001, 0.0001, 0.0001); ceilMesh.setMatrixAt(n++, m4); continue; }
          m4.makeTranslation(x, plan.ceil[k], z); ceilMesh.setMatrixAt(n++, m4);
        }
        g.add(ceilMesh);
        // where a stair comes down through the ceiling, a square of ceiling with a round hole in it
        for (const sp of passing) {
          const patch = new THREE.Mesh(holedRect(sp.x - sp.sq, sp.x + sp.sq, sp.z - sp.sq, sp.z + sp.sq, [{ x: sp.x, z: sp.z, r: sp.rHole }]), ceilMat);
          patch.rotation.x = -Math.PI / 2; patch.position.y = LH - sp.slab[d - 1 - sp.top] - 0.01; g.add(patch);
        }
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
        const hasSpiral = (rm: Room) => this.spirals.some(sp => !sp.main && sp.top <= d && d <= sp.bot && sp.x > (rm.ix0 - N / 2) * C - 5 && sp.x < (rm.ix1 - N / 2) * C + 5 && sp.z > (rm.iz0 - N / 2) * C - 5 && sp.z < (rm.iz1 - N / 2) * C + 5);
        // the tall rooms that get a balcony along one long wall, reached by a stair
        const mrng = mulberry32(313 + d * 53);
        const mezz = new Map<number, { alongX: boolean; wall: number; into: number }>();
        for (const rm of plan.rooms) {
          if (!(rm.kind === 'gallery' || rm.kind === 'room') || plan.shops.includes(rm.id) || rm.ceil < 6.2 || hasSpiral(rm)) continue;
          const w = (rm.ix1 - rm.ix0) * C, dd = (rm.iz1 - rm.iz0) * C;
          if (Math.max(w, dd) < 12 || Math.min(w, dd) < 6) continue;
          if (mrng() > (rm.kind === 'gallery' ? 0.8 : 0.55)) continue;
          const alongX = w >= dd, side = mrng() < 0.5;
          const lo = ((alongX ? rm.iz0 : rm.ix0) - N / 2) * C, hi = ((alongX ? rm.iz1 : rm.ix1) - N / 2) * C;
          mezz.set(rm.id, { alongX, wall: side ? lo : hi, into: side ? 1 : -1 });
        }
        // bookcases along the walls: 1.6 wide, as tall as the ceiling allows (or the balcony above them)
        plan.edges.forEach((e, i) => {
          if (!e.shelf || e.ceil < 2.2) return;
          let rows = Math.max(1, Math.min(5, Math.floor((e.ceil - 0.45) / 0.8)));
          const M = mezz.get(e.room);
          if (M && (M.alongX ? e.nz === M.into && Math.abs(e.z - M.wall) < 0.01 : e.nx === M.into && Math.abs(e.x - M.wall) < 0.01)) rows = Math.min(rows, 3);
          const c = new THREE.Vector3(e.x + e.nx * 0.35, 0, e.z + e.nz * 0.35);
          addFace(c, Math.atan2(e.nx, e.nz), rows, 1.6, true, 'w' + i, e.room, e.kind === 'nook');
          // the case itself stands in the way
          const tx = Math.abs(e.nz) * 0.85, tz = Math.abs(e.nx) * 0.85;
          const ox = e.x + e.nx * 0.31, oz = e.z + e.nz * 0.31;
          colliders.push({ x0: ox - tx - Math.abs(e.nx) * 0.31, x1: ox + tx + Math.abs(e.nx) * 0.31, z0: oz - tz - Math.abs(e.nz) * 0.31, z1: oz + tz + Math.abs(e.nz) * 0.31 });
        });
        // free-standing cases in the bigger rooms, a candle stand in most rooms, and heaps of loose books
        // in the hidden rooms, the alcoves and the far wings
        const frng = mulberry32(555 + d * 71);
        plan.rooms.forEach(rm => {
          if (rm.kind === 'hall' || rm.kind === 'corridor' || rm.kind === 'crawl') return;
          const x0 = (rm.ix0 - N / 2) * C, x1 = (rm.ix1 - N / 2) * C, z0 = (rm.iz0 - N / 2) * C, z1 = (rm.iz1 - N / 2) * C;
          const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          const far = Math.min(1, Math.hypot(mx - WELL.x, mz - WELL.z) / Math.max(20, plan.half));
          if (rm.kind === 'nook') {
            // a single candle on the floor at the back of the alcove, and sometimes a heap beside it
            const f = glowSprite(L.flame, 0.3); f.position.set(mx, 0.25, mz); g.add(f);
            if (frng() < 0.25 + far * 0.4) addPile(mx + (frng() - 0.5) * 0.6, mz + (frng() - 0.5) * 0.6, rm.id, frng);
            return;
          }
          if (plan.shops.includes(rm.id)) return; // the shopkeeper furnishes it
          const w = x1 - x0, dd = z1 - z0;
          if (rm.kind === 'hidden') {
            const n = 2 + Math.floor(frng() * 3);
            for (let k = 0; k < n; k++) addPile(x0 + 1 + frng() * (w - 2), z0 + 1 + frng() * (dd - 2), rm.id, frng);
            const f = glowSprite(L.flame, 0.3); f.position.set(mx, 0.25, mz); g.add(f);
            return;
          }
          let M = mezz.get(rm.id);
          // the stair's low end must not sit in front of a doorway in that wall; try both ends
          let up = frng() < 0.5;
          if (M) {
            const m = M, top0 = 3.4, [p0, p1] = m.alongX ? [x0, x1] : [z0, z1];
            const blocked = (fromLow: boolean) => {
              const s0 = fromLow ? p0 : p1 - (2 / top0) * (top0 / 0.6) - 1.2, s1 = fromLow ? p0 + (2 / top0) * (top0 / 0.6) + 1.2 : p1;
              for (let a = s0 + 0.2; a < s1; a += 0.5) {
                const [ox, oz] = m.alongX ? [a, m.wall - m.into * 0.5] : [m.wall - m.into * 0.5, a];
                const cix = Math.floor(ox / C + N / 2), ciz = Math.floor(oz / C + N / 2);
                if (cix >= 0 && ciz >= 0 && cix < N && ciz < N && plan.walk[ciz * N + cix]) return true;
              }
              return false;
            };
            if (blocked(up)) up = !up;
            if (blocked(up)) M = undefined;
          }
          if (M) {
            // a balcony along the wall: a stair up from one end, the deck on to the other, books above it
            const top = 3.4, Lr = top / 0.6;
            const [a0, a1] = M.alongX ? [x0, x1] : [z0, z1];
            const bA = M.wall + M.into * 0.45, bB = M.wall + M.into * 2.35, bl = Math.min(bA, bB), bh = Math.max(bA, bB);
            const rs = up ? a0 + 0.4 : a1 - 0.4, re = up ? rs + Lr : rs - Lr, de = up ? a1 - 0.3 : a0 + 0.3, dir = up ? 1 : -1;
            const rect = (p: number, q: number): [number, number, number, number] => M.alongX ? [Math.min(p, q), Math.max(p, q), bl, bh] : [bl, bh, Math.min(p, q), Math.max(p, q)];
            const at = (a: number, b: number): [number, number] => M.alongX ? [a, b] : [b, a];
            addRamp(...rect(rs, re), M.alongX ? 0 : 1, rs, re, 0, top);
            addDeck(...rect(re, de), top);
            addRail(...at(rs, bB), ...at(re, bB), 0, top, 0.35);
            addRail(...at(re, bB), ...at(de, bB), top, top);
            for (let a = re + dir * 1.2; (de - a) * dir > 0.5; a += dir * 3.4) post(...at(a, M.wall + M.into * 2.2), top);
            const ry = M.alongX ? (M.into > 0 ? 0 : Math.PI) : (M.into > 0 ? Math.PI / 2 : -Math.PI / 2);
            const rowsUp = Math.min(3, Math.floor((rm.ceil - top - 0.45) / 0.8));
            for (let a = Math.min(re, de) + 0.2; a + 1.6 <= Math.max(re, de) - 1.6; a += 1.8) {
              const [ox, oz] = at(a + 0.8, M.wall - M.into * 0.5);
              const cix = Math.floor(ox / C + N / 2), ciz = Math.floor(oz / C + N / 2);
              if (rowsUp < 1 || (cix >= 0 && ciz >= 0 && cix < N && ciz < N && plan.walk[ciz * N + cix])) continue; // no wall behind: an opening
              const [cx, cz] = at(a + 0.8, M.wall + M.into * 0.35);
              addFace(new THREE.Vector3(cx, top, cz), ry, rowsUp, 1.6, true, `mz${rm.id}:${a.toFixed(1)}`, rm.id, false);
            }
            const [nx, nz] = at(de - dir * 0.8, M.wall + M.into * 1.3);
            addNook(nx, nz, top, ry + (frng() - 0.5) * 0.6);
          } else if (w >= 6 && dd >= 6 && frng() < 0.6) {
            const rows = Math.max(1, Math.min(4, Math.floor((rm.ceil - 0.45) / 0.8)));
            const alongX = w >= dd;
            const [a0, a1, b0, b1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
            for (let b = b0 + 2.3; b <= b1 - 2.3; b += 3) for (let a = a0 + 2.1; a + 1.6 <= a1 - 2.1 + 0.01; a += 1.9) {
              if (frng() < 0.12 + far * 0.15) continue; // a gap, now and then, and more of them further out
              const cx = alongX ? a + 0.8 : b, cz = alongX ? b : a + 0.8;
              // far out, the rows stop keeping straight
              const ry = (alongX ? 0 : Math.PI / 2) + (far > 0.55 && d >= 3 ? (frng() - 0.5) * far * 0.5 : 0);
              const off = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.33);
              addFace(new THREE.Vector3(cx, 0, cz).add(off), ry, rows, 1.6, false, `f${rm.id}:${a.toFixed(1)}:${b.toFixed(1)}`, rm.id, false);
              addFace(new THREE.Vector3(cx, 0, cz).sub(off), ry + Math.PI, rows, 1.6, false, `f${rm.id}:${a.toFixed(1)}:${b.toFixed(1)}`, rm.id, false);
              colliders.push(alongX ? { x0: cx - 0.9, x1: cx + 0.9, z0: cz - 0.55, z1: cz + 0.55 } : { x0: cx - 0.55, x1: cx + 0.55, z0: cz - 0.9, z1: cz + 0.9 });
            }
          } else if (w >= 7 && dd >= 7 && !hasSpiral(rm) && frng() < 0.5) {
            // a raised reading platform in the middle of the room, with an armchair and a heap of books
            const hx = Math.min(2.6, w / 2 - 1.7), hz = Math.min(2.6, dd / 2 - 1.7);
            addDeck(mx - hx, mx + hx, mz - hz, mz + hz, 0.42, true);
            addNook(mx - hx * 0.35, mz, 0.42, frng() * Math.PI * 2);
            addPile(mx + hx * 0.5, mz + (frng() - 0.5) * hz, rm.id, frng, 0.42);
          } else if (w * dd >= 16 && frng() < far * 0.7) {
            addPile(x0 + 1.2 + frng() * (w - 2.4), z0 + 1.2 + frng() * (dd - 2.4), rm.id, frng);
          }
          if (!M && w * dd >= 16 && frng() < 0.85) {
            const sx = x0 + 1.15 + (frng() < 0.5 ? 0 : w - 2.3), sz = z0 + 1.15 + (frng() < 0.5 ? 0 : dd - 2.3);
            stands.push(new THREE.Vector3(sx, 0, sz));
            colliders.push({ x0: sx - 0.25, x1: sx + 0.25, z0: sz - 0.25, z1: sz + 0.25 });
          }
        });
      }
      // the hall is the same on every floor: two rows of free-standing cases down the middle and six candle stands
      HALL_ROWS.forEach(([x, z], i) => {
        addFace(new THREE.Vector3(x, 0, z + 0.33), 0, 4, 2.6, false, 'h' + i, 0, false);
        addFace(new THREE.Vector3(x, 0, z - 0.33), Math.PI, 4, 2.6, false, 'h' + i, 0, false);
        colliders.push({ x0: x - 1.3, x1: x + 1.3, z0: z - 0.5, z1: z + 0.5, hi: 3.5 });
      });
      // the bookcase that winds down the stair: the stretch of it that passes through this floor's room
      // (and pokes up round the hole above), a flat case per step of the turn
      if (d > 0) {
        const perTurn = 20, rc = STAIR_OUT - 0.02, chord = 2 * rc * Math.sin(Math.PI / perTurn) + 0.04;
        for (let k = 0; k < perTurn; k++) {
          const base = ((k + 0.5) / perTurn) * Math.PI * 2;
          if (base < CASE_GAP || base > Math.PI * 2 - CASE_GAP) continue; // open at the landing
          const y = LH - (base / (Math.PI * 2)) * PITCH; // above this floor, coming down from the one above
          const a = A0 + base;
          const c = new THREE.Vector3(WELL.x + Math.cos(a) * rc, y, WELL.z + Math.sin(a) * rc);
          addFace(c, Math.atan2(-Math.cos(a), -Math.sin(a)), 3, chord, true, 'sp' + k, 0, false);
        }
      }
      HALL_CANDLES.forEach(([x, z]) => { stands.push(new THREE.Vector3(x, 0, z)); colliders.push({ x0: x - 0.25, x1: x + 0.25, z0: z - 0.25, z1: z + 0.25, hi: 1.6 }); });

      // clear the floor round the smaller stairs
      for (let i = faces.length - 1; i >= 0; i--) if (!faces[i].unit.startsWith('sp') && nearSpiral(faces[i].c.x, faces[i].c.z, 0.9)) faces.splice(i, 1);
      for (let i = colliders.length - 1; i >= 0; i--) { const b = colliders[i]; if (nearSpiral((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0.9)) colliders.splice(i, 1); }
      for (let i = stands.length - 1; i >= 0; i--) if (nearSpiral(stands[i].x, stands[i].z, 0.9)) stands.splice(i, 1);
      // group the cases into square blocks; each block draws its own books and woodwork
      const secKey = (c: THREE.Vector3) => `${Math.floor(c.x / SECTOR)},${Math.floor(c.z / SECTOR)}`;
      const secOf: Record<string, number> = {};
      const secParts: { cx: number; cz: number; wood: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[]; ids: number[] }[] = [];
      const faceSec = faces.map(f => {
        const k = secKey(f.c);
        if (secOf[k] === undefined) { secOf[k] = secParts.length; secParts.push({ cx: (Math.floor(f.c.x / SECTOR) + 0.5) * SECTOR, cz: (Math.floor(f.c.z / SECTOR) + 0.5) * SECTOR, wood: [], ids: [] }); }
        return secOf[k];
      });
      // shelves: planks, sides, tops and backs
      const done: Record<string, boolean> = {};
      const fullFaces: Face[] = faces.map((f, fi) => {
        const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.ry);
        const tan = new THREE.Vector3(1, 0, 0).applyQuaternion(rot), nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
        if (f.pile) return { ...f, tan, nrm, rot };
        const woodParts = secParts[faceSec[fi]].wood;
        const topY = f.rows * 0.8 + 0.2, W = f.width;
        for (let r = 0; r <= f.rows; r++) woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, 0.1 + r * 0.8, 0)).addScaledVector(nrm, 0.18), q: rot, s: new THREE.Vector3(W, 0.06, 0.38) });
        for (const sx2 of [-W / 2, W / 2]) woodParts.push({ p: f.c.clone().addScaledVector(tan, sx2).add(new THREE.Vector3(0, topY / 2, 0)).addScaledVector(nrm, 0.18), q: rot, s: new THREE.Vector3(0.1, topY, 0.42) });
        woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, topY + 0.08, 0)).addScaledVector(nrm, 0.2), q: rot, s: new THREE.Vector3(W + 0.2, 0.16, 0.48) });
        if (!done[f.unit]) { done[f.unit] = true; woodParts.push({ p: f.c.clone().add(new THREE.Vector3(0, topY / 2, 0)).addScaledVector(nrm, f.wall ? -0.02 : -0.33), q: rot, s: new THREE.Vector3(W, topY, 0.04) }); }
        return { ...f, tan, nrm, rot };
      });
      const srng = mulberry32(99 + d * 1009);
      const slots: Slot[] = [];
      fullFaces.forEach((f, fi) => {
        const sec = secParts[faceSec[fi]];
        if (f.pile) {
          // stacks of books lying flat, a little askew
          for (let r = 0; r < f.rows; r++) {
            const n = 4 + Math.floor(srng() * 9), sx = (r - (f.rows - 1) / 2) * 0.46, dz = (srng() - 0.5) * 0.2;
            let y = 0;
            for (let k = 0; k < n; k++) {
              const w = 0.05 + srng() * 0.07;
              sec.ids.push(slots.length);
              slots.push({ face: fi, row: r, x: sx + (srng() - 0.5) * 0.06, w, h: 0.3 + srng() * 0.16, lean: 0, y, yaw: (srng() - 0.5) * 0.9, dz });
              y += w;
            }
          }
          return;
        }
        const lim = f.width / 2 - 0.08;
        for (let r = 0; r < f.rows; r++) {
          let x = -lim;
          for (;;) {
            const w = 0.05 + srng() * 0.08;
            if (x + w > lim) break;
            const h = 0.36 + srng() * 0.3;
            sec.ids.push(slots.length);
            slots.push({ face: fi, row: r, x: x + w / 2, w, h, lean: srng() < 0.04 ? (srng() - 0.5) * 0.3 : 0 });
            x += w + 0.004 + (srng() < 0.03 ? 0.08 : 0);
          }
        }
      });
      const bookMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.spineTex, roughness: 0.75, emissive: new THREE.Color(d === DEEPEST ? '#1c1c20' : '#000000') });
      const boxGeo = new THREE.BoxGeometry(1, 1, 1);
      const secs: Sector[] = secParts.map(sp => {
        const mesh = new THREE.InstancedMesh(boxGeo, bookMat, Math.max(1, sp.ids.length));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0; // filled in when the floor is first laid out
        S.add(mesh);
        let wood: THREE.InstancedMesh | null = null;
        if (sp.wood.length) {
          wood = new THREE.InstancedMesh(boxGeo, woodMat, sp.wood.length);
          const m4 = new THREE.Matrix4(); sp.wood.forEach((w, i) => { m4.compose(w.p, w.q, w.s); wood!.setMatrixAt(i, m4); });
          wood.computeBoundingSphere(); g.add(wood);
        }
        return { cx: sp.cx, cz: sp.cz, ids: sp.ids, mesh, wood };
      });
      const bandMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: '#8a8a92', metalness: 0.9, roughness: 0.35 }), 600);
      bandMesh.count = 0; S.add(bandMesh);
      // the shopkeepers' rooms on this floor
      const shopStands = new Set<number>();
      STALLS.filter(sd => sd.d === d).forEach((sd, si) => {
        if (plan.shops[si] === undefined) return;
        const rm = plan.rooms[plan.shops[si]], N = plan.N;
        let mx = ((rm.ix0 + rm.ix1) / 2 - N / 2) * C, mz = ((rm.iz0 + rm.iz1) / 2 - N / 2) * C;
        // the stall faces the way in, which is roughly back towards the stair
        // (along the room's long side, so there is space in front of the table)
        const tx = WELL.x - mx, tz = WELL.z - mz, longX = rm.ix1 - rm.ix0 > rm.iz1 - rm.iz0;
        const ry = longX ? (tx > 0 ? Math.PI / 2 : -Math.PI / 2) : (tz > 0 ? 0 : Math.PI);
        // and the table stands back from the middle, towards the far wall
        const back = ((longX ? rm.ix1 - rm.ix0 : rm.iz1 - rm.iz0) * C) / 2 - 2.2;
        mx -= Math.sin(ry) * Math.max(0, back); mz -= Math.cos(ry) * Math.max(0, back);
        const st = new Stall(sd);
        st.group.position.set(mx, 0, mz); st.group.rotation.y = ry; g.add(st.group);
        this.stalls[sd.key] = st;
        const fw = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), side = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
        // the table and the keeper behind it
        const pts = [fw.clone().multiplyScalar(0.4).addScaledVector(side, 2.0), fw.clone().multiplyScalar(0.4).addScaledVector(side, -2.0), fw.clone().multiplyScalar(-1.6).addScaledVector(side, 2.0), fw.clone().multiplyScalar(-1.6).addScaledVector(side, -2.0)];
        colliders.push({ x0: mx + Math.min(...pts.map(p => p.x)), x1: mx + Math.max(...pts.map(p => p.x)), z0: mz + Math.min(...pts.map(p => p.z)), z1: mz + Math.max(...pts.map(p => p.z)) });
        shopStands.add(stands.length);
        stands.push(new THREE.Vector3(mx, 0, mz).addScaledVector(fw, 2.4)); // lights the room from in front, not the keeper's face
      });
      // candle stands, all drawn at once
      const wax = new THREE.MeshStandardMaterial({ color: '#eae0c2', emissive: new THREE.Color('#332a18'), roughness: 0.6 });
      const flames: THREE.Sprite[] = [];
      {
        const bare = stands.filter((_, i) => !shopStands.has(i)); // a shop's lamp is its own
        const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.14, 1.3, 8), iron, Math.max(1, bare.length));
        const wicks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), wax, Math.max(1, bare.length * 3));
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
        bare.forEach((s, i) => {
          m4.makeTranslation(s.x, s.y + 0.65, s.z); poles.setMatrixAt(i, m4);
          [-0.12, 0, 0.12].forEach((dx, k) => {
            const hh = 0.22 + Math.abs(dx);
            m4.compose(new THREE.Vector3(s.x + dx, s.y + 1.31 + hh / 2, s.z), q, new THREE.Vector3(1, hh, 1)); wicks.setMatrixAt(i * 3 + k, m4);
            const flame = glowSprite(L.flame, 0.4); flame.position.set(s.x + dx, s.y + 1.62 + Math.abs(dx), s.z); g.add(flame); flames.push(flame);
          });
        });
        poles.count = bare.length; wicks.count = bare.length * 3;
        poles.computeBoundingSphere(); wicks.computeBoundingSphere();
        g.add(poles, wicks);
      }
      // the decks, stairs, rails and armchairs
      for (const [list, mat] of [[woodB, woodMat], [brassB, brass], [clothB, clothMat]] as const) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length), m4 = new THREE.Matrix4();
        list.forEach((b, i) => { m4.compose(b.p, b.q, b.s); im.setMatrixAt(i, m4); });
        im.computeBoundingSphere(); g.add(im);
      }
      // beams across the hall
      for (let i = -3; i <= 3; i++) { const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * R, 0.4, 0.35), woodMat); beam.position.set(0, (d === 0 ? H0 : H) - 0.2, i * 3); g.add(beam); }
      // each stair as it passes this floor: a stone rim and a brass rail round the hole (open at the landing),
      // and the shaft down through the slab; the smaller stairs get a rail round their foot as well
      for (const sp of this.spirals) {
        const hole = sp.top <= d && d < sp.bot, foot = !sp.main && d === sp.bot;
        if (!hole && !foot) continue;
        const wg = new THREE.Group(); wg.position.set(sp.x, 0, sp.z); g.add(wg);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(sp.rHole + 0.02, sp.main ? 0.1 : 0.07, 8, 56), stone); rim.rotation.x = Math.PI / 2; rim.position.y = 0.03; wg.add(rim);
        const gap = sp.gap, nPost = sp.main ? 36 : 16;
        for (let k = 0; k < nPost; k++) {
          const a = (k / nPost) * Math.PI * 2;
          if (Math.abs(Math.atan2(Math.sin(a - sp.a0), Math.cos(a - sp.a0))) < gap) continue;
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.8, 6), brass); p.position.set(Math.cos(a) * (sp.rHole + 0.05), 0.4, Math.sin(a) * (sp.rHole + 0.05)); wg.add(p);
        }
        const railG = new THREE.Group(); railG.rotation.y = gap - sp.a0; railG.position.y = 0.8; wg.add(railG);
        const rail = new THREE.Mesh(new THREE.TorusGeometry(sp.rHole + 0.05, 0.03, 6, 56, Math.PI * 2 - gap * 2), brass); rail.rotation.x = -Math.PI / 2; railG.add(rail);
        if (hole) {
          const h = sp.slab[d - sp.top];
          const slab = new THREE.Mesh(new THREE.CylinderGeometry(sp.rHole, sp.rHole, h, 40, 1, true), new THREE.MeshStandardMaterial({ map: shaftTex, color: L.wall, roughness: 1, side: THREE.BackSide }));
          slab.position.y = -h / 2; wg.add(slab);
          if (sp.main) { const glow = glowSprite(LEVELS[d + 1].flame, 4, 0.25); glow.position.y = -LH * 0.6; wg.add(glow); }
        }
      }
      this.floors.push({ d, y0: -d * LH, plan, group: g, faces: fullFaces, slots, colliders, stands, decks, ramps, books: [], secs, bandMesh, glows: [], flames, taken: {}, laid: '' });
    }

    // ---- the stairs: helixes of steps, the great one from the Reading Room's tower to the bottom
    for (const sp of this.spirals) {
      const perTurn = sp.main ? 40 : 24;
      const total = Math.round(((sp.bot - sp.top) * LH / sp.pitch) * perTurn);
      const tread = 2 * sp.rOut * Math.sin(Math.PI / perTurn) + 0.06;
      const stepMat = sp.main ? new THREE.MeshStandardMaterial({ map: fs.map, normalMap: fs.normal, color: '#8a8290', roughness: 0.9 }) : new THREE.MeshStandardMaterial({ color: '#6a6070', roughness: 0.9, flatShading: true });
      const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(sp.rOut - sp.rIn, sp.main ? 0.3 : 0.2, tread).translate(0, sp.main ? -0.08 : -0.05, 0), stepMat, total + 1);
      const lip = sp.main ? new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.36, tread * 0.62), brass, total + 1) : null;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), rmid = (sp.rIn + sp.rOut) / 2, y0 = -sp.top * LH;
      for (let k = 0; k <= total; k++) {
        const phi = (k / perTurn) * Math.PI * 2, a = sp.a0 + phi, y = y0 - (phi / (Math.PI * 2)) * sp.pitch;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        m4.compose(new THREE.Vector3(sp.x + Math.cos(a) * rmid, y - 0.07, sp.z + Math.sin(a) * rmid), q, new THREE.Vector3(1, 1, 1)); steps.setMatrixAt(k, m4);
        if (lip) { m4.compose(new THREE.Vector3(sp.x + Math.cos(a) * sp.rIn, y + 0.1, sp.z + Math.sin(a) * sp.rIn), q, new THREE.Vector3(1, 1, 1)); lip.setMatrixAt(k, m4); }
      }
      steps.computeBoundingSphere(); S.add(steps);
      if (lip) { lip.computeBoundingSphere(); S.add(lip); }
      // the smaller stairs wind round a stone column
      if (!sp.main) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(sp.rIn - 0.02, sp.rIn + 0.04, LH * (sp.bot - sp.top) + 1, 12), stone);
        col.position.set(sp.x, y0 - LH * (sp.bot - sp.top) / 2 + 0.5, sp.z); S.add(col);
      }
    }

    // ---- the Reading Room's own things: doorways, rugs, the desk
    const L0 = this.floors[0].group;
    const wood0 = new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.8 });
    const rugMat = new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.4), rugMat); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, 4.9); L0.add(rug);
    const aisle = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 8.6), rugMat); aisle.rotation.x = -Math.PI / 2; aisle.position.set(0, 0.011, -3.4); L0.add(aisle);
    for (const x of [SHOP_X, RING_X]) { const r2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), rugMat); r2.rotation.x = -Math.PI / 2; r2.position.set(x, 0.013, R - 2); L0.add(r2); }
    // the shop's door: a wooden frame and a painted sign
    for (const x of [SHOP_X - doorW / 2 - 0.15, SHOP_X + doorW / 2 + 0.15]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, doorH, 0.4), wood0); post.position.set(x, doorH / 2, R - 0.1); L0.add(post); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.7, 0.4, 0.45), wood0); lintel.position.set(SHOP_X, doorH + 0.2, R - 0.1); L0.add(lintel);
    const signTex = signTexture(['Curios & Oddments'], { bg: '#2a1a12', border: '#c9a13b', ink: '#f1d98a' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: signTex, emissive: new THREE.Color('#ffd080'), emissiveIntensity: 0.25, emissiveMap: signTex }));
    sign.position.set(SHOP_X, doorH + 0.9, R - 0.45); sign.rotation.y = Math.PI; L0.add(sign);
    // potted ferns and wall lanterns either side of both doorways, and a globe and a candelabrum by the desk
    const pot = new THREE.MeshStandardMaterial({ color: '#8a4a2a', roughness: 0.9 });
    const fern = new THREE.MeshStandardMaterial({ color: '#3a6a2a', roughness: 0.9, side: THREE.DoubleSide });
    for (const x of [SHOP_X - 2.3, SHOP_X + 2.3, RING_X - 2.3, RING_X + 2.3]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.6, 12), pot); p.position.set(x, 0.3, R - 0.8); L0.add(p);
      for (let k = 0; k < 7; k++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 5), fern);
        const a = (k / 7) * Math.PI * 2; leaf.position.set(x + Math.cos(a) * 0.15, 0.95, R - 0.8 + Math.sin(a) * 0.15); leaf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); L0.add(leaf);
      }
      this.floors[0].colliders.push({ x0: x - 0.35, x1: x + 0.35, z0: R - 1.15, z1: R - 0.45, hi: 1.5 });
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2018', metalness: 0.8, roughness: 0.4, wireframe: true }));
      const door = x > 0 ? SHOP_X : RING_X; lamp.position.set(x + (x > door ? -0.5 : 0.5), 3.3, R - 0.25); L0.add(lamp);
      const lg = glowSprite('#ffb060', 1.1, 0.9); lg.position.copy(lamp.position); L0.add(lg);
    }
    const globe = new THREE.Group(); globe.position.set(3.1, 0, 8.9); L0.add(globe);
    globe.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.3, 1.0, 10), wood0).translateY(0.5));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshStandardMaterial({ map: parchmentTex(), color: '#6a8aa0', roughness: 0.6 })); orb.position.y = 1.45; orb.rotation.z = 0.4; globe.add(orb);
    const mer = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.025, 6, 32), brass); mer.position.y = 1.45; mer.rotation.y = Math.PI / 2; mer.rotation.x = 0.4; globe.add(mer);
    this.floors[0].colliders.push({ x0: 2.8, x1: 3.4, z0: 8.6, z1: 9.2, hi: 1.5 });
    const cand = new THREE.Group(); cand.position.set(-3.1, 0, 8.9); L0.add(cand);
    cand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 2.0, 8), brass).translateY(1.0));
    for (const [dx, dy] of [[-0.35, 2.05], [0, 2.2], [0.35, 2.05]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 8), new THREE.MeshStandardMaterial({ color: '#eae0c2', emissive: new THREE.Color('#332a18') })); c.position.set(dx, dy, 0); cand.add(c); const f = glowSprite('#ffb05a', 0.4); f.position.set(dx, dy + 0.22, 0); cand.add(f); }
    this.floors[0].colliders.push({ x0: -3.4, x1: -2.8, z0: 8.6, z1: 9.2, hi: 1.5 });
    // the Duelling Ring's arch
    for (const x of [RING_X - doorW / 2 - 0.25, RING_X + doorW / 2 + 0.25]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, doorH, 0.6), stone); pillar.position.set(x, doorH / 2, R - 0.1); L0.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.25, 0.75), stone); cap.position.set(x, 0.12, R - 0.1); L0.add(cap);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(doorW / 2 + 0.25, 0.28, 6, 18, Math.PI), stone);
    arch.position.set(RING_X, doorH, R - 0.1); L0.add(arch);
    this.arenaRunes = new THREE.MeshBasicMaterial({ color: '#7fe0d0', transparent: true, opacity: 0.8 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      const rune = new THREE.Mesh(new THREE.CircleGeometry(0.09, 3 + (i % 3)), this.arenaRunes);
      rune.position.set(RING_X + Math.cos(a) * (doorW / 2 + 0.25), doorH + Math.sin(a) * (doorW / 2 + 0.25), R - 0.42); rune.rotation.y = Math.PI; L0.add(rune);
    }
    for (const x of [RING_X - doorW / 2 - 0.25, RING_X + doorW / 2 + 0.25]) for (let k = 0; k < 4; k++) {
      const rune = new THREE.Mesh(new THREE.CircleGeometry(0.08, 3 + k), this.arenaRunes);
      rune.position.set(x, 0.8 + k * 0.9, R - 0.42); rune.rotation.y = Math.PI; L0.add(rune);
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
    this.arena.position.set(RING_X, (doorH + 1.0) / 2, R + 0.3); this.arena.rotation.y = Math.PI; L0.add(this.arena);
    this.arenaGlow = glowSprite('#7fe0d0', 6, 0.3); this.arenaGlow.position.set(RING_X, 2.2, R - 0.3); L0.add(this.arenaGlow);
    this.arenaLight = new THREE.PointLight('#8ac8ff', 26, 12, 1.6); this.arenaLight.position.set(RING_X, 2.6, R - 1.3); S.add(this.arenaLight);
    {
      const t = signTexture(['The Duelling Ring'], { bg: '#1c1826', border: '#7fe0d0', ink: '#d8fff6' });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color('#9fe3d6'), emissiveIntensity: 0.35, emissiveMap: t }));
      plate.position.set(RING_X, doorH + 1.35, R - 0.45); plate.rotation.y = Math.PI; L0.add(plate);
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
    n = Math.round(n * P.N / 44); // bigger floors, more of everything
    // rooms further from the stair are likelier to be picked, so the strangeness thickens as you go out
    const rooms = P.rooms.filter(r => r.kind !== 'corridor' && r.kind !== 'crawl' && !P.shops.includes(r.id));
    const wts = rooms.map(rm => 0.35 + Math.hypot((rm.ix0 + rm.ix1) / 2 - P.N / 2, (rm.iz0 + rm.iz1) / 2 - P.N / 2) / (P.N / 2));
    const total = wts.reduce((a, b) => a + b, 0);
    for (let k = 0; k < n * 4 && out.length < n; k++) {
      let t = rng() * total, ri = 0;
      while (ri < rooms.length - 1 && (t -= wts[ri]) > 0) ri++;
      const rm = rooms[ri];
      const x = ((rm.ix0 + rng() * (rm.ix1 - rm.ix0)) - P.N / 2) * C, z = ((rm.iz0 + rng() * (rm.iz1 - rm.iz0)) - P.N / 2) * C;
      if (this.spirals.some(sp => sp.top <= d && d <= sp.bot && Math.hypot(x - sp.x, z - sp.z) < sp.rHole + 1.2)) continue;
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
      const piles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: leatherTex([255, 255, 255]), roughness: 0.9 }), 400);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      let n = 0;
      for (const [x, z] of spots) {
        let y = 0;
        const k = 4 + Math.floor(rng() * 6);
        for (let j = 0; j < k && n < 400; j++, n++) {
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
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6), bone, 500);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      let n = 0;
      for (const [x, z] of this.spots(2, rng, 30)) {
        skull(x, 0, z, r(0, 6), r(0.9, 1.3));
        for (let j = 0; j < 8 && n < 500; j++, n++) { q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, r(0, 6), 'YXZ')); m4.compose(new THREE.Vector3(x + r(-0.6, 0.6), 0.04, z + r(-0.6, 0.6)), q, new THREE.Vector3(1, r(0.7, 1.2), 1)); bones.setMatrixAt(n, m4); }
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
      const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap, 700);
      const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.03, 1, 5), stem, 700);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      let n = 0;
      for (const [x, z] of this.spots(3, rng, 60)) for (let j = 0; j < 6 && n < 700; j++, n++) {
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
      const hw = this.floors[4].plan.half;
      const water = new THREE.Mesh(holedRect(-hw, hw, -hw, hw, this.spirals.filter(sp => sp.top <= 4 && 4 < sp.bot).map(sp => ({ x: sp.x, z: sp.z, r: sp.rHole + 0.12 }))), this.water); water.rotation.x = -Math.PI / 2; water.position.y = 0.32; g.add(water);
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
    this.shop?.motes.setScale(h, this.camera.fov); this.shop?.sparkles.setScale(h, this.camera.fov);
  }

  // Build the Curio Shop in behind the Reading Room's east doorway. Its lamps hang in the library's own
  // scene, so they stay lit (and the light count stays the same) whichever floor is drawn.
  attachShop(shop: Shop) {
    this.shop = shop;
    const host = shop.embedIn(this.floors[0].group, new THREE.Vector3(SHOP_X, 0, R + 5.4), Math.PI);
    host.updateMatrixWorld(true);
    shop.keeperParts.lantern.parent?.remove(shop.keeperParts.lantern);
    const lights: THREE.Light[] = [];
    host.traverse(o => { if ((o as THREE.Light).isLight) lights.push(o as THREE.Light); });
    for (const L of lights) {
      this.scene.attach(L);
      const sp = L as THREE.SpotLight;
      if (sp.isSpotLight) { host.updateMatrixWorld(true); sp.target.getWorldPosition(sp.target.position); this.scene.add(sp.target); }
      this.shopLights.push({ L });
    }
    this.onResize(window.innerWidth, window.innerHeight);
  }

  // ---------------------------------------------------------------- books
  // Per-round contents: school, size class, chains, glow and placement. A floor is laid out the first
  // time you come near it. `taken` is keyed by book index plus TAKEN_KEY per floor below the Reading Room.
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
      for (const t in this.layoutArgs.taken) { const n = +t; if (Math.floor(n / TAKEN_KEY) === F.d) mine[n % TAKEN_KEY] = true; }
      this.layoutFloor(F, this.layoutArgs.runId, this.layoutArgs.round, mine);
      F.laid = key;
    }
  }

  private layoutFloor(F: Floor, runId: number, round: number, taken: Record<number, boolean>) {
    const depth = F.d, lvl = LEVELS[depth];
    if (!F.books.length) {
      F.books = F.slots.map(s => ({ face: s.face, row: s.row, x: s.x, w: s.w, h: s.h, lean: s.lean, school: 'fire', size: 0, chained: false, glowing: false, title: '', nook: false, far: 0, hidden: false, flat: s.y !== undefined, sec: 0, j: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), color: new THREE.Color() }));
      F.secs.forEach((sc, si) => sc.ids.forEach((i, j) => { F.books[i].sec = si; F.books[i].j = j; }));
    }
    F.secs.forEach(sc => { sc.mesh.count = sc.ids.length; });
    F.taken = taken;
    if (this.lit?.d === F.d) this.lit = null;
    const tint = new THREE.Color(lvl.spine);
    const seed = hashStr(depth ? `${runId}:${round}:d${depth}` : `${runId}:${round}`);
    const rng = mulberry32(seed);
    // each wing keeps mostly one school; the hall mixes them case by case
    const roomSchool = F.plan.rooms.map(() => SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)]);
    const faceSchool = F.faces.map(f => (f.room === 0 ? SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)] : roomSchool[f.room]));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), tiny = new THREE.Vector3(0.0001, 0.0001, 0.0001), sc = new THREE.Vector3();
    let bands = 0;
    F.glows.forEach(g => this.scene.remove(g)); F.glows = [];
    const glowCandidates: number[] = [];
    const bm = new THREE.Matrix4();
    const hsl = { h: 0, s: 0, l: 0 };
    const weird = depth / DEEPEST; // how strange the far wings of this floor are allowed to get
    F.books.forEach((b, i) => {
      const f = F.faces[b.face], sl = F.slots[i];
      b.school = rng() < (f.room === 0 ? 0.72 : 0.8) ? faceSchool[b.face] : SCHOOL_ORDER[Math.floor(rng() * SCHOOL_ORDER.length)];
      b.size = b.w > 0.115 ? 2 : (b.w > 0.085 || rng() < 0.15 ? 1 : 0);
      b.chained = rng() < (round >= 4 ? 0.022 : 0.012) + depth * 0.004 + (f.nook ? 0.05 : 0) + (f.hidden ? 0.04 : 0);
      b.glowing = false; b.nook = f.nook; b.far = f.far; b.hidden = f.hidden;
      const tr = mulberry32(seed ^ Math.imul(i, 2654435761));
      const words = TITLE_WORDS[b.school];
      b.title = TITLE_FORMS[Math.floor(tr() * TITLE_FORMS.length)].replace('{x}', words[Math.floor(tr() * words.length)]);
      if (depth) b.title = lvl.titles[Math.floor(tr() * lvl.titles.length)];
      if (!b.chained && rng() < 0.004 * (1 + depth * 0.4) * (f.nook || f.hidden ? 6 : 1 + f.far * 2)) glowCandidates.push(i);
      const tw = mulberry32(seed ^ Math.imul(i + 7, 40503));
      let p: THREE.Vector3;
      if (b.flat) {
        p = f.c.clone().addScaledVector(f.tan, b.x).addScaledVector(f.nrm, sl.dz!).add(new THREE.Vector3(0, F.y0 + sl.y! + b.w / 2, 0));
        e.set(0, f.ry + sl.yaw!, Math.PI / 2);
      } else {
        p = f.c.clone().addScaledVector(f.tan, b.x).add(new THREE.Vector3(0, F.y0 + 0.13 + b.row * 0.8 + b.h / 2, 0)).addScaledVector(f.nrm, 0.2 + (rng() - 0.5) * 0.02);
        let lean = b.lean;
        if (depth === 5 || depth === DEEPEST) {
          if (tw() < (depth === 5 ? 0.5 : 0.25)) lean = (tw() - 0.5) * (depth === 5 ? 0.9 : 0.4);
          if (depth === 5) p.y += tw() * 0.14;
        } else if (depth >= 2 && b.lean === 0) {
          if (tw() < 0.06 * depth + f.far * f.far * 0.3 * weird) lean = (tw() - 0.5) * 0.35;
        }
        // in the far wings of the deep floors, books drift a little off their shelves
        if (depth >= 3 && f.far > 0.6 && tw() < (f.far - 0.6) * weird) p.addScaledVector(f.nrm, tw() * 0.12).y += tw() * 0.05;
        e.set(0, f.ry, lean);
      }
      q.setFromEuler(e);
      b.pos.copy(p); b.quat.copy(q);
      const mesh = F.secs[b.sec].mesh;
      m4.compose(p, q, taken[i] ? tiny : sc.set(b.w, b.h, 0.3));
      mesh.setMatrixAt(b.j, m4);
      const base = new THREE.Color(ESS[b.school].spine);
      base.getHSL(hsl);
      col.setHSL(hsl.h, Math.min(1, hsl.s * (0.85 + rng() * 0.3)), Math.max(0.05, Math.min(0.9, hsl.l * (0.8 + rng() * 0.45))));
      if (depth) {
        col.lerp(tint, lvl.spineMix);
        if (depth === DEEPEST && mulberry32(seed ^ Math.imul(i + 3, 9973))() < 0.35) col.setRGB(0.05, 0.05, 0.06);
        // colours go wrong out in the far wings
        if (f.far > 0.5 && depth >= 2) col.offsetHSL((f.far - 0.5) * 0.5 * weird * (f.room % 2 ? 1 : -1), 0, 0);
      }
      b.color.copy(col);
      mesh.setColorAt(b.j, col);
      if (b.chained && !taken[i] && bands < 598) {
        bm.compose(p, q, new THREE.Vector3(b.w + 0.014, 0.035, 0.31)); F.bandMesh.setMatrixAt(bands++, bm);
        bm.compose(p.clone().add(new THREE.Vector3(0, b.h * 0.3, 0).applyQuaternion(q)), q, new THREE.Vector3(b.w + 0.014, 0.035, 0.31)); F.bandMesh.setMatrixAt(bands++, bm);
      }
    });
    glowCandidates.slice(0, 10 + depth * 6).forEach(i => {
      const b = F.books[i]; b.glowing = true;
      if (taken[i]) return;
      const s = glowSprite('#fff0b0', 0.55, 0.6); s.position.copy(b.pos).addScaledVector(F.faces[b.face].nrm, b.flat ? 0 : 0.2); if (b.flat) s.position.y += 0.2; s.userData.phase = rng() * 6; this.scene.add(s); F.glows.push(s);
    });
    F.bandMesh.count = bands;
    F.bandMesh.instanceMatrix.needsUpdate = true;
    for (const sc2 of F.secs) {
      sc2.mesh.instanceMatrix.needsUpdate = true;
      if (sc2.mesh.instanceColor) sc2.mesh.instanceColor.needsUpdate = true;
      sc2.mesh.computeBoundingSphere();
    }
    this.setVisible();
  }

  hideBook(d: number, i: number) {
    const F = this.floors[d], b = F.books[i], m4 = new THREE.Matrix4(), mesh = F.secs[b.sec].mesh;
    m4.compose(b.pos, b.quat, new THREE.Vector3(0.0001, 0.0001, 0.0001));
    mesh.setMatrixAt(b.j, m4); mesh.instanceMatrix.needsUpdate = true;
    F.glows.forEach(g => { if (g.position.distanceTo(b.pos) < 0.45) { g.visible = false; g.userData.hidden = true; } });
    F.taken[i] = true;
  }

  book(d: number, i: number): Book { return this.floors[d].books[i]; }

  // ---------------------------------------------------------------- movement
  get feet() { return this.pos.y - this.eyeH; }
  levelOf(feet: number) { return Math.max(0, Math.min(DEEPEST, Math.ceil((-feet - 0.5) / LH))); }

  // The highest thing to stand on beneath (feet + a step) at x, z: a floor, or the stair.
  groundAt(x: number, z: number, feet: number): number {
    let best = -1e9;
    const reach = feet + STEP_UP;
    for (let k = 0; k <= DEEPEST; k++) {
      const fy = -k * LH;
      if (fy > reach || this.spirals.some(sp => sp.top <= k && k < sp.bot && Math.hypot(x - sp.x, z - sp.z) < sp.rHole)) continue;
      best = fy; break; // the first floor at or below you is the highest one
    }
    // the steps of any spiral stair underfoot
    for (const sp of this.spirals) {
      const dx = x - sp.x, dz = z - sp.z, r = Math.hypot(dx, dz);
      if (r < sp.rIn - 0.05 || r > sp.rOut + 0.05) continue;
      let base = Math.atan2(dz, dx) - sp.a0; base = ((base % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const hTop = -sp.top * LH - (base / (Math.PI * 2)) * sp.pitch;
      const k = Math.max(0, Math.ceil((hTop - reach) / sp.pitch - 1e-9));
      const h = hTop - k * sp.pitch;
      if (h >= -sp.bot * LH - 1e-6) best = Math.max(best, h);
    }
    // galleries, balconies, daises and the stairs up to them
    const F = this.floors[this.levelOf(feet)];
    for (const k of F.decks) if (x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1 && F.y0 + k.y <= reach) best = Math.max(best, F.y0 + k.y);
    for (const r of F.ramps) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      const t = Math.max(0, Math.min(1, ((r.axis === 0 ? x : z) - r.from) / (r.to - r.from)));
      const h = F.y0 + r.y0 + (r.y1 - r.y0) * t;
      if (h <= reach) best = Math.max(best, h);
    }
    return best;
  }

  jump() { if (this.grounded && !this.titleSpin && this.eyeH > EYE - 0.1) { this.vy = 6.4; this.grounded = false; } }

  // The lowest ceiling over the reader's body (standing room, measured from the floor).
  private headroom(x: number, z: number, lv: number): number {
    if (lv === 0) return H;
    const P = this.floors[lv].plan;
    let lo = H;
    const m = BODY + 0.08; // a little wider than the body, so pressing into a crawlspace ducks you into it
    for (const [ox, oz] of [[-m, -m], [m, -m], [-m, m], [m, m]]) {
      const ix = Math.floor((x + ox) / C + P.N / 2), iz = Math.floor((z + oz) / C + P.N / 2);
      const k = iz * P.N + ix;
      if (ix >= 0 && iz >= 0 && ix < P.N && iz < P.N && P.walk[k]) lo = Math.min(lo, P.ceil[k]);
    }
    return lo;
  }

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
      const onFloor = feet > -0.6 && feet < 1.2; // the doorways and the arch only exist on the Reading Room's floor
      if (onFloor && p.z > R - 0.95 && (Math.abs(p.x - SHOP_X) < 1.3 || (p.z > R && Math.abs(p.x - SHOP_X) < 6))) {
        // in the shop's doorway or the shop behind it
        p.z = Math.min(R + SHOP_DEPTH, p.z); p.x = Math.max(SHOP_X - 5.1, Math.min(SHOP_X + 5.1, p.x));
        this.push(p, { x0: SHOP_X - 7, x1: SHOP_X - 1.5, z0: R - 0.1, z1: R + 0.1 });
        this.push(p, { x0: SHOP_X + 1.5, x1: SHOP_X + 7, z0: R - 0.1, z1: R + 0.1 });
      } else if (onFloor && p.z > R - 0.95 && Math.abs(p.x - RING_X) < 1.3) {
        p.z = Math.min(R + 0.5, p.z); // into the Ring's arch
      } else if (feet < 4 && feet > -0.6 && p.z < -R + 0.95 && (Math.abs(p.x) < ARCH_W - 0.35 || p.z < -R - 0.4)) {
        // through the arch and in the stair tower
        const inArch = p.z > -R - 0.6;
        const hw = inArch ? ARCH_W - 0.35 : TOWER.x1 - 0.95;
        p.x = Math.max(-hw, Math.min(hw, p.x)); p.z = Math.max(TOWER.z0 + 0.95, p.z);
      } else {
        p.x = Math.max(-R + 0.95, Math.min(R - 0.95, p.x));
        p.z = Math.max(-R + 0.95, Math.min(R - 0.95, p.z));
      }
      if (onFloor) this.push(p, this.deskCollider);
    } else {
      // solid cells of the plan are walls, and so are passages too low to walk through upright
      const P = F.plan, upright = this.eyeH > EYE_LOW + 0.25;
      for (let pass = 0; pass < 2; pass++) {
        const cix = Math.floor(p.x / C + P.N / 2), ciz = Math.floor(p.z / C + P.N / 2);
        for (let iz = ciz - 1; iz <= ciz + 1; iz++) for (let ix = cix - 1; ix <= cix + 1; ix++) {
          const k = iz * P.N + ix;
          const solid = ix < 0 || iz < 0 || ix >= P.N || iz >= P.N || !P.walk[k] || (upright && P.ceil[k] < STAND);
          if (!solid) continue;
          const x0 = (ix - P.N / 2) * C, z0 = (iz - P.N / 2) * C;
          this.push(p, { x0, x1: x0 + C, z0, z1: z0 + C });
        }
      }
    }
    const fr = feet - F.y0;
    for (const b of F.colliders) {
      if ((b.lo !== undefined && fr < b.lo) || (b.hi !== undefined && fr >= b.hi)) continue;
      if (Math.abs(p.x - (b.x0 + b.x1) / 2) < 3 + (b.x1 - b.x0) / 2 && Math.abs(p.z - (b.z0 + b.z1) / 2) < 3 + (b.z1 - b.z0) / 2) this.push(p, b);
    }
  }

  // The brass rail round each floor's hole: walk in through the landing, or jump over it.
  private rails(prev: THREE.Vector3, p: THREE.Vector3, feet: number) {
    for (const sp of this.spirals) {
      const rPrev = Math.hypot(prev.x - sp.x, prev.z - sp.z), r = Math.hypot(p.x - sp.x, p.z - sp.z);
      const RR = sp.rHole + 0.05;
      if (!(rPrev >= RR - 0.02 && r < RR + 0.15)) continue;
      const k = Math.round(-feet / LH);
      const railed = (sp.top <= k && k < sp.bot) || (!sp.main && k === sp.bot);
      if (!railed || feet - (-k * LH) > 0.72 || feet < -k * LH - 0.1) continue; // jumped high enough to clear it
      const a = Math.atan2(p.z - sp.z, p.x - sp.x);
      if (Math.abs(Math.atan2(Math.sin(a - sp.a0), Math.cos(a - sp.a0))) < sp.gap) continue; // the open landing
      const s = (RR + 0.18) / Math.max(r, 0.001);
      p.x = sp.x + (p.x - sp.x) * s; p.z = sp.z + (p.z - sp.z) * s;
    }
  }

  // The bookcase down the outer edge of the stair: you can't walk through it from the steps or the floor,
  // except at the landings, but you can drop off the inner edge of the stair into the shaft.
  private helixWall(prev: THREE.Vector3, p: THREE.Vector3, feet: number) {
    const r = Math.hypot(p.x - WELL.x, p.z - WELL.z);
    if (r < CASE_IN - BODY || r > STAIR_OUT + BODY) return;
    const a = Math.atan2(p.z - WELL.z, p.x - WELL.x);
    let base = a - A0; base = ((base % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (base < CASE_GAP || base > Math.PI * 2 - CASE_GAP) return;
    const hTop = -(base / (Math.PI * 2)) * PITCH;
    let hit = false;
    for (let k = 0; k < DEEPEST && !hit; k++) { const h = hTop - k * PITCH; hit = h + CASE_H > feet + 0.3 && h - 0.2 < feet + 1.6; }
    if (!hit) return;
    const rPrev = Math.hypot(prev.x - WELL.x, prev.z - WELL.z);
    const to = rPrev < (CASE_IN + STAIR_OUT) / 2 ? CASE_IN - BODY : STAIR_OUT + BODY;
    const s = to / Math.max(r, 0.001);
    p.x = WELL.x + (p.x - WELL.x) * s; p.z = WELL.z + (p.z - WELL.z) * s;
  }

  // Inside a stairwell, between floors, the shaft wall holds you in; the smaller stairs' column stands in the middle.
  private shaftWall(prev: THREE.Vector3, p: THREE.Vector3, feet: number) {
    const head = feet + 1.75;
    for (const sp of this.spirals) {
      const r = Math.hypot(p.x - sp.x, p.z - sp.z);
      if (!sp.main && r < sp.rIn + BODY) { const s = (sp.rIn + BODY) / Math.max(r, 0.001); p.x = sp.x + (p.x - sp.x) * s; p.z = sp.z + (p.z - sp.z) * s; continue; }
      const rPrev = Math.hypot(prev.x - sp.x, prev.z - sp.z);
      if (rPrev > sp.rHole - 0.25 || r <= sp.rHole - 0.25) continue;
      for (let k = sp.top; k < sp.bot; k++) {
        const top = -k * LH, bottom = top - sp.slab[k - sp.top]; // the slab under floor k
        if (head > bottom && feet < top - 0.05) {
          const s = (sp.rHole - 0.25) / r;
          p.x = sp.x + (p.x - sp.x) * s; p.z = sp.z + (p.z - sp.z) * s;
          break;
        }
      }
    }
  }

  // which shop the reader is standing in: -1 for the Curio Shop, a floor number for a hidden one, or null
  inShop(): number | null {
    if (this.feet > -0.6 && this.feet < 1.2 && this.pos.z > R + 0.4 && Math.abs(this.pos.x - SHOP_X) < 5.6) return -1;
    if (this.levelOf(this.feet) !== this.level) return null;
    const p = new THREE.Vector3();
    for (const k in this.stalls) {
      if (Math.floor(+k / 10) !== this.level) continue;
      this.stalls[k].group.getWorldPosition(p);
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 3.6) return +k;
    }
    return null;
  }
  // true when the reader steps into the Duelling Ring's arch
  atArena() { return this.feet > -0.6 && this.feet < 1.2 && this.pos.z > R - 0.6 && Math.abs(this.pos.x - RING_X) < 1.3; }

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
    // this floor's shelves, and the stair's bookcase, which belongs to the floor below but shows above it
    const near: { sc: Sector; F: Floor }[] = [];
    for (const F of this.floors) {
      if (Math.abs(F.d - this.level) > 1) continue;
      for (const sc of F.secs) if (sc.mesh.visible && Math.abs(sc.cx - this.pos.x) < SECTOR / 2 + 7 && Math.abs(sc.cz - this.pos.z) < SECTOR / 2 + 7) near.push({ sc, F });
    }
    const targets: THREE.Object3D[] = near.map(n => n.sc.mesh);
    if (this.level === 0) targets.push(this.deskPick, this.arena);
    const hits = this.raycaster.intersectObjects(targets, false);
    // wares on a counter or a stall, if they are nearer than any book
    let ware: Pick = null, wareDist = Infinity;
    const shopId = this.inShop();
    if (shopId === -1 && this.shop) {
      const i = this.shop.pickRay(this.raycaster);
      if (i >= 0) { ware = { kind: 'ware', shop: -1, i }; wareDist = this.raycaster.intersectObject(this.shop.slots[i].pick, false)[0]?.distance ?? 0; }
    } else if (shopId !== null && shopId >= 0) {
      const r = this.stalls[shopId].pickRay(this.raycaster);
      if (r) { ware = { kind: 'ware', shop: shopId, i: r.i }; wareDist = r.dist; }
    }
    for (const h of hits) {
      if (h.distance > wareDist) break;
      const n = near.find(x => x.sc.mesh === h.object);
      if (n && h.instanceId !== undefined) {
        const i = n.sc.ids[h.instanceId];
        if (n.F.taken[i] || h.distance > 5.5) continue;
        return { kind: 'book', i, d: n.F.d };
      }
      if (h.object === this.deskPick) return { kind: 'desk' };
      if (h.object === this.arena) return { kind: 'arena' };
    }
    return ware;
  }

  setHover(p: Pick) {
    this.hover = p;
    if (this.shop) this.shop.hover = p?.kind === 'ware' && p.shop === -1 ? p.i : -1;
    for (const k in this.stalls) this.stalls[k].hover = p?.kind === 'ware' && p.shop === +k ? p.i : -1;
    const want = p?.kind === 'book' ? { d: p.d, i: p.i } : null;
    if (this.lit && want && this.lit.d === want.d && this.lit.i === want.i) return;
    if (this.lit) this.litBook(this.lit.d, this.lit.i, false);
    this.lit = want;
    if (want) this.litBook(want.d, want.i, true);
  }

  // A hovered book slides a little way off its shelf (or up off its pile) and catches the light.
  private litBook(d: number, i: number, on: boolean) {
    const F = this.floors[d], b = F.books[i];
    if (!b || F.taken[i]) return;
    const mesh = F.secs[b.sec].mesh, p = b.pos.clone();
    if (on) { if (b.flat) p.y += 0.035; else p.addScaledVector(F.faces[b.face].nrm, 0.1); }
    mesh.setMatrixAt(b.j, new THREE.Matrix4().compose(p, b.quat, new THREE.Vector3(b.w, b.h, 0.3)));
    mesh.setColorAt(b.j, on ? b.color.clone().lerp(new THREE.Color('#fff4d8'), 0.4) : b.color);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
      const vis = F.d === d || (this.nearShaft && F.d >= d - 1 && F.d <= d + (quality.level ? 2 : 1));
      F.group.visible = vis; F.bandMesh.visible = vis;
      // blocks of shelves beyond the fog are not drawn at all
      const reach = LEVELS[d].far * this.drawScale + SECTOR * 0.75;
      for (const sc of F.secs) {
        const on = vis && Math.hypot(sc.cx - this.pos.x, sc.cz - this.pos.z) < reach;
        sc.mesh.visible = on; if (sc.wood) sc.wood.visible = on;
      }
      F.glows.forEach(g => { g.visible = vis && !(g.userData.hidden as boolean) && Math.hypot(g.position.x - this.pos.x, g.position.z - this.pos.z) < reach; });
    });
  }

  // The candle-light pool sits on the stands nearest to you.
  private placeLights() {
    const F = this.floors[this.level];
    const near = F.stands.map(s => ({ s, dist: (s.x - this.pos.x) ** 2 + (s.z - this.pos.z) ** 2 + (F.y0 + s.y + 1 - this.pos.y) ** 2 * 2 })).sort((a, b) => a.dist - b.dist);
    this.candleLights.forEach((l, i) => {
      const s = near[i]?.s;
      if (s) { l.position.set(s.x, F.y0 + s.y + 2.1, s.z); l.userData.on = 1; } else l.userData.on = 0;
    });
  }

  // Lower quality: a shorter view through thicker fog, fewer candle lights, fewer floors drawn at once.
  private applyQuality() {
    const lv = quality.level;
    this.qLevel = lv;
    this.drawScale = Q.drawScale(lv);
    this.candleLights.forEach((l, i) => { l.visible = i < Q.candles(lv); });
    this.camera.far = 80 * this.drawScale; this.camera.updateProjectionMatrix();
    this.setVisible();
  }

  update(dt: number, time: number) {
    if (this.qLevel !== quality.level) this.applyQuality();
    const cam = this.camera;
    const prev = this.pos.clone();
    if (this.titleSpin) {
      this.yaw += dt * 0.05; this.pos.set(Math.sin(time * 0.05) * 2, 1.75, 5.5); this.pitch = 0.06; this.vy = 0; this.grounded = true;
      this.eyeH = EYE; this.crouch = false;
    } else {
      const k = this.keys; let fx = 0, fz = 0;
      if (k.KeyW || k.ArrowUp) fz += 1; if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1; if (k.KeyD || k.ArrowRight) fx += 1;
      fx += this.joy.x; fz += -this.joy.y;
      const len = Math.hypot(fx, fz);
      const feet0 = this.feet;
      // crouch while C or Ctrl is held (or the touch button is on); you cannot stand up under a low ceiling
      const lv0 = this.levelOf(feet0);
      const wantLow = this.crouch || !!(k.KeyC || k.ControlLeft || k.ControlRight);
      const low = wantLow || (this.grounded && this.headroom(this.pos.x, this.pos.z, lv0) < STAND);
      this.eyeH += ((low ? EYE_LOW : EYE) - this.eyeH) * (1 - Math.exp(-dt * 12));
      if (len > 0.05) {
        const sp = (low ? 1.7 : k.ShiftLeft || k.ShiftRight ? 5.2 : 3.4) * dt / Math.max(1, len);
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.pos.x += (-sy * fz + cy * fx) * sp; this.pos.z += (-cy * fz - sy * fx) * sp;
        this.collide(this.pos, feet0);
        this.rails(prev, this.pos, feet0);
        this.helixWall(prev, this.pos, feet0);
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
        if (feet + this.eyeH + 0.18 > top && this.vy > 0 && !this.spirals.some(sp => Math.hypot(this.pos.x - sp.x, this.pos.z - sp.z) < sp.rHole + 1)) { feet = top - this.eyeH - 0.18; this.vy = 0; }
      }
      // and so does the underside of a gallery or balcony
      {
        const F = this.floors[lv], fr = feet - F.y0, head = fr + this.eyeH + 0.18;
        for (const k of F.decks) if (this.vy > 0 && this.pos.x > k.x0 && this.pos.x < k.x1 && this.pos.z > k.z0 && this.pos.z < k.z1 && fr < k.y - 1 && head > k.y - 0.26) { feet = F.y0 + k.y - 0.26 - this.eyeH - 0.18; this.vy = 0; }
      }
      this.pos.y = feet + this.eyeH;
    }
    // which floor are we on?
    const lvl = this.levelOf(this.feet);
    if (lvl !== this.level) { this.level = lvl; this.applyLevel(lvl); this.onLevel?.(lvl); }
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.3; this.placeLights();
      this.nearShaft = this.spirals.some(sp => sp.top <= this.level && this.level <= sp.bot && Math.hypot(this.pos.x - sp.x, this.pos.z - sp.z) < (sp.main ? 17 : 11));
      this.setVisible();
    }
    // the air shifts towards this floor's colour
    const L = LEVELS[this.level], kk = 1 - Math.exp(-dt * 3);
    const E = this.env;
    E.fog.lerp(new THREE.Color(L.fog), kk); E.sky.lerp(new THREE.Color(L.sky), kk); E.ground.lerp(new THREE.Color(L.ground), kk);
    E.hemi += (L.hemi - E.hemi) * kk; E.near += (L.near - E.near) * kk; E.far += (L.far - E.far) * kk; E.lantern += (L.lantern - E.lantern) * kk;
    E.exposure += (1.15 - this.level * 0.025 - E.exposure) * kk; E.vignette += (1 + this.level * 0.1 - E.vignette) * kk;
    (this.scene.background as THREE.Color).copy(E.fog);
    const fog = this.scene.fog as THREE.Fog; fog.color.copy(E.fog); fog.near = E.near * this.drawScale; fog.far = E.far * this.drawScale;
    this.hemi.color.copy(E.sky); this.hemi.groundColor.copy(E.ground); this.hemi.intensity = E.hemi;
    this.exposure = E.exposure; this.vignette = E.vignette;
    this.lantern.position.copy(this.pos).add(new THREE.Vector3(0.3, -0.2, 0));
    this.lantern.intensity = E.lantern > 0.05 ? E.lantern + Math.sin(time * 11) * 0.3 + Math.sin(time * 5.3) * 0.2 : 0;
    const top = this.level === 0 ? 1 : 0;
    this.hallLights.forEach((Lh, i) => { Lh.intensity = top * (i === 0 ? 55 : 30) * (1 + Math.sin(time * 3 + i) * 0.04); });
    this.arenaLight.intensity = (24 + Math.sin(time * 2.3) * 4) * top; this.deskLight.intensity = 2.5 * top;

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
    // the Curio Shop's lamps burn only while the Reading Room is drawn; a stall's keeper stirs when you are near
    if (this.shop) {
      if (top) this.shop.update(dt, time);
      else for (const s of this.shopLights) s.L.intensity = 0;
    }
    for (const k in this.stalls) if (Math.floor(+k / 10) === this.level) this.stalls[k].update(dt, time, this.pos);
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
      if (rnd() < 0.5) this.motes.emit({ x: SHOP_X + (rnd() - 0.5) * 2.6, y: 0.5 + rnd() * 3, z: R - 0.5 - rnd() * 3, vz: -0.3, color: '#ffc080', size: 0.06, life: 4, drag: 0, jitter: 0.3, alpha: 0.8 });
      if (rnd() < 0.5) this.motes.emit({ x: RING_X + (rnd() - 0.5) * 2.6, y: 0.4 + rnd() * 3.6, z: R - 0.3 - rnd() * 2, vz: -0.35, color: rnd() < 0.5 ? '#7fe0d0' : '#b89aff', size: 0.06, life: 4, drag: 0, jitter: 0.3, alpha: 0.8 });
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
