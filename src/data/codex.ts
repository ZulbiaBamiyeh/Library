// Statuses, reactions, compound essences and legendary recipes: everything the Codex records.
import type { Essence } from './spells';

export type Status = 'burn' | 'chill' | 'wet' | 'poison' | 'oil' | 'charge' | 'hex';
export const STATUSES: Status[] = ['oil', 'wet', 'burn', 'chill', 'poison', 'charge', 'hex'];

export const STATUS_INFO: Record<Status, { name: string; color: string; text: string }> = {
  burn: { name: 'Burning', color: '#ff7a3d', text: '0.8 damage per second per stack, up to 8; fades every 2 s, faster when the fire is big' },
  chill: { name: 'Chill', color: '#bfe8ff', text: 'Reading slows 10% per stack; at 5 stacks the target is Frozen' },
  wet: { name: 'Wet', color: '#6fb6ff', text: 'Freezes instantly with Chill, douses Burning, conducts Charge' },
  poison: { name: 'Poison', color: '#94e36a', text: '0.55 damage per second per stack, capped at 6; fades 1 stack every 8 s' },
  oil: { name: 'Oil', color: '#c9a86a', text: 'The next Burning turns it into a Blaze' },
  charge: { name: 'Charge', color: '#ffe066', text: 'Up to 10 stacks. Chain Lightning consumes it; Wet discharges it' },
  hex: { name: 'Hex', color: '#e0486e', text: 'At 5 stacks, their next spell targets themselves' },
};

export const DECAY: Partial<Record<Status, number>> = { poison: 8, burn: 2, chill: 6, wet: 6, oil: 8, charge: 6 };

export interface CodexEntry {
  id: string;
  name: string;
  recipe: string;
  text: string;
  riddle: string;
}

export const REACTIONS: CodexEntry[] = [
  { id: 'frozen', name: 'Frozen', recipe: 'Wet + Chill, or 5 Chill', text: 'Reading stops for 3 s and hits land 25% harder; then 6 s of immunity', riddle: 'Water remembers the cold.' },
  { id: 'shatter', name: 'Shatter', recipe: 'Frozen + a heavy hit', text: 'Double damage, ends Frozen early', riddle: 'What is frozen breaks under weight.' },
  { id: 'blaze', name: 'Blaze', recipe: 'Oil + Burning', text: '4 damage per Oil stack; Oil consumed', riddle: 'Slick things hunger for flame.' },
  { id: 'conduct', name: 'Conduct', recipe: 'Wet + Charge', text: '4 damage per Charge stack, all at once; both consumed', riddle: 'Rain carries the storm.' },
  { id: 'douse', name: 'Douse', recipe: 'Burning + Wet', text: 'Both removed', riddle: 'Fire drowns.' },
  { id: 'steam', name: 'Steam', recipe: 'Burning + Chill', text: 'Both removed; their next spell may miss', riddle: 'Fire and frost make a fog.' },
  { id: 'smoke', name: 'Toxic Smoke', recipe: 'Burning + Poison', text: 'A cloud poisons both mages for 8 s', riddle: 'Burn the venom and breathe it in.' },
  { id: 'congeal', name: 'Congeal', recipe: 'Oil + Chill', text: 'Reading 30% slower for 6 s', riddle: 'Cold thickens what is slick.' },
  { id: 'exorcism', name: 'Exorcism', recipe: 'Hex + a Holy hit', text: 'All Hex removed; 6 damage per stack', riddle: 'Light unmakes the hex.' },
];

export type Compound = 'steam' | 'plasma' | 'smog' | 'glacier' | 'rime' | 'plague' | 'twilight' | 'flicker';

