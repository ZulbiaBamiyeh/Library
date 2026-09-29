// Shared handles between screens, set up by main.ts.
import type { Engine } from '../render/engine';
import type { Library } from '../render/library';
import type { Shop } from '../render/shop';
import type { Board } from '../render/board';

export type ScreenName = 'title' | 'library' | 'shop' | 'desk' | 'duel';
export interface Screen { mount(): void; unmount(): void; tick?(dt: number, time: number): void }

export const app = {
  engine: null as unknown as Engine,
  library: null as unknown as Library,
  shop: null as unknown as Shop,
  board: null as unknown as Board,
  screen: 'title' as ScreenName,
  devSpeed: 1,
  go: (_s: ScreenName) => { /* set in main */ },
};

export function ui(): HTMLElement { return document.getElementById('ui')!; }
