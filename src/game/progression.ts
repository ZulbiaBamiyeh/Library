// How a run grows, round by round.
export const MAX_WINS = 10;
export const MAX_LOSSES = 4;
// The tome starts short: four lines, one more at rounds 2, 4, 6, 8 and 10.
export function linesForRound(r: number) { return 4 + [2, 4, 6, 8, 10].filter(x => x <= r).length; }
// Ward lines are earned: the first at round 3, then 6 and 9.
export function wardsForRound(r: number) { return [3, 6, 9].filter(x => x <= r).length; }
export const LINE_UNLOCKS = [2, 4, 6, 8, 10];
export const WARD_UNLOCKS = [3, 6, 9];
export function inkForRound(r: number) { return 100 + 10 * Math.floor((r - 1) / 2); }
export function hpForRound(r: number) { return 160 + 28 * (r - 1); }
export function bindingsForRound(r: number) { return r >= 6 ? 3 : 2; }
export function trinketSlotsForRound(r: number) { return 2 + [3, 6].filter(x => x <= r).length; }
export function goldForResult(round: number, won: boolean) { return won ? 10 + round : 7 + Math.floor(round / 2); }