export const COMPOUNDS: Record<Compound, CodexEntry & { pair: [Essence, Essence] }> = {
  steam: { id: 'steam-c', name: 'Steam', pair: ['fire', 'frost'], recipe: 'Fire + Frost', text: "Hits blind: the target's next spell may miss", riddle: 'The kettle and the well.' },
  plasma: { id: 'plasma', name: 'Plasma', pair: ['fire', 'storm'], recipe: 'Fire + Storm', text: 'Burning chains to a second target', riddle: 'Flame that remembers the sky.' },
  smog: { id: 'smog', name: 'Smog', pair: ['fire', 'venom'], recipe: 'Fire + Venom', text: 'Leaves a toxic cloud on their side', riddle: 'The smoke of a poisoned hearth.' },
  glacier: { id: 'glacier', name: 'Glacier', pair: ['frost', 'stone'], recipe: 'Frost + Stone', text: 'Frozen targets take triple damage from its heavy hits', riddle: 'Ice with the patience of rock.' },
  rime: { id: 'rime', name: 'Rime', pair: ['frost', 'storm'], recipe: 'Frost + Storm', text: 'Every Chill it applies also adds Charge', riddle: 'Frost that hums.' },
  plague: { id: 'plague', name: 'Plague', pair: ['venom', 'shadow'], recipe: 'Venom + Shadow', text: 'Poison spreads to every enemy unit', riddle: 'A sickness that walks.' },
  twilight: { id: 'twilight', name: 'Twilight', pair: ['holy', 'shadow'], recipe: 'Holy + Shadow', text: 'Half the damage it deals heals you', riddle: 'Neither dawn nor dusk.' },
  flicker: { id: 'flicker', name: 'Flicker', pair: ['storm', 'arcane'], recipe: 'Storm + Arcane', text: 'The spell also hits a random second target', riddle: 'Lightning that cannot decide.' },
};
export const COMPOUND_LIST = Object.keys(COMPOUNDS) as Compound[];

export interface LegendaryRecipe extends CodexEntry {
  base: string;
  parts: { id?: string; ess?: Essence }[]; // three infusions, any order
  form?: string;
}

export const LEGENDARIES: LegendaryRecipe[] = [
  { id: 'pitlord', name: 'Pit Lord', base: 'imp', parts: [{ ess: 'fire' }, { ess: 'fire' }, { ess: 'fire' }],
    recipe: 'Summon Imp + Fire + Fire + Fire', text: 'A demon that gains 1 attack for every Burning stack on the board', riddle: 'Three fires make a lord.' },
  { id: 'frostlich', name: 'Frost Lich', base: 'skeletons', parts: [{ ess: 'frost' }, { ess: 'frost' }, { ess: 'shadow' }],
    recipe: 'Skeletons + Frost + Frost + Shadow', text: 'A skeleton mage whose hits freeze at 3 Chill instead of 5', riddle: 'Bones that learned the winter.' },
  { id: 'flock', name: 'Flock', base: 'polymorph', parts: [{ id: 'imp' }, { id: 'echo' }, { id: 'mirror' }],
    recipe: 'Polymorph + Summon Imp + Echo + Mirror', text: 'The enemy and all their summons become sheep for 4 s', riddle: 'Everyone, in the reflection, is a sheep.' },
  { id: 'apocalypse', name: 'Apocalypse Clock', base: 'doom', parts: [{ id: 'agony' }, { id: 'tongues' }, { id: 'hexbolt' }],
    recipe: 'Doom + Agony + Curse of Tongues + Hex Bolt', text: "Doom's fuse shortens by 1 s every time they read a line", riddle: 'Every word they speak winds the clock.' },
  { id: 'philmirror', name: "Philosopher's Mirror", base: 'mirror', parts: [{ id: 'mirror' }, { id: 'mend' }, { id: 'echo' }],
    recipe: 'Mirror + Mirror + Mend + Echo', text: 'Reflects every enemy bolt for 5 s', riddle: 'A mirror that heals what it shows.' },
  { id: 'worldroot', name: 'Worldroot', base: 'treant', parts: [{ ess: 'stone' }, { ess: 'stone' }, { id: 'mend' }],
    recipe: 'Treant + Stone + Stone + Mend', text: 'Grows every 5 s and heals you for the damage it absorbs', riddle: 'The oldest tree drinks every blow.' },
  { id: 'tempest', name: 'Tempest', base: 'chainlightning', parts: [{ id: 'spark' }, { id: 'spark' }, { id: 'frostshard' }],
    recipe: 'Chain Lightning + Spark + Spark + Frost Shard', text: 'Chains through every unit; each gains 1 Chill and 1 Charge', riddle: 'Two sparks and a shard of winter.' },
];
export const LEGENDARY: Record<string, LegendaryRecipe> = {};
for (const l of LEGENDARIES) LEGENDARY[l.id] = l;
