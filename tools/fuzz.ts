// Random tomes, random fusions, random curios: look for crashes, NaN and runaway duels.
import { runDuel } from '../src/sim/duel';
import { SPELL_LIST } from '../src/data/spells';
import { ARTIFACT_LIST } from '../src/data/artifacts';
import { LEGENDARIES } from '../src/data/codex';
import { WARD_CONDS, type TomeSpec } from '../src/sim/types';
import { mulberry32 } from '../src/sim/rng';

const N = Number(process.argv[2] || 2000);
const rng = mulberry32(Number(process.argv[3] || 1));
const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
let uid = 1;
const SPECIALS = [['imp', 'imp'], ['skeletons', 'skeletons'], ['echo', 'echo'], ['counterspell', 'plagiarize'], ['sanctuary', 'mirror'], ['deepfreeze', 'stone'], ['polymorph', 'plaguerat'], ['doom', 'echo'], ['imp', 'mend'], ['polymorph', 'imp']];
function spell() {
  if (rng() < 0.08) { const [base, inf] = pick(SPECIALS); return { uid: uid++, base, inf: [inf], tier: Math.floor(rng() * 3) }; }
  if (rng() < 0.08) { const L = pick(LEGENDARIES); const inf = L.parts.map(p => p.id || pick(SPELL_LIST.filter(s => s.essence === p.ess)).id); return { uid: uid++, base: L.base, inf, tier: Math.floor(rng() * 3) }; }
  const n = Math.floor(rng() * 4);
  return { uid: uid++, base: pick(SPELL_LIST).id, inf: Array.from({ length: n }, () => pick(SPELL_LIST).id), tier: Math.floor(rng() * 3), ever: rng() < 0.1 ? 1 : 0, quick: rng() < 0.1 ? 1 : 0, gilded: rng() < 0.05 };
}
function tome(i: number): TomeSpec {
  const lines = Array.from({ length: 3 + Math.floor(rng() * 8) }, () => rng() < 0.1 ? null : spell());
  const wards = Array.from({ length: Math.floor(rng() * 5) }, () => ({ cond: pick(WARD_CONDS).id, spell: spell() }));
  const staff = pick(ARTIFACT_LIST.filter(a => a.slot === 'staff')).id;
  const trinkets = Array.from({ length: Math.floor(rng() * 5) }, () => pick(ARTIFACT_LIST.filter(a => a.slot === 'trinket')).id);
  return { name: 'F' + i, hp: 160 + Math.floor(rng() * 300), ink: 100 + Math.floor(rng() * 50), lines, wards, artifacts: [staff, ...new Set(trinkets)], startHex: rng() < 0.1 ? 2 : 0 };
}
let crashes = 0, nan = 0, long = 0, draws = 0, totalT = 0, maxEv = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const a = tome(i), b = tome(i + 1);
  try {
    const r = runDuel(a, b, i);
    totalT += r.duration; maxEv = Math.max(maxEv, r.events.length);
    if (r.winner === -1) draws++;
    if (r.duration >= 150) long++;
    for (const e of r.events) if (e.type === 'dmg' && !Number.isFinite(e.amt)) { nan++; break; }
    const last = r.snaps[r.snaps.length - 1];
    if (!Number.isFinite(last.m[0].hp) || !Number.isFinite(last.m[1].hp)) nan++;
  } catch (e) {
    crashes++;
    if (crashes <= 5) { console.log('CRASH', (e as Error).stack?.split('\n').slice(0, 6).join('\n')); console.log(JSON.stringify({ a: a.lines.map(l => l && [l.base, ...l.inf].join('+')), b: b.lines.map(l => l && [l.base, ...l.inf].join('+')), aa: a.artifacts, ba: b.artifacts })); }
  }
}
console.log(`${N} duels in ${Date.now() - t0} ms · crashes ${crashes} · NaN ${nan} · timeouts ${long} · draws ${draws} · avg ${(totalT / N).toFixed(1)} s · max events ${maxEv}`);
