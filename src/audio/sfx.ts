// Procedural sound: every effect is synthesised with Web Audio, no files.
import type { Essence } from '../data/spells';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem('inkbound2.muted') === '1'; } catch { /* ignore */ }
const last = new Map<string, number>();
let voices = 0;

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = 0.35; ambBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
  return ctx;
}

// Browsers only allow audio after a gesture: unlock on the first one.
let wantAmb: AmbKind = 'none';
let ambKind: AmbKind = 'none';
type AmbKind = 'library' | 'shop' | 'duel' | 'none';
export function initAudio() {
  const unlock = () => {
    const c = ensure();
    if (!c) return;
    const go = () => { if (ambKind !== wantAmb) startAmbience(wantAmb); };
    if (c.state === 'suspended') c.resume().then(go).catch(() => { /* ignore */ }); else go();
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
  document.addEventListener('click', e => { if ((e.target as HTMLElement).closest('.btn, button')) play('click'); }, true);
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('inkbound2.muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}

function throttle(key: string, ms: number): boolean {
  const now = performance.now();
  if ((last.get(key) || 0) + ms > now) return false;
  last.set(key, now);
  return true;
}

// ---------- building blocks ----------
interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; t?: number; dur: number; vol: number; attack?: number; detune?: number; filter?: number; q?: number; dest?: AudioNode }
function tone(o: ToneOpts) {
  const c = ctx!; const t = c.currentTime + (o.t || 0);
  const osc = c.createOscillator(); osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let node: AudioNode = osc;
  if (o.filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter; f.Q.value = o.q ?? 0.7; node.connect(f); node = f; }
  node.connect(g); g.connect(o.dest || sfxBus!);
  osc.start(t); osc.stop(t + o.dur + 0.05);
  voices++; osc.onended = () => { voices--; };
}

interface NoiseOpts { t?: number; dur: number; vol: number; type?: BiquadFilterType; f0: number; f1?: number; q?: number; attack?: number; dest?: AudioNode }
function noise(o: NoiseOpts) {
  const c = ctx!; const t = c.currentTime + (o.t || 0);
  const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f); f.connect(g); g.connect(o.dest || sfxBus!);
  src.start(t, Math.random()); src.stop(t + o.dur + 0.05);
  voices++; src.onended = () => { voices--; };
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// ---------- effects ----------
export type Sfx = 'click' | 'page' | 'coin' | 'bind' | 'reroll' | 'summon' | 'heal' | 'curse' | 'freeze' | 'shatter' | 'death' | 'victory' | 'defeat' | 'ward' | 'block' | 'reflect' | 'fizzle' | 'thunder' | 'legend' | 'blaze' | 'conduct' | 'react' | 'door' | 'artifact' | 'sheep' | 'burst';

export function play(name: Sfx, vol = 1) {
  const c = ctx;
  if (!c || muted || c.state !== 'running' || voices > 48) return;
  if (!throttle(name, name === 'click' ? 40 : 70)) return;
  const v = vol;
  switch (name) {
    case 'click': tone({ f0: 900, f1: 600, dur: 0.06, vol: 0.08 * v }); break;
    case 'page': noise({ dur: 0.22, vol: 0.12 * v, type: 'highpass', f0: 1200, f1: 3500, attack: 0.04 }); noise({ t: 0.08, dur: 0.18, vol: 0.08 * v, type: 'bandpass', f0: 2500, f1: 900 }); break;
    case 'door': noise({ dur: 0.6, vol: 0.12 * v, type: 'lowpass', f0: 600, f1: 200, attack: 0.1 }); tone({ f0: 110, f1: 90, dur: 0.5, vol: 0.06 * v, type: 'triangle' }); break;
    case 'coin': [1760, 2349, 3136].forEach((f, i) => tone({ type: 'triangle', f0: f, t: i * 0.06, dur: 0.35, vol: 0.09 * v })); break;
    case 'reroll': for (let i = 0; i < 6; i++) tone({ type: 'triangle', f0: 600 + Math.random() * 900, t: i * 0.04, dur: 0.12, vol: 0.05 * v }); break;
    case 'bind': [0, 4, 7, 12].forEach((s, i) => tone({ type: 'sine', f0: NOTE(62 + s), t: i * 0.07, dur: 0.9, vol: 0.08 * v, attack: 0.02 })); noise({ dur: 0.5, vol: 0.05 * v, type: 'highpass', f0: 4000, attack: 0.05 }); break;
    case 'summon': [0, 5, 9, 14].forEach((s, i) => tone({ type: 'triangle', f0: NOTE(55 + s), t: i * 0.05, dur: 0.35, vol: 0.08 * v })); noise({ dur: 0.35, vol: 0.06 * v, type: 'bandpass', f0: 300, f1: 1800 }); break;
    case 'heal': [0, 4, 7].forEach((s, i) => tone({ f0: NOTE(76 + s), t: i * 0.05, dur: 0.6, vol: 0.05 * v, attack: 0.03 })); break;
    case 'curse': tone({ type: 'sawtooth', f0: 70, f1: 55, dur: 1.1, vol: 0.07 * v, attack: 0.2, filter: 400 }); tone({ type: 'sawtooth', f0: 73.5, f1: 52, dur: 1.1, vol: 0.06 * v, attack: 0.2, filter: 380 }); noise({ dur: 0.8, vol: 0.05 * v, type: 'bandpass', f0: 500, f1: 150, q: 4, attack: 0.3 }); break;
    case 'freeze': [2637, 3520, 4186].forEach((f, i) => tone({ f0: f, t: i * 0.03, dur: 0.5, vol: 0.05 * v })); noise({ dur: 0.25, vol: 0.1 * v, type: 'highpass', f0: 5000 }); break;
    case 'shatter': for (let i = 0; i < 8; i++) tone({ f0: 2000 + Math.random() * 3000, t: Math.random() * 0.12, dur: 0.2, vol: 0.05 * v, type: 'triangle' }); noise({ dur: 0.35, vol: 0.2 * v, type: 'highpass', f0: 2500 }); break;
    case 'death': tone({ f0: 90, f1: 30, dur: 1.6, vol: 0.25 * v, type: 'sine' }); noise({ dur: 1.4, vol: 0.18 * v, type: 'lowpass', f0: 800, f1: 80 }); break;
    case 'victory': [0, 4, 7, 12, 16].forEach((s, i) => tone({ type: 'triangle', f0: NOTE(60 + s), t: i * 0.12, dur: 1.2, vol: 0.09 * v, attack: 0.02 })); break;
    case 'defeat': [7, 3, 0, -5].forEach((s, i) => tone({ type: 'triangle', f0: NOTE(57 + s), t: i * 0.18, dur: 1.1, vol: 0.08 * v, attack: 0.02, filter: 1800 })); break;
    case 'ward': tone({ f0: 660, f1: 990, dur: 0.4, vol: 0.06 * v, attack: 0.05 }); tone({ f0: 990, f1: 1320, dur: 0.4, vol: 0.04 * v, attack: 0.05 }); break;
    case 'block': tone({ f0: 1400, f1: 900, dur: 0.25, vol: 0.1 * v, type: 'triangle' }); noise({ dur: 0.15, vol: 0.1 * v, type: 'highpass', f0: 3000 }); break;
    case 'reflect': tone({ f0: 1200, f1: 2400, dur: 0.3, vol: 0.08 * v, type: 'sine' }); tone({ f0: 1800, f1: 3600, dur: 0.3, vol: 0.05 * v }); break;
    case 'fizzle': noise({ dur: 0.4, vol: 0.1 * v, type: 'bandpass', f0: 2000, f1: 300, q: 2 }); break;
    case 'thunder': noise({ dur: 0.9, vol: 0.28 * v, type: 'lowpass', f0: 1800, f1: 120, attack: 0.005 }); noise({ dur: 0.1, vol: 0.2 * v, type: 'highpass', f0: 3000 }); break;
    case 'legend': [0, 7, 12, 16, 19].forEach((s, i) => tone({ type: 'sawtooth', f0: NOTE(50 + s), t: i * 0.03, dur: 1.8, vol: 0.05 * v, attack: 0.08, filter: 2200 })); tone({ f0: 55, f1: 40, dur: 1.5, vol: 0.2 * v }); break;
    case 'blaze': noise({ dur: 0.7, vol: 0.28 * v, type: 'lowpass', f0: 2500, f1: 300, attack: 0.01 }); tone({ f0: 120, f1: 50, dur: 0.5, vol: 0.2 * v }); break;
    case 'conduct': for (let i = 0; i < 5; i++) tone({ type: 'square', f0: 1400 - i * 180, f1: 300, t: i * 0.035, dur: 0.1, vol: 0.05 * v, filter: 4000 }); noise({ dur: 0.3, vol: 0.18 * v, type: 'highpass', f0: 2500 }); break;
    case 'react': tone({ f0: NOTE(72), dur: 0.5, vol: 0.07 * v, type: 'triangle' }); tone({ f0: NOTE(79), t: 0.05, dur: 0.5, vol: 0.06 * v, type: 'triangle' }); break;
    case 'artifact': tone({ f0: NOTE(84), dur: 0.3, vol: 0.05 * v, type: 'sine' }); tone({ f0: NOTE(91), t: 0.06, dur: 0.35, vol: 0.04 * v }); break;
    case 'sheep': tone({ type: 'sawtooth', f0: 520, f1: 480, dur: 0.5, vol: 0.06 * v, filter: 1500, detune: 0 }); break;
    case 'burst': noise({ dur: 0.6, vol: 0.25 * v, type: 'lowpass', f0: 1500, f1: 150 }); tone({ f0: 90, f1: 40, dur: 0.5, vol: 0.22 * v }); break;
  }
}

// A cast: the sound of the spell leaving the staff, flavoured by essence.
export function castSound(ess: Essence, heavy = false) {
  const c = ctx;
  if (!c || muted || c.state !== 'running' || voices > 48) return;
  if (!throttle('cast' + ess, 60)) return;
  switch (ess) {
    case 'fire': noise({ dur: 0.45, vol: 0.18, type: 'bandpass', f0: 400, f1: 2400, q: 0.8 }); tone({ f0: 160, f1: 70, dur: 0.3, vol: 0.12, type: 'triangle' }); break;
    case 'frost': [1318, 1760, 2637].forEach((f, i) => tone({ f0: f, t: i * 0.02, dur: 0.45, vol: 0.05 })); noise({ dur: 0.3, vol: 0.08, type: 'highpass', f0: 4500, f1: 7000 }); break;
    case 'venom': for (let i = 0; i < 4; i++) tone({ f0: 300 + Math.random() * 400, f1: 700 + Math.random() * 400, t: i * 0.045, dur: 0.09, vol: 0.06, filter: 1800 }); break;
    case 'storm': tone({ type: 'sawtooth', f0: 2200, f1: 180, dur: 0.22, vol: 0.08, filter: 5000 }); noise({ dur: 0.25, vol: 0.14, type: 'highpass', f0: 3000 }); break;
    case 'stone': tone({ f0: 120, f1: 60, dur: 0.4, vol: 0.2 }); noise({ dur: 0.35, vol: 0.12, type: 'lowpass', f0: 600, f1: 150 }); break;
    case 'shadow': tone({ type: 'sawtooth', f0: 110, f1: 70, dur: 0.6, vol: 0.08, filter: 600, attack: 0.08 }); noise({ dur: 0.5, vol: 0.08, type: 'bandpass', f0: 900, f1: 200, q: 3, attack: 0.1 }); break;
    case 'holy': [0, 4, 7].forEach(s => tone({ f0: NOTE(72 + s), dur: 0.7, vol: 0.05, attack: 0.06 })); break;
    case 'arcane': tone({ f0: 880, f1: 1760, dur: 0.35, vol: 0.06, type: 'sine' }); tone({ f0: 1320, f1: 660, dur: 0.35, vol: 0.04, type: 'triangle' }); break;
  }
  if (heavy) tone({ f0: 70, f1: 40, dur: 0.35, vol: 0.15 });
}

export function impactSound(ess: Essence | null, size: number) {
  const c = ctx;
  if (!c || muted || c.state !== 'running' || voices > 48) return;
  if (!throttle('impact', 45)) return;
  const v = Math.min(1, 0.35 + size * 0.5);
  noise({ dur: 0.18 + size * 0.1, vol: 0.16 * v, type: 'lowpass', f0: ess === 'frost' || ess === 'storm' ? 4000 : 1600, f1: 200 });
  tone({ f0: 140, f1: 55, dur: 0.18 + size * 0.1, vol: 0.14 * v });
}

// ---------- ambience ----------
let amb: { nodes: AudioScheduledSourceNode[]; gain: GainNode; timer: number } | null = null;
export function ambience(kind: AmbKind) {
  wantAmb = kind;
  if (ctx && ctx.state === 'running') startAmbience(kind);
}

function startAmbience(kind: AmbKind) {
  const c = ctx;
  ambKind = kind;
  if (amb && ctx) {
    const old = amb; amb = null;
    old.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    clearInterval(old.timer);
    setTimeout(() => old.nodes.forEach(n => { try { n.stop(); } catch { /* ignore */ } }), 1500);
  }
  if (!c || kind === 'none') return;
  const g = c.createGain(); g.gain.value = 0.0001; g.connect(ambBus!);
  g.gain.setTargetAtTime(1, c.currentTime + 0.2, 1.2);
  const nodes: AudioScheduledSourceNode[] = [];
  const pad = (f: number, vol: number, filt: number) => {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filt;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.05;
    const lg = c.createGain(); lg.gain.value = filt * 0.4; lfo.connect(lg); lg.connect(lp.frequency);
    const vg = c.createGain(); vg.gain.value = vol;
    o.connect(lp); lp.connect(vg); vg.connect(g);
    o.start(); lfo.start(); nodes.push(o, lfo);
  };
  const crackle = (vol: number) => {
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.6;
    const vg = c.createGain(); vg.gain.value = vol;
    src.connect(f); f.connect(vg); vg.connect(g); src.start(); nodes.push(src);
  };
  let timer = 0;
  if (kind === 'library') {
    pad(NOTE(38), 0.05, 380); pad(NOTE(45), 0.035, 420); pad(NOTE(50), 0.02, 500);
    crackle(0.012);
    timer = window.setInterval(() => { if (Math.random() < 0.25 && !muted) tone({ f0: NOTE([62, 65, 69, 72, 74][Math.floor(Math.random() * 5)]), dur: 2.2, vol: 0.02, attack: 0.4, dest: g }); }, 1400);
  } else if (kind === 'shop') {
    pad(NOTE(43), 0.035, 500); pad(NOTE(50), 0.025, 600);
    crackle(0.01);
    // a little music box
    const scale = [72, 74, 76, 79, 81, 84, 86];
    timer = window.setInterval(() => { if (Math.random() < 0.55 && !muted) tone({ type: 'triangle', f0: NOTE(scale[Math.floor(Math.random() * scale.length)]), dur: 1.0, vol: 0.025, dest: g }); }, 380);
  } else if (kind === 'duel') {
    pad(NOTE(33), 0.06, 300); pad(NOTE(40), 0.04, 360); pad(NOTE(45), 0.02, 520);
    timer = window.setInterval(() => { if (!muted) { tone({ f0: 55, f1: 45, dur: 0.5, vol: 0.05, dest: g }); } }, 1600);
  }
  amb = { nodes, gain: g, timer };
}
