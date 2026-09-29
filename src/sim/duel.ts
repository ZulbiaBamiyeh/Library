// The duel simulation. Plain TypeScript, no rendering: two tomes and a seed in,
// an event log and state snapshots out. Fixed 20 ticks per second.
import { SPELLS, LIBRARY_SPELLS, type Essence } from '../data/spells';
import { resolveSpell, liteRiders, emptyRiders, ridersEmpty, type Resolved, type Riders } from '../data/fusion';
import { DECAY, REACTIONS, STATUSES, type Status } from '../data/codex';
import { ARTIFACTS, type ArtCtx, type DmgInfo } from '../data/artifacts';
import { mulberry32, type Rng } from './rng';
import type {
  Body, BreakdownItem, Curse, DuelEvent, DuelResult, Field, LineState, Mage, MageSnap, Side, Snap, TomeSpec, Unit, UnitSnap, WardCond,
} from './types';
import { WARD_CONDS } from './types';

export const PACE = { dt: 0.05, start: 1.2, minCycle: 3.2, recover: 0.9, recharge: 3.0, sudden: 75, timeout: 150 };
const BOARD = { mageZ: 5.4, backZ: 3.3, frontZ: 1.2 };
const SLOT_X = [-2.4, 2.4, -4.6, 4.6, -1.2, 1.2, -3.5, 3.5, 0];
const MAX_UNITS = 9;

type Evt = DuelEvent extends infer E ? (E extends { type: infer K } ? Omit<E, 't'> & { type: K } : never) : never;

interface UnitDef { hp: number; atk: number; interval: number; ranged: boolean; taunt?: boolean; blocker?: boolean; st?: Partial<Record<Status, number>> }
const UNITS: Record<string, UnitDef> = {
  imp: { hp: 20, atk: 2, interval: 2.2, ranged: true },
  skeleton: { hp: 8, atk: 2, interval: 2.5, ranged: false, blocker: true },
  treant: { hp: 60, atk: 4, interval: 3, ranged: false, taunt: true },
  sapling: { hp: 18, atk: 2, interval: 3, ranged: false, taunt: true },
  rat: { hp: 14, atk: 1, interval: 2.5, ranged: false, st: { poison: 2 } },
  salamander: { hp: 24, atk: 3, interval: 3, ranged: true },
  ball: { hp: 12, atk: 20, interval: 99, ranged: false },
  decoy: { hp: 1, atk: 0, interval: 99, ranged: false, taunt: true },
  cherub: { hp: 18, atk: 1, interval: 3, ranged: true },
  pitlord: { hp: 70, atk: 4, interval: 2.5, ranged: true },
  frostlich: { hp: 40, atk: 4, interval: 2.2, ranged: true, st: { chill: 2 } },
  worldroot: { hp: 90, atk: 4, interval: 3, ranged: false, taunt: true },
  egg: { hp: 18, atk: 0, interval: 99, ranged: true },
  phoenix: { hp: 28, atk: 3, interval: 2.4, ranged: true, st: { burn: 1 } },
  snowman: { hp: 40, atk: 2, interval: 3, ranged: false, taunt: true, st: { chill: 1 } },
  leech: { hp: 16, atk: 0, interval: 1, ranged: false },
  hydra: { hp: 26, atk: 0, interval: 1, ranged: false },
  tesla: { hp: 22, atk: 0, interval: 3, ranged: true },
  stormspire: { hp: 40, atk: 0, interval: 2, ranged: true },
  clone: { hp: 30, atk: 0, interval: 99, ranged: true },
  mimic: { hp: 40, atk: 5, interval: 3, ranged: false, taunt: true },
  bookworm: { hp: 16, atk: 0, interval: 4, ranged: false },
  author: { hp: 30, atk: 0, interval: 5, ranged: true },
  thing: { hp: 90, atk: 0, interval: 6, ranged: false },
  golem: { hp: 45, atk: 4, interval: 3, ranged: false },
  seraph: { hp: 40, atk: 6, interval: 2.5, ranged: true },
};
export const UNIT_TITLE: Record<string, string> = {
  imp: 'Imp', skeleton: 'Skeleton', treant: 'Treant', sapling: 'Sapling', rat: 'Plague Rat', salamander: 'Salamander', ball: 'Ball Lightning',
  decoy: 'Mirror Image', cherub: 'Cherub', pitlord: 'Pit Lord', frostlich: 'Frost Lich', worldroot: 'Worldroot',
  egg: 'Phoenix Egg', phoenix: 'Phoenix', snowman: 'Snowman', leech: 'Leech', hydra: 'Hydra', tesla: 'Tesla Coil', stormspire: 'Stormspire',
  clone: 'Shadow Clone', golem: 'Golem', seraph: 'Seraph', mimic: 'Book Mimic', bookworm: 'Bookworm', author: 'The Author', thing: 'Thing Between the Shelves',
};
// the colour a unit's attacks read as when nothing tints it
const UNIT_ESS: Record<string, Essence> = {
  salamander: 'fire', pitlord: 'fire', phoenix: 'fire', egg: 'fire', frostlich: 'frost', snowman: 'frost', rat: 'venom', leech: 'venom', hydra: 'venom',
  tesla: 'storm', stormspire: 'storm', ball: 'storm', clone: 'shadow', seraph: 'holy', cherub: 'holy',
  mimic: 'stone', bookworm: 'venom', author: 'arcane', thing: 'shadow',
};

function zeroSt(): Record<Status, number> { return { burn: 0, chill: 0, wet: 0, poison: 0, oil: 0, charge: 0, hex: 0 }; }
const r1 = (x: number) => Math.round(x * 10) / 10;

interface HitOpts { castId?: number; reflected?: boolean; noCompound?: boolean; noSplash?: boolean; attacker?: Body | null; kind?: string; glacier?: boolean; freezeAt?: number; riderOnly?: boolean }

export class Duel {
  t = 0;
  tick = 0;
  rng: Rng;
  seed: number;
  events: DuelEvent[] = [];
  snaps: Snap[] = [];
  mages: [Mage, Mage];
  units: Unit[] = [];
  fields: Field[] = [];
  queue: { time: number; seq: number; fn: () => void }[] = [];
  qseq = 0;
  nextId = 10;
  castSeq = 1;
  winner: number | null = null;
  found = new Set<string>();
  sudden = false;
  smoke = 0;
  smokeT = 0;
  lineRes: [(Resolved | null)[], (Resolved | null)[]] = [[], []];
  blame = '';
  reactName = '';
  ledger = [0, 1].map(() => ({ dealt: new Map<string, BreakdownItem>(), taken: new Map<string, BreakdownItem>(), healed: new Map<string, BreakdownItem>() }));

  constructor(a: TomeSpec, b: TomeSpec, seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.mages = [this.mkMage(0, a), this.mkMage(1, b)];
    for (const m of this.mages) for (const a of m.arts) ARTIFACTS[a.id]?.hooks.init?.(this.ctx(m), a.st);
  }

  // ---------- setup ----------
  mkMage(side: Side, spec: TomeSpec): Mage {
    const lines: LineState[] = [];
    const lr: (Resolved | null)[] = [];
    spec.lines.forEach((inst, idx) => {
      if (!inst) { lr.push(null); return; }
      const res = resolveSpell(inst);
      lr.push(res);
      lines.push({ idx, res, uses: res.uses === 0 ? Infinity : res.uses, blot: 0 });
    });
    this.lineRes[side] = lr;
    const m: Mage = {
      id: side, kind: 'mage', side, name: spec.name, title: spec.title || '', hp: spec.hp, maxHp: spec.hp, alive: true,
      st: zeroSt(), decay: zeroSt(), dotT: 0, frozen: 0, freezeImmune: 0, poisonCap: 6, morph: 0, morphKind: null, glacier: 0, vuln: 0,
      ink: spec.ink, maxInk: spec.ink, regen: spec.regen || 4, recharge: PACE.recharge,
      lines, cursor: 0, phase: 'recover', phaseT: PACE.start, prog: 0, total: 0, cur: null,
      silence: 0, sanctuary: 0, hexSelf: 0, congeal: 0, readSlow: 0, steam: false,
      curses: [], auras: [], block: 0, mirror: 0, mirrorAll: 0, counter: 0, angel: false, wardRiders: null,
      wardLines: spec.wards.map(w => (w && w.cond && w.spell) ? (() => { const res = resolveSpell(w.spell); return { cond: w.cond, res, uses: res.uses === 0 ? Infinity : res.uses, cd: 0 }; })() : null),
      arts: spec.artifacts.filter(id => ARTIFACTS[id]).map(id => ({ id, st: {} })),
      lastCast: null, lastPower: 1, halfUsed: false, every8: 0, castCount: 0, freeNext: false, quickNext: false,
      dealt: 0, healed: 0, loops: 0, shock: 0, divine: 0, nextPower: 1, thief: 0, flayer: 0, history: [], erratum: 0, reversed: 0,
    };
    m.st.hex = spec.startHex || 0;
    return m;
  }

  // ---------- plumbing ----------
  ev(e: Evt) { (e as DuelEvent).t = Math.round(this.t * 1000) / 1000; this.events.push(e as DuelEvent); }
  // queued effects remember what caused them, so damage that lands later is still credited to its spell
  at(delay: number, fn: () => void) { const b = this.blame; this.queue.push({ time: this.t + delay, seq: this.qseq++, fn: () => this.blamed(b, fn) }); }
  blamed<T>(label: string, fn: () => T): T { const prev = this.blame; this.blame = label; try { return fn(); } finally { this.blame = prev; } }
  artHook(id: string, fn: () => void) { this.blamed(ARTIFACTS[id]?.name || id, fn); }
  // ---------- damage and healing breakdown ----------
  credit(book: 'dealt' | 'taken' | 'healed', side: Side, label: string, amt: number, ess: Essence | null, kind: string) {
    const m = this.ledger[side][book];
    const e = m.get(label);
    if (e) e.amt += amt; else m.set(label, { label, amt, ess, kind });
  }
  dmgLabel(info: { kind: string; status?: Status; label?: string }): string {
    if (info.label) return info.label;
    if (info.kind === 'dot') return info.status === 'poison' ? 'Poison' : 'Burning';
    if (info.kind === 'reaction') return this.reactName || 'Reactions';
    if (info.kind === 'retribution') return 'Retribution';
    return this.blame || 'Other';
  }
  opp(m: Mage | Side): Mage { const s = typeof m === 'number' ? m : m.side; return this.mages[1 - s]; }
  mage(s: Side): Mage { return this.mages[s]; }
  ctx(m: Mage): ArtCtx { return { duel: this, me: m, foe: this.opp(m) }; }
  hasArt(m: Mage, id: string) { return m.arts.some(a => a.id === id); }
  artFlash(m: Mage, id: string, text?: string) { this.ev({ type: 'art', side: m.side, id, text }); }
  ownerOf(b: Body): Mage { return b.kind === 'mage' ? (b as Mage) : this.mages[(b as Unit).owner]; }
  unitsOf(side: Side): Unit[] { return this.units.filter(u => u.alive && u.side === side); }
  bodiesOf(side: Side): Body[] { const out: Body[] = []; const m = this.mages[side]; if (m.alive) out.push(m); return out.concat(this.unitsOf(side)); }
  bodyById(id: number): Body | undefined { return id < 2 ? this.mages[id as Side] : this.units.find(u => u.id === id); }
  over() { return this.winner !== null; }

  run(): DuelResult {
    this.snap();
    let guard = 0;
    while (this.winner === null && guard++ < 20000) this.step();
    this.snap();
    const wardsOut = this.mages.map(m => m.wardLines.map(w => w ? { cond: w.cond, res: w.res } : null)) as DuelResult['wards'];
    return {
      winner: this.winner === null ? -1 : this.winner, duration: this.t, events: this.events, snaps: this.snaps, seed: this.seed,
      found: [...this.found], hp: [Math.max(0, Math.ceil(this.mages[0].hp)), Math.max(0, Math.ceil(this.mages[1].hp))],
      names: [this.mages[0].name, this.mages[1].name], lines: this.lineRes, wards: wardsOut,
      arts: [this.mages[0].arts.map(a => a.id), this.mages[1].arts.map(a => a.id)],
      stats: { dealt: [Math.round(this.mages[0].dealt), Math.round(this.mages[1].dealt)], healed: [Math.round(this.mages[0].healed), Math.round(this.mages[1].healed)] },
      breakdown: this.ledger.map(l => {
        const out = (m: Map<string, BreakdownItem>) => [...m.values()].map(e => ({ ...e, amt: Math.round(e.amt) })).filter(e => e.amt > 0).sort((a, b) => b.amt - a.amt);
        return { dealt: out(l.dealt), taken: out(l.taken), healed: out(l.healed) };
      }) as DuelResult['breakdown'],
    };
  }

  step() {
    const dt = PACE.dt;
    this.t += dt; this.tick++;
    if (this.tick === 1) for (const m of this.mages) for (const a of m.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.start?.(this.ctx(m), a.st));
    this.queue.sort((a, b) => a.time - b.time || a.seq - b.seq);
    let guard = 0;
    while (this.queue.length && this.queue[0].time <= this.t + 1e-9 && guard++ < 500) {
      const q = this.queue.shift()!;
      if (!this.over()) q.fn();
      this.queue.sort((a, b) => a.time - b.time || a.seq - b.seq);
    }
    for (const m of this.mages) this.tickMage(m, dt);
    for (const u of this.units.slice()) this.tickUnit(u, dt);
    this.units = this.units.filter(u => u.alive);
    for (const f of this.fields.slice()) this.tickField(f, dt);
    if (this.smoke > 0) {
      this.smoke -= dt; this.smokeT += dt;
      if (this.smokeT >= 1) { this.smokeT -= 1; this.blamed('Toxic Smoke', () => { for (const m of this.mages) this.applyStatus(m, 'poison', 1, null); }); }
    }
    if (this.t > PACE.sudden) {
      if (!this.sudden) { this.sudden = true; this.ev({ type: 'sudden' }); }
      const k = (1 + (this.t - PACE.sudden) * 0.5) * dt;
      for (const m of this.mages) { m.hp -= k; this.credit('taken', m.side, 'Sudden death', k, null, 'other'); if (m.hp <= 0) this.kill(m, null); }
    }
    if (this.tick % 2 === 0) this.snap();
    const [a, b] = this.mages;
    if (this.winner === null) {
      if (!a.alive || !b.alive) {
        this.winner = (!a.alive && !b.alive) ? -1 : (!a.alive ? 1 : 0);
        this.ev({ type: 'end', winner: this.winner });
      } else if (this.t >= PACE.timeout) {
        const pa = a.hp / a.maxHp, pb = b.hp / b.maxHp;
        this.winner = Math.abs(pa - pb) < 0.005 ? -1 : (pa > pb ? 0 : 1);
        this.ev({ type: 'end', winner: this.winner, timeout: true });
      }
    }
  }

  // ---------- snapshots ----------
  snap() {
    const ms = this.mages.map(m => {
      const order = m.lines.map(l => l.idx);
      const uses: number[] = [];
      for (const l of m.lines) uses[l.idx] = l.uses === Infinity ? -1 : l.uses;
      const s: MageSnap = {
        hp: Math.max(0, m.hp), maxHp: m.maxHp, ink: m.ink, maxInk: m.maxInk, st: STATUSES.map(k => m.st[k]),
        phase: m.phase, line: m.cur ? m.lines.indexOf(m.cur) : m.cursor, prog: m.prog, total: m.total, order, uses,
        blots: m.lines.filter(l => l.blot > this.t).map(l => l.idx),
        curses: m.curses.map(c => ({ key: c.key, name: c.name, ess: c.res.primary, left: c.id === 'doom' || c.id === 'apocalypse' ? Math.max(0, this.doomLeft(m, c)) : undefined })),
        auras: m.auras.filter(a => a.until > this.t).map(a => ({ id: a.id, name: a.name, ess: a.res.primary })),
        block: m.block, mirror: m.mirror + (m.mirrorAll > 0 ? 1 : 0), counter: m.counter + m.thief, sanctuary: m.sanctuary > 0 || m.divine > 0, angel: m.angel,
        frozen: m.frozen > 0, morph: m.morph > 0 ? m.morphKind : null, silence: m.silence > 0, hexSelf: m.hexSelf,
        wardCd: m.wardLines.map(w => w ? Math.max(0, w.cd) : 0), wardUses: m.wardLines.map(w => w ? (w.uses === Infinity ? -1 : w.uses) : 0),
      };
      return s;
    }) as [MageSnap, MageSnap];
    this.snaps.push({ t: Math.round(this.t * 1000) / 1000, m: ms, u: this.units.filter(u => u.alive).map(u => this.unitSnap(u)), fields: this.fields.map(f => f.id) });
  }

