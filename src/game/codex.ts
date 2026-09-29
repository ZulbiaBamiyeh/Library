// What the player has discovered carries over between runs.
import { store } from './run';

interface CodexState { found: string[]; hinted: string[] }
export const codex: CodexState = store.get<CodexState>('inkbound2.codex', { found: [], hinted: [] });

export function isFound(id: string) { return codex.found.includes(id); }
export function discover(id: string): boolean {
  if (codex.found.includes(id)) return false;
  codex.found.push(id);
  store.set('inkbound2.codex', codex);
  return true;
}
export function hint(id: string) {
  if (codex.hinted.includes(id)) return;
  codex.hinted.push(id);
  store.set('inkbound2.codex', codex);
}
