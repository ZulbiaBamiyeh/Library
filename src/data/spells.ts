// Spells as data. The simulation resolves each form with one handler and
// layers essences and traits on top, so a new fusion is new data, not new code.

export type Essence = 'fire' | 'frost' | 'venom' | 'storm' | 'stone' | 'shadow' | 'holy' | 'arcane';
export type Form = 'bolt' | 'burst' | 'summon' | 'field' | 'curse' | 'aura' | 'blessing' | 'hex' | 'ward';
export type Trait =
  | 'force' | 'splash' | 'oil' | 'wet' | 'empower' | 'hatch' | 'afflict' | 'linger'
  | 'guard' | 'daze' | 'chain' | 'quick' | 'mend' | 'echo' | 'heavy';
export type Rarity = 0 | 1 | 2 | 3;

export const ESSENCES: Essence[] = ['fire', 'frost', 'venom', 'storm', 'stone', 'shadow', 'holy', 'arcane'];

export interface EssenceInfo {
  name: string;
  color: string; // glow colour on the board, always the same per essence
  spine: string; // book spine colour in the library
  school: string;
  adj: string; // prefix for fused names
  twice: string; // prefix when the essence is intensified
}

export const ESS: Record<Essence, EssenceInfo> = {
  fire: { name: 'Fire', color: '#ff7a3d', spine: '#8a1f24', school: 'Fire', adj: 'Fire', twice: 'Inferno' },
  frost: { name: 'Frost', color: '#9fdcff', spine: '#1d3a73', school: 'Frost and water', adj: 'Frost', twice: 'Glacial' },
  venom: { name: 'Venom', color: '#94e36a', spine: '#34582a', school: 'Venom', adj: 'Venom', twice: 'Virulent' },
  storm: { name: 'Storm', color: '#ffe066', spine: '#b5861c', school: 'Storm', adj: 'Storm', twice: 'Thunder' },
  stone: { name: 'Stone', color: '#d0a577', spine: '#6e6a66', school: 'Earth and summoning', adj: 'Stone', twice: 'Granite' },
  shadow: { name: 'Shadow', color: '#e0486e', spine: '#19141c', school: 'Curses and shadow', adj: 'Shadow', twice: 'Umbral' },
  holy: { name: 'Holy', color: '#ffeaa0', spine: '#e9e1c6', school: 'Holy', adj: 'Holy', twice: 'Radiant' },
  arcane: { name: 'Arcane', color: '#c59bff', spine: '#4e2c85', school: 'Arcane', adj: 'Arcane', twice: 'Resonant' },
};

export const FORM_INFO: Record<Form, { name: string; text: string }> = {
  bolt: { name: 'Bolt', text: 'A projectile at the enemy mage' },
  burst: { name: 'Burst', text: 'A hit on the enemy and all their summons' },
  summon: { name: 'Summon', text: 'A creature that fights on the board' },
  field: { name: 'Field', text: 'A zone on the board that lasts a while' },
  curse: { name: 'Curse', text: 'A lasting affliction on the enemy mage' },
  aura: { name: 'Aura', text: 'A lasting effect on you' },
  blessing: { name: 'Blessing', text: 'An instant effect on yourself' },
  hex: { name: 'Hex', text: 'A transformation or control effect' },
  ward: { name: 'Ward', text: 'A shield, reflect or counter' },
};

