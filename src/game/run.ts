// Run state: everything a run carries between rounds, saved to localStorage.
import { SPELLS, LIBRARY_SPELLS } from '../data/spells';
import type { SpellInst } from '../data/fusion';
import { ARTIFACTS, ARTIFACT_LIST, REAGENT_LIST, RARITY } from '../data/artifacts';
import type { TomeSpec, WardCond } from '../sim/types';
import { makeBot } from '../sim/bots';
import { STALL_BY_KEY } from '../data/stalls';
import { hashStr, mulberry32, weighted, shuffle } from '../sim/rng';
import { bindingsForRound, hpForRound, inkForRound, linesForRound, trinketSlotsForRound, wardsForRound } from './progression';

export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export interface ShopItem { kind: 'art' | 'reagent'; id: string; sold: boolean }

export interface Run {
  v: number;
  id: number;
  runNo: number;
  round: number;
  wins: number;
  losses: number;
  gold: number;
  uid: number;
  name: string;
  lines: (SpellInst | null)[];
  wards: { cond: WardCond | null; spell: SpellInst | null }[];
  satchel: (SpellInst | null)[];
  reagents: string[];
  staff: string | null;
  trinkets: (string | null)[];
  stash: string[];
  // taken and peeked are keyed by book index, plus 1000000 per level below the Reading Room
  lib: { borrows: number; candles: number; peeked: Record<number, boolean>; taken: Record<number, boolean>; forbidden: number; depth?: number };
  shop: { stock: ShopItem[]; rerolls: number; visited: boolean };
  secret?: Record<number, ShopItem[]>; // the hidden shops in the depths, by floor, stocked when first found
  bindings: number;
  desk: { base: SpellInst | null; inf: SpellInst | null };
  phase: 'library' | 'shop' | 'desk' | 'duel';
  opponent: TomeSpec | null;
  history: { round: number; won: boolean; name: string; title: string }[];
}

const SAVE_KEY = 'inkbound2.run';
export let run: Run | null = null;

export function loadRun(): Run | null {
  const r = store.get<Run | null>(SAVE_KEY, null);
  run = r && r.v === 2 ? r : null;
  if (run) {
    if (!run.opponent) run.opponent = pickOpponent(run);
    if (!run.desk) run.desk = { base: null, inf: null };
    if (!run.shop?.stock?.length) run.shop = { stock: rollStock(run, 0), rerolls: 0, visited: false };
  }
  return run;
}
export function saveRun() { if (run) store.set(SAVE_KEY, run); }
export function clearRun() { store.del(SAVE_KEY); run = null; }

export function inst(r: Run, base: string, inf: string[] = [], tier = 0): SpellInst {
  return { uid: ++r.uid, base, inf, tier };
}

export function newRun(): Run {
  const runNo = store.get('inkbound2.runs', 0) + 1;
  store.set('inkbound2.runs', runNo);
  const r: Run = {
    v: 2, id: (Date.now() % 1e9) | 0, runNo, round: 1, wins: 0, losses: 0, gold: 10, uid: 0, name: 'You',
    lines: [], wards: [], satchel: [], reagents: [], staff: 'ashwood', trinkets: [null, null], stash: [],
    lib: { borrows: 3, candles: 5, peeked: {}, taken: {}, forbidden: 0 },
    shop: { stock: [], rerolls: 0, visited: false }, bindings: 2, desk: { base: null, inf: null }, phase: 'library', opponent: null, history: [],
  };
  // one basic spell to begin with; everything else comes from the library
  r.lines = [inst(r, 'firebolt'), null, null, null];
  r.wards = [];
  r.satchel = [null, null, null, null, null, null];
  run = r;
  prepareRound();
  return r;
}

export function prepareRound() {
  const r = run!;
  while (r.lines.length < linesForRound(r.round)) r.lines.push(null);
  const conds: WardCond[] = ['loop', 'every8', 'struck'];
  while (r.wards.length < wardsForRound(r.round)) r.wards.push({ cond: conds[r.wards.length] || 'loop', spell: null });
  while (r.trinkets.length < trinketSlotsForRound(r.round)) r.trinkets.push(null);
  r.lib = { borrows: 3, candles: 5, peeked: {}, taken: {}, forbidden: 0 };
  r.shop = { stock: rollStock(r, 0), rerolls: 0, visited: false };
  r.secret = {};
  r.bindings = bindingsForRound(r.round);
  r.phase = 'library';
  r.opponent = pickOpponent(r);
  saveRun();
}

