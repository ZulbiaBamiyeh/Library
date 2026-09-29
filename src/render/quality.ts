// Graphics quality. "auto" starts high and steps down on its own if the frame rate stays low.
export type QualityMode = 'auto' | 'high' | 'medium' | 'low';
export const QUALITY_MODES: QualityMode[] = ['auto', 'high', 'medium', 'low'];
const KEY = 'inkbound2.gfx';

function load(): QualityMode {
  try { const v = localStorage.getItem(KEY) as QualityMode | null; return v && QUALITY_MODES.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}

export const quality = {
  mode: load(),
  level: 2, // 2 high, 1 medium, 0 low: what is actually in use
};
quality.level = quality.mode === 'low' ? 0 : quality.mode === 'medium' ? 1 : 2;

export function setQualityMode(mode: QualityMode) {
  quality.mode = mode;
  quality.level = mode === 'low' ? 0 : mode === 'medium' ? 1 : 2;
  try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ }
}

// How much of each setting a level gets.
export const Q = {
  pixelRatio: (lv: number) => Math.min(window.devicePixelRatio || 1, [0.7, 1, 1.6][lv]),
  samples: (lv: number) => [0, 0, 4][lv],
  bloom: (lv: number) => lv > 0,
  drawScale: (lv: number) => [0.6, 0.8, 1][lv], // how far you see through the library before the fog
  candles: (lv: number) => [3, 4, 6][lv], // candle lights that follow you
};