export const TRAIT_INFO: Record<Trait, { name: string; text: string; suffix: string }> = {
  force: { name: 'Force', text: '+4 damage', suffix: 'of Force' },
  splash: { name: 'Splash', text: 'also hits each enemy summon for half', suffix: 'of Scattering' },
  oil: { name: 'Pitch', text: 'adds 2 Oil', suffix: 'of Pitch' },
  wet: { name: 'Rain', text: 'adds 2 Wet', suffix: 'of Rain' },
  empower: { name: 'Empower', text: '+25% power', suffix: 'of Power' },
  hatch: { name: 'Hatch', text: 'hatches a creature that fights for 6 s', suffix: 'of the Brood' },
  afflict: { name: 'Afflict', text: 'adds 2 Hex', suffix: 'of Malice' },
  linger: { name: 'Linger', text: '+50% statuses and duration', suffix: 'of Lingering' },
  guard: { name: 'Guard', text: 'you gain a ward that blocks one bolt', suffix: 'of Warding' },
  daze: { name: 'Daze', text: 'pushes their reading back 0.8 s', suffix: 'of Stupor' },
  chain: { name: 'Chain', text: 'jumps to a second target', suffix: 'of Arcs' },
  quick: { name: 'Quick', text: 'reads 0.8 s faster', suffix: 'of Haste' },
  mend: { name: 'Mend', text: 'heals you 5', suffix: 'of Mending' },
  echo: { name: 'Echo', text: 'repeats once at half power', suffix: 'of Echoes' },
  heavy: { name: 'Heavy', text: '+6 damage; a heavy hit', suffix: 'of Weight' },
};

export interface SpellDef {
  id: string;
  name: string;
  school: Essence; // spine colour / library shelf
  essence: Essence | null; // what it brings as an infusion
  form: Form;
  uses: number; // 0 = endless
  ink: number;
  heft: number; // extra reading seconds on top of the base read
  rarity: 0 | 1 | 2;
  trait: Trait; // what it brings as an infusion
  unit?: string; // summon kind (also used by the hatch trait)
  text: string;
}

const S = (
  id: string, name: string, school: Essence, essence: Essence | null, form: Form, uses: number,
  ink: number, heft: number, rarity: 0 | 1 | 2, trait: Trait, text: string, unit?: string,
): SpellDef => ({ id, name, school, essence, form, uses, ink, heft, rarity, trait, text, unit });