// ---------- spells owned ----------
export type Where = 'line' | 'sat' | 'ward' | 'base' | 'inf';
export interface Ref { where: Where; i: number }
export function slotGet(r: Run, ref: Ref): SpellInst | null {
  if (ref.where === 'line') return r.lines[ref.i] || null;
  if (ref.where === 'sat') return r.satchel[ref.i] || null;
  if (ref.where === 'base') return r.desk.base;
  if (ref.where === 'inf') return r.desk.inf;
  return r.wards[ref.i]?.spell || null;
}
export function slotSet(r: Run, ref: Ref, v: SpellInst | null) {
  if (ref.where === 'line') r.lines[ref.i] = v;
  else if (ref.where === 'sat') r.satchel[ref.i] = v;
  else if (ref.where === 'base') r.desk.base = v;
  else if (ref.where === 'inf') r.desk.inf = v;
  else r.wards[ref.i].spell = v;
}
export function allOwned(r: Run): { s: SpellInst; ref: Ref }[] {
  const out: { s: SpellInst; ref: Ref }[] = [];
  r.lines.forEach((s, i) => s && out.push({ s, ref: { where: 'line', i } }));
  r.wards.forEach((w, i) => w.spell && out.push({ s: w.spell, ref: { where: 'ward', i } }));
  r.satchel.forEach((s, i) => s && out.push({ s, ref: { where: 'sat', i } }));
  if (r.desk.base) out.push({ s: r.desk.base, ref: { where: 'base', i: 0 } });
  if (r.desk.inf) out.push({ s: r.desk.inf, ref: { where: 'inf', i: 0 } });
  return out;
}

// Borrowing a spell you already own upgrades it instead: Silver, then Gold.
export function gainSpell(r: Run, id: string): { upgraded: SpellInst | null; placed: boolean } {
  const owned = allOwned(r).filter(o => o.s.base === id && o.s.tier < 2).sort((a, b) => b.s.tier - a.s.tier)[0];
  if (owned) { owned.s.tier++; return { upgraded: owned.s, placed: true }; }
  const slot = r.satchel.findIndex(s => !s);
  if (slot < 0) return { upgraded: null, placed: false };
  r.satchel[slot] = inst(r, id);
  return { upgraded: null, placed: true };
}

export function playerTome(r: Run): TomeSpec {
  return {
    name: r.name, title: 'Apprentice', hp: hpForRound(r.round), ink: inkForRound(r.round),
    lines: r.lines.slice(), wards: r.wards.map(w => ({ cond: w.cond, spell: w.spell })),
    artifacts: [r.staff, ...r.trinkets].filter((x): x is string => !!x), startHex: r.lib.forbidden * 2,
  };
}

// ---------- shop ----------
function rarityWeights(round: number): number[] {
  const t = Math.min(1, (round - 1) / 8);
  return [60 - 42 * t, 30 + 6 * t, 8 + 22 * t, 2 + 14 * t];
}

export function rollStock(r: Run, reroll: number): ShopItem[] {
  const rng = mulberry32(hashStr(`${r.id}:${r.round}:shop:${reroll}`));
  const owned = new Set([r.staff, ...r.trinkets, ...r.stash].filter(Boolean));
  const w = rarityWeights(r.round);
  const pool = ARTIFACT_LIST.filter(a => !owned.has(a.id) && a.id !== 'ashwood' && !a.shopOnly);
  const out: ShopItem[] = [];
  // always one staff on offer, then trinkets
  const staves = pool.filter(a => a.slot === 'staff');
  if (staves.length) { const a = weighted(rng, staves, x => w[x.rarity]); out.push({ kind: 'art', id: a.id, sold: false }); }
  const trinkets = pool.filter(a => a.slot === 'trinket');
  while (out.length < 5 && trinkets.length) {
    const a = weighted(rng, trinkets, x => w[x.rarity]);
    trinkets.splice(trinkets.indexOf(a), 1);
    out.push({ kind: 'art', id: a.id, sold: false });
  }
  const reag = shuffle(rng, REAGENT_LIST.slice()).slice(0, 2);
  for (const g of reag) out.push({ kind: 'reagent', id: g.id, sold: false });
  return out;
}

