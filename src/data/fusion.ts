// Fusion: the base decides what a spell is, the infusions decide what it's made of.
import { ESS, SPELLS, TIER_MULT, TRAIT_INFO, FORM_INFO, type Essence, type Form, type SpellDef, type Trait } from './spells';
import { COMPOUNDS, COMPOUND_LIST, LEGENDARIES, STATUS_INFO, type Compound, type LegendaryRecipe, type Status } from './codex';

export interface SpellInst {
  uid: number;
  base: string;
  inf: string[];
  tier: number;
  ever?: number; // Everburning Ink applied: each loosens the charge one step
  quick?: number; // Quicksilver applied: each reads 1 s faster
  gilded?: boolean; // Gilded Thread: allows a fourth infusion
}

export interface Riders {
  dmg: number;
  heavy: boolean;
  st: Partial<Record<Status, number>>;
  heal: number;
  drain: number;
  judgement: number;
  daze: number;
  chain: number;
  splash: number;
  flicker: number;
  echo: number;
  hatch: string[];
  guard: number;
  statusMult: number;
  durMult: number;
}

export interface Resolved {
  inst: SpellInst;
  name: string;
  form: Form;
  base: SpellDef;
  essences: Essence[]; // every part's essence, base first
  essCount: Partial<Record<Essence, number>>;
  riders: Riders;
  traits: Trait[];
  compounds: Compound[];
  legendary: LegendaryRecipe | null;
  special: string | null; // explicit fusions with their own behaviour
  uses: number; // 0 = endless
  ink: number;
  read: number;
  power: number;
  parts: number;
  primary: Essence; // colour the spell reads as on the board
}

export const MAX_INFUSIONS = 3;
export const BASE_READ = 1.3;
export const INFUSION_READ = 0.8;

export function emptyRiders(): Riders {
  return { dmg: 0, heavy: false, st: {}, heal: 0, drain: 0, judgement: 0, daze: 0, chain: 0, splash: 0, flicker: 0, echo: 0, hatch: [], guard: 0, statusMult: 1, durMult: 1 };
}

function addSt(r: Riders, s: Status, n: number) { r.st[s] = (r.st[s] || 0) + n; }

export function essenceRider(r: Riders, e: Essence) {
  switch (e) {
    case 'fire': addSt(r, 'burn', 2); break;
    case 'frost': addSt(r, 'chill', 2); break;
    case 'venom': addSt(r, 'poison', 2); break;
    case 'storm': addSt(r, 'charge', 1); r.chain += 0.4; break;
    case 'stone': r.dmg += 5; r.heavy = true; break;
    case 'shadow': r.drain += 0.4; break;
    case 'holy': r.heal += 4; r.judgement += 2; break;
    case 'arcane': r.flicker += 0.5; break;
  }
}

export function traitRider(r: Riders, t: Trait, def: SpellDef) {
  switch (t) {
    case 'force': r.dmg += 4; break;
    case 'splash': r.splash += 0.5; break;
    case 'oil': addSt(r, 'oil', 2); break;
    case 'wet': addSt(r, 'wet', 2); break;
    case 'hatch': if (def.unit) r.hatch.push(def.unit); break;
    case 'afflict': addSt(r, 'hex', 2); break;
    case 'linger': r.statusMult += 0.5; r.durMult += 0.5; break;
    case 'guard': r.guard += 1; break;
    case 'daze': r.daze += 0.8; break;
    case 'chain': r.chain += 0.6; break;
    case 'mend': r.heal += 5; break;
    case 'echo': r.echo += 0.5; break;
    case 'heavy': r.dmg += 6; r.heavy = true; break;
    case 'empower': case 'quick': break; // handled on the spell itself
  }
}

// Scale riders down for things that fire repeatedly: summon attacks, field and curse pulses, aura hits.
export function liteRiders(r: Riders): Riders {
  const o = emptyRiders();
  o.dmg = Math.round(r.dmg * 0.25);
  o.heavy = r.heavy;
  for (const k in r.st) { const s = k as Status; const n = r.st[s] || 0; if (n > 0) o.st[s] = Math.max(1, Math.ceil(n / 2)); }
  o.heal = Math.round(r.heal * 0.5);
  o.drain = r.drain;
  o.judgement = Math.round(r.judgement * 0.5);
  o.daze = r.daze * 0.4;
  o.chain = r.chain; o.splash = r.splash; o.flicker = r.flicker * 0.6;
  o.statusMult = r.statusMult; o.durMult = r.durMult;
  return o;
}

