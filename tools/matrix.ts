// Win matrix for one round: rows beat columns (percent over seeds).
import { runDuel } from '../src/sim/duel';
import { ARCHETYPES, makeBot } from '../src/sim/bots';
const round = Number(process.argv[2] || 6), seeds = Number(process.argv[3] || 6);
const N = ARCHETYPES.length;
const short = ARCHETYPES.map(a => a.title.split(' ')[0].slice(0, 6).padStart(7));
console.log('       ' + short.join(''));
const heal = new Array(N).fill(0), dealt = new Array(N).fill(0), games = new Array(N).fill(0);
for (let a = 0; a < N; a++) {
  let row = short[a];
  for (let b = 0; b < N; b++) {
    if (a === b) { row += '      -'; continue; }
    let w = 0;
    for (let s = 0; s < seeds; s++) {
      const r = runDuel(makeBot(round, 100 + s, a), makeBot(round, 200 + s, b), 7 * s + a * 31 + b);
      if (r.winner === 0) w++;
      heal[a] += r.stats.healed[0]; dealt[a] += r.stats.dealt[0]; games[a]++;
    }
    row += String(Math.round(100 * w / seeds)).padStart(7);
  }
  console.log(row);
}
console.log('\navg dealt / healed per duel:');
ARCHETYPES.forEach((A, i) => console.log('  ' + A.title.padEnd(20), Math.round(dealt[i] / games[i]), Math.round(heal[i] / games[i])));
