// The duel simulation. Plain TypeScript, no rendering: two tomes and a seed in,
// an event log and state snapshots out. Fixed 20 ticks per second.
import { SPELLS, type Essence } from '../data/spells';
import { resolveSpell, liteRiders, emptyRiders, ridersEmpty, type Resolved, type Riders } from '../data/fusion';
import { DECAY, REACTIONS, STATUSES, type Status } from '../data/codex';
import { ARTIFACTS, type ArtCtx, type DmgInfo } from '../data/artifacts';
import { mulberry32, type Rng } from './rng';
import type {
  Body, Curse, DuelEvent, DuelResult, Field, LineState, Mage, MageSnap, Side, Snap, TomeSpec, Unit, UnitSnap, WardCond,
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
};
export const UNIT_TITLE: Record<string, string> = {
  imp: 'Imp', skeleton: 'Skeleton', treant: 'Treant', sapling: 'Sapling', rat: 'Plague Rat', salamander: 'Salamander', ball: 'Ball Lightning',
  decoy: 'Mirror Image', cherub: 'Cherub', pitlord: 'Pit Lord', frostlich: 'Frost Lich', worldroot: 'Worldroot',
};

function zeroSt(): Record<Status, number> { return { burn: 0, chill: 0, wet: 0, poison: 0, oil: 0, charge: 0, hex: 0 }; }
const r1 = (x: number) => Math.round(x * 10) / 10;

