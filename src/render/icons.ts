// Renders curio models into small images for the interface, once each, then caches them.
import * as THREE from 'three';
import { ARTIFACTS, REAGENTS, type ModelSpec } from '../data/artifacts';
import { makeArtifactModel } from './models';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera;
const cache = new Map<string, string>();

function setup() {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  renderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(160, 160, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff4e0', '#3a2a40', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight('#9fe3d6', 1.4); rim.position.set(-3, 1, -2); scene.add(rim);
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
}

function render(key: string, spec: ModelSpec): string {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (!renderer) setup();
    const m = makeArtifactModel(spec);
    const staff = spec.kind.startsWith('staff');
    const holder = new THREE.Group(); holder.add(m); scene.add(holder);
    if (staff) {
      // show the head of the staff, tilted
      m.position.y = -1.5; holder.rotation.z = -0.55;
      camera.position.set(0.05, 0.2, 1.05); camera.lookAt(0.05, 0.05, 0);
    } else {
      holder.rotation.y = 0.5;
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      m.position.sub(center);
      camera.position.set(0, size * 0.25, size * 1.55); camera.lookAt(0, 0, 0);
    }
    renderer!.render(scene, camera);
    const url = renderer!.domElement.toDataURL('image/png');
    scene.remove(holder);
    holder.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); });
    cache.set(key, url);
    return url;
  } catch {
    return '';
  }
}

export function artifactIcon(id: string): string {
  const a = ARTIFACTS[id];
  return a ? render('a:' + id, a.model) : '';
}
export function reagentIcon(id: string): string {
  const r = REAGENTS[id];
  return r ? render('r:' + id, r.model) : '';
}
