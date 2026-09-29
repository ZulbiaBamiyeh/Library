// Print a readable log of one bot duel: node tools/trace.ts <round> <archA> <archB> [seed]
import { runDuel } from '../src/sim/duel';
import { ARCHETYPES, makeBot } from '../src/sim/bots';

const [round, a, b, seed] = process.argv.slice(2).map(Number);
const A = makeBot(round, 11, a), B = makeBot(round, 22, b);
const r = runDuel(A, B, seed || 7);
const name = (id: number) => id < 2 ? ['A', 'B'][id] : `u${id}`;
const dmgBy: Record<string, number> = {};
for (const e of r.events) {
  if (e.type === 'dmg') { const k = `${e.tgt < 2 ? name(e.tgt) : 'unit@' + e.tgt}:${e.kind}:${e.ess}`; dmgBy[k] = (dmgBy[k] || 0) + e.amt; }
  if (['cast', 'react', 'fizzle', 'curse', 'spawn', 'death', 'field', 'end', 'art', 'callout', 'wardLine', 'starved', 'freeze', 'morph'].includes(e.type)) {
    const x = { ...e } as Record<string, unknown>; delete x.t; delete x.type;
    if (e.type === 'spawn') { console.log(e.t.toFixed(2).padStart(6), 'spawn', e.unit.kind, 'side', e.unit.side, 'hp', Math.round(e.unit.hp)); continue; }
    console.log(e.t.toFixed(2).padStart(6), e.type.padEnd(8), JSON.stringify(x));
  }
}
console.log(ARCHETYPES[a].title, 'vs', ARCHETYPES[b].title, '→ winner', r.winner, 'hp', r.hp, 't', r.duration.toFixed(1));
console.log(A.lines.map(l => l && [l.base, ...l.inf].join('+')).join(' | '));
console.log(B.lines.map(l => l && [l.base, ...l.inf].join('+')).join(' | '));
const sorted = Object.entries(dmgBy).sort((x, y) => y[1] - x[1]);
for (const [k, v] of sorted) console.log('  ', k.padEnd(28), v.toFixed(0));
