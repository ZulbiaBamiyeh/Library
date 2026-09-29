// One WebGL renderer and post-processing chain shared by every scene.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { quality, Q } from './quality';

export interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, time: number): void;
  bloom?: { strength: number; radius: number; threshold: number };
  exposure?: number;
  vignette?: number;
  onResize?(w: number, h: number): void;
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
    uFlash: { value: new THREE.Vector4(0, 0, 0, 0) },
    uAberr: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform vec4 uFlash; uniform float uAberr;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.1) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      vec4 c;
      if (uAberr > 0.0) {
        vec2 o = d * uAberr * 0.012;
        c = vec4(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b, 1.0);
      } else c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)) * uVignette);
      c.rgb *= mix(0.55, 1.0, v);
      c.rgb += uFlash.rgb * uFlash.a * (1.0 - v * 0.6);
      c.rgb += (hash(vUv * 900.0) - 0.5) * 0.025;
      gl_FragColor = c;
    }
  `,
};

export class Engine {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  final: ShaderPass;
  view: View | null = null;
  flash = new THREE.Vector4(0, 0, 0, 0);
  aberr = 0;
  pixelRatio: number;
  onQualityDrop?: (level: number) => void;
  private qLevel = -1;
  private fps = { t: 0, frames: 0, slow: 0, warm: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.pixelRatio = Q.pixelRatio(quality.level);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(size, 0.8, 0.5, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setView(v: View) {
    this.view = v;
    this.renderPass.scene = v.scene;
    this.renderPass.camera = v.camera;
    const b = v.bloom || { strength: 0.8, radius: 0.5, threshold: 0.8 };
    this.bloom.strength = b.strength; this.bloom.radius = b.radius; this.bloom.threshold = b.threshold;
    this.renderer.toneMappingExposure = v.exposure ?? 1.0;
    this.final.uniforms.uVignette.value = v.vignette ?? 0.9;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    if (this.view) {
      this.view.camera.aspect = w / h;
      this.view.camera.updateProjectionMatrix();
      this.view.onResize?.(w, h);
    }
  }

  // A brief full-screen flash in a colour, used for big hits and reactions.
  pulse(color: THREE.ColorRepresentation, strength = 0.35) {
    const c = new THREE.Color(color);
    this.flash.set(c.r, c.g, c.b, Math.max(this.flash.w, strength));
  }

  // Apply the quality level: resolution, anti-aliasing and bloom.
  private applyQuality() {
    const lv = quality.level;
    this.qLevel = lv;
    this.pixelRatio = Q.pixelRatio(lv);
    this.renderer.setPixelRatio(this.pixelRatio);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { if (rt.samples !== Q.samples(lv)) { rt.samples = Q.samples(lv); rt.dispose(); } }
    this.bloom.enabled = Q.bloom(lv);
    this.resize();
  }

  // In auto mode, a frame rate that stays under ~35 for a few seconds drops the quality a level.
  private watchFps(dt: number) {
    if (quality.mode !== 'auto' || quality.level === 0) return;
    const f = this.fps;
    f.warm += dt;
    if (f.warm < 4) return; // let shaders compile first
    f.t += dt; f.frames++;
    if (f.t < 2) return;
    const fps = f.frames / f.t;
    f.t = 0; f.frames = 0;
    f.slow = fps < 35 ? f.slow + 1 : 0;
    if (f.slow >= 2) { f.slow = 0; f.warm = 0; quality.level--; this.onQualityDrop?.(quality.level); }
  }

  frame(dt: number, time: number) {
    if (!this.view) return;
    if (this.qLevel !== quality.level) this.applyQuality();
    this.watchFps(dt);
    this.view.update(dt, time);
    // views may change their exposure and vignette as you move (the library darkens as you go down)
    if (this.view.exposure !== undefined) this.renderer.toneMappingExposure = this.view.exposure;
    if (this.view.vignette !== undefined) this.final.uniforms.uVignette.value = this.view.vignette;
    this.flash.w = Math.max(0, this.flash.w - dt * 2.2);
    this.aberr = Math.max(0, this.aberr - dt * 3);
    this.final.uniforms.uTime.value = time;
    this.final.uniforms.uFlash.value.copy(this.flash);
    this.final.uniforms.uAberr.value = this.aberr;
    this.composer.render(dt);
  }
}
