// Pooled point-sprite particles. One draw call per system; updated on the CPU.
import * as THREE from 'three';

export interface Emit {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  color: THREE.Color | string | number;
  size: number;
  sizeEnd?: number;
  life: number;
  alpha?: number;
  drag?: number;
  gravity?: number;
  spin?: number;
  jitter?: number;
}

const VERT = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aRot;
  varying float vAlpha; varying vec3 vColor; varying float vRot;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha; vColor = aColor; vRot = aRot;
  }
`;
const FRAG = /* glsl */`
  uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor; varying float vRot;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p + 0.5;
    vec4 t = texture2D(uMap, p);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

export class Particles {
  points: THREE.Points;
  max: number;
  count = 0;
  pos: Float32Array; vel: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array; rot: Float32Array;
  life: Float32Array; maxLife: Float32Array; s0: Float32Array; s1: Float32Array; a0: Float32Array; drag: Float32Array; grav: Float32Array; spin: Float32Array; jit: Float32Array;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  private tmp = new THREE.Color();

  constructor(max: number, map: THREE.Texture, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.rot = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.spin = new Float32Array(max); this.jit = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 300 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  setScale(viewportHeight: number, fov: number) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
  }

  emit(e: Emit) {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else { // recycle the oldest-looking particle
      i = Math.floor(Math.random() * this.max);
    }
    this.pos[i * 3] = e.x; this.pos[i * 3 + 1] = e.y; this.pos[i * 3 + 2] = e.z;
    this.vel[i * 3] = e.vx || 0; this.vel[i * 3 + 1] = e.vy || 0; this.vel[i * 3 + 2] = e.vz || 0;
    this.tmp.set(e.color as THREE.ColorRepresentation);
    this.col[i * 3] = this.tmp.r; this.col[i * 3 + 1] = this.tmp.g; this.col[i * 3 + 2] = this.tmp.b;
    this.life[i] = e.life; this.maxLife[i] = e.life;
    this.s0[i] = e.size; this.s1[i] = e.sizeEnd ?? e.size * 0.2;
    this.a0[i] = e.alpha ?? 1; this.drag[i] = e.drag ?? 1.2; this.grav[i] = e.gravity ?? 0;
    this.spin[i] = e.spin ?? 0; this.rot[i] = Math.random() * 6.28; this.jit[i] = e.jitter ?? 0;
    this.size[i] = e.size; this.alpha[i] = this.a0[i];
  }

  // Emit a burst of particles radiating from a point.
  burst(x: number, y: number, z: number, n: number, color: THREE.ColorRepresentation, speed: number, size: number, life: number, o: Partial<Emit> = {}) {
    for (let k = 0; k < n; k++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.emit({
        x, y, z, vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.abs(Math.cos(ph)) * sp * 0.9 + (o.vy || 0), vz: Math.sin(ph) * Math.sin(th) * sp,
        color, size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.6), drag: o.drag ?? 2.4, gravity: o.gravity ?? -2, sizeEnd: o.sizeEnd, alpha: o.alpha, spin: o.spin, jitter: o.jitter,
      });
    }
  }

  update(dt: number) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      if (this.jit[i]) { this.vel[i * 3] += (Math.random() - 0.5) * this.jit[i] * dt; this.vel[i * 3 + 2] += (Math.random() - 0.5) * this.jit[i] * dt; }
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = this.a0[i] * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha', 'aRot']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }

  private copy(from: number, to: number) {
    for (let c = 0; c < 3; c++) {
      this.pos[to * 3 + c] = this.pos[from * 3 + c]; this.vel[to * 3 + c] = this.vel[from * 3 + c]; this.col[to * 3 + c] = this.col[from * 3 + c];
    }
    this.size[to] = this.size[from]; this.alpha[to] = this.alpha[from]; this.rot[to] = this.rot[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from]; this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from]; this.spin[to] = this.spin[from]; this.jit[to] = this.jit[from];
  }
}

// A camera-facing ribbon that follows a moving point: projectile trails and lightning.
export class Ribbon {
  mesh: THREE.Mesh;
  pts: THREE.Vector3[] = [];
  max: number;
  width: number;
  geo: THREE.BufferGeometry;
  pos: Float32Array;
  alpha: Float32Array;
  color: THREE.Color;
  fade = 1;

  constructor(max: number, width: number, color: THREE.ColorRepresentation, map?: THREE.Texture) {
    this.max = max; this.width = width; this.color = new THREE.Color(color);
    this.pos = new Float32Array(max * 2 * 3);
    this.alpha = new Float32Array(max * 2);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(max * 2 * 2);
    for (let i = 0; i < max; i++) { uv[i * 4] = i / (max - 1); uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / (max - 1); uv[i * 4 + 3] = 1; }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uFade: { value: 1 }, uMap: { value: map || null }, uHasMap: { value: map ? 1 : 0 } },
      vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv; void main(){ vA=aAlpha; vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; uniform float uFade; varying float vA; varying vec2 vUv;
        void main(){ float e = 1.0 - abs(vUv.y - 0.5) * 2.0; e = smoothstep(0.0, 0.9, e);
          vec3 core = mix(uColor, vec3(1.0), smoothstep(0.55, 1.0, e) * 0.8);
          gl_FragColor = vec4(core * 1.6, e * vA * uFade); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  push(p: THREE.Vector3) {
    this.pts.unshift(p.clone());
    if (this.pts.length > this.max) this.pts.pop();
  }

  setPoints(pts: THREE.Vector3[]) { this.pts = pts.slice(0, this.max); }

  update(camera: THREE.Camera) {
    const n = this.pts.length;
    const camPos = camera.position;
    const side = new THREE.Vector3(), tan = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i < this.max; i++) {
      const p = this.pts[Math.min(i, n - 1)] || new THREE.Vector3();
      const q = this.pts[Math.min(i + 1, n - 1)] || p;
      const r = this.pts[Math.max(i - 1, 0)] || p;
      tan.subVectors(r, q); if (tan.lengthSq() < 1e-8) tan.set(1, 0, 0);
      view.subVectors(camPos, p);
      side.crossVectors(tan, view).normalize();
      const t = i / (this.max - 1);
      const w = this.width * (1 - t) * (i < n ? 1 : 0);
      this.pos[i * 6] = p.x + side.x * w; this.pos[i * 6 + 1] = p.y + side.y * w; this.pos[i * 6 + 2] = p.z + side.z * w;
      this.pos[i * 6 + 3] = p.x - side.x * w; this.pos[i * 6 + 4] = p.y - side.y * w; this.pos[i * 6 + 5] = p.z - side.z * w;
      const a = i < n ? (1 - t) : 0;
      this.alpha[i * 2] = a; this.alpha[i * 2 + 1] = a;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uFade.value = this.fade;
  }

  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
