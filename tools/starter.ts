// How a fresh player fares against round-1 and round-2 ghosts: Firebolt plus three borrowed spells.
import { runDuel } from '../src/sim/duel';
import { ARCHETYPES, makeBot } from '../src/sim/bots';
import { SPELL_LIST } from '../src/data/spells';
import { mulberry32 } from '../src/sim/rng';
import { hpForRound, inkForRound } from '../src/game/progression';
import type { TomeSpec } from '../src/sim/types';

let u = 1;
const I = (b: string) => ({ uid: u++, base: b, inf: [] as string[], tier: 0 });
const commons = SPELL_LIST.filter(s => s.rarity === 0).map(s => s.id);
for (const round of [1, 2]) {
  const rng = mulberry32(round);
  const wins = ARCHETYPES.map(() => 0);
  const N = 40;
  for (let t = 0; t < N; t++) {
    const picks = Array.from({ length: 3 }, () => commons[Math.floor(rng() * commons.length)]);
    const me: TomeSpec = { name: 'You', hp: hpForRound(round), ink: inkForRound(round), lines: [I('firebolt'), ...picks.map(I)], wards: [], artifacts: ['ashwood'] };
    ARCHETYPES.forEach((_, a) => { if (runDuel(me, makeBot(round, 50 + t, a), t).winner === 0) wins[a]++; });
  }
  console.log(`round ${round}: ` + ARCHETYPES.map((A, a) => `${A.title.split(' ')[0].slice(0, 6)} ${Math.round(100 * wins[a] / N)}%`).join('  ') + `  · overall ${Math.round(100 * wins.reduce((x, y) => x + y) / (N * ARCHETYPES.length))}%`);
}
