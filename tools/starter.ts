// How a fresh player tome fares against round-1 ghosts.
import { runDuel } from '../src/sim/duel';
import { ARCHETYPES, makeBot } from '../src/sim/bots';
import type { TomeSpec } from '../src/sim/types';
let u = 1;
const I = (b: string) => ({ uid: u++, base: b, inf: [], tier: 0 });
const tomes: Record<string, TomeSpec> = {
  starter: { name: 'You', hp: 160, ink: 115, lines: [I('spark'), I('firebolt'), I('frostshard')], wards: [], artifacts: ['ashwood'] },
  filled: { name: 'You', hp: 160, ink: 115, lines: [I('imp'), I('spark'), I('firebolt'), I('venomdart'), I('frostshard')], wards: [{ cond: 'struck', spell: I('spark') }], artifacts: ['ashwood'] },
};
for (const [k, t] of Object.entries(tomes)) {
  let row = k.padEnd(9);
  for (let a = 0; a < ARCHETYPES.length; a++) {
    let w = 0;
    for (let s = 0; s < 8; s++) if (runDuel(t, makeBot(1, 50 + s, a), s).winner === 0) w++;
    row += ` ${ARCHETYPES[a].title.split(' ')[0].slice(0, 5)} ${Math.round(w / 8 * 100)}%`;
  }
  console.log(row);
}
