// Curios sold in the shop beside the library: one staff and a few trinkets.
// Each artifact is data plus a handful of hooks the simulation calls. Plain TypeScript, no rendering.
import type { Essence } from './spells';
import { SPELL_LIST } from './spells';
import type { Resolved } from './fusion';
import { resolveSpell } from './fusion';
import type { Status } from './codex';
import type { Body, Curse, Mage, Unit } from '../sim/types';
import type { Duel } from '../sim/duel';

export interface ArtCtx { duel: Duel; me: Mage; foe: Mage }
export interface DmgInfo { kind: string; ess?: Essence | null; heavy?: boolean; glacier?: boolean; status?: Status }
// per-duel scratch memory for an artifact
export type Mem = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ArtifactHooks {
  init?(c: ArtCtx, s: Mem): void;
  start?(c: ArtCtx, s: Mem): void;
  tick?(c: ArtCtx, s: Mem, dt: number): void;
  loop?(c: ArtCtx, s: Mem): void;
  foeRead?(c: ArtCtx, s: Mem, res: Resolved): void;
  cancelFoe?(c: ArtCtx, s: Mem, res: Resolved): boolean;
  castPower?(c: ArtCtx, s: Mem, res: Resolved): number;
  cast?(c: ArtCtx, s: Mem, res: Resolved, echo: boolean): void;
  foeCast?(c: ArtCtx, s: Mem, res: Resolved): void;
  readMult?(c: ArtCtx, s: Mem): number;
  inkMult?(c: ArtCtx, s: Mem, res: Resolved): number;
  readAdd?(c: ArtCtx, s: Mem, res: Resolved): number;
  incomingBolt?(c: ArtCtx, s: Mem, res: Resolved): boolean;
  unitHp?(c: ArtCtx, s: Mem, kind: string): number;
  summon?(c: ArtCtx, s: Mem, u: Unit): void;
  cursed?(c: ArtCtx, s: Mem, curse: Curse): void;
  stunned?(c: ArtCtx, s: Mem, form: string): boolean;
  outDmg?(c: ArtCtx, s: Mem, tgt: Body, amt: number, info: DmgInfo): number;
  inDmg?(c: ArtCtx, s: Mem, src: Mage | null, amt: number, info: DmgInfo): number;
  dealt?(c: ArtCtx, s: Mem, tgt: Body, amt: number, info: DmgInfo): void;
  wouldDie?(c: ArtCtx, s: Mem): boolean;
  unitDied?(c: ArtCtx, s: Mem, u: Unit, mine: boolean): void;
  healMult?(c: ArtCtx, s: Mem): number;
  healed?(c: ArtCtx, s: Mem, amt: number, fromCurse: boolean): void;
  reaction?(c: ArtCtx, s: Mem, id: string, tgt: Body): void;
  freezeDur?(c: ArtCtx, s: Mem, dur: number): number;
  outStatus?(c: ArtCtx, s: Mem, st: Status, n: number, tgt: Body): number;
  inStatus?(c: ArtCtx, s: Mem, st: Status, n: number, src: Mage | null): number;
  blazeMult?(c: ArtCtx, s: Mem): number;
  conductMult?(c: ArtCtx, s: Mem): number;
}

export type ArtSlot = 'staff' | 'trinket';

export interface ModelSpec {
  kind: string; // shape family for the 3D model and icon
  color: string;
  accent?: string;
  glow?: string;
}

export interface ArtifactDef {
  id: string;
  name: string;
  slot: ArtSlot;
  rarity: 0 | 1 | 2 | 3;
  text: string;
  flavor: string;
  model: ModelSpec;
  ess?: Essence; // which school it leans toward, for shop colouring
  hooks: ArtifactHooks;
}

export const RARITY = [
  { name: 'Common', color: '#c9c2ad', price: 5 },
  { name: 'Uncommon', color: '#5cc0b0', price: 9 },
  { name: 'Rare', color: '#6fa8ff', price: 14 },
  { name: 'Mythic', color: '#f0b441', price: 22 },
];

