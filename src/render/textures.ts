// Procedural canvas textures: nothing is downloaded, everything is painted at start-up.
import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

export function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

// value noise for organic surfaces
function makeNoise(seed: number) {
  const rng = mulberry32(seed);
  const P = 256, g = new Float32Array(P * P);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x: number, y: number) => g[((y & (P - 1)) * P) + (x & (P - 1))];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const n = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number, oct = 4) => {
    let s = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { s += n(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
    return s;
  };
}

// Turn a greyscale height canvas into a tangent-space normal map.
export function heightToNormal(src: HTMLCanvasElement, strength = 2): THREE.CanvasTexture {
  const w = src.width, h = src.height;
  const sx = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, x] = canvas(w, h);
  const out = x.createImageData(w, h);
  const H = (i: number, j: number) => sx[(((j + h) % h) * w + ((i + w) % w)) * 4] / 255;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (H(i + 1, j) - H(i - 1, j)) * strength, dy = (H(i, j + 1) - H(i, j - 1)) * strength;
    const nz = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const k = (j * w + i) * 4;
    out.data[k] = (-dx * nz * 0.5 + 0.5) * 255; out.data[k + 1] = (dy * nz * 0.5 + 0.5) * 255; out.data[k + 2] = nz * 255; out.data[k + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  const t = tex(c, false, true);
  return t;
}

export function glowTex(): THREE.Texture {
  return cached('glow', () => {
    const [c, x] = canvas(128);
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return tex(c, false);
  });
}

export function sparkTex(): THREE.Texture {
  return cached('spark', () => {
    const [c, x] = canvas(128);
    x.translate(64, 64);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 20);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(-64, -64, 128, 128);
    x.globalCompositeOperation = 'lighter';
    for (const r of [0, Math.PI / 2]) {
      x.save(); x.rotate(r);
      const l = x.createLinearGradient(-64, 0, 64, 0);
      l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.5, 'rgba(255,255,255,.9)'); l.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = l; x.fillRect(-64, -2, 128, 4);
      x.restore();
    }
    return tex(c, false);
  });
}

export function smokeTex(): THREE.Texture {
  return cached('smoke', () => {
    const [c, x] = canvas(128);
    const noise = makeNoise(17);
    const img = x.createImageData(128, 128);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
      const dx = (i - 64) / 64, dy = (j - 64) / 64, d = Math.sqrt(dx * dx + dy * dy);
      const n = noise(i / 22, j / 22, 4);
      const a = Math.max(0, 1 - d) ** 1.6 * (0.45 + n * 0.9);
      const k = (j * 128 + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.min(255, a * 255);
    }
    x.putImageData(img, 0, 0);
    return tex(c, false);
  });
}

export function ringTex(): THREE.Texture {
  return cached('ring', () => {
    const [c, x] = canvas(256);
    const g = x.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.72, 'rgba(255,255,255,.0)');
    g.addColorStop(0.86, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return tex(c, false);
  });
}

const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
export function runeCircleTex(detail = 1): THREE.Texture {
  return cached('runes' + detail, () => {
    const S = 1024;
    const [c, x] = canvas(S);
    x.translate(S / 2, S / 2);
    x.strokeStyle = 'rgba(255,255,255,1)';
    const ring = (r: number, w: number) => { x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); };
    ring(500, 6); ring(470, 3); ring(330, 4); ring(300, 2); ring(120, 3);
    x.font = '44px serif'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 0; i < 36; i++) {
      x.save(); x.rotate((i / 36) * Math.PI * 2); x.fillText(RUNES[i % RUNES.length], 0, -400); x.restore();
    }
    // star polygon
    x.lineWidth = 3;
    const pts = 7;
    x.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i * 3 / pts) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * 300, py = Math.sin(a) * 300;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
    if (detail > 1) {
      x.font = '28px serif';
      for (let i = 0; i < 24; i++) { x.save(); x.rotate((i / 24) * Math.PI * 2 + 0.1); x.fillText(RUNES[(i * 7) % RUNES.length], 0, -215); x.restore(); }
    }
    return tex(c, false);
  });
}

