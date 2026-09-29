// Headless balance runner: every archetype against every other, several seeds per round.
import { runDuel } from '../src/sim/duel';
import { ARCHETYPES, makeBot } from '../src/sim/bots';

const rounds = (process.argv[2] || '1,5,10').split(',').map(Number);
const seeds = Number(process.argv[3] || 6);
for (const round of rounds) {
  const N = ARCHETYPES.length;
  const wins = new Array(N).fill(0), games = new Array(N).fill(0);
  let dur = 0, count = 0, draws = 0, maxDur = 0;
  const t0 = Date.now();
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (a === b) continue;
    for (let s = 0; s < seeds; s++) {
      const A = makeBot(round, 1000 + s * 7 + a, a), B = makeBot(round, 2000 + s * 13 + b, b);
      const r = runDuel(A, B, 31 * s + a * 101 + b);
      games[a]++; games[b]++;
      if (r.winner === 0) wins[a]++; else if (r.winner === 1) wins[b]++; else draws++;
      dur += r.duration; count++; maxDur = Math.max(maxDur, r.duration);
    }
  }
  console.log(`\nRound ${round}: ${count} duels in ${Date.now() - t0} ms, avg ${(dur / count).toFixed(1)} s, max ${maxDur.toFixed(1)} s, draws ${draws}`);
  ARCHETYPES.forEach((A, i) => console.log(`  ${A.title.padEnd(20)} ${(100 * wins[i] / games[i]).toFixed(0).padStart(3)}%`));
}
