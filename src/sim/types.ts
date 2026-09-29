import type { Essence, Form } from '../data/spells';
import type { Resolved, Riders, SpellInst } from '../data/fusion';
import type { Status } from '../data/codex';

export type Side = 0 | 1;
export type WardCond = 'struck' | 'half' | 'every8' | 'loop' | 'afflicted' | 'summondies';

export const WARD_CONDS: { id: WardCond; name: string; text: string; cd: number }[] = [
  { id: 'struck', name: 'When struck', text: 'When an enemy bolt hits you (5 s cooldown)', cd: 5 },
  { id: 'half', name: 'Below half', text: 'Once, when you drop below half health', cd: 0 },
  { id: 'every8', name: 'Every 8 s', text: 'Every 8 seconds', cd: 0 },
  { id: 'loop', name: 'On loop', text: 'Each time your incantation loops', cd: 0 },
  { id: 'afflicted', name: 'When afflicted', text: 'When the enemy gives you a status (5 s cooldown)', cd: 5 },
  { id: 'summondies', name: 'When a summon dies', text: 'When one of your summons dies (3 s cooldown)', cd: 3 },
];

export interface TomeSpec {
  name: string;
  title?: string;
  hp: number;
  ink: number;
  regen?: number;
  lines: (SpellInst | null)[];
  wards: { cond: WardCond | null; spell: SpellInst | null }[];
  artifacts: string[];
  startHex?: number;
}

export interface Body {
  id: number;
  kind: 'mage' | 'unit';
  side: Side;
  name: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  st: Record<Status, number>;
  decay: Record<Status, number>;
  dotT: number;
  frozen: number;
  freezeImmune: number;
  poisonCap: number;
  morph: number;
  morphKind: string | null;
  glacier: number; // time left where heavy hits deal triple (Ice Statue)
  vuln: number; // Acid: takes 25% more damage while above zero
}

export interface LineState {
  idx: number;
  res: Resolved;
  uses: number; // Infinity for endless
  blot: number; // blanked until this time
}

export interface Curse {
  key: number;
  id: string;
  name: string;
  res: Resolved;
  owner: Side;
  power: number;
  age: number;
  tickT: number;
  pulseT: number;
  riders: Riders;
  data: Record<string, number>;
}

export interface Aura {
  key: number;
  id: string;
  name: string;
  res: Resolved;
  power: number;
  until: number;
  riders: Riders;
  data: Record<string, number>;
}

export interface WardLine {
  cond: WardCond;
  res: Resolved;
  uses: number;
  cd: number;
}