export function sigilTex(seed: number): THREE.Texture {
  return cached('sigil' + seed, () => {
    const [c, x] = canvas(128);
    const rng = mulberry32(seed);
    x.translate(64, 64); x.strokeStyle = '#fff'; x.lineWidth = 5; x.lineCap = 'round';
    x.beginPath(); x.arc(0, 0, 52, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      x.beginPath();
      const a = rng() * Math.PI * 2, b = a + Math.PI * (0.5 + rng());
      x.moveTo(Math.cos(a) * 38, Math.sin(a) * 38);
      x.quadraticCurveTo((rng() - 0.5) * 50, (rng() - 0.5) * 50, Math.cos(b) * 38, Math.sin(b) * 38);
      x.stroke();
    }
    return tex(c, false);
  });
}

// Flagstones for the duel arena and shop floor.
export function flagstones(seed: number, base: [number, number, number], size = 1024, cells = 6): { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const key = `flag${seed}:${base.join(',')}:${size}:${cells}`;
  const hit = cache.get(key);
  if (hit) return { map: hit, normal: cache.get(key + 'n')!, rough: cache.get(key + 'r')! };
  const rng = mulberry32(seed);
  const noise = makeNoise(seed + 5);
  const [c, x] = canvas(size);
  const [hc, hx] = canvas(size);
  const [rc, rx] = canvas(size);
  const img = x.createImageData(size, size), him = hx.createImageData(size, size), rim = rx.createImageData(size, size);
  // irregular stones: jittered grid with running bond
  const cell = size / cells;
  const tone: number[] = [];
  for (let i = 0; i < cells * cells * 2; i++) tone.push(0.75 + rng() * 0.4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const row = Math.floor(j / cell);
    const off = (row % 2) * cell * 0.5;
    const col = Math.floor((i + off) / cell);
    const lx = ((i + off) % cell) / cell, ly = (j % cell) / cell;
    const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
    const n = noise(i / 40, j / 40, 5);
    const n2 = noise(i / 6, j / 6, 2);
    const grout = edge < 0.035 + n * 0.02 ? 1 : 0;
    const bevel = Math.min(1, edge / 0.08);
    const t = tone[(row * cells + col) % tone.length] * (0.8 + n * 0.4) * (0.92 + n2 * 0.16);
    const k = (j * size + i) * 4;
    const dark = grout ? 0.35 : 1;
    img.data[k] = Math.min(255, base[0] * t * dark); img.data[k + 1] = Math.min(255, base[1] * t * dark); img.data[k + 2] = Math.min(255, base[2] * t * dark); img.data[k + 3] = 255;
    const hgt = grout ? 0.1 : (0.55 + bevel * 0.3 + n2 * 0.15);
    him.data[k] = him.data[k + 1] = him.data[k + 2] = hgt * 255; him.data[k + 3] = 255;
    const r = grout ? 0.95 : 0.6 + n * 0.3;
    rim.data[k] = rim.data[k + 1] = rim.data[k + 2] = r * 255; rim.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0); hx.putImageData(him, 0, 0); rx.putImageData(rim, 0, 0);
  const map = tex(c, true, true), normal = heightToNormal(hc, 3), rough = tex(rc, false, true);
  cache.set(key, map); cache.set(key + 'n', normal); cache.set(key + 'r', rough);
  return { map, normal, rough };
}

export function woodTex(seed: number, base: [number, number, number], w = 512, h = 512, grain = 1): THREE.Texture {
  return cached(`wood${seed}:${base}:${w}:${grain}`, () => {
    const noise = makeNoise(seed);
    const [c, x] = canvas(w, h);
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = noise(i / 90, j / 8 * grain, 5);
      const ring = 0.5 + 0.5 * Math.sin((n * 18 + i / 40) * 1.2);
      const t = 0.7 + ring * 0.25 + noise(i / 3, j / 30, 2) * 0.12;
      const k = (j * w + i) * 4;
      img.data[k] = base[0] * t; img.data[k + 1] = base[1] * t; img.data[k + 2] = base[2] * t; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c, true, true);
  });
}

export function plasterTex(seed: number, base: [number, number, number]): THREE.Texture {
  return cached(`plaster${seed}:${base}`, () => {
    const noise = makeNoise(seed);
    const S = 512;
    const [c, x] = canvas(S);
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = noise(i / 60, j / 60, 5), m = noise(i / 7, j / 7, 2);
      const t = 0.75 + n * 0.35 + m * 0.08;
      const k = (j * S + i) * 4;
      img.data[k] = base[0] * t; img.data[k + 1] = base[1] * t; img.data[k + 2] = base[2] * t; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // courses of stone blocks
    x.strokeStyle = 'rgba(0,0,0,.28)'; x.lineWidth = 3;
    for (let r = 0; r < 8; r++) {
      x.beginPath(); x.moveTo(0, r * 64); x.lineTo(S, r * 64); x.stroke();
      for (let q = 0; q < 5; q++) { const px = q * 128 + (r % 2) * 64; x.beginPath(); x.moveTo(px, r * 64); x.lineTo(px, r * 64 + 64); x.stroke(); }
    }
    return tex(c, true, true);
  });
}

