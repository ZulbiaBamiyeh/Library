// Archetype ghosts: one bot tome per engine from the design, grown to fit the round.
import type { SpellInst } from '../data/fusion';
import type { TomeSpec, WardCond } from './types';
import { mulberry32, pick } from './rng';
import { hpForRound, inkForRound, linesForRound, trinketSlotsForRound, wardsForRound } from '../game/progression';

// 'a+b+c' means base a infused with b then c. Each entry unlocks at a round.
type Entry = [string, number];
interface Archetype {
  title: string;
  lines: Entry[];
  wards: [WardCond, string, number][];
  staff: [string, number][];
  trinkets: [string, number][];
}

export const ARCHETYPES: Archetype[] = [
  { title: 'Affliction Warlock',
    lines: [['malediction', 5], ['agony', 1], ['tongues+firebolt', 3], ['corruption', 1], ['unstable', 6], ['doom', 4], ['hexbolt', 1], ['siphon', 2], ['hexbolt', 1], ['hexbolt+venomdart', 8]],
    wards: [['half', 'mend', 1], ['struck', 'hexbolt', 3], ['every8', 'siphon', 6]],
    staff: [['ashwood', 1], ['bonecrook', 6]], trinkets: [['onyx', 1], ['blackcandle', 3], ['doomskull', 7], ['vampfang', 5]] },
  { title: 'Imp Engine',
    lines: [['kindle', 4], ['imp+firebolt', 1], ['imp+oilflask', 5], ['oilflask', 2], ['fireball', 3], ['firebolt', 1], ['firebolt+firebolt', 6], ['firebolt', 1], ['spark', 8], ['firebolt', 1]],
    wards: [['summondies', 'firebolt', 2], ['half', 'mend', 3], ['loop', 'oilflask', 6]],
    staff: [['ashwood', 1], ['emberwood', 3]], trinkets: [['rubychip', 1], ['cinderchalice', 4], ['impjar', 2], ['crowncinders', 7]] },
  { title: 'Frost Lock',
    lines: [['raincloud', 1], ['blizzard', 5], ['frostarmour', 4], ['frostshard', 1], ['frostshard', 1], ['frostshard+stone', 3], ['deepfreeze', 6], ['frostshard', 1], ['stone', 2], ['frostshard+frostshard', 8]],
    wards: [['struck', 'frostshard', 1], ['half', 'icewall', 3], ['every8', 'raincloud', 6]],
    staff: [['ashwood', 1], ['rimeglass', 3]], trinkets: [['sapphire', 1], ['frostlocket', 4], ['rainbell', 2], ['hourglass', 6]] },
  { title: 'Storm Conductor',
    lines: [['staticfield', 4], ['thunderhead', 6], ['raincloud', 2], ['spark', 1], ['spark', 1], ['chainlightning', 1], ['spark+spark', 5], ['chainlightning', 3], ['spark', 1], ['chainlightning+raincloud', 8]],
    wards: [['every8', 'spark', 1], ['half', 'mirror', 3], ['struck', 'spark', 6]],
    staff: [['ashwood', 1], ['stormrod', 3]], trinkets: [['topaz', 1], ['lodestone', 3], ['tonguejar', 6], ['stormbottle', 7]] },
  { title: 'Trickster',
    lines: [['counterspell', 3], ['misplaced', 6], ['polymorph+imp', 5], ['babel', 7], ['plagiarize', 8], ['mirror+imp', 4], ['echo', 2], ['spark', 1], ['frostshard', 1], ['stone', 1]],
    wards: [['struck', 'mirror', 1], ['half', 'inkblot', 3], ['loop', 'spark', 6]],
    staff: [['ashwood', 1], ['hollowreed', 4]], trinkets: [['amethyst', 1], ['gamblersdie', 4], ['librarianeye', 7], ['waxseal', 2]] },
  { title: 'Holy Martyr',
    lines: [['retribution', 2], ['consecration', 4], ['imp+mend', 3], ['guardianangel', 6], ['smite', 1], ['mend', 1], ['smite', 1], ['mend+smite', 5], ['smite+firebolt', 8], ['smite', 1]],
    wards: [['half', 'mend', 1], ['afflicted', 'mend', 3], ['struck', 'smite', 6]],
    staff: [['ashwood', 1], ['censer', 4]], trinkets: [['pearl', 1], ['knucklebone', 2], ['ouroboros', 5], ['vampfang', 7]] },
  { title: 'Plaguebringer',
    lines: [['plaguerat', 2], ['miasma', 4], ['wither', 6], ['venomdart', 1], ['venomdart+chainlightning', 3], ['stone', 1], ['rotseed', 5], ['venomdart', 2], ['hexbolt+venomdart', 8], ['spark', 1]],
    wards: [['struck', 'venomdart', 1], ['half', 'mend', 3], ['summondies', 'plaguerat', 6]],
    staff: [['ashwood', 1], ['thornroot', 5]], trinkets: [['emerald', 1], ['leechtooth', 3], ['gravedust', 6], ['heartkiln', 9]] },
  { title: 'Stone Warden',
    lines: [['treant', 3], ['skeletons', 2], ['imp', 1], ['stoneskin', 5], ['stone', 1], ['smite', 1], ['earthquake', 6], ['stone', 1], ['treant+stone+stone', 9], ['stone+firebolt', 8]],
    wards: [['half', 'icewall', 1], ['summondies', 'imp', 3], ['struck', 'stone', 6]],
    staff: [['ashwood', 1], ['thornroot', 3]], trinkets: [['flint', 1], ['thimble', 2], ['mossidol', 4], ['twincoin', 8]] },
  { title: 'Pyroclast',
    lines: [['wildfire', 4], ['phoenixegg', 6], ['emberswarm', 1], ['firebolt', 1], ['oilflask', 2], ['flashpoint', 5], ['firebolt', 1], ['emberswarm+firebolt', 7], ['fireball', 3], ['phoenixegg+firebolt+firebolt', 9]],
    wards: [['loop', 'emberswarm', 1], ['summondies', 'firebolt', 3], ['every8', 'oilflask', 6]],
    staff: [['ashwood', 1], ['emberwood', 3]], trinkets: [['rubychip', 1], ['oilglove', 2], ['cinderchalice', 4], ['kindledruby', 7]] },
  { title: 'Wintershade',
    lines: [['snowman', 2], ['permafrost', 4], ['raincloud', 1], ['icicle', 1], ['frostshard', 3], ['icicle', 1], ['haunt', 5], ['coldsnap', 7], ['icicle+icicle', 6], ['raincloud+frostshard', 9]],
    wards: [['every8', 'raincloud', 1], ['afflicted', 'icicle', 3], ['loop', 'haunt', 6]],
    staff: [['ashwood', 1], ['rimeglass', 3]], trinkets: [['sapphire', 1], ['rainbell', 2], ['frostlocket', 4], ['hourglass', 6]] },
  { title: 'Chronomancer',
    lines: [['duplicate', 3], ['shadowclone', 5], ['missiles', 1], ['timewarp', 4], ['manadrain', 2], ['missiles', 1], ['wildmagic', 1], ['missiles+spark', 6], ['echo+echo', 7], ['judgement', 8]],
    wards: [['loop', 'missiles', 1], ['every8', 'wildmagic', 3], ['summondies', 'timewarp', 6]],
    staff: [['ashwood', 1], ['hollowreed', 4]], trinkets: [['amethyst', 1], ['goldquill', 2], ['clockheart', 5], ['gamblersdie', 7]] },
  { title: 'Tinker',
    lines: [['crystal', 4], ['teslacoil', 2], ['golem', 1], ['spark', 1], ['boulder', 5], ['spark', 1], ['stone', 3], ['overcharge', 6], ['golem+chainlightning', 8], ['staticshield', 7]],
    wards: [['every8', 'spark', 1], ['loop', 'staticshield', 3], ['summondies', 'spark', 6]],
    staff: [['ashwood', 1], ['thornroot', 3]], trinkets: [['topaz', 1], ['flint', 2], ['lodestone', 4], ['stormbottle', 7]] },
];

