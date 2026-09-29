// The few shopkeepers hidden in the depths: one each on five of the floors, always in the furthest hidden room
// that floor has. Each sells two oddities nobody else sells and a curio of its own schools, and dresses its
// stall to match. A stall's key is its floor times ten.
import type { Essence } from './spells';

export type StallLook = 'demon' | 'bone' | 'ice' | 'arcane' | 'ink';

export interface StallDef {
  key: number; d: number; unit: string; tint: string | null; scale: number; lift?: number;
  look: StallLook;
  ess: Essence[]; // the schools of the ordinary curio it sells
  odd: string[]; // the oddities it can have on its table
  ring?: string; // one colour for every cushion ring (the imp will have nothing but red)
}

export const STALLS: StallDef[] = [
  { key: 10, d: 1, unit: 'imp', tint: null, scale: 1.55, lift: 0.3, look: 'demon', ess: ['fire'], odd: ['tinderbox', 'brimstonepipe'], ring: '#ff2a2a' },
  { key: 20, d: 2, unit: 'skeleton', tint: '#7aff9a', scale: 1.7, look: 'bone', ess: ['shadow', 'venom'], odd: ['ribcage', 'jawbone', 'ratcrown', 'cheese'] },
  { key: 40, d: 4, unit: 'frostlich', tint: '#5ab0ff', scale: 1.6, look: 'ice', ess: ['frost', 'storm'], odd: ['snowglobe', 'icicledentures', 'kitekey', 'staticsock'] },
  { key: 50, d: 5, unit: 'mimic', tint: null, scale: 1.6, lift: 0.9, look: 'arcane', ess: ['arcane', 'stone'], odd: ['bottledecho', 'latefees', 'acorn', 'pebbles'] },
  { key: 70, d: 7, unit: 'author', tint: null, scale: 1.6, look: 'ink', ess: ['holy', 'arcane'], odd: ['halo', 'choirbox', 'bottledecho', 'latefees'] },
];

export const STALL_BY_KEY: Record<number, StallDef> = {};
for (const s of STALLS) STALL_BY_KEY[s.key] = s;