export interface ArtState {
  id: string;
  st: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface Mage extends Body {
  kind: 'mage';
  title: string;
  ink: number;
  maxInk: number;
  regen: number;
  recharge: number;
  lines: LineState[];
  cursor: number;
  phase: 'idle' | 'reading' | 'recover' | 'recharge' | 'starved';
  phaseT: number;
  prog: number;
  total: number;
  cur: LineState | null;
  silence: number;
  sanctuary: number;
  hexSelf: number;
  congeal: number;
  readSlow: number;
  steam: boolean;
  curses: Curse[];
  auras: Aura[];
  block: number;
  mirror: number;
  mirrorAll: number;
  counter: number;
  angel: boolean;
  wardRiders: Riders | null;
  wardLines: (WardLine | null)[];
  arts: ArtState[];
  lastCast: Resolved | null;
  lastPower: number;
  halfUsed: boolean;
  every8: number;
  castCount: number;
  freeNext: boolean;
  quickNext: boolean;
  dealt: number;
  healed: number;
  loops: number;
  shock: number; // Static Shield blocks still waiting to shock
  divine: number; // Divine Shield time left
  nextPower: number; // Martyrdom
  thief: number; // Spellthief charges
  flayer: number; // Mindflayer: backfires that also drain ink
  history: { res: Resolved; power: number }[];
}

export interface Unit extends Body {
  kind: 'unit';
  ukind: string;
  owner: Side;
  atk: number;
  interval: number;
  atkT: number;
  ranged: boolean;
  taunt: boolean;
  blocker: boolean;
  life: number;
  riders: Riders;
  ess: Essence[];
  power: number;
  x: number;
  z: number;
  slot: number;
  row: 'front' | 'back' | 'free';
  split: boolean;
  tint: Essence | null;
  flags: Record<string, number>;
}

export interface Field {
  id: number;
  owner: Side;
  on: Side;
  kind: string;
  name: string;
  res: Resolved | null;
  power: number;
  dur: number;
  age: number;
  period: number;
  tickT: number;
  riders: Riders;
  ess: Essence;
  flags: Record<string, number>;
}

// ----- event log -----
export type DuelEvent = { t: number } & (
  | { type: 'read'; side: Side; line: number; dur: number; name: string; ess: Essence }
  | { type: 'starved'; side: Side }
  | { type: 'loop'; side: Side }
  | { type: 'recharge'; side: Side; dur: number }
  | { type: 'cast'; side: Side; line: number; name: string; form: Form; ess: Essence; castId: number; via?: string; legendary?: boolean }
  | { type: 'fizzle'; side: Side; reason: string; castId?: number; name?: string }
  | { type: 'proj'; id: number; from: number; to: number; flight: number; ess: Essence; style: string; size: number; castId?: number }
  | { type: 'projEnd'; id: number; outcome: 'hit' | 'block' | 'reflect' | 'fizzle' | 'miss' }
  | { type: 'burst'; side: Side; ess: Essence; from: number; flight: number; all?: boolean }
  | { type: 'dmg'; tgt: number; amt: number; ess: Essence | null; kind: string; crit?: boolean; castId?: number }
  | { type: 'heal'; tgt: number; amt: number }
  | { type: 'status'; tgt: number; s: Status; n: number; total: number }
  | { type: 'react'; tgt: number; id: string; name: string }
  | { type: 'spawn'; unit: UnitSnap; temp?: boolean }
  | { type: 'unitAtk'; id: number; tgt: number }
  | { type: 'death'; tgt: number; how?: string }
  | { type: 'field'; id: number; on: Side; owner: Side; kind: string; name: string; ess: Essence; dur: number }
  | { type: 'fieldEnd'; id: number }
  | { type: 'strike'; tgt: number; ess: Essence }
  | { type: 'arc'; from: number; to: number; ess: Essence }
  | { type: 'curse'; side: Side; key: number; name: string; ess: Essence }
  | { type: 'cursePulse'; side: Side; key: number }
  | { type: 'curseEnd'; side: Side; key: number; how: string }
  | { type: 'aura'; side: Side; id: string; name: string; ess: Essence }
  | { type: 'ward'; side: Side; kind: string; name: string }
  | { type: 'wardUse'; side: Side; kind: string }
  | { type: 'wardLine'; side: Side; idx: number; cond: string }
  | { type: 'callout'; side: Side; text: string; sub: string; gold?: boolean }
  | { type: 'art'; side: Side; id: string; text?: string }
  | { type: 'freeze'; tgt: number; dur: number }
  | { type: 'thaw'; tgt: number }
  | { type: 'morph'; tgt: number; form: string; dur: number }
  | { type: 'unmorph'; tgt: number }
  | { type: 'blot'; side: Side; line: number; dur: number }
  | { type: 'swap'; side: Side; a: number; b: number }
  | { type: 'backfire'; side: Side }
  | { type: 'shake'; amt: number }
  | { type: 'sudden' }
  | { type: 'end'; winner: number; timeout?: boolean }
);

export interface UnitSnap {
  id: number;
  side: Side;
  kind: string;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  tint: Essence | null;
  st: number[]; // STATUSES order
  frozen: boolean;
  morph: string | null;
  taunt: boolean;
  temp: boolean;
}

export interface MageSnap {
  hp: number;
  maxHp: number;
  ink: number;
  maxInk: number;
  st: number[];
  phase: string;
  line: number; // position in the current order
  prog: number;
  total: number;
  order: number[];
  uses: number[]; // per original line index; -1 endless
  blots: number[];
  curses: { key: number; name: string; ess: Essence; left?: number }[];
  auras: { id: string; name: string; ess: Essence }[];
  block: number;
  mirror: number;
  counter: number;
  sanctuary: boolean;
  angel: boolean;
  frozen: boolean;
  morph: string | null;
  silence: boolean;
  hexSelf: number;
  wardCd: number[];
  wardUses: number[];
}

export interface Snap {
  t: number;
  m: [MageSnap, MageSnap];
  u: UnitSnap[];
  fields: number[];
}

export interface DuelResult {
  winner: number;
  duration: number;
  events: DuelEvent[];
  snaps: Snap[];
  seed: number;
  found: string[];
  hp: [number, number];
  names: [string, string];
  lines: [(Resolved | null)[], (Resolved | null)[]];
  wards: [({ cond: WardCond; res: Resolved } | null)[], ({ cond: WardCond; res: Resolved } | null)[]];
  arts: [string[], string[]];
  stats: { dealt: [number, number]; healed: [number, number] };
}