export function ridersEmpty(r: Riders): boolean {
  return !r.dmg && !r.heal && !r.drain && !r.judgement && !r.daze && !r.chain && !r.splash && !r.flicker && !r.echo && !r.hatch.length && !r.guard && Object.keys(r.st).length === 0;
}

const NOUN: Record<string, string> = { imp: 'Imp', firebolt: 'Bolt', frostshard: 'Shard', venomdart: 'Dart', chainlightning: 'Chain', hexbolt: 'Hex', rotseed: 'Seed' };

const EXPLICIT: Record<string, { name: string; special?: string }> = {
  'firebolt+imp': { name: 'Hatching Bolt' },
  'frostshard+stone': { name: 'Hailstone' },
  'raincloud+frostshard': { name: 'Freezing Rain' },
  'polymorph+imp': { name: 'Impmorph', special: 'impmorph' },
  'polymorph+frostshard': { name: 'Ice Statue', special: 'icestatue' },
  'mirror+imp': { name: 'Mirror Image' },
  'imp+agony': { name: 'Wailing Imp' },
  'tongues+firebolt': { name: 'Tongues of Flame' },
  'venomdart+chainlightning': { name: 'Arc Venom' },
  'imp+mend': { name: 'Cherub', special: 'cherub' },
  'sanctuary+firebolt': { name: 'Ring of Fire' },
  'inkblot+venomdart': { name: 'Poisoned Page' },
  'counterspell+spark': { name: 'Static Snap' },
  'firebolt+firebolt': { name: 'Inferno Bolt' },
  'imp+firebolt': { name: 'Fire Imp' },
  'treant+venomdart': { name: 'Blightwood' },
  'skeletons+firebolt': { name: 'Cinder Bones' },
};

const TRAIT_PREFIX: Partial<Record<Trait, string>> = { hatch: 'Hatching', mend: 'Mending', echo: 'Echoing', guard: 'Warding', daze: 'Dazing', chain: 'Chaining', quick: 'Quick', splash: 'Scattering', afflict: 'Wailing', empower: 'Mighty', linger: 'Lingering', oil: 'Pitch', wet: 'Rain', force: 'Keen', heavy: 'Heavy' };

function matchLegendary(base: string, inf: string[]): LegendaryRecipe | null {
  if (inf.length !== 3) return null;
  for (const L of LEGENDARIES) {
    if (L.base !== base) continue;
    const used = [false, false, false];
    const ok = (k: number): boolean => {
      if (k === 3) return true;
      const part = L.parts[k];
      for (let i = 0; i < 3; i++) {
        if (used[i]) continue;
        const d = SPELLS[inf[i]];
        if ((part.id && part.id === d.id) || (part.ess && d.essence === part.ess)) {
          used[i] = true;
          if (ok(k + 1)) return true;
          used[i] = false;
        }
      }
      return false;
    };
    if (ok(0)) return L;
  }
  return null;
}

