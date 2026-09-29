// Who keeps a hidden shop where: two to a floor below the Reading Room, each selling curios of their own
// school plus an oddity nobody else sells. A stall's key is its floor times ten plus its place on that floor.
import type { Essence } from './spells';

export interface StallDef { key: number; d: number; unit: string; tint: string | null; scale: number; cloth: string; ess: Essence; lift?: number }

export const STALLS: StallDef[] = [
  { key: 10, d: 1, unit: 'imp', tint: null, scale: 1.55, cloth: '#5a1a10', ess: 'fire', lift: 0.25 },
  { key: 11, d: 1, unit: 'rat', tint: null, scale: 2.6, cloth: '#3a4a20', ess: 'venom', lift: 0.9 },
  { key: 20, d: 2, unit: 'skeleton', tint: '#7aff9a', scale: 1.7, cloth: '#2a3a2a', ess: 'shadow' },
  { key: 21, d: 2, unit: 'cherub', tint: null, scale: 1.5, cloth: '#5a4a2a', ess: 'holy', lift: 0.7 },
  { key: 30, d: 3, unit: 'treant', tint: null, scale: 1.25, cloth: '#3a4a1a', ess: 'stone' },
  { key: 31, d: 3, unit: 'salamander', tint: null, scale: 2.6, cloth: '#6a2a10', ess: 'fire', lift: 1.1 },
  { key: 40, d: 4, unit: 'frostlich', tint: '#5ab0ff', scale: 1.6, cloth: '#1a3040', ess: 'frost' },
  { key: 41, d: 4, unit: 'leech', tint: null, scale: 3.2, cloth: '#1a3a2a', ess: 'venom', lift: 1.2 },
  { key: 50, d: 5, unit: 'mimic', tint: null, scale: 1.6, cloth: '#3a1a4a', ess: 'arcane', lift: 0.9 },
  { key: 51, d: 5, unit: 'tesla', tint: null, scale: 1.5, cloth: '#2a2a3a', ess: 'storm' },
  { key: 60, d: 6, unit: 'golem', tint: '#ffd070', scale: 1.25, cloth: '#4a3a1a', ess: 'stone' },
  { key: 61, d: 6, unit: 'bookworm', tint: null, scale: 2.2, cloth: '#3a2a1a', ess: 'arcane', lift: 0.9 },
  { key: 70, d: 7, unit: 'author', tint: null, scale: 1.6, cloth: '#1a1a1e', ess: 'arcane' },
  { key: 71, d: 7, unit: 'thing', tint: null, scale: 1.1, cloth: '#0a0a0c', ess: 'shadow' },
];

export const STALL_BY_KEY: Record<number, StallDef> = {};
for (const s of STALLS) STALL_BY_KEY[s.key] = s;