// A hidden shop keeps only three things: two of its keeper's oddities, which no other shop sells, and a
// curio of its keeper's schools, rarer the deeper it is. Keyed by stall (floor × 10).
export function secretStock(r: Run, key: number): ShopItem[] {
  if (!r.secret) r.secret = {};
  if (r.secret[key]) return r.secret[key];
  const def = STALL_BY_KEY[key], d = Math.floor(key / 10);
  const rng = mulberry32(hashStr(`${r.id}:${r.round}:secret:${key}`));
  const taken = new Set([r.staff, ...r.trinkets, ...r.stash, ...r.shop.stock.map(s => s.id), ...Object.values(r.secret).flat().map(s => s.id)].filter(Boolean));
  const w = [Math.max(0, 6 - d), 18, 36 + d * 3, 12 + d * 5];
  const out: ShopItem[] = [];
  const odd = shuffle(rng, (def?.odd || []).filter(id => ARTIFACTS[id] && !taken.has(id)));
  for (const id of odd.slice(0, 2)) out.push({ kind: 'art', id, sold: false });
  const themed = ARTIFACT_LIST.filter(a => !a.shopOnly && !taken.has(a.id) && a.id !== 'ashwood' && a.ess && def?.ess.includes(a.ess));
  const any = ARTIFACT_LIST.filter(a => !a.shopOnly && !taken.has(a.id) && a.id !== 'ashwood');
  while (out.length < 3) {
    const pool = (themed.length ? themed : any).filter(a => !out.some(o => o.id === a.id));
    if (!pool.length) break;
    out.push({ kind: 'art', id: weighted(rng, pool, x => w[x.rarity] + 1).id, sold: false });
  }
  r.secret[key] = out;
  return out;
}

export function priceOf(item: ShopItem): number {
  if (item.kind === 'art') return RARITY[ARTIFACTS[item.id].rarity].price;
  return REAGENT_LIST.find(g => g.id === item.id)!.price;
}
export function sellPrice(id: string): number { return Math.ceil(RARITY[ARTIFACTS[id].rarity].price / 2); }
export function rerollPrice(r: Run) { return 2 + r.shop.rerolls; }

// ---------- opponents and ghosts ----------
interface Ghost { round: number; wins: number; name: string; tome: TomeSpec; runId: number }
const GHOST_KEY = 'inkbound2.ghosts';

export function saveGhost(r: Run) {
  const ghosts = store.get<Ghost[]>(GHOST_KEY, []);
  const tome = playerTome(r);
  tome.name = `Echo of run ${r.runNo}`;
  tome.title = 'Your own ghost';
  ghosts.push({ round: r.round, wins: r.wins, name: tome.name, tome, runId: r.id });
  while (ghosts.length > 40) ghosts.shift();
  store.set(GHOST_KEY, ghosts);
}

export function pickOpponent(r: Run): TomeSpec {
  const rng = mulberry32(hashStr(`${r.id}:${r.round}:opp`));
  const ghosts = store.get<Ghost[]>(GHOST_KEY, []).filter(g => g.round === r.round && g.runId !== r.id && Math.abs(g.wins - r.wins) <= 2);
  if (ghosts.length && rng() < 0.4) {
    const g = ghosts[Math.floor(rng() * ghosts.length)];
    return { ...g.tome, hp: hpForRound(r.round), ink: inkForRound(r.round) };
  }
  return makeBot(r.round, hashStr(`${r.id}:${r.round}:bot`));
}

export function libraryPool(school: string, size: number, chained: boolean): string[] {
  const list = LIBRARY_SPELLS.filter(s => chained ? s.rarity >= 1 : s.school === school);
  return list.map(s => s.id).filter(id => SPELLS[id] && (size >= 1 || SPELLS[id].rarity < 2 || chained));
}