const flash = (c: ArtCtx, id: string, text?: string) => c.duel.artFlash(c.me, id, text);
const isEss = (info: DmgInfo, e: Essence) => info.ess === e && (info.kind === 'spell' || info.kind === 'summon');
const foeOf = (c: ArtCtx, b: Body) => b.side === c.foe.side;
const baseSpell = (id: string) => resolveSpell({ uid: 0, base: id, inf: [], tier: 0 });

const A = (id: string, name: string, slot: ArtSlot, rarity: 0 | 1 | 2 | 3, text: string, flavor: string, model: ModelSpec, hooks: ArtifactHooks, ess?: Essence): ArtifactDef =>
  ({ id, name, slot, rarity, text, flavor, model, hooks, ess });

export const ARTIFACT_LIST: ArtifactDef[] = [
  // ---------------- staves ----------------
  A('ashwood', 'Ashwood Staff', 'staff', 0, '+15 maximum ink.', "Every apprentice's first staff. It smells faintly of bonfire.",
    { kind: 'staff-knot', color: '#8a6a4a', glow: '#ffcf8a' },
    { init: c => { c.me.maxInk += 15; c.me.ink += 15; } }),
  A('emberwood', 'Emberwood Staff', 'staff', 1, 'Fire spells deal 15% more damage. Hits that apply 2+ Burning apply 1 more.', 'The wood never stopped smouldering after the lightning found it.',
    { kind: 'staff-ember', color: '#3a2218', glow: '#ff7a3d' },
    { outDmg: (_c, _s, _t, amt, info) => isEss(info, 'fire') ? amt * 1.15 : amt,
      outStatus: (_c, _s, st, n) => st === 'burn' && n >= 2 ? n + 1 : n }, 'fire'),
  A('rimeglass', 'Rimeglass Staff', 'staff', 1, 'Frost spells deal 20% more damage. Your freezes last 1 s longer.', 'Carved from a single icicle that refused to melt.',
    { kind: 'staff-crystal', color: '#cfe8ff', glow: '#9fdcff' },
    { outDmg: (_c, _s, _t, amt, info) => isEss(info, 'frost') ? amt * 1.2 : amt, freezeDur: (_c, _s, d) => d + 1 }, 'frost'),
  A('thornroot', 'Thornroot Staff', 'staff', 1, 'Your summons have 40% more health.', 'Still growing. Water it on Sundays.',
    { kind: 'staff-thorn', color: '#4a5a2a', glow: '#a6e86a' },
    { unitHp: () => 1.4 }, 'stone'),
  A('stormrod', "Stormcaller's Rod", 'staff', 1, 'Every 4th spell you cast also fires a free Spark.', 'A copper rod that hums before weather.',
    { kind: 'staff-rod', color: '#b87333', glow: '#ffe066' },
    { cast: (c, s, _res, echo) => {
      if (echo) return;
      s.n = (s.n || 0) + 1;
      if (s.n % 4 === 0) { flash(c, 'stormrod'); c.duel.at(0.3, () => c.duel.cast(c.me, baseSpell('spark'), { power: 1, via: "Stormcaller's Rod", echo: true })); }
    } }, 'storm'),
  A('censer', 'Censer of Dawn', 'staff', 2, 'Your healing is 30% stronger, and each heal of 5 or more sears the enemy for 2.', 'Swing it gently. The incense is older than the chapel.',
    { kind: 'staff-censer', color: '#d9b45a', glow: '#ffeaa0' },
    { healMult: () => 1.3,
      healed: (c, s, amt) => { if (amt < 5) return; s.t = s.t || 0; if (c.duel.t - s.t < 0.5) return; s.t = c.duel.t; c.duel.damage(c.me, c.foe, 2, { kind: 'spell', ess: 'holy' }); } }, 'holy'),
  A('hollowreed', 'Hollow Reed', 'staff', 2, 'You read 20% faster, but every spell costs 25% more ink.', 'Speak into one end and the words come out of the other, hurried.',
    { kind: 'staff-reed', color: '#a8b070', glow: '#e0f0a0' },
    { readMult: () => 1.2, inkMult: () => 1.25 }, 'arcane'),
  A('bonecrook', 'Bonewhite Crook', 'staff', 2, 'When one of your summons dies, a skeleton rises in its place.', 'A shepherd of a certain kind of flock.',
    { kind: 'staff-crook', color: '#e8e0cc', glow: '#c8d8ff' },
    { unitDied: (c, _s, u, mine) => {
      if (!mine || u.ukind === 'skeleton' || u.ukind === 'decoy' || u.life !== Infinity) return;
      flash(c, 'bonecrook'); c.duel.addUnit(c.me.side, 'skeleton', { power: 1 });
    } }, 'shadow'),
  A('lastpage', 'Staff of the Last Page', 'staff', 3, 'When your tome loops, recast your most recent once spell at 60% power.', 'Topped with the final page of a book no one finished writing.',
    { kind: 'staff-book', color: '#3a2a4a', glow: '#f6e7a8' },
    { cast: (_c, s, res, echo) => { if (!echo && res.uses === 1) s.last = res; },
      loop: (c, s) => { if (!s.last) return; const r = s.last as Resolved; flash(c, 'lastpage', r.name); c.duel.at(0.4, () => c.duel.cast(c.me, r, { power: 0.6, via: 'Last Page', echo: true })); } }, 'arcane'),
  A('moebius', 'Moebius Staff', 'staff', 3, 'Your first line is read twice: it casts again at 60% power.', 'It has one side. Try not to think about it.',
    { kind: 'staff-loop', color: '#6a5a8a', glow: '#c59bff' }, {}, 'arcane'),

  // ---------------- common trinkets ----------------
  A('rubychip', 'Ruby Chip', 'trinket', 0, 'Fire spells deal 15% more damage.', 'A chip off a much larger, much angrier stone.',
    { kind: 'gem', color: '#d0233a', glow: '#ff5a5a' },
    { outDmg: (_c, _s, _t, amt, info) => isEss(info, 'fire') ? amt * 1.15 : amt }, 'fire'),
  A('sapphire', 'Sapphire Chip', 'trinket', 0, 'Frost spells deal 15% more damage.', 'Cold to the touch, even in a pocket.',
    { kind: 'gem', color: '#2a5ad0', glow: '#8fc0ff' },
    { outDmg: (_c, _s, _t, amt, info) => isEss(info, 'frost') ? amt * 1.15 : amt }, 'frost'),
  A('emerald', 'Emerald Chip', 'trinket', 0, 'Poison you apply is 1 stack stronger.', 'Green as a snake, and about as friendly.',
    { kind: 'gem', color: '#1f9a4a', glow: '#94e36a' },
    { outStatus: (_c, _s, st, n) => st === 'poison' ? n + 1 : n }, 'venom'),
  A('topaz', 'Topaz Chip', 'trinket', 0, 'Storm spells deal 15% more damage.', 'It crackles when you rub it on wool.',
    { kind: 'gem', color: '#e0a020', glow: '#ffe066' },
    { outDmg: (_c, _s, _t, amt, info) => isEss(info, 'storm') ? amt * 1.15 : amt }, 'storm'),
  A('onyx', 'Onyx Chip', 'trinket', 0, 'Your curses deal 15% more damage.', 'Absorbs light, and a little bit of goodwill.',
    { kind: 'gem', color: '#1a1420', glow: '#e0486e' },
    { outDmg: (_c, _s, _t, amt, info) => info.kind === 'curse' ? amt * 1.15 : amt }, 'shadow'),
  A('pearl', 'Pearl Chip', 'trinket', 0, 'Healing is 20% stronger.', 'Formed around a prayer instead of a grain of sand.',
    { kind: 'pearl', color: '#f4eee0', glow: '#ffeaa0' },
    { healMult: () => 1.2 }, 'holy'),
  A('amethyst', 'Amethyst Chip', 'trinket', 0, 'Arcane spells read 0.4 s faster.', 'Hold it to your ear and it whispers the next word.',
    { kind: 'gem', color: '#7a3ac0', glow: '#c59bff' },
    { readAdd: (_c, _s, res) => res.essences.includes('arcane') ? -0.4 : 0 }, 'arcane'),
  A('flint', 'Flint Chip', 'trinket', 0, 'Heavy hits deal 4 more damage.', 'Strike it and it sparks. Throw it and it hurts.',
    { kind: 'rock', color: '#8a8480', glow: '#d0a577' },
    { outDmg: (_c, _s, _t, amt, info) => info.heavy ? amt + 4 : amt }, 'stone'),
  A('inkvial', 'Vial of Squid Ink', 'trinket', 0, '+25 maximum ink.', 'The squid was paid, eventually.',
    { kind: 'vial', color: '#1a1830', glow: '#7d8fd8' },
    { init: c => { c.me.maxInk += 25; c.me.ink += 25; } }),
  A('thimble', 'Iron Thimble', 'trinket', 0, 'Take 1 less damage from every spell and summon hit.', "A seamstress's armour.",
    { kind: 'thimble', color: '#7a7a82', glow: '#c8c8d0' },
    { inDmg: (_c, _s, _src, amt, info) => (info.kind === 'spell' || info.kind === 'summon') ? Math.max(0.5, amt - 1) : amt }),
  A('waxseal', 'Wax Seal', 'trinket', 0, 'You start each duel behind a ward that blocks one bolt.', 'Pressed with a sigil that means “not yet”.',
    { kind: 'seal', color: '#a8202a', glow: '#ff8080' },
    { start: c => { c.me.block += 1; c.duel.ev({ type: 'ward', side: c.me.side, kind: 'block', name: 'Wax Seal' }); } }),
  A('knucklebone', 'Knucklebone', 'trinket', 0, '+20 maximum health.', 'Lucky, according to whoever lost it.',
    { kind: 'bone', color: '#e8dcc0', glow: '#fff4d0' },
    { init: c => { c.me.maxHp += 20; c.me.hp += 20; } }),

  // ---------------- uncommon trinkets ----------------
  A('cinderchalice', 'Cinder Chalice', 'trinket', 1, 'Heal for 30% of the Burning damage your enemies take.', 'Drink deep. It tastes of smoke and other people.',
    { kind: 'chalice', color: '#b8862a', glow: '#ff7a3d' },
    { dealt: (c, s, tgt, amt, info) => {
      if (info.status !== 'burn' || !foeOf(c, tgt)) return;
      c.duel.heal(c.me, amt * 0.3, true);
      if (!s.t || c.duel.t - s.t > 3) { s.t = c.duel.t; flash(c, 'cinderchalice'); }
    } }, 'fire'),
  A('leechtooth', 'Leech Tooth', 'trinket', 1, 'Heal for 30% of the Poison damage your enemies take.', 'It is still, technically, hungry.',
    { kind: 'tooth', color: '#d8d0b0', glow: '#94e36a' },
    { dealt: (c, s, tgt, amt, info) => {
      if (info.status !== 'poison' || !foeOf(c, tgt)) return;
      c.duel.heal(c.me, amt * 0.3, true);
      if (!s.t || c.duel.t - s.t > 3) { s.t = c.duel.t; flash(c, 'leechtooth'); }
    } }, 'venom'),
  A('salamanderscale', 'Salamander Scale', 'trinket', 1, "You can't catch fire. Burning meant for you catches the enemy instead.", 'Warm, faintly pulsing, shed willingly (probably).',
    { kind: 'scale', color: '#d85a20', glow: '#ffb050' },
    { inStatus: (c, s, st, n, src) => {
      if (st !== 'burn') return n;
      if (src && src.side === c.foe.side && !s.bounce) {
        s.bounce = 1; c.duel.applyStatus(c.foe, 'burn', n, c.me); s.bounce = 0;
        if (!s.t || c.duel.t - s.t > 2) { s.t = c.duel.t; flash(c, 'salamanderscale'); }
      }
      return 0;
    } }, 'fire'),
  A('frostlocket', 'Frostbite Locket', 'trinket', 1, 'You deal 30% more damage to targets that are Frozen or have 3+ Chill.', 'Inside: a lock of hair, frozen mid-curl.',
    { kind: 'locket', color: '#a0c8e8', glow: '#9fdcff' },
    { outDmg: (_c, _s, tgt, amt) => (tgt.frozen > 0 || tgt.st.chill >= 3) ? amt * 1.3 : amt }, 'frost'),
  A('lodestone', 'Lodestone', 'trinket', 1, 'Conduct deals double damage, and anything that adds Charge adds 1 more.', 'Iron filings follow you around like ducklings.',
    { kind: 'rock', color: '#3a3a44', glow: '#ffe066' },
    { conductMult: () => 2, outStatus: (_c, _s, st, n) => st === 'charge' ? n + 1 : n }, 'storm'),
  A('oilglove', 'Oil-stained Glove', 'trinket', 1, 'Your Blazes deal double damage. The enemy starts every duel with 2 Oil.', 'Belonged to a lamplighter with no eyebrows.',
    { kind: 'glove', color: '#4a3a28', glow: '#c9a86a' },
    { blazeMult: () => 2, start: c => c.duel.applyStatus(c.foe, 'oil', 2, c.me) }, 'fire'),
  A('rainbell', 'Rain Bell', 'trinket', 1, 'Every 8 s, the enemy gains 1 Wet.', 'Ring it and somewhere, someone regrets their laundry.',
    { kind: 'bell', color: '#8ab0c8', glow: '#6fb6ff' },
    { tick: (c, s, dt) => { s.t = (s.t || 0) + dt; if (s.t >= 8) { s.t -= 8; c.duel.applyStatus(c.foe, 'wet', 1, c.me); flash(c, 'rainbell'); } } }, 'frost'),
  A('impjar', 'Imp in a Jar', 'trinket', 1, 'At the start of each duel, an imp hops out to fight for you.', 'Airholes in the lid. It knocks politely.',
    { kind: 'jar', color: '#a8c0b0', glow: '#ff7a3d' },
    { start: c => { flash(c, 'impjar'); c.duel.addUnit(c.me.side, 'imp', { power: 1, name: 'Jar Imp' }); } }, 'stone'),
  A('goldquill', 'Gilded Quill', 'trinket', 1, 'Your once spells cost no ink.', 'Writes in gold, signs in blood, costs you nothing (it says).',
    { kind: 'quill', color: '#f0d070', glow: '#fff0a0' },
    { inkMult: (_c, _s, res) => res.uses === 1 ? 0 : 1 }),
  A('hourglass', 'Hourglass of Fine Sand', 'trinket', 1, 'The pause before your tome loops is 1.5 s instead of 3.', 'The sand is ground from a clock tower.',
    { kind: 'hourglass', color: '#c8a868', glow: '#ffe0a0' },
    { init: c => { c.me.recharge = 1.5; } }),
  A('blackcandle', 'Black Candle', 'trinket', 1, 'Your spells deal 4% more damage for each curse on the enemy.', 'It burns downward into the dark.',
    { kind: 'candle', color: '#18121c', glow: '#e0486e' },
    { outDmg: (c, _s, _t, amt, info) => info.kind === 'spell' ? amt * (1 + 0.04 * c.foe.curses.length) : amt }, 'shadow'),
  A('vampfang', 'Vampire Fang', 'trinket', 1, 'Heal for 10% of the spell and summon damage you deal.', 'Sharp enough to still be a little bit hungry.',
    { kind: 'fang', color: '#f0e8e0', glow: '#e0486e' },
    { dealt: (c, _s, tgt, amt, info) => { if (foeOf(c, tgt) && (info.kind === 'spell' || info.kind === 'summon')) c.duel.heal(c.me, amt * 0.1, true); } }, 'shadow'),
  A('mossidol', 'Moss Idol', 'trinket', 1, 'Your summons regrow 1 health per second.', 'A little stone saint, patient as lichen.',
    { kind: 'idol', color: '#6a7a50', glow: '#a6e86a' },
    { tick: (c, s, dt) => { s.t = (s.t || 0) + dt; if (s.t < 1) return; s.t -= 1; for (const u of c.duel.unitsOf(c.me.side)) u.hp = Math.min(u.maxHp, u.hp + 1); } }, 'stone'),

  // ---------------- rare trinkets ----------------
  A('phoenix', 'Phoenix Feather', 'trinket', 2, 'The first time you would die, burst into flame: return at 40% health and give the enemy 5 Burning.', 'Warm. Always warm.',
    { kind: 'feather', color: '#ff6a20', glow: '#ffb050' },
    { wouldDie: (c, s) => {
      if (s.used) return false;
      s.used = 1; c.me.hp = c.me.maxHp * 0.4;
      flash(c, 'phoenix');
      c.duel.ev({ type: 'callout', side: c.me.side, text: 'Phoenix Feather', sub: `${c.me.name} rises from the ashes` });
      c.duel.ev({ type: 'burst', side: c.me.side, ess: 'fire', from: c.me.id, flight: 0 });
      c.duel.applyStatus(c.foe, 'burn', 5, c.me);
      return true;
    } }, 'fire'),
  A('tonguejar', 'Tongue in a Jar', 'trinket', 2, 'Each time the enemy finishes reading a line, 30% chance you cast a free Spark.', 'It repeats everything it hears, but meaner.',
    { kind: 'jar-tongue', color: '#b0c8b8', glow: '#ffe066' },
    { foeRead: (c) => { if (c.duel.rng() < 0.3) { flash(c, 'tonguejar'); c.duel.at(0.25, () => c.duel.cast(c.me, baseSpell('spark'), { power: 1, via: 'Tongue in a Jar', echo: true })); } } }, 'storm'),
  A('mirrorshard', 'Mirror Shard', 'trinket', 2, 'The first enemy bolt each loop is reflected back at them.', 'Seven years of bad luck, pointed outward.',
    { kind: 'mirror', color: '#c8d8e8', glow: '#e0f0ff' },
    { start: (_c, s) => { s.ready = 1; }, loop: (_c, s) => { s.ready = 1; },
      incomingBolt: (c, s, res) => {
        if (!s.ready) return false;
        s.ready = 0; flash(c, 'mirrorshard');
        const d = c.duel, me = c.me, foe = c.foe;
        const to = d.boltTarget(me, foe);
        d.launch(me.id, to, 0.8, res.primary, 'bolt', 1, undefined, (pid) => {
          if (!d.intercept(me, to, pid, res, 1, undefined, true)) return;
          d.ev({ type: 'projEnd', id: pid, outcome: 'hit' });
          d.boltEffect(me, to, res, 1, { reflected: true });
        });
        return true;
      } }, 'arcane'),
  A('crowncinders', 'Crown of Cinders', 'trinket', 2, 'Burning on your enemies deals 50% more damage.', 'Heavy is the head. Hot, too.',
    { kind: 'crown', color: '#5a2a1a', glow: '#ff7a3d' },
    { outDmg: (_c, _s, _t, amt, info) => info.status === 'burn' ? amt * 1.5 : amt }, 'fire'),
  A('clockheart', 'Clockwork Heart', 'trinket', 2, 'Every 12 s, your next spell reads instantly and costs no ink.', 'Tick. Tick. Now.',
    { kind: 'gear', color: '#b88a3a', glow: '#ffd070' },
    { tick: (c, s, dt) => { s.t = (s.t || 0) + dt; if (s.t >= 12) { s.t -= 12; c.me.quickNext = true; c.me.freeNext = true; flash(c, 'clockheart'); } } }),
  A('gamblersdie', "Gambler's Die", 'trinket', 2, 'Each spell you cast has a 1-in-4 chance to cast twice, and a 1-in-12 chance to singe you for 8.', 'All six faces are the same number. Nobody can agree which.',
    { kind: 'die', color: '#f0ece0', glow: '#ffffff' },
    { cast: (c, _s, res, echo) => {
      if (echo) return;
      const r = c.duel.rng();
      if (r < 0.25) { flash(c, 'gamblersdie', 'Double!'); c.duel.at(0.45, () => c.duel.cast(c.me, res, { power: 1, via: "Gambler's Die", echo: true })); }
      else if (r < 0.25 + 1 / 12) { flash(c, 'gamblersdie', 'Snake eyes'); c.duel.damage(null, c.me, 8, { kind: 'other', ess: 'arcane' }); }
    } }, 'arcane'),
  A('stormbottle', 'Storm in a Bottle', 'trinket', 2, 'Whenever a reaction happens on an enemy, lightning strikes it for 8.', 'Shake well before use. Actually, please do not.',
    { kind: 'bottle', color: '#90a8c0', glow: '#ffe066' },
    { reaction: (c, s, _id, tgt) => {
      if (!foeOf(c, tgt) || s.busy) return;
      s.busy = 1;
      c.duel.ev({ type: 'strike', tgt: tgt.id, ess: 'storm' });
      c.duel.damage(c.me, tgt, 8, { kind: 'other', ess: 'storm' });
      s.busy = 0;
      flash(c, 'stormbottle');
    } }, 'storm'),
  A('gravedust', 'Pouch of Grave Dust', 'trinket', 2, 'When an enemy summon dies, a skeleton rises to fight for you for 10 s.', 'Sprinkle, do not sniff.',
    { kind: 'pouch', color: '#6a5a4a', glow: '#c8d8ff' },
    { unitDied: (c, _s, u, mine) => { if (mine || u.ukind === 'decoy') return; flash(c, 'gravedust'); c.duel.addUnit(c.me.side, 'skeleton', { power: 1, life: 10 }); } }, 'shadow'),
  A('ouroboros', 'Ouroboros Ring', 'trinket', 2, 'Each time your tome loops, heal 5% of your maximum health.', 'It has been eating its own tail for a very long time and is fine, thanks.',
    { kind: 'ring', color: '#c8a040', glow: '#94e36a' },
    { loop: c => { flash(c, 'ouroboros'); c.duel.heal(c.me, c.me.maxHp * 0.05); } }, 'venom'),
  A('kindledruby', 'Kindled Ruby', 'trinket', 2, 'Fire spells cost 30% less ink and deal 25% more damage, but each one you cast gives you 1 Burning.', 'The ruby is on fire. It has always been on fire.',
    { kind: 'gem-big', color: '#ff2a3a', glow: '#ff7a3d' },
    { inkMult: (_c, _s, res) => res.primary === 'fire' ? 0.7 : 1,
      outDmg: (_c, _s, _t, amt, info) => isEss(info, 'fire') ? amt * 1.25 : amt,
      cast: (c, _s, res, echo) => { if (!echo && res.primary === 'fire') c.duel.applyStatus(c.me, 'burn', 1, null); } }, 'fire'),

  // ---------------- mythic trinkets ----------------
  A('heartkiln', 'Heart of the Kiln', 'trinket', 3, 'Enemy Burning never fades below 1 stack, and every 5 s it erupts for 3 damage per stack.', 'A furnace-heart, beating in a clay chest.',
    { kind: 'heart', color: '#8a2a1a', glow: '#ff7a3d' },
    { tick: (c, s, dt) => {
      s.t = (s.t || 0) + dt; if (s.t < 5) return; s.t -= 5;
      const n = c.foe.st.burn; if (n <= 0) return;
      flash(c, 'heartkiln');
      c.duel.ev({ type: 'burst', side: c.foe.side, ess: 'fire', from: c.foe.id, flight: 0 });
      c.duel.damage(c.me, c.foe, 3 * n, { kind: 'other', ess: 'fire' });
    } }, 'fire'),
  A('librarianeye', 'Eye of the Librarian', 'trinket', 3, 'The first once spell the enemy reads each duel is struck out: they read it, and nothing happens.', 'It has read every book in the library, and it disapproves of yours.',
    { kind: 'eye', color: '#e8e0d0', glow: '#c59bff' },
    { cancelFoe: (_c, s, res) => { if (s.used || res.uses !== 1) return false; s.used = 1; return true; } }, 'arcane'),
  A('twincoin', 'Two-Headed Coin', 'trinket', 3, 'Every summon you cast arrives twice.', 'Heads, you win. Heads, you win again.',
    { kind: 'coin', color: '#e0b840', glow: '#fff0a0' }, {}, 'stone'),
  A('sheepbell', "Shepherd's Bell", 'trinket', 3, 'The first time you would be frozen or transformed, it happens to the enemy instead.', 'The flock was never the sheep.',
    { kind: 'bell', color: '#d8c8a0', glow: '#ffffff' },
    { stunned: (c, s) => { if (s.used) return false; s.used = 1; flash(c, 'sheepbell'); c.duel.ev({ type: 'callout', side: c.me.side, text: "Shepherd's Bell", sub: 'The spell turns back on its caster' }); return true; } }, 'arcane'),
  A('doomskull', "Doomsayer's Skull", 'trinket', 3, 'At 40 s, the enemy takes 8% of their maximum health for every curse on them.', 'Its jaw clacks the hour.',
    { kind: 'skull', color: '#e0d8c8', glow: '#e0486e' },
    { tick: (c, s) => {
      if (s.done || c.duel.t < 40) return;
      s.done = 1;
      const n = c.foe.curses.length; if (!n) return;
      flash(c, 'doomskull');
      c.duel.ev({ type: 'callout', side: c.me.side, text: "Doomsayer's Skull", sub: `${n} curse${n > 1 ? 's' : ''} come due` });
      c.duel.damage(c.me, c.foe, c.foe.maxHp * 0.08 * n, { kind: 'curse', ess: 'shadow' });
    } }, 'shadow'),
  A('eclipse', 'Bottled Eclipse', 'trinket', 3, 'At 30 s, you and the enemy swap every status and curse.', 'For a moment, day and night trade places.',
    { kind: 'bottle-dark', color: '#2a1a3a', glow: '#ffeaa0' },
    { tick: (c, s) => {
      if (s.done || c.duel.t < 30) return;
      s.done = 1;
      const me = c.me, foe = c.foe;
      const st = { ...me.st }; me.st = { ...foe.st }; foe.st = st;
      const mc = me.curses, fc = foe.curses;
      me.curses = fc; foe.curses = mc;
      for (const k of me.curses) k.owner = foe.side;
      for (const k of foe.curses) k.owner = me.side;
      for (const k of mc) c.duel.ev({ type: 'curseEnd', side: me.side, key: k.key, how: 'eclipse' });
      for (const k of fc) c.duel.ev({ type: 'curseEnd', side: foe.side, key: k.key, how: 'eclipse' });
      for (const k of foe.curses) c.duel.ev({ type: 'curse', side: foe.side, key: k.key, name: k.name, ess: k.res.primary });
      for (const k of me.curses) c.duel.ev({ type: 'curse', side: me.side, key: k.key, name: k.name, ess: k.res.primary });
      flash(c, 'eclipse');
      c.duel.ev({ type: 'callout', side: me.side, text: 'Eclipse', sub: 'Every affliction changes hands' });
    } }, 'holy'),
  A('unwritten', 'The Unwritten Page', 'trinket', 3, 'Each time your tome loops, cast a random spell from the library.', 'Blank until the moment you need it. Then it is something else.',
    { kind: 'page', color: '#f0ead8', glow: '#f6e7a8' },
    { loop: c => {
      const pool = SPELL_LIST.filter(s => s.form !== 'ward' && s.id !== 'echo' && s.id !== 'plagiarize');
      const d = pool[Math.floor(c.duel.rng() * pool.length)];
      flash(c, 'unwritten', d.name);
      c.duel.at(0.5, () => c.duel.cast(c.me, baseSpell(d.id), { power: 1, via: 'Unwritten Page', echo: true }));
    } }, 'arcane'),
];

