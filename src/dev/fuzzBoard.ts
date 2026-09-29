// Dev-only: play random duels' event logs through the board without rendering, to catch errors.
import { runDuel } from '../sim/duel';
import { SPELL_LIST } from '../data/spells';
import { ARTIFACT_LIST } from '../data/artifacts';
import { WARD_CONDS, type TomeSpec } from '../sim/types';
import { mulberry32 } from '../sim/rng';
import type { Board } from '../render/board';

export function fuzzBoard(board: Board, n: number, seed = 1): string {
  const rng = mulberry32(seed);
  const pick = <T>(a: T[]) => a[Math.floor(rng() * a.length)];
  let uid = 1;
  const spell = () => ({ uid: uid++, base: pick(SPELL_LIST).id, inf: Array.from({ length: Math.floor(rng() * 4) }, () => pick(SPELL_LIST).id), tier: Math.floor(rng() * 3) });
  const tome = (i: number): TomeSpec => ({
    name: 'F' + i, hp: 200, ink: 120, lines: Array.from({ length: 4 + Math.floor(rng() * 6) }, spell),
    wards: [{ cond: pick(WARD_CONDS).id, spell: spell() }], artifacts: [pick(ARTIFACT_LIST).id, pick(ARTIFACT_LIST).id],
  });
  let events = 0;
  for (let i = 0; i < n; i++) {
    const r = runDuel(tome(i), tome(i + 1), i);
    board.setup({ robes: ['#1f3f6a', '#5a1424'], staffs: ['ashwood', null] });
    let ei = 0, si = 0;
    for (let T = 0; T < r.duration + 1; T += 0.1) {
      while (ei < r.events.length && r.events[ei].t <= T) { board.handle(r.events[ei++], T); events++; }
      while (si < r.snaps.length - 1 && r.snaps[si + 1].t <= T) si++;
      board.applySnap(r.snaps[si]);
      board.updateProjectiles(T);
      board.update(0.1, T);
    }
  }
  board.reset();
  return `ok: ${n} duels, ${events} events, ${board.scene.children.length} scene children after reset`;
}