interface HitOpts { castId?: number; reflected?: boolean; noSplash?: boolean; attacker?: Body | null; kind?: string; glacier?: boolean; freezeAt?: number; riderOnly?: boolean }

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
      st: zeroSt(), decay: zeroSt(), dotT: 0, frozen: 0, freezeImmune: 0, poisonCap: 6, morph: 0, morphKind: null, glacier: 0,
      ink: spec.ink, maxInk: spec.ink, regen: spec.regen || 4, recharge: PACE.recharge,
      lines, cursor: 0, phase: 'recover', phaseT: PACE.start, prog: 0, total: 0, cur: null,
      silence: 0, sanctuary: 0, hexSelf: 0, congeal: 0, readSlow: 0, steam: false,
      curses: [], auras: [], block: 0, mirror: 0, mirrorAll: 0, counter: 0, angel: false, wardRiders: null,
      wardLines: spec.wards.map(w => (w && w.cond && w.spell) ? (() => { const res = resolveSpell(w.spell); return { cond: w.cond, res, uses: res.uses === 0 ? Infinity : res.uses, cd: 0 }; })() : null),
      arts: spec.artifacts.filter(id => ARTIFACTS[id]).map(id => ({ id, st: {} })),
      lastCast: null, lastPower: 1, halfUsed: false, every8: 0, castCount: 0, freeNext: false, quickNext: false,
      dealt: 0, healed: 0, loops: 0,
    };
    m.st.hex = spec.startHex || 0;
    return m;
  }

  // ---------- plumbing ----------
  ev(e: Evt) { (e as DuelEvent).t = Math.round(this.t * 1000) / 1000; this.events.push(e as DuelEvent); }
  at(delay: number, fn: () => void) { this.queue.push({ time: this.t + delay, seq: this.qseq++, fn }); }
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
    };
  }

  step() {
    const dt = PACE.dt;
    this.t += dt; this.tick++;
    if (this.tick === 1) for (const m of this.mages) for (const a of m.arts) ARTIFACTS[a.id]?.hooks.start?.(this.ctx(m), a.st);
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
      if (this.smokeT >= 1) { this.smokeT -= 1; for (const m of this.mages) this.applyStatus(m, 'poison', 1, null); }
    }
    if (this.t > PACE.sudden) {
      if (!this.sudden) { this.sudden = true; this.ev({ type: 'sudden' }); }
      const k = (1 + (this.t - PACE.sudden) * 0.5) * dt;
      for (const m of this.mages) { m.hp -= k; if (m.hp <= 0) this.kill(m, null); }
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
        block: m.block, mirror: m.mirror + (m.mirrorAll > 0 ? 1 : 0), counter: m.counter, sanctuary: m.sanctuary > 0, angel: m.angel,
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
    for (const w of m.wardLines) if (w && w.cd > 0) w.cd -= dt;
    m.auras = m.auras.filter(a => a.until > this.t);
    for (const l of m.lines) if (l.blot && l.blot <= this.t) l.blot = 0;
    this.tickCurses(m, dt);
    for (const a of m.arts) ARTIFACTS[a.id]?.hooks.tick?.(this.ctx(m), a.st, dt);
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
      if (b.st.burn > 0) this.damage(this.burnSource(b), b, b.st.burn * 0.8, { kind: 'dot', ess: 'fire', status: 'burn' });
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
        for (const a of m.arts) ARTIFACTS[a.id]?.hooks.loop?.(this.ctx(m), a.st);
        this.wardFire(m, 'loop');
        if (!m.alive || this.over()) return;
      }
      m.phase = 'idle';
    }
    if (m.phase === 'idle' || m.phase === 'starved') this.beginNext(m);
  }

  castable(l: LineState) { return l.uses > 0 && !(l.blot > this.t); }

  inkCost(m: Mage, res: Resolved): number {
    let c = res.ink;
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
    for (const a of foe.arts) ARTIFACTS[a.id]?.hooks.foeRead?.(this.ctx(foe), a.st, L.res);
    if (!m.alive || this.over()) return;
    for (const a of foe.arts) {
      const f = ARTIFACTS[a.id]?.hooks.cancelFoe;
      if (f && f(this.ctx(foe), a.st, L.res)) {
        this.ev({ type: 'fizzle', side: m.side, reason: 'Struck out', name: L.res.name });
        this.artFlash(foe, a.id);
        return;
      }
    }
    if (foe.counter > 0) {
      foe.counter--;
      this.ev({ type: 'fizzle', side: m.side, reason: 'Countered', name: L.res.name });
      this.ev({ type: 'wardUse', side: foe.side, kind: 'counter' });
      this.wardRetort(foe, m);
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
      if (c.id === 'tongues' || c.res.base.id === 'tongues') {
        const owner = this.mage(c.owner);
        this.ev({ type: 'cursePulse', side: m.side, key: c.key });
        this.damage(owner, m, 3 * c.power, { kind: 'curse', ess: c.res.primary });
        if (!ridersEmpty(c.riders)) this.applyRiders(owner, m, c.riders, c.power, c.res, {});
      }
      if (c.id === 'apocalypse') c.data.shorten = (c.data.shorten || 0) + 1;
    }
  }

  // ---------- casting ----------
  cast(m: Mage, res: Resolved, o: { power: number; line?: number; via?: string; echo?: boolean }) {
    if (!m.alive || this.over()) return;
    const castId = this.castSeq++;
    const foe = this.opp(m);
    this.ev({ type: 'cast', side: m.side, line: o.line ?? -1, name: res.name, form: res.form, ess: res.primary, castId, via: o.via, legendary: !!res.legendary });
    if (res.legendary && !o.echo) this.ev({ type: 'callout', side: m.side, text: res.legendary.name, sub: res.legendary.text, gold: true });
    let power = o.power * res.power;
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.castPower; if (f) power *= f(this.ctx(m), a.st, res); }
    for (const a of m.arts) ARTIFACTS[a.id]?.hooks.cast?.(this.ctx(m), a.st, res, !!o.echo);
    for (const a of foe.arts) ARTIFACTS[a.id]?.hooks.foeCast?.(this.ctx(foe), a.st, res);
    if (!m.alive || this.over()) return;
    m.castCount++;
    if (!o.echo && res.base.id !== 'echo') { m.lastCast = res; m.lastPower = o.power; }
    // Static Field: each cast charges the enemy
    for (const a of m.auras) if (a.id === 'staticfield' && a.until > this.t) this.applyStatus(foe, 'charge', 1, m);
    // curses that react to the victim casting
    for (const c of m.curses) {
      if (c.res.essCount.storm && c.res.base.id !== 'tongues') {
        this.ev({ type: 'cursePulse', side: m.side, key: c.key });
        this.damage(foe, m, 3 * c.power, { kind: 'curse', ess: 'storm' });
        this.applyStatus(m, 'charge', 1, foe);
      }
      if (c.res.inst.inf.some(id => SPELLS[id].essence === 'arcane') && this.rng() < 0.25) {
        this.ev({ type: 'cursePulse', side: m.side, key: c.key });
        this.ev({ type: 'backfire', side: m.side });
        this.damage(foe, m, 6 * c.power, { kind: 'curse', ess: 'arcane' });
      }
    }
    // arcane fields make your spells echo
    if (!o.echo && this.fields.some(f => f.owner === m.side && f.flags.echo)) {
      this.at(0.5, () => this.cast(m, res, { power: 0.4 * o.power, line: o.line, via: 'Echo field', echo: true }));
    }
    let tgt: Mage = foe;
    const offensive = res.form === 'bolt' || res.form === 'burst' || res.form === 'curse' || res.form === 'hex';
    if (offensive && m.hexSelf > 0) { m.hexSelf--; tgt = m; this.ev({ type: 'backfire', side: m.side }); }
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

  castBolt(m: Mage, tgt: Mage, res: Resolved, power: number, castId: number) {
    const to = this.boltTarget(m, tgt);
    const id = res.base.id;
    const style = id === 'stone' ? 'heavy' : id === 'spark' ? 'spark' : id === 'chainlightning' ? 'lightning' : id === 'rotseed' ? 'seed' : res.riders.heavy ? 'heavy' : 'bolt';
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
      case 'stone': dmg = 14; heavy = true; break;
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
    // Frost Armour: whoever hits you gains Chill
    if (to.kind === 'mage' && foeSide && !o.riderOnly) {
      const tm = to as Mage;
      for (const a of tm.auras) if (a.id === 'frostarmour' && a.until > this.t) { const att = o.attacker || m; this.applyStatus(att, 'chill', 1, tm); this.damage(tm, att, 2 * a.power, { kind: 'spell', ess: 'frost', quiet: true }); }
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
    }
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
    const pos = kind === 'ball' ? { x: (this.rng() - 0.5) * 3, z: (owner === 0 ? 1 : -1) * BOARD.backZ, slot: 99 } : this.slotFor(owner, row);
    const u: Unit = {
      id: this.nextId++, kind: 'unit', side: owner, owner, name: o.name || UNIT_TITLE[kind] || kind, ukind: kind,
      hp, maxHp: hp, alive: true, st: zeroSt(), decay: zeroSt(), dotT: 0, frozen: 0, freezeImmune: 0, poisonCap: 6, morph: 0, morphKind: null, glacier: 0,
      atk: d.atk, interval, atkT: 0.6 + this.rng() * 0.6, ranged: d.ranged, taunt, blocker: !!d.blocker, life: o.life ?? Infinity,
      riders: o.riders || emptyRiders(), ess, power: o.power, x: pos.x, z: pos.z, slot: pos.slot, row: kind === 'ball' ? 'free' : row,
      split: has('arcane'), tint: o.tint ?? null, flags: {},
    };
    this.units.push(u);
    this.ev({ type: 'spawn', unit: this.unitSnap(u), temp: u.life < 1e8 });
    for (const a of owners.arts) ARTIFACTS[a.id]?.hooks.summon?.(this.ctx(owners), a.st, u);
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
    else if (res.special === 'cherub') kind = 'cherub';
    const count = kind === 'skeleton' ? 3 : 1;
    const twin = this.hasArt(m, 'twincoin');
    for (let rep = 0; rep < (twin ? 2 : 1); rep++) {
      for (let i = 0; i < count; i++) {
        const u = this.addUnit(m.side, kind, { ...common, name: res.name });
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
    if (u && near && k === 'ball') { u.x = near.kind === 'unit' ? (near as Unit).x : 0; }
  }

  tickUnit(u: Unit, dt: number) {
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
    if (u.atk <= 0) return;
    u.atkT -= dt / (1 + 0.08 * u.st.chill);
    if (u.atkT > 0) return;
    u.atkT = u.interval;
    if (u.ukind === 'cherub') {
      this.ev({ type: 'unitAtk', id: u.id, tgt: owner.id });
      this.heal(owner, 2 * u.power);
      return;
    }
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
    const res = { ...resolveSpell({ uid: 0, base: 'imp', inf: [], tier: 0 }), riders: u.riders, compounds: [], essences: u.ess, primary: (u.tint || (u.ukind === 'salamander' || u.ukind === 'pitlord' ? 'fire' : u.ukind === 'frostlich' ? 'frost' : u.ukind === 'rat' ? 'venom' : 'stone')) as Essence } as Resolved;
    if (u.ess.includes('storm')) res.riders = { ...u.riders, chain: Math.max(u.riders.chain, 0.5) };
    const land = () => {
      if (!target.alive || !u.alive && u.ukind !== 'skeleton') return;
      this.hitPayload(owner, target, res, u.power, dmg, st, u.ess.includes('stone'), { attacker: u, kind: 'summon', freezeAt: u.ukind === 'frostlich' ? 3 : undefined });
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
      case 'blizzard': this.makeField(m, foe.side, 'blizzard', res.name, res, power, 10 * durMult, 1, lite, res.primary, flags); break;
      case 'miasma': this.makeField(m, foe.side, 'miasma', res.name, res, power, 12 * durMult, 2, lite, res.primary, flags); break;
      case 'thunderhead': this.makeField(m, foe.side, 'thunder', res.name, res, power, 16 * durMult, 2, lite, res.primary, flags); break;
      case 'consecration': this.makeField(m, m.side, 'consecration', res.name, res, power, 12 * durMult, 1, lite, res.primary, flags); break;
    }
  }

  tickField(f: Field, dt: number) {
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
      case 'blizzard': for (const b of on) { this.applyStatus(b, 'chill', 1, owner); this.damage(owner, b, (b.kind === 'unit' ? 2 : 1.5) * f.power, { kind: 'field', ess: 'frost', quiet: true }); } break;
      case 'miasma': case 'smog': for (const b of on) this.applyStatus(b, 'poison', 1, owner); break;
      case 'thunder': {
        if (!on.length) break;
        const b = on[Math.floor(this.rng() * on.length)];
        this.ev({ type: 'strike', tgt: b.id, ess: 'storm' });
        this.damage(owner, b, 5 * f.power, { kind: 'field', ess: 'storm' });
        break;
      }
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
    const id = res.legendary?.id === 'apocalypse' ? 'apocalypse' : res.base.id;
    if (victim.curses.length >= 5) {
      const old = victim.curses.shift()!;
      this.ev({ type: 'curseEnd', side: victim.side, key: old.key, how: 'crowded' });
    }
    const lite = liteRiders(res.riders); lite.hatch = []; lite.guard = 0; lite.echo = 0;
    const c: Curse = { key: this.nextId++, id, name: res.name, res, owner: owner.side, power, age: 0, tickT: 0, pulseT: 0, riders: lite, data: {} };
    victim.curses.push(c);
    this.ev({ type: 'curse', side: victim.side, key: c.key, name: c.name, ess: res.primary });
    if (id === 'immolate' && victim.st.burn < 2) this.applyStatus(victim, 'burn', 2 - victim.st.burn, owner);
    if (id === 'wither') { victim.poisonCap = 12; this.applyStatus(victim, 'poison', 2, owner); }
    for (const k of res.riders.hatch) this.spawnMinion(owner, k, 6, power);
    if (res.riders.guard) { owner.block += res.riders.guard; this.ev({ type: 'ward', side: owner.side, kind: 'block', name: res.name }); }
    for (const a of owner.arts) ARTIFACTS[a.id]?.hooks.cursed?.(this.ctx(owner), a.st, c);
  }

  doomLeft(victim: Mage, c: Curse): number {
    const others = victim.curses.length - 1;
    return 22 - c.age - 2 * others - (c.data.shorten || 0);
  }

  tickCurses(m: Mage, dt: number) {
    for (const c of m.curses.slice()) {
      if (!m.alive || this.over()) return;
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
        }
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
    m.auras.push({ key: this.nextId++, id, name: res.name, res, power, until: this.t + dur, riders: lite });
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
    } else if (res.base.id === 'echo') {
      const prev = m.lastCast;
      if (!prev || o.echo) { this.ev({ type: 'fizzle', side: m.side, reason: 'Nothing to echo', name: res.name }); }
      else this.at(0.3, () => this.cast(m, prev, { power: 0.8 * power * m.lastPower, via: 'Echo', echo: true }));
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
    const id = res.legendary?.id || res.base.id;
    const extra = res.inst.tier >= 2 ? 1 : 0;
    switch (id) {
      case 'icewall': m.block += 2 + extra; this.ev({ type: 'ward', side: m.side, kind: 'block', name: res.name }); break;
      case 'mirror': m.mirror += 1 + extra; this.ev({ type: 'ward', side: m.side, kind: 'mirror', name: res.name }); break;
      case 'philmirror': m.mirrorAll = 5 * power; this.heal(m, 12 * power); this.ev({ type: 'ward', side: m.side, kind: 'mirror', name: res.name }); break;
      case 'counterspell': m.counter += 1 + extra; this.ev({ type: 'ward', side: m.side, kind: 'counter', name: res.name }); break;
      case 'sanctuary': m.sanctuary = 4 * res.riders.durMult; this.ev({ type: 'ward', side: m.side, kind: 'sanctuary', name: res.name }); break;
      case 'guardianangel': m.angel = true; this.ev({ type: 'ward', side: m.side, kind: 'angel', name: res.name }); break;
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
  damage(src: Mage | null, tgt: Body, amt: number, info: DmgInfo & { castId?: number; res?: Resolved; quiet?: boolean }): number {
    if (!tgt.alive || amt <= 0 || this.over()) return 0;
    const kind = info.kind;
    if (src && src.side !== tgt.side) {
      if (kind === 'spell' || kind === 'summon') {
        for (const a of src.auras) if (a.id === 'kindle' && a.until > this.t && kind === 'spell') amt += tgt.st.burn * 0.5 * a.power;
      }
      for (const a of src.arts) { const f = ARTIFACTS[a.id]?.hooks.outDmg; if (f) amt = f(this.ctx(src), a.st, tgt, amt, info); }
    }
    if (tgt.kind === 'mage') {
      const m = tgt as Mage;
      if (kind === 'spell' || kind === 'summon') for (const a of m.auras) if (a.id === 'stoneskin' && a.until > this.t) amt = Math.max(1, amt - 2 * a.power);
      for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.inDmg; if (f) amt = f(this.ctx(m), a.st, src, amt, info); }
    }
    let crit = false;
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
    if (!info.quiet || amt >= 1) this.ev({ type: 'dmg', tgt: tgt.id, amt: r1(amt), ess: info.ess || null, kind, crit, castId: info.castId });
    if (src && src.side !== tgt.side) for (const a of src.arts) ARTIFACTS[a.id]?.hooks.dealt?.(this.ctx(src), a.st, tgt, amt, info);
    if (tgt.kind === 'unit') {
      const u = tgt as Unit;
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
        m.angel = false; m.hp = m.maxHp * 0.25;
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
    if (u.ess.includes('fire') || u.ukind === 'pitlord') {
      this.ev({ type: 'burst', side: foe.side, ess: 'fire', from: u.id, flight: 0.5 });
      this.at(0.5, () => { this.damage(owner, foe, 6 * u.power, { kind: 'spell', ess: 'fire' }); this.applyStatus(foe, 'burn', 2, owner); });
    }
    if (u.ess.includes('venom') || u.ukind === 'rat') this.makeField(owner, foe.side, 'miasma', 'Plague cloud', null, u.power, 6, 2, emptyRiders(), 'venom', {});
    for (const a of owner.arts) ARTIFACTS[a.id]?.hooks.unitDied?.(this.ctx(owner), a.st, u, true);
    for (const a of foe.arts) ARTIFACTS[a.id]?.hooks.unitDied?.(this.ctx(foe), a.st, u, false);
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
    for (const a of m.arts) { const f = ARTIFACTS[a.id]?.hooks.healMult; if (f) amt *= f(this.ctx(m), a.st); }
    const before = m.hp;
    m.hp = Math.min(m.maxHp, m.hp + amt);
    const got = m.hp - before;
    if (got <= 0) return 0;
    m.healed += got;
    this.ev({ type: 'heal', tgt: m.id, amt: r1(got) });
    for (const a of m.auras) {
      if (a.id === 'retribution' && a.until > this.t) this.damage(m, this.opp(m), got * 0.4 * a.power, { kind: 'retribution', ess: 'holy', quiet: got < 1 });
    }
    for (const a of m.arts) ARTIFACTS[a.id]?.hooks.healed?.(this.ctx(m), a.st, got, fromCurse);
    return got;
  }

  react(id: string, tgt: Body) {
    const r = REACTIONS.find(x => x.id === id);
    this.found.add(id);
    this.ev({ type: 'react', tgt: tgt.id, id, name: r ? r.name : id });
    const owner = tgt.kind === 'mage' ? this.opp(tgt as Mage) : this.mages[1 - tgt.side];
    for (const a of owner.arts) ARTIFACTS[a.id]?.hooks.reaction?.(this.ctx(owner), a.st, id, tgt);
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
        st.charge = Math.min(10, st.charge + n); break;
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