export const ARTIFACTS: Record<string, ArtifactDef> = {};
for (const a of ARTIFACT_LIST) ARTIFACTS[a.id] = a;

// ---------- reagents (also sold in the shop, and found in thick or chained books) ----------
export interface ReagentDef { id: string; name: string; price: number; text: string; model: ModelSpec }
export const REAGENTS: Record<string, ReagentDef> = {
  everburning: { id: 'everburning', name: 'Everburning Ink', price: 8, text: 'Makes a spell one step less limited: once becomes ×2, ×2 or ×3 becomes endless.', model: { kind: 'inkwell', color: '#2a1a1a', glow: '#ff7a3d' } },
  quicksilver: { id: 'quicksilver', name: 'Quicksilver', price: 6, text: 'Makes a spell read 1 s faster.', model: { kind: 'vial', color: '#c8d0d8', glow: '#ffffff' } },
  gilded: { id: 'gilded', name: 'Gilded Thread', price: 10, text: 'Lets one spell take a fourth infusion.', model: { kind: 'spool', color: '#e0b840', glow: '#fff0a0' } },
  unbinding: { id: 'unbinding', name: 'Unbinding Knife', price: 4, text: 'Strips a fused spell back to its base. The infusions are lost.', model: { kind: 'knife', color: '#b8b8c0', glow: '#c59bff' } },
};
export const REAGENT_LIST = Object.values(REAGENTS);

export function artifactPrice(id: string): number {
  const a = ARTIFACTS[id]; return a ? RARITY[a.rarity].price : 0;
}