export function resolveSpell(inst: SpellInst): Resolved {
  const base = SPELLS[inst.base];
  const infDefs = inst.inf.map(id => SPELLS[id]);
  const essences: Essence[] = [];
  if (base.essence) essences.push(base.essence);
  for (const d of infDefs) if (d.essence) essences.push(d.essence);
  const essCount: Partial<Record<Essence, number>> = {};
  for (const e of essences) essCount[e] = (essCount[e] || 0) + 1;

  const riders = emptyRiders();
  const traits: Trait[] = [];
  let empower = 0, quick = 0;
  for (const d of infDefs) {
    if (d.essence) essenceRider(riders, d.essence);
    traits.push(d.trait);
    traitRider(riders, d.trait, d);
    if (d.trait === 'empower') empower++;
    if (d.trait === 'quick') quick++;
  }

  const distinct = Object.keys(essCount) as Essence[];
  const compounds = COMPOUND_LIST.filter(c => {
    const [a, b] = COMPOUNDS[c].pair;
    return distinct.includes(a) && distinct.includes(b);
  });

  const legendary = matchLegendary(inst.base, inst.inf);

  // Charge: a fused spell keeps the most limited charge among its parts.
  let uses = base.uses;
  for (const d of infDefs) {
    if (d.uses === 0) continue;
    uses = uses === 0 ? d.uses : Math.min(uses, d.uses);
  }
  for (let i = 0; i < (inst.ever || 0); i++) uses = uses === 1 ? 2 : 0;

  let ink = base.ink;
  for (const d of infDefs) ink += Math.ceil(d.ink * 0.4) + 2;
  let read = BASE_READ + base.heft + INFUSION_READ * infDefs.length - INFUSION_READ * quick - (inst.quick || 0);
  read = Math.max(0.6, read);
  const power = TIER_MULT[inst.tier || 0] * (1 + 0.25 * empower);

  // Naming
  let name = base.name;
  let special: string | null = null;
  const key1 = inst.inf.length ? `${inst.base}+${inst.inf[0]}` : '';
  const restPlain = inst.inf.slice(1).every(id => !SPELLS[id].essence);
  if (legendary) name = legendary.name;
  else if (inst.inf.length && EXPLICIT[key1] && restPlain) {
    name = EXPLICIT[key1].name; special = EXPLICIT[key1].special || null;
    if (inst.inf.length > 1) name += ' ' + TRAIT_INFO[SPELLS[inst.inf[inst.inf.length - 1]].trait].suffix;
  } else if (inst.inf.length) {
    if (EXPLICIT[key1]) special = EXPLICIT[key1].special || null;
    const noun = NOUN[inst.base] || base.name;
    let prefix = '';
    if (compounds.length) prefix = COMPOUNDS[compounds[0]].name;
    else {
      const infEss = infDefs.map(d => d.essence).filter((e): e is Essence => !!e);
      if (infEss.length) {
        const counts: Partial<Record<Essence, number>> = {};
        let best: Essence = infEss[0];
        for (const e of infEss) { counts[e] = (counts[e] || 0) + 1; if ((counts[e] || 0) > (counts[best] || 0)) best = e; }
        prefix = (essCount[best] || 0) >= 2 ? ESS[best].twice : ESS[best].adj;
      }
    }
    const plain = infDefs.filter(d => !d.essence);
    let fromTrait = false;
    if (!prefix && plain.length) { prefix = TRAIT_PREFIX[plain[0].trait] || ''; fromTrait = true; }
    name = (prefix ? prefix + ' ' : '') + noun;
    const suffixFrom = fromTrait ? plain.slice(1) : plain;
    if (suffixFrom.length) name += ' ' + TRAIT_INFO[suffixFrom[suffixFrom.length - 1].trait].suffix;
  }

  const primary: Essence = (legendary && legendaryPrimary[legendary.id]) || (() => {
    let best: Essence | null = null, n = 0;
    for (const e of distinct) if ((essCount[e] || 0) > n) { best = e; n = essCount[e] || 0; }
    return best || base.school;
  })();

  return {
    inst, name, form: base.form, base, essences, essCount, riders, traits, compounds, legendary, special,
    uses, ink, read, power, parts: 1 + inst.inf.length, primary,
  };
}

const legendaryPrimary: Record<string, Essence> = {
  pitlord: 'fire', frostlich: 'frost', flock: 'arcane', apocalypse: 'shadow', philmirror: 'arcane', worldroot: 'stone', tempest: 'storm',
};

export function maxInfusions(inst: SpellInst): number {
  return MAX_INFUSIONS + (inst.gilded ? 1 : 0);
}

export function canInfuse(base: SpellInst, _inf: SpellInst): string | null {
  if (base.inf.length >= maxInfusions(base)) return base.gilded ? 'This spell can hold no more infusions.' : 'Three infusions is the limit. Gilded Thread allows a fourth.';
  return null;
}

// The infusion is used up. Its own infusions are lost; only its base spell binds in.
export function fuse(base: SpellInst, inf: SpellInst, uid: number): SpellInst {
  return { uid, base: base.base, inf: base.inf.concat([inf.base]), tier: base.tier, ever: base.ever, quick: base.quick, gilded: base.gilded };
}

// ----- plain-language description for cards, previews and the desk -----

function riderPhrases(r: Riders): string[] {
  const out: string[] = [];
  if (r.dmg) out.push(`+${r.dmg} damage${r.heavy ? ' (heavy)' : ''}`);
  else if (r.heavy) out.push('heavy');
  for (const s of ['burn', 'chill', 'wet', 'poison', 'oil', 'charge', 'hex'] as Status[]) {
    const n = r.st[s]; if (n) out.push(`${Math.round(n * r.statusMult)} ${STATUS_INFO[s].name}`);
  }
  if (r.heal) out.push(`heals you ${r.heal}`);
  if (r.drain) out.push(`drains ${Math.round(r.drain * 100)}% as life`);
  if (r.judgement) out.push(`+${r.judgement} per debuff`);
  if (r.daze) out.push(`pushes their reading back ${r.daze.toFixed(1)} s`);
  if (r.chain) out.push('chains to a second target');
  if (r.splash) out.push('splashes their summons');
  if (r.flicker) out.push('flickers to a random target');
  if (r.echo) out.push('repeats at half power');
  if (r.hatch.length) out.push(`hatches ${r.hatch.map(u => UNIT_NAMES[u] || u).join(' and ')}`);
  if (r.guard) out.push(`you gain ${r.guard} bolt ward${r.guard > 1 ? 's' : ''}`);
  return out;
}