  unitSnap(u: Unit): UnitSnap {
    return {
      id: u.id, side: u.side, kind: u.ukind, hp: Math.max(0, u.hp), maxHp: u.maxHp, x: u.x, z: u.z, tint: u.tint,
      st: STATUSES.map(k => u.st[k]), frozen: u.frozen > 0, morph: u.morph > 0 ? u.morphKind : null, taunt: u.taunt, temp: u.life < 1e8,
    };
  }

  // ---------- per-tick: mages ----------
  tickMage(m: Mage, dt: number) {
    if (!m.alive) return;
    m.ink = Math.min(m.maxInk, m.ink + m.regen * dt);
    this.tickBody(m, dt);
    if (m.silence > 0) m.silence -= dt;
    if (m.sanctuary > 0) m.sanctuary -= dt;
    if (m.congeal > 0) m.congeal -= dt;
    if (m.mirrorAll > 0) m.mirrorAll -= dt;
    if (m.divine > 0) m.divine -= dt;
    if (m.reversed > 0) m.reversed -= dt;
    for (const w of m.wardLines) if (w && w.cd > 0) w.cd -= dt;
    m.auras = m.auras.filter(a => a.until > this.t);
    // Crystal Growth: a crystal that blocks one bolt grows every 8 s, up to 2
    for (const a of m.auras) {
      if (a.id !== 'crystal') continue;
      a.data.t = (a.data.t || 0) + dt * Math.min(1.5, a.power);
      if (a.data.t >= 8) { a.data.t -= 8; if (m.block < 2) { m.block++; this.ev({ type: 'ward', side: m.side, kind: 'block', name: 'Crystal' }); } }
    }
    for (const l of m.lines) if (l.blot && l.blot <= this.t) l.blot = 0;
    this.tickCurses(m, dt);
    for (const a of m.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.tick?.(this.ctx(m), a.st, dt));
    if (!m.alive || this.over()) return;
    m.every8 += dt;
    if (m.every8 >= 8) { m.every8 -= 8; this.wardFire(m, 'every8'); }
    if (!m.halfUsed && m.hp < m.maxHp / 2) { m.halfUsed = true; this.wardFire(m, 'half'); }
    this.tickReading(m, dt);
  }

  // shared by mages and units: DoTs, decay, freeze and morph timers
  tickBody(b: Body, dt: number) {
    b.dotT += dt;
    if (b.dotT >= 1) {
      b.dotT -= 1;
      if (b.st.burn > 0) {
        const back = b.kind === 'mage' && (b as Mage).auras.find(a => a.id === 'backcandle' && a.until > this.t);
        if (back) this.blamed(back.name, () => this.heal(b as Mage, b.st.burn * 0.8));
        else this.damage(this.burnSource(b), b, b.st.burn * 0.8, { kind: 'dot', ess: 'fire', status: 'burn' });
      }
      // Ratify: a mage turned plague rat sickens every second
      if (b.morph > 0 && b.morphKind === 'rat') this.applyStatus(b, 'poison', 1, this.burnSource(b));
      if (b.alive && b.st.poison > 0) this.damage(this.poisonSource(b), b, b.st.poison * (b.kind === 'mage' && (b as Mage).curses.some(c => c.id === 'wither') ? 0.85 : 0.55), { kind: 'dot', ess: 'venom', status: 'poison' });
      if (!b.alive) return;
    }
    const minBurn = b.kind === 'mage' && (b as Mage).curses.some(c => c.id === 'immolate') ? 2 : 0;
    const withered = b.kind === 'mage' && (b as Mage).curses.some(c => c.id === 'wither');
    for (const k in DECAY) {
      const s = k as Status;
      if (b.st[s] > 0) {
        b.decay[s] += dt;
        if (b.decay[s] >= (DECAY[s] as number)) {
          b.decay[s] = 0;
          if (s === 'burn' && b.st.burn <= minBurn) continue;
          if (s === 'poison' && withered) continue;
          if (s === 'burn' && b.kind === 'mage' && this.foeHas(b as Mage, 'heartkiln') && b.st.burn <= 1) continue;
          // big fires burn out faster
          b.st[s] -= s === 'burn' ? Math.max(1, Math.floor(b.st.burn / 3)) : 1;
          if (s === 'burn') b.st.burn = Math.max(minBurn, b.st.burn);
        }
      } else b.decay[s] = 0;
    }
    if (b.frozen > 0) { b.frozen -= dt; if (b.frozen <= 0) this.ev({ type: 'thaw', tgt: b.id }); }
    if (b.freezeImmune > 0) b.freezeImmune -= dt;
    if (b.glacier > 0) b.glacier -= dt;
    if (b.vuln > 0) b.vuln -= dt;
    if (b.morph > 0) {
      b.morph -= dt;
      if (b.morphKind === 'imp' && b.kind === 'mage') {
        // Impmorph: the imp form claws at its owner
        this.damage(this.opp(b as Mage), b, 2 * dt, { kind: 'spell', ess: 'arcane', quiet: true });
      }
      if (b.morph <= 0) { b.morphKind = null; this.ev({ type: 'unmorph', tgt: b.id }); }
    }
  }

  foeHas(m: Mage, art: string) { return this.hasArt(this.opp(m), art); }
  burnSource(b: Body): Mage { return b.kind === 'mage' ? this.opp(b as Mage) : this.mages[1 - (b as Unit).side]; }
  poisonSource(b: Body): Mage { return this.burnSource(b); }