export const SPELL_LIST: SpellDef[] = [
  // Fire (crimson spines)
  S('firebolt', 'Firebolt', 'fire', 'fire', 'bolt', 0, 10, 0.2, 0, 'force', '6 damage, 2 Burning'),
  S('fireball', 'Fireball', 'fire', 'fire', 'burst', 2, 22, 0.8, 1, 'splash', '10 damage to the enemy and each of their summons; 2 Burning each'),
  S('oilflask', 'Oil Flask', 'fire', 'fire', 'field', 3, 8, 0, 0, 'oil', '3 Oil on the enemy and their summons'),
  S('kindle', 'Kindle', 'fire', 'fire', 'aura', 1, 16, 0.4, 1, 'empower', 'Your spells deal +1 damage for every 2 Burning stacks on the target'),
  S('salamander', 'Salamander', 'fire', 'fire', 'summon', 1, 22, 0.6, 2, 'hatch', 'Eats Burning off you and spits it at the enemy', 'salamander'),
  S('immolate', 'Immolate', 'fire', 'fire', 'curse', 1, 18, 0.5, 2, 'afflict', "Their Burning can't fall below 2 while the curse holds"),

  // Frost and water (deep blue spines)
  S('frostshard', 'Frost Shard', 'frost', 'frost', 'bolt', 0, 9, 0.1, 0, 'force', '7 damage, +2 per Chill already on the target; 2 Chill'),
  S('raincloud', 'Rain Cloud', 'frost', 'frost', 'field', 3, 10, 0.2, 0, 'wet', '4 Wet on the enemy side'),
  S('blizzard', 'Blizzard', 'frost', 'frost', 'field', 1, 26, 0.8, 2, 'linger', 'For 10 s, everything on their side gains 1 Chill and takes damage every second'),
  S('frostarmour', 'Frost Armour', 'frost', 'frost', 'aura', 1, 16, 0.3, 1, 'guard', 'Anything that hits you gains 1 Chill and takes 2 damage'),
  S('icewall', 'Ice Wall', 'frost', 'frost', 'ward', 2, 14, 0.2, 1, 'guard', 'Blocks the next two bolts'),
  S('deepfreeze', 'Deep Freeze', 'frost', 'frost', 'hex', 1, 20, 0.5, 2, 'daze', '8 damage. Freezes a target with 3+ Chill for 4 s; otherwise adds 3 Chill'),

  // Venom (moss green spines)
  S('venomdart', 'Venom Dart', 'venom', 'venom', 'bolt', 0, 7, 0, 0, 'force', '2 damage, 2 Poison'),
  S('rotseed', 'Rot Seed', 'venom', 'venom', 'bolt', 2, 14, 0.4, 1, 'linger', 'Plants a seed that bursts after 6 s for 3 damage per Poison stack'),
  S('plaguerat', 'Plague Rat', 'venom', 'venom', 'summon', 1, 16, 0.5, 1, 'hatch', 'Bites for 2 Poison; bursts into a poison cloud when it dies', 'rat'),
  S('miasma', 'Miasma', 'venom', 'venom', 'field', 1, 22, 0.6, 1, 'linger', '1 Poison every 2 s to the enemy and their summons for 12 s'),
  S('wither', 'Wither', 'venom', 'venom', 'curse', 1, 18, 0.5, 2, 'afflict', 'Poison on them can stack to 12 instead of 6; 2 Poison now'),

  // Storm (amber spines)
  S('spark', 'Spark', 'storm', 'storm', 'bolt', 0, 5, -0.4, 0, 'quick', '5 damage, 1 Charge; the quickest spell to read'),
  S('chainlightning', 'Chain Lightning', 'storm', 'storm', 'bolt', 3, 16, 0.4, 1, 'chain', '6 damage, +5 per Charge; jumps to one summon'),
  S('thunderhead', 'Thunderhead', 'storm', 'storm', 'field', 1, 24, 0.7, 2, 'chain', 'Every 2 s for 16 s, lightning strikes a random enemy unit for 5'),
  S('staticfield', 'Static Field', 'storm', 'storm', 'aura', 1, 16, 0.3, 1, 'empower', 'Every time you cast, the enemy gains 1 Charge'),
  S('balllightning', 'Ball Lightning', 'storm', 'storm', 'summon', 1, 20, 0.5, 1, 'hatch', 'Drifts at the enemy and bursts for 20, chaining to their summons', 'ball'),

  // Curses and shadow (black spines)
  S('hexbolt', 'Hex Bolt', 'shadow', 'shadow', 'bolt', 0, 6, 0, 0, 'afflict', '3 damage, +2 per curse on the target'),
  S('agony', 'Agony', 'shadow', 'shadow', 'curse', 1, 16, 0.4, 0, 'afflict', 'Random damage every 2 s; the ceiling rises as it festers'),
  S('tongues', 'Curse of Tongues', 'shadow', 'shadow', 'curse', 1, 16, 0.4, 1, 'afflict', 'Each time they finish reading a line, they take 3 damage'),
  S('corruption', 'Corruption', 'shadow', 'shadow', 'curse', 1, 16, 0.4, 0, 'afflict', '1 damage per second for the rest of the duel'),
  S('siphon', 'Siphon Life', 'shadow', 'shadow', 'curse', 2, 14, 0.4, 1, 'mend', '1 damage per second; you heal what it deals'),
  S('unstable', 'Unstable Affliction', 'shadow', 'shadow', 'curse', 1, 20, 0.5, 2, 'afflict', '1.5 damage per second; whoever cleanses it is silenced for 3 s and takes 20'),
  S('doom', 'Doom', 'shadow', 'shadow', 'curse', 1, 24, 0.6, 2, 'afflict', '50 damage after 22 s; each other curse on them shortens the fuse by 2 s'),
  S('malediction', 'Malediction', 'shadow', 'shadow', 'aura', 1, 16, 0.3, 2, 'empower', 'Your curses tick 15% faster for each curse on the target'),

  // Holy (white and gold spines)
  S('smite', 'Smite', 'holy', 'holy', 'bolt', 0, 8, 0.1, 0, 'force', '8 damage, +3 per summon the enemy controls'),
  S('mend', 'Mend', 'holy', 'holy', 'blessing', 3, 14, 0.2, 0, 'mend', 'Heal 8 and cleanse the newest curse, or 2 status stacks'),
  S('sanctuary', 'Sanctuary', 'holy', 'holy', 'ward', 1, 16, 0.3, 1, 'guard', "For 4 s you can't be targeted; enemy bolts fizzle"),
  S('consecration', 'Consecration', 'holy', 'holy', 'field', 1, 22, 0.6, 1, 'mend', 'Heals you 1 per second for 12 s; enemy summons burn in its light'),
  S('retribution', 'Retribution', 'holy', 'holy', 'aura', 1, 18, 0.4, 2, 'empower', 'Whenever you are healed, the enemy takes 40% as much'),
  S('guardianangel', 'Guardian Angel', 'holy', 'holy', 'ward', 1, 20, 0.4, 2, 'guard', 'The first time you would die, heal to 25% instead'),

  // Arcane (violet spines)
  S('echo', 'Echo', 'arcane', 'arcane', 'blessing', 0, 10, 0.2, 1, 'echo', 'Recast your previous spell at 80% power'),
  S('polymorph', 'Polymorph', 'arcane', 'arcane', 'hex', 1, 24, 0.6, 2, 'daze', 'The enemy becomes a sheep for 5 s; their tome stops'),
  S('mirror', 'Mirror', 'arcane', 'arcane', 'ward', 2, 14, 0.2, 1, 'guard', 'Reflects the next enemy bolt'),
  S('counterspell', 'Counterspell', 'arcane', 'arcane', 'ward', 2, 16, 0.3, 1, 'guard', "Cancels the enemy's next spell as they finish reading it"),
  S('plagiarize', 'Plagiarize', 'arcane', 'arcane', 'hex', 1, 18, 0.5, 2, 'echo', 'Casts a copy of the last spell they cast, as yours'),
  S('inkblot', 'Ink Blot', 'arcane', 'arcane', 'hex', 2, 14, 0.3, 1, 'daze', 'Blanks a random enemy line for 9 s'),
  S('misplaced', 'Misplaced Words', 'arcane', 'arcane', 'hex', 1, 16, 0.4, 2, 'daze', 'Swaps two lines in their tome for the rest of the duel'),
  S('babel', 'Babel', 'arcane', 'arcane', 'hex', 1, 18, 0.4, 2, 'daze', 'Their next two spells target themselves'),
  S('transpose', 'Transpose', 'arcane', 'arcane', 'hex', 1, 14, 0.4, 2, 'daze', 'Swaps all statuses between you and the enemy'),
  S('haste', 'Haste', 'arcane', 'arcane', 'aura', 1, 14, 0.2, 1, 'quick', 'You read 30% faster for 12 s'),

  // Earth and summoning (grey stone spines)
  S('stone', 'Stone', 'stone', 'stone', 'bolt', 0, 12, 1.2, 0, 'heavy', '14 damage; a heavy hit, slow to read'),
  S('imp', 'Summon Imp', 'stone', null, 'summon', 1, 16, 0.5, 0, 'hatch', 'An imp that fires a 2-damage bolt every 2 s', 'imp'),
  S('skeletons', 'Skeletons', 'stone', null, 'summon', 1, 20, 0.6, 1, 'hatch', 'Three skeletons; each blocks one bolt aimed at you', 'skeleton'),
  S('treant', 'Treant', 'stone', 'stone', 'summon', 1, 24, 0.8, 2, 'guard', '60 health; enemy bolts must hit it first', 'treant'),
  S('stoneskin', 'Stone Skin', 'stone', 'stone', 'aura', 1, 16, 0.3, 1, 'guard', 'Take 2 less damage from every hit'),
  S('earthquake', 'Earthquake', 'stone', 'stone', 'burst', 2, 20, 0.8, 1, 'splash', '8 damage to every unit on the board, yours included'),
];

export const SPELLS: Record<string, SpellDef> = {};
for (const s of SPELL_LIST) SPELLS[s.id] = s;

export const SCHOOL_ORDER: Essence[] = ['fire', 'frost', 'venom', 'storm', 'shadow', 'holy', 'arcane', 'stone'];

export function usesLabel(uses: number): string {
  return uses === 0 ? '∞' : uses === 1 ? 'once' : `×${uses}`;
}

export const TIER_MULT = [1, 1.25, 1.5];
export const TIER_NAME = ['', 'Silver', 'Gold'];