export const UNIT_NAMES: Record<string, string> = {
  imp: 'an imp', skeleton: 'a skeleton', treant: 'a sapling', rat: 'a plague rat', salamander: 'a salamander', ball: 'a ball of lightning',
};

const FORM_ESSENCE_NOTE: Partial<Record<Form, Partial<Record<Essence, string>>>> = {
  summon: {
    fire: 'Explodes when it dies.', frost: 'Slower but tougher.', venom: 'Leaves a poison cloud when it dies.', storm: 'Its attacks jump to a second target.',
    stone: 'Tough and slow; draws enemy bolts.', shadow: 'Its attacks drain life to you.', holy: 'Heals you when it hits.', arcane: 'Splits in two at half health.',
  },
  field: {
    fire: 'The ground ignites.', frost: 'Everything inside is chilled.', venom: 'A toxic pool that poisons summons too.', storm: 'Lightning strikes random enemy units.',
    stone: 'A wall that blocks the next bolt.', shadow: 'Enemy bolts may miss in the dark.', holy: 'Heals you each pulse.', arcane: 'Your spells echo while it holds.',
  },
  curse: {
    fire: 'Each tick also burns.', frost: 'Their reading slows further over time.', venom: 'Poison on them keeps growing.', storm: 'Zaps them each time they cast.',
    stone: 'Petrify: slows, then roots them once.', shadow: 'The damage it deals heals you.', holy: 'Judgement: bonus damage per debuff.', arcane: 'Their spells sometimes rebound on them.',
  },
};

export function describe(r: Resolved): { head: string; lines: string[] } {
  const lines: string[] = [];
  if (r.legendary) lines.push(r.legendary.text + '.');
  else if (r.special === 'impmorph') lines.push('The enemy becomes an imp for 5 s: their tome stops and the imp claws at them.');
  else if (r.special === 'icestatue') lines.push('Frozen solid for 4 s, ignoring immunity; heavy hits deal triple.');
  else if (r.special === 'cherub') lines.push('A cherub that heals you 2 every 3 s.');
  else lines.push(r.base.text + '.');
  const repeating = r.form === 'summon' || r.form === 'field' || r.form === 'curse' || r.form === 'aura' || r.form === 'ward';
  const ph = r.special === 'cherub' ? [] : riderPhrases(repeating ? { ...liteRiders(r.riders), hatch: r.form === 'summon' ? r.riders.hatch : [], guard: r.riders.guard } : r.riders);
  if (r.form === 'ward' && r.riders.hatch.length) lines.push('Also conjures two mirror images that draw enemy bolts for 10 s.');
  if (ph.length && r.inst.inf.length) {
    const lead: Record<Form, string> = {
      bolt: 'On hit', burst: 'On hit', hex: 'Also', blessing: 'Also strikes the enemy', summon: 'Its attacks', field: 'Each pulse', curse: 'Each time it triggers', aura: 'Your hits gain', ward: 'When it triggers, the attacker takes',
    };
    lines.push(`${lead[r.form]}: ${ph.join(', ')}.`);
  }
  const notes = FORM_ESSENCE_NOTE[r.form];
  if (notes && r.inst.inf.length && r.special !== 'cherub') {
    const seen = new Set<Essence>();
    for (const id of r.inst.inf) { const e = SPELLS[id].essence; if (e && !seen.has(e) && notes[e]) { seen.add(e); lines.push(notes[e] as string); } }
  }
  for (const c of r.compounds) lines.push(`${COMPOUNDS[c].name}: ${COMPOUNDS[c].text}.`);
  if ((r.essCount.fire || 0) >= 3) lines.push('Three fires: Burning spreads to nearby units.');
  const head = `${FORM_INFO[r.form].name} · ${r.essences.length ? [...new Set(r.essences)].map(e => ESS[e].name).join(', ') : 'no essence'}`;
  return { head, lines };
}

export function discoveriesOf(r: Resolved): string[] {
  const out: string[] = [];
  for (const c of r.compounds) out.push(COMPOUNDS[c].id);
  if (r.legendary) out.push(r.legendary.id);
  return out;
}