  readSpeed(m: Mage): number {
    let s = 1 / (1 + 0.1 * m.st.chill + m.readSlow);
    if (m.congeal > 0) s *= 0.7;
    if (this.margin(m)) s *= 0.8;
    if (m.auras.some(a => a.id === 'haste' && a.until > this.t)) s *= 1.3;
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.readMult; if (f) s *= f(this.ctx(m), a.st); }
    return s;
  }

  stunned(m: Mage) { return m.frozen > 0 || m.morph > 0 || m.silence > 0 || m.sanctuary > 0; }

  tickReading(m: Mage, dt: number) {
    if (this.stunned(m)) return;
    const speed = this.readSpeed(m);
    if (m.phase === 'reading') {
      m.prog += dt * speed;
      if (m.prog >= m.total) this.finishRead(m);
      return;
    }
    if (m.phase === 'recover' || m.phase === 'recharge') {
      m.phaseT -= dt * speed;
      if (m.phaseT > 0) return;
      if (m.phase === 'recharge') {
        m.cursor = 0; m.loops++;
        this.ev({ type: 'loop', side: m.side });
        for (const a of m.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.loop?.(this.ctx(m), a.st));
        this.wardFire(m, 'loop');
        if (!m.alive || this.over()) return;
      }
      m.phase = 'idle';
    }
    if (m.phase === 'idle' || m.phase === 'starved') this.beginNext(m);
  }

  castable(l: LineState) { return l.uses > 0 && !(l.blot > this.t); }

  margin(m: Mage): Field | undefined { return this.fields.find(f => f.kind === 'margin' && f.on === m.side && f.owner !== m.side); }

  inkCost(m: Mage, res: Resolved): number {
    let c = res.ink;
    if (this.margin(m)) c *= 1.5;
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.inkMult; if (f) c *= f(this.ctx(m), a.st, res); }
    if (m.freeNext) c = 0;
    return Math.round(c);
  }

  readTime(m: Mage, res: Resolved): number {
    let r = res.read;
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.readAdd; if (f) r += f(this.ctx(m), a.st, res); }
    if (m.quickNext) r = 0.35;
    return Math.max(0.35, r);
  }

  beginNext(m: Mage) {
    let i = m.cursor;
    while (i < m.lines.length && !this.castable(m.lines[i])) i++;
    if (i >= m.lines.length) {
      if (!m.lines.some(l => l.uses > 0)) { m.phase = 'idle'; return; }
      m.phase = 'recharge'; m.phaseT = m.recharge; m.cursor = 0; m.cur = null;
      this.ev({ type: 'recharge', side: m.side, dur: m.recharge });
      return;
    }
    const L = m.lines[i];
    const cost = this.inkCost(m, L.res);
    if (m.ink < cost) {
      if (m.phase !== 'starved') this.ev({ type: 'starved', side: m.side });
      m.phase = 'starved'; m.cursor = i;
      return;
    }
    m.ink -= cost;
    const mg = this.margin(m);
    if (mg && cost > 0) { const o = this.mage(mg.owner); o.ink = Math.min(o.maxInk, o.ink + cost / 3); this.ev({ type: 'arc', from: m.id, to: o.id, ess: 'shadow' }); }
    m.cursor = i; m.cur = L; m.phase = 'reading'; m.prog = 0; m.total = this.readTime(m, L.res);
    m.freeNext = false; m.quickNext = false;
    this.ev({ type: 'read', side: m.side, line: L.idx, dur: m.total, name: L.res.name, ess: L.res.primary });
  }

  finishRead(m: Mage) {
    const L = m.cur!;
    const read = m.total;
    m.cur = null;
    m.cursor = m.lines.indexOf(L) + 1;
    m.phase = 'recover'; m.phaseT = Math.max(PACE.minCycle - read, PACE.recover);
    if (L.uses !== Infinity) L.uses--;
    // curses that bite when the victim reads a line
    this.onVictimRead(m);
    if (!m.alive || this.over()) return;
    const foe = this.opp(m);
    for (const a of foe.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.foeRead?.(this.ctx(foe), a.st, L.res));
    if (!m.alive || this.over()) return;
    for (const a of foe.arts) {
      const f = ARTIFACTS[a.id]?.hooks.cancelFoe;
      if (f && f(this.ctx(foe), a.st, L.res)) {
        this.ev({ type: 'fizzle', side: m.side, reason: 'Struck out', name: L.res.name });
        this.artFlash(foe, a.id);
        return;
      }
    }
    // Spellthief: the enemy's spell is caught as it is read and cast by the thief instead
    if (foe.thief > 0) {
      foe.thief--;
      this.ev({ type: 'fizzle', side: m.side, reason: 'Stolen', name: L.res.name });
      this.ev({ type: 'wardUse', side: foe.side, kind: 'counter' });
      const stolen = L.res;
      this.at(0.4, () => this.cast(foe, stolen, { power: 1, via: 'Spellthief', echo: true }));
      return;
    }
    if (foe.counter > 0) {
      foe.counter--;
      this.ev({ type: 'fizzle', side: m.side, reason: 'Countered', name: L.res.name });
      this.ev({ type: 'wardUse', side: foe.side, kind: 'counter' });
      this.wardRetort(foe, m);
      return;
    }
    if (m.erratum > 0) {
      m.erratum--;
      const pool = LIBRARY_SPELLS.filter(s => s.form !== 'ward' && s.id !== 'echo' && s.id !== 'plagiarize');
      const pick = pool[Math.floor(this.rng() * pool.length)];
      this.ev({ type: 'fizzle', side: m.side, reason: 'Misprinted', name: L.res.name });
      this.cast(m, resolveSpell({ uid: 0, base: pick.id, inf: [], tier: 0 }), { power: 1, line: L.idx, via: 'Erratum', echo: true });
      return;
    }
    if (m.steam) {
      m.steam = false;
      if (this.rng() < 0.5) { this.ev({ type: 'fizzle', side: m.side, reason: 'Lost in the steam', name: L.res.name }); return; }
    }
    this.cast(m, L.res, { power: 1, line: L.idx });
    // Moebius Staff: the first line is read twice
    if (L === m.lines.find(l => l.uses >= 0) && this.hasArt(m, 'moebius') && !this.over()) {
      this.artFlash(m, 'moebius');
      this.at(0.45, () => this.cast(m, L.res, { power: 0.6, line: L.idx, via: 'Moebius', echo: true }));
    }
  }

  onVictimRead(m: Mage) {
    for (const c of m.curses.slice()) {
      if (c.id === 'drownedking') {
        const owner = this.mage(c.owner);
        this.blamed(c.name, () => {
          this.ev({ type: 'cursePulse', side: m.side, key: c.key });
          this.applyStatus(m, 'wet', 2, owner);
          // the water they swallow is counted apart from their Wet, so reactions can't drain it
          c.data.water = (c.data.water || 0) + 1;
          if (m.alive && c.data.water >= 5) {
            c.data.water = 0;
            this.ev({ type: 'react', tgt: m.id, id: 'drowned', name: 'Drowned' });
            this.ev({ type: 'shake', amt: 0.8 });
            this.damage(owner, m, 25 * Math.min(1.5, c.power), { kind: 'curse', ess: 'frost' });
          }
        });
        if (!m.alive || this.over()) return;
      }
      if (c.id === 'tongues' || c.res.base.id === 'tongues') {
        const owner = this.mage(c.owner);
        this.ev({ type: 'cursePulse', side: m.side, key: c.key });
        this.blamed(c.name, () => {
          this.damage(owner, m, 3 * c.power, { kind: 'curse', ess: c.res.primary });
          if (!ridersEmpty(c.riders)) this.applyRiders(owner, m, c.riders, c.power, c.res, {});
        });
      }
      if (c.id === 'apocalypse') c.data.shorten = (c.data.shorten || 0) + 1;
    }
  }

  // ---------- casting ----------
  cast(m: Mage, res: Resolved, o: { power: number; line?: number; via?: string; echo?: boolean }) {
    this.blamed(res.name, () => this.castInner(m, res, o));
  }

  private castInner(m: Mage, res: Resolved, o: { power: number; line?: number; via?: string; echo?: boolean }) {
    if (!m.alive || this.over()) return;
    const castId = this.castSeq++;
    const foe = this.opp(m);
    this.ev({ type: 'cast', side: m.side, line: o.line ?? -1, name: res.name, form: res.form, ess: res.primary, castId, via: o.via, legendary: !!res.legendary });
    if (res.legendary && !o.echo) this.ev({ type: 'callout', side: m.side, text: res.legendary.name, sub: res.legendary.text, gold: true });
    let power = o.power * res.power;
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.castPower; if (f) power *= f(this.ctx(m), a.st, res); }
    // Martyrdom: the next spell after it hits twice as hard
    if (m.nextPower !== 1 && !o.echo && res.base.id !== 'martyrdom') { power *= m.nextPower; m.nextPower = 1; this.ev({ type: 'react', tgt: m.id, id: 'martyr', name: 'Empowered' }); }
    for (const a of m.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.cast?.(this.ctx(m), a.st, res, !!o.echo));
    for (const a of foe.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.foeCast?.(this.ctx(foe), a.st, res));
    if (!m.alive || this.over()) return;
    m.castCount++;
    if (!o.echo && res.base.id !== 'echo') {
      m.lastCast = res; m.lastPower = o.power;
      m.history.push({ res, power: o.power }); if (m.history.length > 3) m.history.shift();
    }
    // Shadow Clone: each clone recasts your endless spells at 40%
    if (!o.echo && res.uses === 0 && res.form !== 'summon') {
      let k = 0;
      for (const u of this.unitsOf(m.side)) {
        if (u.ukind !== 'clone' || u.frozen > 0 || u.morph > 0) continue;
        const cp = 0.4 * Math.min(1.5, u.power) * o.power;
        this.at(0.35 + 0.15 * k++, () => { if (u.alive) { this.ev({ type: 'unitAtk', id: u.id, tgt: foe.id }); this.cast(m, res, { power: cp, line: o.line, via: 'Shadow Clone', echo: true }); } });
      }
    }
    // Static Field: each cast charges the enemy
    for (const a of m.auras) if (a.id === 'staticfield' && a.until > this.t) this.applyStatus(foe, 'charge', 1, m);
    // curses that react to the victim casting
    for (const c of m.curses) {
      if (c.res.essCount.storm && c.res.base.id !== 'tongues') {
        this.ev({ type: 'cursePulse', side: m.side, key: c.key });
        this.damage(foe, m, 3 * c.power, { kind: 'curse', ess: 'storm', label: c.name });
        this.applyStatus(m, 'charge', 1, foe);
      }
      if (c.res.inst.inf.some(id => SPELLS[id].essence === 'arcane') && this.rng() < 0.25) {
        this.ev({ type: 'cursePulse', side: m.side, key: c.key });
        this.ev({ type: 'backfire', side: m.side });
        this.damage(foe, m, 6 * c.power, { kind: 'curse', ess: 'arcane', label: c.name });
      }
    }
    // arcane fields make your spells echo
    if (!o.echo && this.fields.some(f => f.owner === m.side && f.flags.echo)) {
      this.at(0.5, () => this.cast(m, res, { power: 0.4 * o.power, line: o.line, via: 'Echo field', echo: true }));
    }
    let tgt: Mage = foe;
    const offensive = res.form === 'bolt' || res.form === 'burst' || res.form === 'curse' || res.form === 'hex';
    if (offensive && m.hexSelf > 0) {
      m.hexSelf--; tgt = m; this.ev({ type: 'backfire', side: m.side });
      if (m.flayer > 0) { m.flayer--; m.ink = Math.max(0, m.ink - 10); }
    }
    else if (offensive && m.st.hex >= 5) { m.st.hex = 0; tgt = m; this.ev({ type: 'backfire', side: m.side }); }

    switch (res.form) {
      case 'bolt': this.castBolt(m, tgt, res, power, castId); break;
      case 'burst': this.castBurst(m, tgt, res, power, castId); break;
      case 'summon': this.castSummon(m, res, power); break;
      case 'field': this.castField(m, res, power); break;
      case 'curse': this.castCurse(m, tgt, res, power, castId); break;
      case 'aura': this.castAura(m, res, power); break;
      case 'blessing': this.castBlessing(m, res, power, o); break;
      case 'hex': this.castHex(m, tgt, res, power, castId); break;
      case 'ward': this.castWard(m, res, power); break;
    }
    if (res.riders.echo && !o.echo) {
      this.at(0.55, () => this.cast(m, res, { power: o.power * res.riders.echo, line: o.line, via: 'Echo', echo: true }));
    }
  }

  // Pick where an enemy bolt actually goes: taunts first, then skeletons that shield the mage.
  boltTarget(src: Mage, intended: Mage): Body {
    if (intended === src) return src;
    const us = this.unitsOf(intended.side);
    const taunt = us.find(u => u.taunt && u.morph <= 0);
    if (taunt) return taunt;
    const block = us.find(u => u.blocker);
    if (block) return block;
    return intended;
  }

  launch(fromId: number, to: Body, flight: number, ess: Essence, style: string, size: number, castId: number | undefined, arrive: (pid: number) => void) {
    const id = this.nextId++;
    this.ev({ type: 'proj', id, from: fromId, to: to.id, flight, ess, style, size, castId });
    this.at(flight, () => arrive(id));
    return id;
  }

  // Resolve arrival of an enemy bolt at a mage: sanctuary, mirrors, walls, darkness.
  // Returns true if the bolt should land.
  intercept(src: Mage, tgt: Body, pid: number, res: Resolved, power: number, castId: number | undefined, reflected: boolean): boolean {
    if (!tgt.alive) { this.ev({ type: 'projEnd', id: pid, outcome: 'fizzle' }); return false; }
    if (tgt.kind !== 'mage' || tgt === src) return true;
    const t = tgt as Mage;
    if (t.sanctuary > 0) { this.ev({ type: 'projEnd', id: pid, outcome: 'fizzle' }); this.ev({ type: 'wardUse', side: t.side, kind: 'sanctuary' }); this.wardRetort(t, src); return false; }
    if ((t.mirrorAll > 0 || t.mirror > 0) && !reflected) {
      if (t.mirrorAll <= 0) t.mirror--;
      this.ev({ type: 'projEnd', id: pid, outcome: 'reflect' });
      this.ev({ type: 'wardUse', side: t.side, kind: 'mirror' });
      this.wardRetort(t, src);
      const back = this.boltTarget(t, src);
      this.launch(t.id, back, 0.8, res.primary, 'bolt', 1, undefined, (p2) => {
        if (!this.intercept(t, back, p2, res, power, undefined, true)) return;
        this.ev({ type: 'projEnd', id: p2, outcome: 'hit' });
        this.boltEffect(t, back, res, power, { reflected: true });
      });
      return false;
    }
    if (t.block > 0) {
      t.block--;
      this.ev({ type: 'projEnd', id: pid, outcome: 'block' });
      this.ev({ type: 'wardUse', side: t.side, kind: 'block' });
      if (t.shock > 0) { t.shock--; this.ev({ type: 'arc', from: t.id, to: src.id, ess: 'storm' }); this.applyStatus(src, 'charge', 3, t); }
      this.wardRetort(t, src);
      return false;
    }
    if (this.fields.some(f => f.owner === t.side && f.flags.dark) && this.rng() < 0.25) {
      this.ev({ type: 'projEnd', id: pid, outcome: 'miss' });
      return false;
    }
    for (const a of t.arts) {
      const f = ARTIFACTS[a.id]?.hooks.incomingBolt;
      if (f && f(this.ctx(t), a.st, res)) { this.ev({ type: 'projEnd', id: pid, outcome: 'reflect' }); return false; }
    }
    return true;
  }

  castBolt(m: Mage, tgt: Mage, res: Resolved, power: number, castId: number, dup = false) {
    const id = res.base.id;
    // Duplicate: the next few bolts are cast twice
    if (!dup) {
      const d = m.auras.find(a => a.id === 'duplicate' && a.until > this.t && (a.data.n || 0) > 0);
      if (d) {
        d.data.n--; if (d.data.n <= 0) d.until = this.t;
        this.at(0.3, () => { if (m.alive) this.castBolt(m, tgt, res, power, castId, true); });
      }
    }
    // Ember Swarm and Arcane Missiles: a volley of small projectiles at random enemies
    if (id === 'emberswarm' || id === 'missiles') {
      const n = id === 'emberswarm' ? 4 : 3;
      const ess: Essence = id === 'emberswarm' ? 'fire' : 'arcane';
      const lite = { ...res, riders: liteRiders(res.riders) } as Resolved;
      const lit = new Set<number>(); // each enemy catches fire from the swarm only once
      for (let i = 0; i < n; i++) {
        this.at(i * 0.12, () => {
          const pool = tgt === m ? [m as Body] : this.bodiesOf(tgt.side);
          if (!pool.length || !m.alive) return;
          const to = pool[Math.floor(this.rng() * pool.length)];
          this.launch(m.id, to, 0.7, ess, 'minor', 0.7, castId, (pid) => {
            if (!this.intercept(m, to, pid, res, power, castId, false)) return;
            this.ev({ type: 'projEnd', id: pid, outcome: 'hit' });
            const burn = id === 'emberswarm' && !lit.has(to.id);
            lit.add(to.id);
            this.hitPayload(m, to, i === 0 ? res : lite, power, id === 'emberswarm' ? 3 : 5, burn ? { burn: 2 } : {}, res.riders.heavy, { castId, noSplash: i > 0 });
          });
        });
      }
      return;
    }
    const to = this.boltTarget(m, tgt);
    const style = id === 'stone' || id === 'boulder' ? 'heavy' : id === 'spark' ? 'spark' : id === 'chainlightning' ? 'lightning' : id === 'rotseed' ? 'seed' : res.riders.heavy ? 'heavy' : 'bolt';
    const flight = style === 'spark' || style === 'lightning' ? 0.5 : style === 'heavy' ? 1.05 : 0.85;
    const size = Math.min(2.2, 0.9 + 0.2 * res.inst.inf.length + (res.legendary ? 0.6 : 0));
    this.launch(m.id, to, flight, res.primary, style, size, castId, (pid) => {
      if (!this.intercept(m, to, pid, res, power, castId, false)) return;
      this.ev({ type: 'projEnd', id: pid, outcome: 'hit' });
      this.boltEffect(m, to, res, power, { castId });
    });
  }

  // Base effect of a bolt plus its riders.
  boltEffect(m: Mage, to: Body, res: Resolved, power: number, o: HitOpts) {
    const id = res.base.id;
    const r = res.riders;
    let dmg = 0; const st: Partial<Record<Status, number>> = {};
    let heavy = r.heavy;
    switch (id) {
      case 'firebolt': dmg = 6; st.burn = 2; break;
      case 'frostshard': dmg = 7 + 2 * to.st.chill; st.chill = 2; break;
      case 'venomdart': dmg = 2; st.poison = 2; break;
      case 'spark': dmg = 5; st.charge = 1; break;
      case 'chainlightning': {
        const c = to.st.charge; to.st.charge = 0;
        dmg = 6 + 5 * c;
        break;
      }
      case 'hexbolt': dmg = 3 + 2 * (to.kind === 'mage' ? (to as Mage).curses.length : 0); break;
      case 'smite': dmg = 10 + 3 * this.unitsOf(to.side).length; break;
      case 'stone':
        heavy = true;
        if (res.legendary?.id === 'thorsanvil') {
          dmg = 40;
          // all their charge conducts twice over
          const c = to.st.charge;
          if (c > 0) {
            to.st.charge = 0; this.react('conduct', to);
            this.at(0.2, () => this.damage(m, to, 8 * c * Math.min(power, 1.5), { kind: 'reaction', ess: 'storm' }));
          }
          this.ev({ type: 'shake', amt: 1.2 });
        } else dmg = 14;
        break;
      case 'icicle': dmg = to.st.wet > 0 || to.frozen > 0 ? 15 : 5; break;
      case 'nettle': dmg = 3 + to.st.poison; break;
      case 'judgement': dmg = 8 + 6 * this.debuffs(to); break;
      case 'boulder':
        dmg = 22; heavy = true;
        if (to.kind === 'mage' && to.side !== m.side) this.daze(to as Mage, 1);
        this.ev({ type: 'shake', amt: 0.8 });
        break;
      case 'rotseed': {
        const victim = to; const owner = m;
        this.ev({ type: 'field', id: this.nextId++, on: to.side, owner: m.side, kind: 'seed', name: 'Rot Seed', ess: 'venom', dur: 6 });
        this.at(6 * r.durMult, () => {
          if (!victim.alive) return;
          const n = victim.st.poison;
          this.ev({ type: 'burst', side: victim.side, ess: 'venom', from: victim.id, flight: 0 });
          this.damage(owner, victim, (3 * n + 4) * power, { kind: 'spell', ess: 'venom' });
        });
        dmg = 2; st.poison = 1;
        break;
      }
    }
    this.hitPayload(m, to, res, power, dmg, st, heavy, o);
    // Chain Lightning jumps to one summon; Tempest chains through every unit.
    if (id === 'chainlightning') {
      if (res.legendary?.id === 'tempest') {
        let prev: Body = to;
        let delay = 0;
        for (const b of (this.units.filter(u => u.alive && u !== to) as Body[]).concat(to.kind === 'unit' ? [this.mages[to.side]] : [])) {
          delay += 0.12; const from = prev; prev = b;
          this.at(delay, () => {
            if (!b.alive) return;
            this.ev({ type: 'arc', from: from.id, to: b.id, ess: 'storm' });
            const foeSide = b.side !== m.side;
            if (foeSide) this.damage(m, b, 6 * power, { kind: 'spell', ess: 'storm' });
            this.applyStatus(b, 'chill', 1, m); this.applyStatus(b, 'charge', 1, m);
          });
        }
      } else {
        const others = this.unitsOf(to.side).filter(u => u !== to);
        const next: Body | undefined = others.length ? others[Math.floor(this.rng() * others.length)] : (to.kind === 'unit' ? this.mages[to.side] : undefined);
        if (next) {
          this.at(0.12, () => {
            if (!next.alive) return;
            this.ev({ type: 'arc', from: to.id, to: next.id, ess: 'storm' });
            this.damage(m, next, 6 * power, { kind: 'spell', ess: 'storm' });
          });
        }
      }
    }
  }

  // Deal base damage and statuses, then everything the infusions bring.
  hitPayload(m: Mage, to: Body, res: Resolved, power: number, baseDmg: number, baseSt: Partial<Record<Status, number>>, heavy: boolean, o: HitOpts) {
    const r = res.riders;
    let dmg = baseDmg + r.dmg;
    if (r.judgement) dmg += r.judgement * this.debuffs(to);
    dmg *= power;
    const cp = res.compounds;
    if (cp.includes('magma')) heavy = true;
    if (cp.includes('sunfire') && to.kind === 'unit') dmg *= 2;
    if (cp.includes('blackice') && to.side !== m.side) to.freezeImmune = 0;
    const glacier = res.compounds.includes('glacier') || o.glacier;
    const dealt = dmg > 0 ? this.damage(m, to, dmg, { kind: o.kind === 'summon' ? 'summon' : 'spell', ess: res.primary, heavy, glacier, castId: o.castId, res }) : 0;
    if (dealt > 0 && to.kind === 'mage' && to.side !== m.side && o.kind !== 'summon') this.wardFire(to as Mage, 'struck');
    const st: Partial<Record<Status, number>> = { ...baseSt };
    for (const k in r.st) { const s = k as Status; st[s] = (st[s] || 0) + (r.st[s] || 0); }
    for (const s of STATUSES) {
      const n = st[s]; if (!n || !to.alive) continue;
      const amt = Math.max(1, Math.round(n * r.statusMult * Math.min(power, 1.6)));
      this.applyStatus(to, s, amt, m, { freezeAt: o.freezeAt });
      if (s === 'chill' && res.compounds.includes('rime')) this.applyStatus(to, 'charge', amt, m);
      if (s === 'poison' && res.compounds.includes('blightfrost')) this.applyStatus(to, 'chill', amt, m);
    }
    this.afterHit(m, to, res, power, dealt, o);
  }

  debuffs(b: Body): number {
    let n = 0;
    for (const s of STATUSES) if (b.st[s] > 0) n++;
    if (b.kind === 'mage') n += (b as Mage).curses.length;
    return n;
  }

  // Riders that do not depend on the base spell: heals, drains, chains, splashes, hatches, compounds.
  afterHit(m: Mage, to: Body, res: Resolved, power: number, dealt: number, o: HitOpts) {
    const r = res.riders;
    const foeSide = to.side !== m.side;
    if (r.heal) this.heal(m, r.heal * power);
    if (r.drain && dealt > 0) this.heal(m, dealt * r.drain);
    if (res.compounds.includes('twilight') && dealt > 0) this.heal(m, dealt * 0.5);
    if (r.daze && to.kind === 'mage' && foeSide) this.daze(to as Mage, r.daze);
    if (r.guard) { m.block += r.guard; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); }
    for (const k of r.hatch) this.spawnMinion(m, k, 6 * r.durMult, power, to);
    if (to.kind === 'mage' && res.essences.includes('holy') && to.st.hex > 0) {
      const h = to.st.hex; to.st.hex = 0; this.react('exorcism', to);
      this.damage(m, to, 6 * h, { kind: 'reaction', ess: 'holy' });
    }
    // Snowman: whatever hits it gains 2 Chill
    if (to.kind === 'unit' && (to as Unit).ukind === 'snowman' && foeSide && !o.riderOnly && dealt > 0) this.applyStatus(o.attacker || m, 'chill', 2, this.mages[to.side]);
    // Frost Armour: whoever hits you gains Chill
    if (to.kind === 'mage' && foeSide && !o.riderOnly) {
      const tm = to as Mage;
      for (const a of tm.auras) if (a.id === 'frostarmour' && a.until > this.t) { const att = o.attacker || m; this.applyStatus(att, 'chill', 1, tm); this.damage(tm, att, 3 * a.power, { kind: 'spell', ess: 'frost', quiet: true }); }
    }
    // fused auras put their riders on every hit you make
    if (foeSide && !o.riderOnly) for (const a of m.auras) if (a.until > this.t && !ridersEmpty(a.riders)) this.applyRiders(m, to, a.riders, a.power, a.res, { noSplash: true });
    if (!o.noSplash && foeSide) {
      const lite = { ...res, riders: { ...emptyRiders(), st: halfSt(r.st) } } as Resolved;
      if (r.chain) {
        const pool = this.bodiesOf(to.side).filter(b => b !== to);
        if (pool.length) {
          const b = pool[Math.floor(this.rng() * pool.length)];
          this.at(0.1, () => { if (!b.alive) return; this.ev({ type: 'arc', from: to.id, to: b.id, ess: res.primary }); this.hitPayload(m, b, lite, power * Math.min(1, r.chain), Math.max(3, dealt / Math.max(power, 0.01)), {}, false, { noSplash: true }); });
        }
      }
      if (r.splash) for (const u of this.unitsOf(to.side)) if (u !== to) this.hitPayload(m, u, lite, power * r.splash, Math.max(3, dealt / Math.max(power, 0.01)), {}, false, { noSplash: true });
      const flick = r.flicker + (res.compounds.includes('flicker') ? 0.5 : 0);
      if (flick) {
        const pool = this.bodiesOf(to.side).filter(b => b !== to);
        if (pool.length) {
          const b = pool[Math.floor(this.rng() * pool.length)];
          this.at(0.15, () => { if (!b.alive) return; this.ev({ type: 'arc', from: to.id, to: b.id, ess: 'arcane' }); this.hitPayload(m, b, lite, power * flick, Math.max(3, dealt / Math.max(power, 0.01)), {}, false, { noSplash: true }); });
        }
      }
      if (res.compounds.includes('steam') && to.kind === 'mage') { (to as Mage).steam = true; }
      if (res.compounds.includes('plasma')) {
        const pool = this.bodiesOf(to.side).filter(b => b !== to);
        if (pool.length) { const b = pool[Math.floor(this.rng() * pool.length)]; this.ev({ type: 'arc', from: to.id, to: b.id, ess: 'fire' }); this.applyStatus(b, 'burn', 2, m); }
      }
      if (res.compounds.includes('smog')) this.makeField(m, to.side, 'smog', 'Smog', null, power, 6, 2, emptyRiders(), 'venom', {});
      if (res.compounds.includes('plague')) for (const b of this.bodiesOf(to.side)) if (b !== to) this.applyStatus(b, 'poison', 1, m);
      if ((res.essCount.fire || 0) >= 3) for (const u of this.unitsOf(to.side)) if (u !== to) this.applyStatus(u, 'burn', 1, m);
      if (res.compounds.length) this.compoundHit(m, to, res, power, dealt);
    }
  }

  // The second shelf of compounds: what two essences do together on a hit.
  compoundHit(m: Mage, to: Body, res: Resolved, power: number, dealt: number) {
    const cp = res.compounds;
    const has = (c: string) => cp.includes(c as never);
    const others = () => this.bodiesOf(to.side).filter(b => b !== to);
    const tm = to.kind === 'mage' ? to as Mage : null;
    if (has('magma')) for (const u of this.unitsOf(to.side)) if (u !== to) { this.ev({ type: 'strike', tgt: u.id, ess: 'fire' }); this.damage(m, u, 4 * power, { kind: 'spell', ess: 'fire' }); this.applyStatus(u, 'burn', 1, m); }
    if (has('hellfire') && to.st.burn > 0) this.heal(m, 2 * to.st.burn);
    if (has('wildflame')) for (const b of others()) { this.ev({ type: 'arc', from: to.id, to: b.id, ess: 'fire' }); this.damage(m, b, 3 * power, { kind: 'spell', ess: 'fire' }); this.applyStatus(b, 'burn', 1, m); }
    if (has('aurora') && to.st.chill > 0) this.heal(m, 2 * to.st.chill);
    if (has('stasis') && tm) this.daze(tm, 1);
    if (has('neurotoxin') && tm) tm.readSlow = Math.min(0.5, tm.readSlow + 0.03);
    if (has('acid')) to.vuln = 5;
    if (has('purge')) this.cleanse(m, 2, false);
    if (has('mutation') && to.st.poison >= 2) {
      to.st.poison -= 2;
      this.ev({ type: 'react', tgt: to.id, id: 'mutation', name: 'Mutation' });
      const pool: Status[] = ['burn', 'chill', 'wet', 'oil', 'charge'];
      for (let i = 0; i < 2; i++) this.applyStatus(to, pool[Math.floor(this.rng() * pool.length)], 1, m);
    }
    if (has('magnetite') && dealt > 0) for (const u of this.unitsOf(to.side)) if (u !== to) { this.ev({ type: 'arc', from: to.id, to: u.id, ess: 'stone' }); this.damage(m, u, dealt * 0.5, { kind: 'spell', ess: 'stone' }); }
    if (has('blacklightning') && tm && to.st.charge > 0) {
      const take = Math.min(tm.ink, 4 * to.st.charge);
      tm.ink -= take; m.ink = Math.min(m.maxInk, m.ink + take);
    }
    if (has('radiance') && to.st.charge > 0) this.heal(m, 2 * to.st.charge);
    if (has('obsidian') && dealt > 0) {
      const echo = dealt * 0.4;
      this.at(2, () => { if (to.alive) { this.ev({ type: 'strike', tgt: to.id, ess: 'shadow' }); this.damage(m, to, echo, { kind: 'spell', ess: 'shadow' }); } });
    }
    if (has('bulwark') && m.block < 3) { m.block++; this.ev({ type: 'ward', side: m.side, kind: 'block', name: 'Bulwark' }); }
    if (has('gravity')) {
      if (tm) this.daze(tm, 0.8);
      for (const u of this.unitsOf(to.side)) u.atkT += 0.8;
    }
    if (has('void') && tm) this.voidStrip(tm);
    if (has('prism') && dealt > 0) for (const b of others()) { this.ev({ type: 'arc', from: to.id, to: b.id, ess: 'holy' }); this.damage(m, b, dealt * 0.4, { kind: 'spell', ess: 'holy' }); }
  }

  // Void: strip one ward or aura
  voidStrip(t: Mage) {
    let what = '';
    if (t.mirror > 0) { t.mirror--; what = 'mirror'; }
    else if (t.counter > 0) { t.counter--; what = 'counter'; }
    else if (t.thief > 0) { t.thief--; what = 'counter'; }
    else if (t.block > 0) { t.block--; if (t.shock > t.block) t.shock = t.block; what = 'block'; }
    else if (t.angel) { t.angel = false; what = 'angel'; }
    else if (t.auras.length) { const a = t.auras.pop()!; a.until = this.t; what = a.name; }
    if (what) this.ev({ type: 'react', tgt: t.id, id: 'void', name: 'Voided' });
  }

  // Apply a rider bundle on its own (curse pulses, field pulses, aura hits, ward retorts, blessings).
  applyRiders(m: Mage, to: Body, r: Riders, power: number, res: Resolved, o: HitOpts) {
    if (!to.alive) return;
    const fake = { ...res, riders: r, compounds: [] } as Resolved;
    this.hitPayload(m, to, fake, power, 0, {}, r.heavy, { ...o, noSplash: true, riderOnly: true });
  }

  daze(m: Mage, secs: number) {
    if (m.phase === 'reading') m.prog = Math.max(0, m.prog - secs);
    else if (m.phase === 'recover' || m.phase === 'recharge') m.phaseT += secs;
  }

  wardRetort(owner: Mage, attacker: Mage) {
    if (!owner.wardRiders || ridersEmpty(owner.wardRiders)) return;
    const r = owner.wardRiders;
    this.applyRiders(owner, attacker, { ...r, hatch: [], guard: 0, echo: 0 }, 1, resolveSpell({ uid: 0, base: 'mirror', inf: [], tier: 0 }), {});
  }

  castBurst(m: Mage, tgt: Mage, res: Resolved, power: number, castId: number) {
    const id = res.base.id;
    const flight = 0.75;
    const all = id === 'earthquake';
    this.ev({ type: 'burst', side: tgt.side, ess: res.primary, from: m.id, flight, all });
    this.at(flight, () => {
      if (id === 'earthquake') {
        this.ev({ type: 'shake', amt: 1 });
        const victims: Body[] = [tgt, ...this.units.filter(u => u.alive)];
        for (const b of victims) if (b.alive) this.hitPayload(m, b, res, power, 8, {}, true, { castId, noSplash: b !== tgt });
        return;
      }
      if (id === 'gale') {
        // blow away their fields and knock their summons back
        for (const f of this.fields.filter(f => f.owner === tgt.side)) { this.fields = this.fields.filter(x => x !== f); this.ev({ type: 'fieldEnd', id: f.id }); }
        for (const b of this.bodiesOf(tgt.side)) {
          if (b.kind === 'unit') (b as Unit).atkT += 2;
          this.hitPayload(m, b, res, power, 5, {}, res.riders.heavy, { castId, noSplash: b !== tgt });
        }
        return;
      }
      if (res.legendary?.id === 'supernova') {
        this.ev({ type: 'shake', amt: 1.4 });
        if (tgt !== m) tgt.steam = true;
        for (const b of this.bodiesOf(tgt.side)) this.hitPayload(m, b, res, power, 30, { burn: 4 }, res.riders.heavy, { castId, noSplash: b !== tgt });
        return;
      }
      const victims = this.bodiesOf(tgt.side);
      for (const b of victims) {
        if (b.kind === 'mage' && (b as Mage).sanctuary > 0) { this.ev({ type: 'wardUse', side: b.side, kind: 'sanctuary' }); continue; }
        this.hitPayload(m, b, res, power, 10, { burn: 2 }, res.riders.heavy, { castId, noSplash: b !== tgt });
      }
    });
  }

  // ---------- summons ----------
  slotFor(side: Side, row: 'front' | 'back'): { x: number; z: number; slot: number } {
    const used = new Set(this.units.filter(u => u.alive && u.side === side && u.row === row).map(u => u.slot));
    let slot = 0; while (used.has(slot) && slot < SLOT_X.length - 1) slot++;
    const sign = side === 0 ? 1 : -1;
    const z = sign * (row === 'front' ? BOARD.frontZ + (slot > 3 ? 0.9 : 0) : BOARD.backZ + (slot > 3 ? 0.8 : 0));
    return { x: SLOT_X[slot] + (used.has(slot) ? (this.rng() - 0.5) : 0), z, slot };
  }

  addUnit(owner: Side, kind: string, o: { power: number; riders?: Riders; ess?: Essence[]; life?: number; tint?: Essence | null; res?: Resolved | null; hpMult?: number; name?: string }): Unit | null {
    if (this.unitsOf(owner).length >= MAX_UNITS) return null;
    const d = UNITS[kind];
    const ess = o.ess || [];
    const has = (e: Essence) => ess.includes(e);
    let hp = d.hp * (o.hpMult || 1) * Math.min(1.8, o.power);
    let interval = d.interval;
    let taunt = !!d.taunt;
    if (has('frost')) { hp *= 1.3; interval *= 1.15; }
    if (has('stone')) { hp *= 1.5; interval *= 1.1; taunt = true; }
    const owners = this.mages[owner];
    for (const a of owners.arts) { const f = ARTIFACTS[a.id]?.hooks.unitHp; if (f) hp *= f(this.ctx(owners), a.st, kind); }
    const row: 'front' | 'back' = d.ranged ? 'back' : 'front';
    // leeches and hydra heads latch onto the enemy mage, on the far side of the board
    const latch = kind === 'leech' || kind === 'hydra' || kind === 'bookworm';
    const pos = kind === 'ball' ? { x: (this.rng() - 0.5) * 3, z: (owner === 0 ? 1 : -1) * BOARD.backZ, slot: 99 }
      : latch ? { x: (this.rng() - 0.5) * 2.6, z: (owner === 0 ? -1 : 1) * (BOARD.mageZ - 0.9 - this.rng() * 0.5), slot: 99 }
      : this.slotFor(owner, row);
    const u: Unit = {
      id: this.nextId++, kind: 'unit', side: owner, owner, name: o.name || UNIT_TITLE[kind] || kind, ukind: kind,
      hp, maxHp: hp, alive: true, st: zeroSt(), decay: zeroSt(), dotT: 0, frozen: 0, freezeImmune: 0, poisonCap: 6, morph: 0, morphKind: null, glacier: 0, vuln: 0,
      atk: d.atk, interval, atkT: 0.6 + this.rng() * 0.6, ranged: d.ranged, taunt, blocker: !!d.blocker, life: o.life ?? Infinity,
      riders: o.riders || emptyRiders(), ess, power: o.power, x: pos.x, z: pos.z, slot: pos.slot, row: kind === 'ball' || latch ? 'free' : row,
      split: has('arcane'), tint: o.tint ?? null, flags: {},
    };
    this.units.push(u);
    this.ev({ type: 'spawn', unit: this.unitSnap(u), temp: u.life < 1e8 });
    for (const a of owners.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.summon?.(this.ctx(owners), a.st, u));
    return u;
  }

  castSummon(m: Mage, res: Resolved, power: number) {
    const infEss = res.inst.inf.map(id => SPELLS[id].essence).filter((e): e is Essence => !!e);
    const lite = liteRiders(res.riders);
    lite.hatch = []; lite.guard = 0; lite.echo = 0;
    const common = { power, riders: lite, ess: infEss, tint: infEss[0] || null, res };
    let kind = res.base.unit || 'imp';
    if (res.legendary?.id === 'pitlord') kind = 'pitlord';
    else if (res.legendary?.id === 'frostlich') kind = 'frostlich';
    else if (res.legendary?.id === 'worldroot') kind = 'worldroot';
    else if (res.legendary?.id === 'seraph') kind = 'seraph';
    else if (res.legendary?.id === 'hydra') kind = 'hydra';
    else if (res.legendary?.id === 'phoenixlord') kind = 'phoenix';
    else if (res.legendary?.id === 'stormspire') kind = 'stormspire';
    else if (res.special === 'cherub') kind = 'cherub';
    const count = res.special === 'legion' ? 5 : kind === 'skeleton' ? 3 : res.special === 'impgang' ? 3 : 1;
    const twin = this.hasArt(m, 'twincoin');
    for (let rep = 0; rep < (twin ? 2 : 1); rep++) {
      for (let i = 0; i < count; i++) {
        const u = this.addUnit(m.side, kind, { ...common, name: res.name, hpMult: res.legendary?.id === 'phoenixlord' ? 1.6 : res.special === 'impgang' ? 0.6 : 1 });
        if (u && kind === 'egg') u.flags.lives = 1;
        if (u && res.legendary?.id === 'phoenixlord') { u.flags.lives = 99; u.flags.lord = 1; u.atk = 6; }
        if (u && res.legendary?.id === 'blackdeath') u.flags.breed = 1;
        if (u && res.special === 'impgang') u.interval = 2;
        if (u && res.traits.includes('guard')) u.taunt = true;
        if (u && res.traits.includes('quick')) u.interval *= 0.65;
        if (u && res.traits.includes('echo')) u.split = true;
      }
      if (twin && rep === 0) this.artFlash(m, 'twincoin');
    }
    // hatch traits bring companions
    for (const k of res.riders.hatch) this.addUnit(m.side, k === 'treant' ? 'sapling' : k, { ...common, hpMult: 0.5, name: UNIT_TITLE[k] });
    if (res.riders.guard) { m.block += res.riders.guard; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); }
  }

  spawnMinion(m: Mage, kind: string, life: number, power: number, near?: Body) {
    const k = kind === 'treant' ? 'sapling' : kind === 'skeleton' ? 'skeleton' : kind;
    const u = this.addUnit(m.side, k, { power: Math.min(power, 1.2), life, hpMult: 0.6 });
    if (u && k === 'egg') u.flags.hatchAt = Math.min(3, life * 0.5);
    if (u && near && k === 'ball') { u.x = near.kind === 'unit' ? (near as Unit).x : 0; }
  }

  hatchEgg(egg: Unit) {
    egg.alive = false;
    this.ev({ type: 'death', tgt: egg.id, how: 'hatch' });
    const lord = !!egg.flags.lord;
    const p = this.addUnit(egg.owner, 'phoenix', { power: egg.power, riders: egg.riders, ess: egg.ess, tint: egg.tint, name: lord ? 'Phoenix Lord' : 'Phoenix', hpMult: lord ? 1.6 : 1, life: egg.life === Infinity ? Infinity : egg.life + 6 });
    if (!p) return;
    p.flags.lives = egg.flags.lives || 0;
    if (lord) { p.flags.lord = 1; p.atk = 6; }
    p.x = egg.x; p.z = egg.z;
    this.ev({ type: 'burst', side: egg.side, ess: 'fire', from: p.id, flight: 0 });
  }

  tickUnit(u: Unit, dt: number) { this.blamed(u.name, () => this.tickUnitInner(u, dt)); }

  private tickUnitInner(u: Unit, dt: number) {
    if (!u.alive) return;
    this.tickBody(u, dt);
    if (!u.alive) return;
    if (u.life !== Infinity) {
      u.life -= dt;
      if (u.life <= 0) { u.alive = false; this.ev({ type: 'death', tgt: u.id, how: 'fade' }); return; }
    }
    if (u.frozen > 0 || u.morph > 0) return;
    const owner = this.mages[u.owner];
    const foe = this.opp(owner);
    if (u.ukind === 'ball') {
      const dir = u.side === 0 ? -1 : 1;
      u.z += dir * 2.4 * dt;
      if (Math.abs(u.z - (dir < 0 ? -BOARD.mageZ : BOARD.mageZ)) < 0.9) {
        u.alive = false;
        this.ev({ type: 'death', tgt: u.id, how: 'burst' });
        this.ev({ type: 'burst', side: foe.side, ess: 'storm', from: u.id, flight: 0 });
        this.ev({ type: 'shake', amt: 0.6 });
        const res = resolveSpell({ uid: 0, base: 'balllightning', inf: [], tier: 0 });
        this.hitPayload(owner, foe, { ...res, riders: u.riders } as Resolved, u.power, 20, {}, false, { noSplash: true });
        for (const e of this.unitsOf(foe.side)) { this.ev({ type: 'arc', from: foe.id, to: e.id, ess: 'storm' }); this.damage(owner, e, 10 * u.power, { kind: 'spell', ess: 'storm' }); }
      }
      return;
    }
    if (u.ukind === 'worldroot') {
      u.flags.grow = (u.flags.grow || 0) + dt;
      if (u.flags.grow >= 5) { u.flags.grow -= 5; u.maxHp += 10; u.hp += 10; }
    }
    if (u.ukind === 'egg') {
      u.flags.age = (u.flags.age || 0) + dt;
      if (u.flags.age >= (u.flags.hatchAt || 6)) this.hatchEgg(u);
      return;
    }
    if (u.ukind === 'leech' || u.ukind === 'hydra') {
      u.atkT -= dt;
      if (u.atkT > 0) return;
      u.atkT = 1;
      if (!foe.alive || foe.sanctuary > 0) return;
      const rate = (u.ukind === 'hydra' ? 2 : 1.5) * (u.flags.half ? 0.5 : 1) * Math.min(1.6, u.power);
      this.ev({ type: 'unitAtk', id: u.id, tgt: foe.id });
      const d = this.damage(owner, foe, rate, { kind: 'summon', ess: 'venom', quiet: true });
      if (d > 0) this.heal(owner, d);
      if (!ridersEmpty(u.riders) && this.rng() < 0.25) this.applyRiders(owner, foe, { ...u.riders, heal: 0, drain: 0 }, u.power * 0.5, resolveSpell({ uid: 0, base: 'leech', inf: [], tier: 0 }), { attacker: u, kind: 'summon' });
      return;
    }
    if (u.ukind === 'bookworm' || u.ukind === 'author' || u.ukind === 'thing') {
      u.atkT -= dt / (1 + 0.08 * u.st.chill);
      if (u.atkT > 0) return;
      u.atkT = u.interval;
      if (!foe.alive) return;
      if (u.ukind === 'bookworm') {
        // eats a use from a limited line, or smudges an endless one
        const limited = foe.lines.filter(l => l.uses !== Infinity && l.uses > 0);
        this.ev({ type: 'unitAtk', id: u.id, tgt: foe.id });
        if (limited.length) {
          const L = limited[Math.floor(this.rng() * limited.length)];
          L.uses--;
          this.ev({ type: 'react', tgt: foe.id, id: 'eaten', name: `${L.res.name} nibbled` });
        } else {
          const free = foe.lines.filter(l => !(l.blot > this.t) && l.uses > 0);
          if (free.length) { const L = free[Math.floor(this.rng() * free.length)]; L.blot = this.t + 3; this.ev({ type: 'blot', side: foe.side, line: L.idx, dur: 3 }); }
        }
        this.heal(owner, 3 * Math.min(1.5, u.power));
        if (!ridersEmpty(u.riders)) this.applyRiders(owner, foe, { ...u.riders, heal: 0, drain: 0 }, u.power * 0.5, resolveSpell({ uid: 0, base: 'bookworm', inf: [], tier: 0 }), { attacker: u, kind: 'summon' });
        return;
      }
      if (u.ukind === 'author') {
        const pool = LIBRARY_SPELLS.filter(s => s.form !== 'summon' && s.form !== 'ward' && s.id !== 'echo' && s.id !== 'wildmagic' && s.id !== 'martyrdom' && s.id !== 'plagiarize');
        const pick = pool[Math.floor(this.rng() * pool.length)];
        this.ev({ type: 'unitAtk', id: u.id, tgt: foe.id });
        const p = 0.6 * Math.min(1.5, u.power);
        this.at(0.25, () => { if (u.alive) this.cast(owner, resolveSpell({ uid: 0, base: pick.id, inf: [], tier: 0 }), { power: p, via: 'The Author', echo: true }); });
        return;
      }
      // the Thing swallows an enemy summon whole, or bites the mage
      const prey = this.unitsOf(foe.side);
      if (prey.length) {
        const e = prey.reduce((a, b) => (b.hp > a.hp ? b : a));
        this.ev({ type: 'unitAtk', id: u.id, tgt: e.id });
        this.at(0.25, () => {
          if (!e.alive || !u.alive) return;
          const hp = e.hp;
          this.ev({ type: 'react', tgt: e.id, id: 'swallowed', name: 'Swallowed' });
          this.damage(owner, e, hp + 1, { kind: 'summon', ess: 'shadow' });
          u.maxHp += 10; u.hp = Math.min(u.maxHp, u.hp + Math.min(30, hp));
        });
      } else {
        this.ev({ type: 'unitAtk', id: u.id, tgt: foe.id });
        this.at(0.25, () => { if (u.alive) this.damage(owner, foe, 8 * Math.min(1.6, u.power), { kind: 'summon', ess: 'shadow' }); });
      }
      return;
    }
    if (u.ukind === 'tesla' || u.ukind === 'stormspire') {
      u.atkT -= dt / (1 + 0.08 * u.st.chill);
      if (u.atkT > 0) return;
      u.atkT = u.interval;
      const pool = this.bodiesOf(foe.side);
      if (!pool.length) return;
      let tgt = pool[0];
      for (const b of pool) if (b.st.charge > tgt.st.charge) tgt = b;
      const zap = (b: Body, from: number, mult: number) => {
        this.ev({ type: 'arc', from, to: b.id, ess: 'storm' });
        this.damage(owner, b, (3 + b.st.charge) * mult * Math.min(1.6, u.power), { kind: 'summon', ess: 'storm' });
        // the spire drinks the charge its infusions would add, or it would overload everything in seconds
        const rid = u.ukind === 'stormspire' ? { ...u.riders, chain: 0, st: { ...u.riders.st, charge: 0 } } : { ...u.riders, chain: 0 };
        if (b.alive && mult >= 1 && !ridersEmpty(rid)) this.applyRiders(owner, b, rid, u.power * mult, resolveSpell({ uid: 0, base: 'teslacoil', inf: [], tier: 0 }), { attacker: u, kind: 'summon' });
      };
      zap(tgt, u.id, 1);
      const rest = pool.filter(b => b !== tgt);
      if (u.ukind === 'stormspire') {
        let prev = tgt; let delay = 0;
        for (const b of rest) { const from = prev.id; prev = b; delay += 0.1; this.at(delay, () => { if (b.alive) zap(b, from, 0.5); }); }
      } else if (rest.length) {
        const b = rest[Math.floor(this.rng() * rest.length)];
        this.at(0.12, () => { if (b.alive) zap(b, tgt.id, 0.5); });
      }
      return;
    }
    if (u.atk <= 0) return;
    u.atkT -= dt / (1 + 0.08 * u.st.chill);
    if (u.atkT > 0) return;
    u.atkT = u.interval;
    if (u.ukind === 'cherub') {
      this.ev({ type: 'unitAtk', id: u.id, tgt: owner.id });
      this.heal(owner, 2 * u.power);
      return;
    }
    if (u.ukind === 'seraph') this.heal(owner, 4 * Math.min(1.6, u.power));
    // choose a target: taunting units first, else the mage, unless in Sanctuary
    const theirs = this.unitsOf(foe.side);
    let tgt: Body | undefined = theirs.find(x => x.taunt && x.morph <= 0);
    if (!tgt && !u.ranged) tgt = theirs.find(x => x.row === 'front');
    if (!tgt) tgt = foe.sanctuary > 0 ? theirs[0] : foe;
    if (!tgt || !tgt.alive) return;
    let dmg = u.atk;
    const st: Partial<Record<Status, number>> = { ...(UNITS[u.ukind].st || {}) };
    if (u.ukind === 'salamander') {
      const eat = Math.min(2, owner.st.burn);
      if (eat > 0) { owner.st.burn -= eat; this.ev({ type: 'status', tgt: owner.id, s: 'burn', n: -eat, total: owner.st.burn }); }
      dmg = 3 + 2 * eat; st.burn = 1 + eat;
    }
    if (u.ukind === 'pitlord') {
      let burning = 0; for (const b of [...this.mages, ...this.units]) if (b.alive) burning += b.st.burn;
      dmg = 4 + burning; st.burn = 1;
    }
    const target = tgt;
    const res = { ...resolveSpell({ uid: 0, base: 'imp', inf: [], tier: 0 }), riders: u.riders, compounds: [], essences: u.ess, primary: (u.tint || UNIT_ESS[u.ukind] || 'stone') as Essence } as Resolved;
    if (u.ess.includes('storm')) res.riders = { ...u.riders, chain: Math.max(u.riders.chain, 0.5) };
    const land = () => {
      if (!target.alive || !u.alive && u.ukind !== 'skeleton') return;
      this.hitPayload(owner, target, res, u.power, dmg, st, u.ess.includes('stone') || u.ukind === 'golem', { attacker: u, kind: 'summon', freezeAt: u.ukind === 'frostlich' ? 3 : undefined });
      // Black Death: every bite breeds another rat, up to five
      if (u.flags.breed && u.alive && this.unitsOf(u.owner).filter(x => x.flags.breed).length < 5) {
        const pup = this.addUnit(u.owner, 'rat', { power: u.power, riders: u.riders, ess: u.ess, tint: u.tint, name: 'Black Rat', hpMult: 0.7 });
        if (pup) pup.flags.breed = 1;
      }
    };
    if (u.ranged) {
      this.launch(u.id, target, 0.6, res.primary, 'minor', 0.55, undefined, (pid) => { this.ev({ type: 'projEnd', id: pid, outcome: 'hit' }); land(); });
    } else {
      this.ev({ type: 'unitAtk', id: u.id, tgt: target.id });
      this.at(0.22, land);
    }
  }

  // ---------- fields ----------
  makeField(owner: Mage, on: Side, kind: string, name: string, res: Resolved | null, power: number, dur: number, period: number, riders: Riders, ess: Essence, flags: Record<string, number>): Field {
    const f: Field = { id: this.nextId++, owner: owner.side, on, kind, name, res, power, dur, age: 0, period, tickT: 0, riders, ess, flags };
    this.fields.push(f);
    this.ev({ type: 'field', id: f.id, on, owner: owner.side, kind, name, ess, dur });
    return f;
  }

  castField(m: Mage, res: Resolved, power: number) {
    const foe = this.opp(m);
    const id = res.base.id;
    const r = res.riders;
    const lite = liteRiders(r); lite.hatch = []; lite.guard = 0; lite.echo = 0;
    const infEss = res.inst.inf.map(x => SPELLS[x].essence).filter((e): e is Essence => !!e);
    const flags: Record<string, number> = {};
    if (infEss.includes('shadow')) flags.dark = 1;
    if (infEss.includes('arcane')) flags.echo = 1;
    if (infEss.includes('holy')) flags.heal = 1;
    if (infEss.includes('storm')) flags.strike = 1;
    if (infEss.includes('stone')) { m.block += 1; this.ev({ type: 'ward', side: m.side, kind: 'block', name: 'Stone wall' }); }
    const durMult = r.durMult;
    for (const k of r.hatch) this.spawnMinion(m, k, 8, power);
    if (r.guard) { m.block += r.guard; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); }
    const enemies = () => this.bodiesOf(foe.side);
    const n = (x: number) => Math.max(1, Math.round(x * Math.min(power, 1.6) * r.statusMult));
    switch (id) {
      case 'oilflask':
        this.makeField(m, foe.side, 'oil', res.name, res, power, 3, 99, lite, res.primary, flags);
        for (const b of enemies()) this.applyStatus(b, 'oil', n(3), m);
        if (!ridersEmpty(lite)) for (const b of enemies()) this.applyRiders(m, b, lite, power, res, {});
        break;
      case 'raincloud': {
        const dur = ridersEmpty(lite) && !Object.keys(flags).length ? 4 : 6 * durMult;
        this.makeField(m, foe.side, 'rain', res.name, res, power, dur, 2, lite, res.primary, flags);
        for (const b of enemies()) this.applyStatus(b, 'wet', n(4), m);
        break;
      }
      case 'blizzard':
        if (res.legendary?.id === 'absolutezero') {
          this.ev({ type: 'shake', amt: 1 });
          for (const b of enemies()) this.freeze(b, 4 * Math.min(1.5, power), true);
          this.makeField(m, foe.side, 'blizzard', res.name, res, power, 20 * durMult, 1, lite, res.primary, flags);
        } else this.makeField(m, foe.side, 'blizzard', res.name, res, power, 10 * durMult, 1, lite, res.primary, flags);
        break;
      case 'wildfire':
        this.makeField(m, foe.side, 'wildfire', res.name, res, power, 12 * durMult, 3, lite, res.primary, flags);
        this.applyStatus(foe, 'burn', n(1), m);
        break;
      case 'sporebloom': this.makeField(m, foe.side, 'spores', res.name, res, power, 18 * durMult, 3, lite, res.primary, flags); break;
      case 'lightwell': this.makeField(m, m.side, 'lightwell', res.name, res, power, 15 * durMult, 3, lite, res.primary, flags); break;
      case 'margin': this.makeField(m, foe.side, 'margin', res.name, res, power, 15 * durMult, 99, lite, res.primary, flags); break;
      case 'miasma': this.makeField(m, foe.side, 'miasma', res.name, res, power, 12 * durMult, 2, lite, res.primary, flags); break;
      case 'thunderhead': this.makeField(m, foe.side, 'thunder', res.name, res, power, 16 * durMult, 2, lite, res.primary, flags); break;
      case 'consecration': this.makeField(m, m.side, 'consecration', res.name, res, power, 12 * durMult, 1, lite, res.primary, flags); break;
    }
  }

  tickField(f: Field, dt: number) { this.blamed(f.name, () => this.tickFieldInner(f, dt)); }

  private tickFieldInner(f: Field, dt: number) {
    f.age += dt;
    const owner = this.mages[f.owner];
    if (f.age >= f.dur || !owner.alive) {
      this.fields = this.fields.filter(x => x !== f);
      this.ev({ type: 'fieldEnd', id: f.id });
      return;
    }
    f.tickT += dt;
    if (f.tickT < f.period) return;
    f.tickT -= f.period;
    const on = this.bodiesOf(f.on);
    const foeSide = (1 - f.owner) as Side;
    const res = f.res || resolveSpell({ uid: 0, base: 'miasma', inf: [], tier: 0 });
    switch (f.kind) {
      case 'blizzard': for (const b of on) { this.applyStatus(b, 'chill', 1, owner); this.damage(owner, b, (b.kind === 'unit' ? 2.5 : 2) * f.power, { kind: 'field', ess: 'frost', quiet: true }); } break;
      case 'miasma': case 'smog': for (const b of on) this.applyStatus(b, 'poison', 1, owner); break;
      case 'thunder': {
        if (!on.length) break;
        const b = on[Math.floor(this.rng() * on.length)];
        this.ev({ type: 'strike', tgt: b.id, ess: 'storm' });
        this.damage(owner, b, 5 * f.power, { kind: 'field', ess: 'storm' });
        break;
      }
      case 'wildfire': {
        // every burning enemy sets one that isn't burning alight
        const burning = on.filter(b => b.st.burn > 0);
        for (const src of burning) {
          const dry = this.bodiesOf(f.on).filter(b => b.st.burn <= 0);
          if (!dry.length) break;
          const b = dry[Math.floor(this.rng() * dry.length)];
          this.ev({ type: 'arc', from: src.id, to: b.id, ess: 'fire' });
          this.applyStatus(b, 'burn', 1, owner);
        }
        break;
      }
      case 'lightwell': this.heal(owner, 3 * f.power); this.cleanse(owner, 1, false); break;
      case 'consecration': {
        this.heal(owner, 1 * f.power);
        for (const u of this.unitsOf(foeSide)) { this.ev({ type: 'strike', tgt: u.id, ess: 'holy' }); this.damage(owner, u, 3 * f.power, { kind: 'field', ess: 'holy' }); }
        break;
      }
    }
    if (f.flags.heal) this.heal(owner, 1 * f.power);
    if (f.flags.strike) {
      const pool = this.bodiesOf(foeSide);
      if (pool.length) { const b = pool[Math.floor(this.rng() * pool.length)]; this.ev({ type: 'strike', tgt: b.id, ess: 'storm' }); this.damage(owner, b, 4 * f.power, { kind: 'field', ess: 'storm' }); }
    }
    if (!ridersEmpty(f.riders)) {
      const targets = f.on === f.owner ? this.bodiesOf(foeSide) : on;
      for (const b of targets) this.applyRiders(owner, b, { ...f.riders, heal: 0, drain: 0 }, f.power, res, {});
      if (f.riders.heal) this.heal(owner, f.riders.heal * f.power);
    }
  }

  // ---------- curses ----------
  castCurse(m: Mage, tgt: Mage, res: Resolved, power: number, castId: number) {
    this.launch(m.id, tgt, 0.8, res.primary, 'curse', 1, castId, (pid) => {
      if (tgt.sanctuary > 0 && tgt !== m) { this.ev({ type: 'projEnd', id: pid, outcome: 'fizzle' }); this.ev({ type: 'wardUse', side: tgt.side, kind: 'sanctuary' }); return; }
      if (tgt.counter > 0 && tgt !== m) { /* counterspell only catches spells as they are read */ }
      this.ev({ type: 'projEnd', id: pid, outcome: 'hit' });
      this.addCurse(m, tgt, res, power);
    });
  }

  addCurse(owner: Mage, victim: Mage, res: Resolved, power: number) {
    const id = res.legendary?.id === 'apocalypse' || res.legendary?.id === 'totaleclipse' ? res.legendary.id : res.base.id;
    if (victim.curses.length >= 5) {
      const old = victim.curses.shift()!;
      this.ev({ type: 'curseEnd', side: victim.side, key: old.key, how: 'crowded' });
    }
    const lite = liteRiders(res.riders); lite.hatch = []; lite.guard = 0; lite.echo = 0;
    const c: Curse = { key: this.nextId++, id, name: res.name, res, owner: owner.side, power, age: 0, tickT: 0, pulseT: 0, riders: lite, data: {} };
    if (res.special === 'echodoom') c.data.again = 1;
    victim.curses.push(c);
    this.ev({ type: 'curse', side: victim.side, key: c.key, name: c.name, ess: res.primary });
    if (id === 'immolate' && victim.st.burn < 2) this.applyStatus(victim, 'burn', 2 - victim.st.burn, owner);
    if (id === 'wither') { victim.poisonCap = 12; this.applyStatus(victim, 'poison', 2, owner); }
    for (const k of res.riders.hatch) this.spawnMinion(owner, k, 6, power);
    if (res.riders.guard) { owner.block += res.riders.guard; this.ev({ type: 'ward', side: owner.side, kind: 'block', name: res.name }); }
    for (const a of owner.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.cursed?.(this.ctx(owner), a.st, c));
  }

  doomLeft(victim: Mage, c: Curse): number {
    const others = victim.curses.length - 1;
    return 22 - c.age - 2 * others - (c.data.shorten || 0);
  }

  tickCurses(m: Mage, dt: number) {
    const prev = this.blame;
    try { this.tickCursesInner(m, dt); } finally { this.blame = prev; }
  }

  private tickCursesInner(m: Mage, dt: number) {
    for (const c of m.curses.slice()) {
      if (!m.alive || this.over()) return;
      this.blame = c.name;
      const owner = this.mage(c.owner);
      const mal = owner.auras.find(a => a.id === 'malediction' && a.until > this.t);
      const rate = mal ? 1 + 0.15 * m.curses.length * mal.power : 1;
      c.age += dt * rate;
      c.tickT += dt * rate;
      c.pulseT += dt * rate;
      const drain = c.res.inst.inf.some(id => SPELLS[id].essence === 'shadow') || c.id === 'siphon';
      const hurt = (amt: number) => {
        const d = this.damage(owner, m, amt * c.power, { kind: 'curse', ess: c.res.primary, quiet: amt < 2 });
        if (drain && d > 0) this.heal(owner, d, true);
      };
      if (c.tickT >= 1) {
        c.tickT -= 1;
        switch (c.id) {
          case 'corruption': hurt(1); break;
          case 'siphon': hurt(1); break;
          case 'unstable': hurt(1.5); break;
          case 'totaleclipse': hurt(1); break;
          case 'finalchapter': hurt(0.5 + 0.12 * c.age); break;
          case 'haunt': {
            const d = this.damage(owner, m, 2 * c.power, { kind: 'curse', ess: 'shadow' });
            c.data.total = (c.data.total || 0) + d;
            break;
          }
        }
      }
      if (c.id === 'unmaking' && !c.data.done && c.age >= 14) {
        c.data.done = 1;
        const endless = m.lines.filter(l => l.uses === Infinity && !(l.blot > this.t + 1000));
        const pool = endless.length ? endless : m.lines.filter(l => l.uses > 0);
        if (pool.length) {
          const L = pool.reduce((a, b) => (b.res.ink > a.res.ink ? b : a));
          if (endless.length) L.blot = this.t + 9999; else L.uses = 0;
          this.ev({ type: 'blot', side: m.side, line: L.idx, dur: 9999 });
          this.ev({ type: 'callout', side: owner.side, text: 'Unmade', sub: `${L.res.name} is erased from ${m.name}'s tome` });
          this.ev({ type: 'shake', amt: 0.8 });
        }
      }
      if (c.id === 'haunt' && c.age >= 8 * c.res.riders.durMult) {
        // the ghost returns home with everything it took
        m.curses = m.curses.filter(x => x !== c);
        this.ev({ type: 'curseEnd', side: m.side, key: c.key, how: 'haunt' });
        this.ev({ type: 'arc', from: m.id, to: owner.id, ess: 'shadow' });
        this.heal(owner, c.data.total || 0, true);
        continue;
      }
      if (c.id === 'agony') {
        c.data.t = (c.data.t || 0) + dt * rate;
        if (c.data.t >= 2) {
          c.data.t -= 2;
          const ceil = Math.min(8, 2 + Math.floor(c.age / 6));
          this.ev({ type: 'cursePulse', side: m.side, key: c.key });
          hurt(1 + Math.floor(this.rng() * ceil));
        }
      }
      if (c.id === 'doom' || c.id === 'apocalypse') {
        if (this.doomLeft(m, c) <= 0) {
          m.curses = m.curses.filter(x => x !== c);
          this.ev({ type: 'curseEnd', side: m.side, key: c.key, how: 'doom' });
          this.ev({ type: 'callout', side: owner.side, text: 'Doom', sub: `${c.name} falls on ${m.name}` });
          this.ev({ type: 'shake', amt: 1.2 });
          hurt(45);
          // Echoing Doom: a second doom takes its place
          if (c.data.again && m.alive && !this.over()) this.addCurse(owner, m, { ...c.res, special: null }, c.power);
          continue;
        }
      }
      if (c.pulseT >= 3) {
        c.pulseT -= 3;
        const infEss = c.res.inst.inf.map(id => SPELLS[id].essence);
        if (infEss.includes('frost')) m.readSlow = Math.min(0.35, m.readSlow + 0.04);
        if (infEss.includes('stone') && !c.data.rooted && c.age > 9) { c.data.rooted = 1; m.silence = Math.max(m.silence, 2); this.ev({ type: 'react', tgt: m.id, id: 'petrify', name: 'Petrified' }); }
        if (!ridersEmpty(c.riders) && c.id !== 'tongues') {
          this.ev({ type: 'cursePulse', side: m.side, key: c.key });
          this.applyRiders(owner, m, { ...c.riders, drain: 0 }, c.power, c.res, {});
        }
      }
    }
  }

  cleanse(m: Mage, stacks: number, curse: boolean) {
    if (curse && m.curses.length) {
      const c = m.curses.pop()!;
      this.ev({ type: 'curseEnd', side: m.side, key: c.key, how: 'cleansed' });
      if (c.id === 'wither') m.poisonCap = 6;
      if (c.id === 'unstable') {
        this.ev({ type: 'react', tgt: m.id, id: 'unstable', name: 'Unstable!' });
        m.silence = Math.max(m.silence, 3);
        this.damage(this.mage(c.owner), m, 20, { kind: 'curse', ess: 'shadow' });
      }
      return;
    }
    const order: Status[] = ['hex', 'poison', 'burn', 'chill', 'charge', 'oil', 'wet'];
    for (let k = 0; k < stacks; k++) { const s = order.find(x => m.st[x] > 0); if (!s) return; m.st[s]--; }
  }

  // ---------- auras, blessings, hexes, wards ----------
  castAura(m: Mage, res: Resolved, power: number) {
    const id = res.base.id;
    m.auras = m.auras.filter(a => a.id !== id);
    const lite = liteRiders(res.riders); lite.hatch = []; lite.guard = 0; lite.echo = 0; lite.heal = 0;
    const dur = id === 'haste' ? 12 * res.riders.durMult : Infinity;
    const data: Record<string, number> = {};
    if (id === 'duplicate') data.n = 4 + (res.inst.tier || 0);
    if (id === 'crystal') { data.t = 3; lite.chain = 0; lite.splash = 0; lite.flicker = 0; }
    if (id === 'backcandle') this.at(0.05, () => this.applyStatus(m, 'burn', 3, null));
    m.auras.push({ key: this.nextId++, id, name: res.name, res, power, until: this.t + dur, riders: id === 'duplicate' || id === 'crystal' ? emptyRiders() : lite, data });
    this.ev({ type: 'aura', side: m.side, id, name: res.name, ess: res.primary });
    for (const k of res.riders.hatch) this.spawnMinion(m, k, 8, power);
    if (res.riders.guard) { m.block += res.riders.guard; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); }
    if (res.riders.heal) this.heal(m, res.riders.heal * power);
  }

  castBlessing(m: Mage, res: Resolved, power: number, o: { power: number; echo?: boolean }) {
    const foe = this.opp(m);
    if (res.base.id === 'mend') {
      this.heal(m, 8 * power);
      this.cleanse(m, 2, true);
    } else if (res.legendary?.id === 'endlesslibrary') {
      const hist = m.history.slice();
      if (!hist.length || o.echo) this.ev({ type: 'fizzle', side: m.side, reason: 'Nothing to echo', name: res.name });
      hist.forEach((h, i) => { if (!o.echo) this.at(0.3 + 0.45 * i, () => this.cast(m, h.res, { power: Math.max(1, power) * h.power, via: 'Endless Library', echo: true })); });
    } else if (res.base.id === 'echo') {
      const prev = m.lastCast;
      const full = res.special === 'resonance';
      if (!prev || o.echo) { this.ev({ type: 'fizzle', side: m.side, reason: 'Nothing to echo', name: res.name }); }
      else this.at(0.3, () => this.cast(m, prev, { power: (full ? 1 : 0.8) * power * m.lastPower, via: full ? 'Resonance' : 'Echo', echo: true }));
    } else if (res.base.id === 'ouroboros') {
      let n = 0;
      for (const l of m.lines) if (l.uses === 0 && l.res.base.id !== 'ouroboros') { l.uses = 1; n++; }
      this.ev({ type: 'react', tgt: m.id, id: 'ouroboros', name: n ? `${n} line${n > 1 ? 's' : ''} rewritten` : 'Nothing to rewrite' });
    } else if (res.base.id === 'martyrdom') {
      this.damage(null, m, 10, { kind: 'self', ess: 'holy' });
      m.nextPower = Math.max(m.nextPower, 2);
    } else if (res.base.id === 'wildmagic') {
      if (!o.echo || this.rng() < 0.5) {
        const pool = LIBRARY_SPELLS.filter(s => s.id !== 'wildmagic' && s.id !== 'echo' && s.id !== 'martyrdom');
        const pick = pool[Math.floor(this.rng() * pool.length)];
        this.at(0.3, () => this.cast(m, resolveSpell({ uid: 0, base: pick.id, inf: [], tier: 0 }), { power: 0.7 * power, via: 'Wild Magic', echo: true }));
      }
    }
    const r = { ...res.riders, echo: 0 };
    if (!ridersEmpty({ ...r, heal: 0, guard: 0, hatch: [] })) {
      this.launch(m.id, this.boltTarget(m, foe), 0.6, res.primary, 'minor', 0.8, undefined, (pid) => {
        this.ev({ type: 'projEnd', id: pid, outcome: 'hit' });
        this.applyRiders(m, foe, { ...r, heal: 0, guard: 0, hatch: [] }, power, res, {});
      });
    }
    if (r.heal && res.base.id !== 'mend') this.heal(m, r.heal * power);
    if (r.guard) { m.block += r.guard; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); }
    for (const k of r.hatch) this.spawnMinion(m, k, 8, power);
  }

  morph(b: Body, form: string, dur: number) {
    if (b.kind === 'mage') {
      const m = b as Mage;
      for (const a of m.arts) {
        const f = ARTIFACTS[a.id]?.hooks.stunned;
        if (f && f(this.ctx(m), a.st, form)) { this.morph(this.opp(m), form, dur); return; }
      }
      if (m.phase === 'reading') { /* reading pauses, not cancelled */ }
    }
    b.morph = dur; b.morphKind = form;
    this.ev({ type: 'morph', tgt: b.id, form, dur });
  }

  castHex(m: Mage, tgt: Mage, res: Resolved, power: number, castId: number) {
    this.launch(m.id, tgt, 0.7, res.primary, 'hex', 1, castId, (pid) => {
      if (tgt !== m && tgt.sanctuary > 0) { this.ev({ type: 'projEnd', id: pid, outcome: 'fizzle' }); this.ev({ type: 'wardUse', side: tgt.side, kind: 'sanctuary' }); return; }
      if (tgt !== m && (tgt.mirror > 0 || tgt.mirrorAll > 0)) {
        if (tgt.mirrorAll <= 0) tgt.mirror--;
        this.ev({ type: 'projEnd', id: pid, outcome: 'reflect' });
        this.ev({ type: 'wardUse', side: tgt.side, kind: 'mirror' });
        this.at(0.7, () => this.hexEffect(tgt, m, res, power));
        return;
      }
      this.ev({ type: 'projEnd', id: pid, outcome: 'hit' });
      this.hexEffect(m, tgt, res, power);
    });
  }

  hexEffect(m: Mage, tgt: Mage, res: Resolved, power: number) {
    const id = res.legendary?.id || res.special || res.base.id;
    const durP = Math.min(power, 1.5) * res.riders.durMult;
    switch (id) {
      case 'polymorph': this.morph(tgt, 'sheep', 5 * durP); break;
      case 'ratify': this.morph(tgt, 'rat', 5 * durP); break;
      case 'petrify': this.morph(tgt, 'stone', 2.5 * durP); tgt.glacier = 6 * durP; break;
      case 'flashpoint': {
        const n = tgt.st.burn;
        if (n > 0) { tgt.st.burn = 0; this.ev({ type: 'status', tgt: tgt.id, s: 'burn', n: -n, total: 0 }); this.react('blaze', tgt); }
        this.damage(m, tgt, (n > 0 ? 5 * n : 3) * power, { kind: 'spell', ess: 'fire', heavy: n >= 5 });
        break;
      }
      case 'coldsnap': {
        let any = false;
        for (const b of this.bodiesOf(tgt.side)) {
          const w = b.st.wet; if (w <= 0) continue;
          any = true; b.st.wet = 0;
          this.applyStatus(b, 'chill', Math.round(2 * w * Math.min(power, 1.5)), m);
        }
        if (!any) this.applyStatus(tgt, 'chill', 2, m);
        break;
      }
      case 'contagion': {
        // every status spreads from the mage to their summons and back
        const bodies = this.bodiesOf(tgt.side);
        const top: Partial<Record<Status, number>> = {};
        for (const b of bodies) for (const s of STATUSES) if (s !== 'hex' && b.st[s] > (top[s] || 0)) top[s] = b.st[s];
        for (const b of bodies) for (const s of STATUSES) {
          const d = (top[s] || 0) - b.st[s];
          if (d > 0 && b.alive) { if (b !== tgt) this.ev({ type: 'arc', from: tgt.id, to: b.id, ess: 'venom' }); this.applyStatus(b, s, d, m); }
        }
        break;
      }
      case 'overcharge': {
        const c = tgt.st.charge;
        if (c * 2 >= 8) {
          tgt.st.charge = 0;
          this.react('overload', tgt);
          this.ev({ type: 'shake', amt: 0.8 });
          this.damage(m, tgt, 4 * c * 2 * Math.min(power, 1.5), { kind: 'reaction', ess: 'storm' });
        } else this.applyStatus(tgt, 'charge', Math.max(2, c), m);
        break;
      }
      case 'soulharvest': {
        const n = tgt.curses.length;
        const d = this.damage(m, tgt, (n ? 5 * n : 3) * power, { kind: 'spell', ess: 'shadow' });
        if (d > 0) this.heal(m, d);
        break;
      }
      case 'timewarp':
        this.ev({ type: 'react', tgt: tgt.id, id: 'timewarp', name: 'Time Warp' });
        if (tgt.phase === 'reading') tgt.prog = -1.5;
        else if (tgt.phase === 'recover' || tgt.phase === 'recharge') tgt.phaseT += 3;
        break;
      case 'manadrain': {
        const take = Math.min(tgt.ink, 25 * Math.min(power, 1.5));
        tgt.ink -= take; m.ink = Math.min(m.maxInk, m.ink + take);
        this.ev({ type: 'arc', from: tgt.id, to: m.id, ess: 'arcane' });
        if (take >= 2) this.damage(m, tgt, take / 2, { kind: 'spell', ess: 'arcane' });
        break;
      }
      case 'mindflayer': tgt.hexSelf += 4; tgt.flayer += 4; this.ev({ type: 'react', tgt: tgt.id, id: 'babel', name: 'Mind flayed' }); break;
      case 'shatterpoint':
        if (tgt.frozen > 0 || tgt.glacier > 0) this.damage(m, tgt, 15 * power, { kind: 'spell', ess: 'stone', heavy: true });
        else { this.damage(m, tgt, 8 * power, { kind: 'spell', ess: 'frost' }); this.applyStatus(tgt, 'chill', 3, m); }
        break;
      case 'flock':
        this.morph(tgt, 'sheep', 4 * durP);
        for (const u of this.unitsOf(tgt.side)) this.morph(u, 'sheep', 4 * durP);
        break;
      case 'impmorph': this.morph(tgt, 'imp', 5 * durP); break;
      case 'icestatue': this.freeze(tgt, 4 * durP, true); tgt.glacier = 4 * durP; break;
      case 'deepfreeze':
        this.damage(m, tgt, 8 * power, { kind: 'spell', ess: 'frost' });
        if (tgt.st.chill >= 3) { tgt.st.chill = 0; this.freeze(tgt, 4 * durP, false); } else this.applyStatus(tgt, 'chill', 3, m);
        break;
      case 'inkblot': {
        const free = tgt.lines.filter(l => !(l.blot > this.t) && l.uses > 0);
        if (free.length) { const l = free[Math.floor(this.rng() * free.length)]; l.blot = this.t + 9 * durP; this.ev({ type: 'blot', side: tgt.side, line: l.idx, dur: 9 * durP }); }
        break;
      }
      case 'misplaced': {
        if (tgt.lines.length >= 2) {
          const a = Math.floor(this.rng() * tgt.lines.length);
          let b = Math.floor(this.rng() * (tgt.lines.length - 1)); if (b >= a) b++;
          const cur = tgt.cur;
          [tgt.lines[a], tgt.lines[b]] = [tgt.lines[b], tgt.lines[a]];
          if (cur) tgt.cursor = tgt.lines.indexOf(cur);
          this.ev({ type: 'swap', side: tgt.side, a: tgt.lines[b].idx, b: tgt.lines[a].idx });
        }
        break;
      }
      case 'babel': tgt.hexSelf += 2; this.ev({ type: 'react', tgt: tgt.id, id: 'babel', name: 'Babel' }); break;
      case 'transpose': {
        if (tgt === m) break;
        const tmp = { ...m.st }; m.st = { ...tgt.st }; tgt.st = tmp;
        this.ev({ type: 'react', tgt: tgt.id, id: 'transpose', name: 'Transposed' });
        break;
      }
      case 'erratum': tgt.erratum += 1; this.ev({ type: 'react', tgt: tgt.id, id: 'erratum', name: 'Misprinted' }); break;
      case 'reversegrammar': tgt.reversed = Math.max(tgt.reversed, 8 * durP); this.ev({ type: 'react', tgt: tgt.id, id: 'reversed', name: 'Reversed' }); break;
      case 'palimpsest': {
        if (tgt === m) break;
        const n = tgt.lines.length;
        const start = tgt.cur ? tgt.lines.indexOf(tgt.cur) + 1 : tgt.cursor;
        let L: LineState | null = null;
        for (let k = 0; k < n && !L; k++) { const c = tgt.lines[(start + k) % n]; if (c !== tgt.cur && this.castable(c)) L = c; }
        if (!L) { this.ev({ type: 'fizzle', side: m.side, reason: 'Nothing to scrape', name: res.name }); break; }
        L.blot = this.t + 10 * durP;
        this.ev({ type: 'blot', side: tgt.side, line: L.idx, dur: 10 * durP });
        const stolen = L.res;
        this.at(0.3, () => this.cast(m, stolen, { power: 1 * Math.min(power, 1.5), via: 'Palimpsest', echo: true }));
        break;
      }
      case 'anagram': {
        const ls = tgt.lines;
        for (let i = ls.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [ls[i], ls[j]] = [ls[j], ls[i]]; }
        if (tgt.phase === 'reading') { tgt.cur = null; tgt.prog = 0; }
        tgt.phase = 'recover'; tgt.phaseT = 0.6; tgt.cursor = 0;
        this.ev({ type: 'react', tgt: tgt.id, id: 'anagram', name: 'Anagram' });
        break;
      }
      case 'plagiarize': {
        const stolen = tgt.lastCast;
        if (stolen) this.at(0.3, () => this.cast(m, stolen, { power: 1 * power, via: 'Plagiarized', echo: true }));
        else this.ev({ type: 'fizzle', side: m.side, reason: 'Nothing to steal', name: res.name });
        break;
      }
    }
    const r = res.riders;
    if (!ridersEmpty({ ...r, echo: 0 })) {
      this.hitPayload(m, tgt, { ...res, riders: { ...r, echo: 0 } } as Resolved, power, 0, {}, r.heavy, {});
    }
  }

  castWard(m: Mage, res: Resolved, power: number) {
    const id = res.legendary?.id || (res.special === 'hallofmirrors' || res.special === 'spellthief' ? res.special : res.base.id);
    const extra = res.inst.tier >= 2 ? 1 : 0;
    switch (id) {
      case 'icewall': m.block += 2 + extra; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); break;
      case 'mirror': m.mirror += 1 + extra; this.ev({ type: 'ward', side: m.side, kind: 'mirror', name: res.name }); break;
      case 'philmirror': m.mirrorAll = 5 * power; this.heal(m, 12 * power); this.ev({ type: 'ward', side: m.side, kind: 'mirror', name: res.name }); break;
      case 'counterspell': m.counter += 1 + extra; this.ev({ type: 'ward', side: m.side, kind: 'counter', name: res.name }); break;
      case 'sanctuary': m.sanctuary = 4 * res.riders.durMult; this.ev({ type: 'ward', side: m.side, kind: 'sanctuary', name: res.name }); break;
      case 'guardianangel': m.angel = true; this.ev({ type: 'ward', side: m.side, kind: 'angel', name: res.name }); break;
      case 'staticshield': m.block += 1 + extra; m.shock += 1 + extra; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); break;
      case 'divineshield': m.divine = 3 * res.riders.durMult; this.ev({ type: 'ward', side: m.side, kind: 'sanctuary', name: res.name }); break;
      case 'hallofmirrors': m.mirrorAll = Math.max(m.mirrorAll, 4 * res.riders.durMult); this.ev({ type: 'ward', side: m.side, kind: 'mirror', name: res.name }); break;
      case 'spellthief': m.thief += 1 + extra; this.ev({ type: 'ward', side: m.side, kind: 'counter', name: res.name }); break;
    }
    const lite = liteRiders(res.riders);
    if (!ridersEmpty({ ...lite, hatch: [], guard: 0, echo: 0 })) m.wardRiders = lite;
    // Mirror Image and friends: hatch traits on a ward become decoys that draw bolts
    for (let i = 0; i < res.riders.hatch.length; i++) {
      for (let k = 0; k < 2; k++) this.addUnit(m.side, 'decoy', { power: 1, life: 10 * res.riders.durMult, name: 'Mirror Image' });
    }
    if (res.riders.guard) { m.block += res.riders.guard; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); }
    if (res.riders.heal) this.heal(m, res.riders.heal * power);
  }

  wardFire(m: Mage, cond: WardCond) {
    if (!m.alive || this.over() || this.stunned(m)) return;
    m.wardLines.forEach((w, i) => {
      if (!w || w.cond !== cond || w.cd > 0 || w.uses <= 0) return;
      const cost = Math.round(w.res.ink * 0.8);
      if (m.ink < cost) return;
      m.ink -= cost;
      if (w.uses !== Infinity) w.uses--;
      w.cd = WARD_CONDS.find(c => c.id === cond)!.cd;
      this.ev({ type: 'wardLine', side: m.side, idx: i, cond });
      this.cast(m, w.res, { power: 1, line: -1 - i, via: 'Ward' });
    });
  }

  // ---------- core effects ----------
  damage(src: Mage | null, tgt: Body, amt: number, info: DmgInfo & { castId?: number; res?: Resolved; quiet?: boolean; label?: string }): number {
    if (!tgt.alive || amt <= 0 || this.over()) return 0;
    const kind = info.kind;
    if (src && src.side !== tgt.side) {
      if (kind === 'spell' || kind === 'summon') {
        for (const a of src.auras) if (a.id === 'kindle' && a.until > this.t && kind === 'spell') amt += tgt.st.burn * 0.4 * a.power;
      }
      for (const a of src.arts) { const f = ARTIFACTS[a.id]?.hooks.outDmg; if (f) amt = f(this.ctx(src), a.st, tgt, amt, info); }
    }
    if (tgt.kind === 'mage') {
      const m = tgt as Mage;
      if (m.divine > 0) { if (kind !== 'dot' || amt >= 1) this.ev({ type: 'wardUse', side: m.side, kind: 'divine' }); return 0; }
      // Reverse Grammar: what they deal heals its target instead
      if (src && src.reversed > 0 && src.side !== m.side && kind !== 'reversed') { this.heal(m, amt); return 0; }
      // Mark of the Hunter: summons hit the marked mage harder
      if (kind === 'summon' && src && m.curses.some(c => c.id === 'huntersmark' && c.owner === src.side)) amt *= 1.5;
      if (kind === 'spell' || kind === 'summon') for (const a of m.auras) if (a.id === 'stoneskin' && a.until > this.t) amt = Math.max(1, amt - 2 * a.power);
      for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.inDmg; if (f) amt = f(this.ctx(m), a.st, src, amt, info); }
    }
    let crit = false;
    if (tgt.vuln > 0) amt *= 1.25;
    // Wildfire: burning enemies take 1 more from every hit
    if (src && tgt.st.burn > 0 && (kind === 'spell' || kind === 'summon') && this.fields.some(f => f.kind === 'wildfire' && f.owner === src.side && f.on === tgt.side)) amt += 1;
    if (tgt.frozen > 0 && !info.heavy && kind !== 'dot') amt *= 1.25;
    if ((tgt.frozen > 0 || tgt.glacier > 0) && info.heavy) {
      const mult = info.glacier || tgt.glacier > 0 ? 3 : 2;
      amt *= mult; crit = true;
      if (tgt.frozen > 0) { tgt.frozen = 0; this.ev({ type: 'thaw', tgt: tgt.id }); }
      tgt.glacier = 0;
      this.react('shatter', tgt);
    }
    if (amt <= 0) return 0;
    tgt.hp -= amt;
    if (src && src.side !== tgt.side) src.dealt += amt;
    {
      const label = this.dmgLabel(info), cat = info.kind === 'dot' ? 'status' : info.kind;
      if (src && src.side !== tgt.side) this.credit('dealt', src.side, label, amt, info.ess || null, cat);
      if (tgt.kind === 'mage') this.credit('taken', tgt.side, src && src.side === tgt.side ? `${label} (own)` : label, amt, info.ess || null, cat);
    }
    if (!info.quiet || amt >= 1) this.ev({ type: 'dmg', tgt: tgt.id, amt: r1(amt), ess: info.ess || null, kind, crit, castId: info.castId });
    if (src && src.side !== tgt.side) for (const a of src.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.dealt?.(this.ctx(src), a.st, tgt, amt, info));
    if (tgt.kind === 'mage') {
      const m = tgt as Mage;
      // Total Eclipse: a quarter of everything they take heals the caster
      for (const c of m.curses) if (c.id === 'totaleclipse' && kind !== 'retribution') this.heal(this.mage(c.owner), amt * 0.25, true);
    }
    // Curse of Echoes: a third of what the cursed mage's spells deal comes back to them
    if (src && src.side !== tgt.side && kind === 'spell') {
      const ce = src.curses.find(c => c.id === 'echoes');
      if (ce) this.at(0.25, () => { if (src.alive) { this.ev({ type: 'cursePulse', side: src.side, key: ce.key }); this.damage(this.mage(ce.owner), src, amt / 3 * Math.min(1.5, ce.power), { kind: 'curse', ess: 'shadow', label: ce.name }); } });
    }
    if (tgt.kind === 'unit') {
      const u = tgt as Unit;
      if (u.ukind === 'golem' && u.hp > 0 && kind !== 'dot') u.atk = Math.min(10, u.atk + 1);
      if (u.ukind === 'mimic' && u.hp > 0 && kind === 'spell' && src && src.side !== u.side) {
        u.hp = Math.min(u.maxHp, u.hp + 6);
        const owner = this.mages[u.owner];
        this.at(0.3, () => this.blamed(u.name, () => { if (u.alive && src.alive) { this.ev({ type: 'unitAtk', id: u.id, tgt: src.id }); this.damage(owner, src, 4 * Math.min(1.5, u.power), { kind: 'summon', ess: 'stone' }); } }));
      }
      if (u.ukind === 'worldroot' && u.hp > 0) this.heal(this.mages[u.owner], amt * 0.5);
      if (u.split && u.hp > 0 && u.hp < u.maxHp / 2) {
        u.split = false;
        const c = this.addUnit(u.owner, u.ukind, { power: u.power, riders: u.riders, ess: u.ess.filter(e => e !== 'arcane'), tint: u.tint, name: u.name });
        if (c) { c.hp = c.maxHp = u.hp; u.maxHp = u.hp; this.ev({ type: 'react', tgt: u.id, id: 'split', name: 'Split!' }); }
      }
    }
    if (tgt.hp <= 0) this.kill(tgt, src);
    return amt;
  }

  kill(tgt: Body, src: Mage | null) {
    if (!tgt.alive) return;
    if (tgt.kind === 'mage') {
      const m = tgt as Mage;
      if (m.angel) {
        m.angel = false; m.hp = m.maxHp * 0.2;
        this.ev({ type: 'wardUse', side: m.side, kind: 'angel' });
        this.ev({ type: 'callout', side: m.side, text: 'Guardian Angel', sub: `${m.name} is lifted back up` });
        this.ev({ type: 'heal', tgt: m.id, amt: Math.round(m.hp) });
        return;
      }
      for (const a of m.arts) {
        const f = ARTIFACTS[a.id]?.hooks.wouldDie;
        if (f && f(this.ctx(m), a.st)) { if (m.hp > 0) return; }
      }
      m.alive = false; m.hp = Math.min(m.hp, 0);
      this.ev({ type: 'death', tgt: m.id });
      return;
    }
    const u = tgt as Unit;
    u.alive = false;
    this.ev({ type: 'death', tgt: u.id });
    const owner = this.mages[u.owner];
    const foe = this.opp(owner);
    // a phoenix with lives left falls back into an egg
    if (u.ukind === 'phoenix' && (u.flags.lives || 0) > 0) {
      const egg = this.addUnit(u.owner, 'egg', { power: u.power, riders: u.riders, ess: u.ess, tint: u.tint, name: 'Phoenix Egg', life: u.life });
      if (egg) {
        egg.flags.lives = u.flags.lives - 1; egg.flags.hatchAt = u.flags.lord ? 3 : 6; egg.flags.lord = u.flags.lord || 0;
        egg.x = u.x; egg.z = u.z;
        this.ev({ type: 'react', tgt: egg.id, id: 'reborn', name: 'Reborn' });
      }
    }
    // Hydra: a severed head grows back as two smaller ones
    if (u.ukind === 'hydra' && (u.flags.gen || 0) < 2) {
      for (let k = 0; k < 2; k++) {
        const h = this.addUnit(u.owner, 'hydra', { power: u.power, riders: u.riders, ess: u.ess, tint: u.tint, name: 'Hydra', hpMult: 0.5 / (u.flags.gen ? 2 : 1) });
        if (h) { h.flags.gen = (u.flags.gen || 0) + 1; h.flags.half = 1; }
      }
      this.ev({ type: 'react', tgt: u.id, id: 'regrow', name: 'Two more!' });
    }
    // Spore Bloom: any summon's death bursts spores over the enemy mage
    for (const f of this.fields) {
      if (f.kind !== 'spores') continue;
      const fo = this.mages[f.owner]; const victim = this.opp(fo);
      this.ev({ type: 'arc', from: u.id, to: victim.id, ess: 'venom' });
      this.applyStatus(victim, 'poison', Math.max(1, Math.round(3 * Math.min(1.5, f.power))), fo);
    }
    if (u.ess.includes('fire') || u.ukind === 'pitlord') {
      this.ev({ type: 'burst', side: foe.side, ess: 'fire', from: u.id, flight: 0.5 });
      this.at(0.5, () => this.blamed(u.name, () => { this.damage(owner, foe, 4 * u.power, { kind: 'spell', ess: 'fire' }); this.applyStatus(foe, 'burn', 1, owner); }));
    }
    if (u.ess.includes('venom') || u.ukind === 'rat') this.makeField(owner, foe.side, 'miasma', 'Plague cloud', null, u.power, 6, 2, emptyRiders(), 'venom', {});
    for (const a of owner.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.unitDied?.(this.ctx(owner), a.st, u, true));
    for (const a of foe.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.unitDied?.(this.ctx(foe), a.st, u, false));
    if (u.life === Infinity) this.wardFire(owner, 'summondies');
  }

  private healDepth = 0;

  heal(m: Mage, amt: number, fromCurse = false): number {
    // heal -> damage -> heal chains (Retribution with lifesteal) stop after a few links
    if (!m.alive || amt <= 0 || this.over() || this.healDepth > 3) return 0;
    this.healDepth++;
    try { return this.healInner(m, amt, fromCurse); } finally { this.healDepth--; }
  }

  private healInner(m: Mage, amt: number, fromCurse: boolean): number {
    if (m.reversed > 0) { this.damage(this.opp(m), m, amt, { kind: 'reversed', ess: 'arcane', label: 'Reverse Grammar' }); return 0; }
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.healMult; if (f) amt *= f(this.ctx(m), a.st); }
    const before = m.hp;
    m.hp = Math.min(m.maxHp, m.hp + amt);
    const got = m.hp - before;
    if (got <= 0) return 0;
    m.healed += got;
    this.credit('healed', m.side, this.blame || 'Other', got, null, 'heal');
    this.ev({ type: 'heal', tgt: m.id, amt: r1(got) });
    for (const a of m.auras) {
      if (a.id === 'retribution' && a.until > this.t) this.damage(m, this.opp(m), got * 0.3 * a.power, { kind: 'retribution', ess: 'holy', quiet: got < 1 });
    }
    for (const a of m.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.healed?.(this.ctx(m), a.st, got, fromCurse));
    return got;
  }

  react(id: string, tgt: Body) {
    const r = REACTIONS.find(x => x.id === id);
    this.found.add(id);
    this.reactName = r ? r.name : this.reactName;
    this.ev({ type: 'react', tgt: tgt.id, id, name: r ? r.name : id });
    const owner = tgt.kind === 'mage' ? this.opp(tgt as Mage) : this.mages[1 - tgt.side];
    for (const a of owner.arts) this.artHook(a.id, () => ARTIFACTS[a.id]?.hooks.reaction?.(this.ctx(owner), a.st, id, tgt));
  }

  freeze(tgt: Body, dur: number, ignoreImmune: boolean) {
    if (tgt.freezeImmune > 0 && !ignoreImmune) { this.ev({ type: 'react', tgt: tgt.id, id: 'resist', name: 'Resists the freeze' }); return; }
    if (tgt.kind === 'mage') {
      const m = tgt as Mage;
      for (const a of m.arts) {
        const f = ARTIFACTS[a.id]?.hooks.stunned;
        if (f && f(this.ctx(m), a.st, 'frozen')) { this.freeze(this.opp(m), dur, ignoreImmune); return; }
      }
      const foe = this.opp(m);
      for (const a of foe.arts) { const f = ARTIFACTS[a.id]?.hooks.freezeDur; if (f) dur = f(this.ctx(foe), a.st, dur); }
    }
    if (tgt.kind === 'mage') {
      const pf = (tgt as Mage).curses.find(c => c.id === 'permafrost');
      if (pf) { dur += 2; this.at(0.05, () => { this.ev({ type: 'cursePulse', side: tgt.side, key: pf.key }); this.damage(this.mage(pf.owner), tgt, 12 * Math.min(1.5, pf.power), { kind: 'curse', ess: 'frost', label: pf.name }); }); }
    }
    tgt.frozen = dur; tgt.freezeImmune = dur + 6;
    this.react('frozen', tgt);
    this.ev({ type: 'freeze', tgt: tgt.id, dur });
  }

  applyStatus(tgt: Body, s: Status, n: number, src: Mage | null, o: { freezeAt?: number } = {}) {
    if (!tgt.alive || n <= 0 || this.over()) return;
    if (s === 'hex' && tgt.kind !== 'mage') return;
    if (src && src.side !== tgt.side) {
      for (const a of src.arts) { const f = ARTIFACTS[a.id]?.hooks.outStatus; if (f) n = f(this.ctx(src), a.st, s, n, tgt); }
    }
    if (tgt.kind === 'mage') {
      const m = tgt as Mage;
      for (const a of m.arts) {
        const f = ARTIFACTS[a.id]?.hooks.inStatus;
        if (f) { n = f(this.ctx(m), a.st, s, n, src); if (n <= 0) return; }
      }
    }
    const st = tgt.st;
    const before = { ...st };
    const blaze = (stacks: number) => {
      this.react('blaze', tgt);
      let dmg = 4 * stacks;
      if (src) for (const a of src.arts) { const f = ARTIFACTS[a.id]?.hooks.blazeMult; if (f) dmg *= f(this.ctx(src), a.st); }
      this.damage(src, tgt, dmg, { kind: 'reaction', ess: 'fire' });
    };
    const freezeAt = o.freezeAt || 5;
    switch (s) {
      case 'burn':
        if (tgt.frozen > 0) {
          // Thermal Shock: fire on ice cracks it open
          tgt.frozen = 0; this.ev({ type: 'thaw', tgt: tgt.id }); this.react('thermal', tgt);
          this.damage(src, tgt, 12, { kind: 'reaction', ess: 'fire' });
          if (!tgt.alive) return;
        }
        if (st.wet > 0) { st.wet = 0; st.burn = 0; this.react('douse', tgt); break; }
        if (st.chill > 0) { st.chill = 0; st.burn = 0; if (tgt.kind === 'mage') (tgt as Mage).steam = true; this.react('steam', tgt); break; }
        if (st.oil > 0) { const oil = st.oil; st.oil = 0; blaze(oil); }
        if (st.poison > 0 && this.smoke <= 0) { this.smoke = 8; this.smokeT = 0; this.react('smoke', tgt); this.ev({ type: 'field', id: this.nextId++, on: tgt.side, owner: tgt.side, kind: 'smoke', name: 'Toxic Smoke', ess: 'venom', dur: 8 }); }
        st.burn = Math.min(8, st.burn + n); break;
      case 'wet':
        if (st.burn > 0) { st.burn = 0; st.wet = 0; this.react('douse', tgt); break; }
        if (st.charge > 0) {
          const c = st.charge; st.charge = 0; st.wet = 0; this.react('conduct', tgt);
          let dmg = 4 * c; if (src) for (const a of src.arts) { const f = ARTIFACTS[a.id]?.hooks.conductMult; if (f) dmg *= f(this.ctx(src), a.st); }
          this.damage(src, tgt, dmg, { kind: 'reaction', ess: 'storm' });
          break;
        }
        if (st.chill > 0) { st.chill = 0; st.wet = 0; this.freeze(tgt, 3, false); break; }
        st.wet += n; break;
      case 'chill':
        if (st.wet > 0) { st.wet = 0; st.chill = 0; this.freeze(tgt, 3, false); break; }
        if (st.burn > 0) { st.burn = 0; st.chill = 0; if (tgt.kind === 'mage') (tgt as Mage).steam = true; this.react('steam', tgt); break; }
        if (st.oil > 0 && tgt.kind === 'mage') { st.oil = 0; (tgt as Mage).congeal = 6; this.react('congeal', tgt); }
        st.chill += n;
        if (st.chill >= freezeAt) { st.chill = 0; this.freeze(tgt, 3, false); }
        break;
      case 'oil':
        if (st.burn > 0) { blaze(n); break; }
        if (st.chill > 0 && tgt.kind === 'mage') { (tgt as Mage).congeal = 6; this.react('congeal', tgt); break; }
        st.oil += n; break;
      case 'charge':
        if (st.wet > 0) {
          const c = st.charge + n; st.charge = 0; st.wet = 0; this.react('conduct', tgt);
          let dmg = 4 * c; if (src) for (const a of src.arts) { const f = ARTIFACTS[a.id]?.hooks.conductMult; if (f) dmg *= f(this.ctx(src), a.st); }
          this.damage(src, tgt, dmg, { kind: 'reaction', ess: 'storm' }); break;
        }
        st.charge = Math.min(10, st.charge + n);
        if (st.charge >= 10) {
          st.charge = 0; this.react('overload', tgt);
          this.ev({ type: 'shake', amt: 0.6 });
          this.damage(src, tgt, 30, { kind: 'reaction', ess: 'storm' });
          return;
        }
        break;
      case 'poison':
        if (st.burn > 0 && this.smoke <= 0) { this.smoke = 8; this.smokeT = 0; this.react('smoke', tgt); this.ev({ type: 'field', id: this.nextId++, on: tgt.side, owner: tgt.side, kind: 'smoke', name: 'Toxic Smoke', ess: 'venom', dur: 8 }); }
        st.poison = Math.min(tgt.poisonCap, st.poison + n); break;
      case 'hex': {
        st.hex += n;
        break;
      }
    }
    if (!tgt.alive) return;
    for (const k of STATUSES) {
      const d = st[k] - before[k];
      if (d > 0 && k === s) this.ev({ type: 'status', tgt: tgt.id, s: k, n: d, total: st[k] });
    }
    if (tgt.kind === 'mage' && src && src !== tgt && st[s] > before[s]) this.wardFire(tgt as Mage, 'afflicted');
  }
}

function halfSt(st: Partial<Record<Status, number>>): Partial<Record<Status, number>> {
  const o: Partial<Record<Status, number>> = {};
  for (const k in st) { const s = k as Status; const n = st[s] || 0; if (n > 0) o[s] = Math.max(1, Math.floor(n / 2)); }
  return o;
}

export function runDuel(a: TomeSpec, b: TomeSpec, seed: number): DuelResult {
  return new Duel(a, b, seed).run();
}