export function rugTex(): THREE.Texture {
  return cached('rug', () => {
    const [c, x] = canvas(256, 1024);
    const noise = makeNoise(3);
    x.fillStyle = '#5a1c26'; x.fillRect(0, 0, 256, 1024);
    x.strokeStyle = '#c9a13b'; x.lineWidth = 6; x.strokeRect(14, 14, 228, 996);
    x.strokeStyle = '#2a0e14'; x.lineWidth = 16; x.strokeRect(32, 32, 192, 960);
    x.fillStyle = 'rgba(201,161,59,.55)';
    for (let i = 0; i < 9; i++) {
      const cy = 100 + i * 103;
      x.beginPath(); x.moveTo(128, cy - 40); x.lineTo(168, cy); x.lineTo(128, cy + 40); x.lineTo(88, cy); x.closePath(); x.fill();
      x.fillStyle = 'rgba(74,163,150,.5)'; x.beginPath(); x.arc(128, cy, 10, 0, Math.PI * 2); x.fill(); x.fillStyle = 'rgba(201,161,59,.55)';
    }
    const img = x.getImageData(0, 0, 256, 1024);
    for (let j = 0; j < 1024; j++) for (let i = 0; i < 256; i++) {
      const k = (j * 256 + i) * 4, t = 0.8 + noise(i / 2, j / 2, 2) * 0.35;
      img.data[k] *= t; img.data[k + 1] *= t; img.data[k + 2] *= t;
    }
    x.putImageData(img, 0, 0);
    return tex(c);
  });
}

// A tileable noise texture for shader effects (fields, fire, frost).
export function noiseTex(): THREE.Texture {
  return cached('noise', () => {
    const S = 256;
    const [c, x] = canvas(S);
    const img = x.createImageData(S, S);
    const n1 = makeNoise(41), n2 = makeNoise(77), n3 = makeNoise(99);
    // tileable by sampling a torus-ish mix
    const tile = (f: (a: number, b: number, o: number) => number, i: number, j: number, sc: number) => {
      const u = i / S, v = j / S;
      const a = f(u * sc, v * sc, 4), b = f((u - 1) * sc, v * sc, 4), c2 = f(u * sc, (v - 1) * sc, 4), d = f((u - 1) * sc, (v - 1) * sc, 4);
      return (a * (1 - u) * (1 - v) + b * u * (1 - v) + c2 * (1 - u) * v + d * u * v);
    };
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const k = (j * S + i) * 4;
      img.data[k] = tile(n1, i, j, 8) * 255; img.data[k + 1] = tile(n2, i, j, 16) * 255; img.data[k + 2] = tile(n3, i, j, 4) * 255; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = tex(c, false, true);
    return t;
  });
}

export function parchmentTex(): THREE.Texture {
  return cached('parchment', () => {
    const S = 512;
    const [c, x] = canvas(S);
    const noise = makeNoise(9);
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = noise(i / 50, j / 50, 5);
      const e = Math.min(i, j, S - i, S - j) / S;
      const t = 0.82 + n * 0.25 - Math.max(0, 0.08 - e) * 3;
      const k = (j * S + i) * 4;
      img.data[k] = 236 * t; img.data[k + 1] = 222 * t; img.data[k + 2] = 186 * t; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.fillStyle = 'rgba(60,40,30,.55)';
    for (let r = 0; r < 14; r++) x.fillRect(40 + (r % 3) * 6, 50 + r * 30, 380 - (r * 37) % 120, 3);
    return tex(c);
  });
}

export function leatherTex(color: [number, number, number]): THREE.Texture {
  return cached(`leather:${color}`, () => {
    const S = 256;
    const [c, x] = canvas(S);
    const noise = makeNoise(21);
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = noise(i / 12, j / 12, 4), m = noise(i / 2.5, j / 2.5, 2);
      const t = 0.7 + n * 0.3 + m * 0.12;
      const k = (j * S + i) * 4;
      img.data[k] = color[0] * t; img.data[k + 1] = color[1] * t; img.data[k + 2] = color[2] * t; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c, true, true);
  });
}

export function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}
