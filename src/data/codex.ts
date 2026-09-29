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
  { id: 'overload', name: 'Overload', recipe: '10 Charge', text: 'The charge detonates for 30 damage', riddle: 'A jar can only hold so much lightning.' },
  { id: 'thermal', name: 'Thermal Shock', recipe: 'Frozen + Burning', text: 'The ice cracks: 12 damage and the freeze ends', riddle: 'Hot water on cold glass.' },
];

export type Compound = 'steam' | 'plasma' | 'smog' | 'glacier' | 'rime' | 'plague' | 'twilight' | 'flicker'
  | 'magma' | 'hellfire' | 'sunfire' | 'wildflame' | 'blightfrost' | 'blackice' | 'aurora' | 'stasis' | 'neurotoxin' | 'acid'
  | 'purge' | 'mutation' | 'magnetite' | 'blacklightning' | 'radiance' | 'obsidian' | 'bulwark' | 'gravity' | 'void' | 'prism';

export const COMPOUNDS: Record<Compound, CodexEntry & { pair: [Essence, Essence] }> = {
  steam: { id: 'steam-c', name: 'Steam', pair: ['fire', 'frost'], recipe: 'Fire + Frost', text: "Hits blind: the target's next spell may miss", riddle: 'The kettle and the well.' },
  plasma: { id: 'plasma', name: 'Plasma', pair: ['fire', 'storm'], recipe: 'Fire + Storm', text: 'Burning chains to a second target', riddle: 'Flame that remembers the sky.' },
  smog: { id: 'smog', name: 'Smog', pair: ['fire', 'venom'], recipe: 'Fire + Venom', text: 'Leaves a toxic cloud on their side', riddle: 'The smoke of a poisoned hearth.' },
  glacier: { id: 'glacier', name: 'Glacier', pair: ['frost', 'stone'], recipe: 'Frost + Stone', text: 'Frozen targets take triple damage from its heavy hits', riddle: 'Ice with the patience of rock.' },
  rime: { id: 'rime', name: 'Rime', pair: ['frost', 'storm'], recipe: 'Frost + Storm', text: 'Every Chill it applies also adds Charge', riddle: 'Frost that hums.' },
  plague: { id: 'plague', name: 'Plague', pair: ['venom', 'shadow'], recipe: 'Venom + Shadow', text: 'Poison spreads to every enemy unit', riddle: 'A sickness that walks.' },
  twilight: { id: 'twilight', name: 'Twilight', pair: ['holy', 'shadow'], recipe: 'Holy + Shadow', text: 'Half the damage it deals heals you', riddle: 'Neither dawn nor dusk.' },
  flicker: { id: 'flicker', name: 'Flicker', pair: ['storm', 'arcane'], recipe: 'Storm + Arcane', text: 'The spell also hits a random second target', riddle: 'Lightning that cannot decide.' },
  magma: { id: 'magma', name: 'Magma', pair: ['fire', 'stone'], recipe: 'Fire + Stone', text: 'Its hits are heavy and scorch every enemy summon for 4 and 1 Burning', riddle: 'Stone that forgot how to be cold.' },
  hellfire: { id: 'hellfire', name: 'Hellfire', pair: ['fire', 'shadow'], recipe: 'Fire + Shadow', text: 'You heal 2 for every Burning stack on the target', riddle: 'A flame that feeds its keeper.' },
  sunfire: { id: 'sunfire', name: 'Sunfire', pair: ['fire', 'holy'], recipe: 'Fire + Holy', text: 'Deals double damage to summons', riddle: 'Noon falls on the servants first.' },
  wildflame: { id: 'wildflame', name: 'Wildflame', pair: ['fire', 'arcane'], recipe: 'Fire + Arcane', text: 'An ember leaps to every other enemy: 3 damage and 1 Burning', riddle: 'Fire that chooses where to go.' },
  blightfrost: { id: 'blightfrost', name: 'Blightfrost', pair: ['frost', 'venom'], recipe: 'Frost + Venom', text: 'Every Poison stack it applies also adds a Chill', riddle: 'The rot that comes with winter.' },
  blackice: { id: 'blackice', name: 'Black Ice', pair: ['frost', 'shadow'], recipe: 'Frost + Shadow', text: 'Clears the target\'s immunity so it can freeze again at once', riddle: 'Ice you never see coming.' },
  aurora: { id: 'aurora', name: 'Aurora', pair: ['frost', 'holy'], recipe: 'Frost + Holy', text: 'Heals you 2 for each Chill on the target', riddle: 'Light over the frozen sea.' },
  stasis: { id: 'stasis', name: 'Stasis', pair: ['frost', 'arcane'], recipe: 'Frost + Arcane', text: 'Pushes their reading back 1 s', riddle: 'The moment, held still.' },
  neurotoxin: { id: 'neurotoxin', name: 'Neurotoxin', pair: ['venom', 'storm'], recipe: 'Venom + Storm', text: 'Each hit slows their reading 3% for the rest of the duel', riddle: 'A sting that numbs the tongue.' },
  acid: { id: 'acid', name: 'Acid', pair: ['venom', 'stone'], recipe: 'Venom + Stone', text: 'The target takes 25% more damage from everything for 5 s', riddle: 'What eats through armour.' },
  purge: { id: 'purge', name: 'Purge', pair: ['venom', 'holy'], recipe: 'Venom + Holy', text: 'Each hit cleanses 2 status stacks from you', riddle: 'The bitter cure.' },
  mutation: { id: 'mutation', name: 'Mutation', pair: ['venom', 'arcane'], recipe: 'Venom + Arcane', text: 'Turns 2 Poison on the target into 2 random other statuses', riddle: 'Venom that will not stay venom.' },
  magnetite: { id: 'magnetite', name: 'Magnetite', pair: ['storm', 'stone'], recipe: 'Storm + Stone', text: 'Every enemy summon is dragged into the hit and takes half', riddle: 'The stone that pulls.' },
  blacklightning: { id: 'blacklightning', name: 'Black Lightning', pair: ['storm', 'shadow'], recipe: 'Storm + Shadow', text: 'Steals 4 ink for each Charge on the target', riddle: 'A bolt that takes as it strikes.' },
  radiance: { id: 'radiance', name: 'Radiance', pair: ['storm', 'holy'], recipe: 'Storm + Holy', text: 'Heals you 2 for each Charge on the target', riddle: 'Lightning as a blessing.' },
  obsidian: { id: 'obsidian', name: 'Obsidian', pair: ['stone', 'shadow'], recipe: 'Stone + Shadow', text: 'The hit strikes again 2 s later for 40% as shadow', riddle: 'The dark glass remembers the blow.' },
  bulwark: { id: 'bulwark', name: 'Bulwark', pair: ['stone', 'holy'], recipe: 'Stone + Holy', text: 'Each hit gives you a ward that blocks one bolt (up to 3)', riddle: 'The wall that prays.' },
  gravity: { id: 'gravity', name: 'Gravity', pair: ['stone', 'arcane'], recipe: 'Stone + Arcane', text: 'Their reading is pushed back 0.8 s and their summons stagger', riddle: 'Everything, heavier.' },
  void: { id: 'void', name: 'Void', pair: ['shadow', 'arcane'], recipe: 'Shadow + Arcane', text: 'Strips one ward or aura from the target', riddle: 'The hole where the magic was.' },
  prism: { id: 'prism', name: 'Prism', pair: ['holy', 'arcane'], recipe: 'Holy + Arcane', text: 'Splits: every other enemy takes 40% of the hit', riddle: 'One light, many colours.' },
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
  { id: 'supernova', name: 'Supernova', base: 'fireball', parts: [{ ess: 'fire' }, { ess: 'fire' }, { ess: 'holy' }],
    recipe: 'Fireball + Fire + Fire + Holy', text: 'A second sun: 30 damage and 4 Burning to every enemy, and they are blinded', riddle: 'Two fires and a prayer make a star.' },
  { id: 'absolutezero', name: 'Absolute Zero', base: 'blizzard', parts: [{ ess: 'frost' }, { ess: 'frost' }, { ess: 'arcane' }],
    recipe: 'Blizzard + Frost + Frost + Arcane', text: 'Every enemy freezes for 4 s, immunity or not, and the storm lasts twice as long', riddle: 'The cold that stops the clock.' },
  { id: 'blackdeath', name: 'Black Death', base: 'plaguerat', parts: [{ ess: 'venom' }, { ess: 'venom' }, { ess: 'shadow' }],
    recipe: 'Plague Rat + Venom + Venom + Shadow', text: 'Every bite breeds another rat, up to five', riddle: 'One rat is a problem. Then it is not one rat.' },
  { id: 'thorsanvil', name: "Thor's Anvil", base: 'stone', parts: [{ ess: 'storm' }, { ess: 'storm' }, { ess: 'stone' }],
    recipe: 'Stone + Storm + Storm + Stone', text: 'A 40-damage heavy blow; all their Charge conducts twice over', riddle: 'The hammer, and the weather.' },
  { id: 'endlesslibrary', name: 'The Endless Library', base: 'echo', parts: [{ id: 'echo' }, { id: 'echo' }, { ess: 'arcane' }],
    recipe: 'Echo + Echo + Echo + Arcane', text: 'Recasts your last three spells at full power', riddle: 'Every book, read again.' },
  { id: 'seraph', name: 'Seraph', base: 'imp', parts: [{ ess: 'holy' }, { ess: 'holy' }, { ess: 'holy' }],
    recipe: 'Summon Imp + Holy + Holy + Holy', text: 'A six-winged seraph: every 2.5 s it heals you 4 and smites for 6', riddle: 'Three blessings make a small thing holy.' },
  { id: 'mindflayer', name: 'Mindflayer', base: 'babel', parts: [{ ess: 'shadow' }, { ess: 'arcane' }, { ess: 'arcane' }],
    recipe: 'Babel + Shadow + Arcane + Arcane', text: 'Their next four spells target themselves, each draining 10 of their ink', riddle: 'A tongue that speaks against its owner.' },
  { id: 'hydra', name: 'Hydra', base: 'leech', parts: [{ ess: 'venom' }, { ess: 'venom' }, { ess: 'venom' }],
    recipe: 'Leech + Venom + Venom + Venom', text: 'When a head dies, two grow back at half size, twice over', riddle: 'Cut one, grow two.' },
  { id: 'totaleclipse', name: 'Total Eclipse', base: 'corruption', parts: [{ ess: 'shadow' }, { ess: 'holy' }, { ess: 'arcane' }],
    recipe: 'Corruption + Shadow + Holy + Arcane', text: 'For the rest of the duel, a quarter of all damage they take heals you', riddle: 'When the dark and the light line up.' },
  { id: 'phoenixlord', name: 'Phoenix Lord', base: 'phoenixegg', parts: [{ ess: 'fire' }, { ess: 'fire' }, { ess: 'holy' }],
    recipe: 'Phoenix Egg + Fire + Fire + Holy', text: 'Hatches at once into a great phoenix that is reborn every time it dies', riddle: 'An egg that remembers every fire.' },
  { id: 'stormspire', name: 'Stormspire', base: 'teslacoil', parts: [{ ess: 'storm' }, { ess: 'storm' }, { ess: 'storm' }],
    recipe: 'Tesla Coil + Storm + Storm + Storm', text: 'A spire that zaps every 2 s and chains through every enemy', riddle: 'Three storms, one lightning rod.' },
];
export const LEGENDARY: Record<string, LegendaryRecipe> = {};
for (const l of LEGENDARIES) LEGENDARY[l.id] = l;