export const BOT_NAMES = [
  'Morwen of the Ash Stacks', 'Brother Quill', 'The Vellum Widow', 'Oddny Saltmarsh', 'Alder the Unbound', 'Sister Gall',
  'Hollis Marrowdew', 'Ysolde Candlewick', 'The Rubricator', 'Old Fenwick', 'Ivo Palimpsest', 'Marga the Blotted',
  'Tamsin Inkwell', 'Corvin Marginalia', 'The Pale Archivist', 'Wren Foxglove',
];

let uidSeq = 900000;
function inst(desc: string, round: number, tier: number): SpellInst {
  const parts = desc.split('+');
  // early bots bind less
  const maxInf = round <= 2 ? 0 : round <= 5 ? 1 : round <= 8 ? 2 : 3;
  return { uid: uidSeq++, base: parts[0], inf: parts.slice(1, 1 + maxInf), tier };
}

export function makeBot(round: number, seed: number, archIdx?: number): TomeSpec {
  const rng = mulberry32(seed);
  const arch = archIdx !== undefined ? ARCHETYPES[archIdx % ARCHETYPES.length] : pick(rng, ARCHETYPES);
  const n = Math.min(linesForRound(round), round + 2);
  let eligible = arch.lines.filter(([, r]) => r <= round);
  while (eligible.length > n) {
    // drop the most recently unlocked entry first
    let worst = 0;
    eligible.forEach(([, r], i) => { if (r >= eligible[worst][1]) worst = i; });
    eligible = eligible.filter((_, i) => i !== worst);
  }
  const tier = () => { const x = rng(); if (round >= 6 && x < (round - 5) * 0.08) return 2; if (x < Math.min(0.55, round * 0.07)) return 1; return 0; };
  const lines = eligible.map(([d]) => inst(d, round, tier()));
  const nW = wardsForRound(round);
  const wards = arch.wards.filter(([, , r]) => r <= round).slice(0, nW).map(([cond, s]) => ({ cond, spell: inst(s, round, tier()) }));
  const staffs = arch.staff.filter(([, r]) => r <= round);
  const staff = staffs[staffs.length - 1][0];
  const trinkets = arch.trinkets.filter(([, r]) => r <= round).map(([id]) => id).slice(-trinketSlotsForRound(round));
  return {
    name: pick(rng, BOT_NAMES), title: arch.title, hp: Math.round(hpForRound(round) * (round <= 3 ? 0.88 : 1)), ink: inkForRound(round), lines, wards,
    artifacts: [staff, ...trinkets],
  };
}
