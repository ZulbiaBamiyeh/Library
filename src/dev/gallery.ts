// Dev-only: every model laid out on a grid, for eyeballing.
import * as THREE from 'three';
import { Engine } from '../render/engine';
import { ARTIFACT_LIST, REAGENT_LIST } from '../data/artifacts';
import { makeArtifactModel, makeMage, makeUnit, makeSheep, makeIceBlock, setMageStaff } from '../render/models';

const which = new URLSearchParams(location.search).get('set') || 'units';
const engine = new Engine(document.getElementById('gl') as HTMLCanvasElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1624');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight('#a8a0c8', '#2a2018', 1.2));
const key = new THREE.DirectionalLight('#ffe0c0', 2.5); key.position.set(3, 6, 5); key.castShadow = true; scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#2a2430' }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const items: THREE.Object3D[] = [];
if (which === 'units') {
  const p = makeMage('#2a4a7a', '#c9a13b', '#7fe0ff', 'pointed'); setMageStaff(p, ARTIFACT_LIST[1].model); items.push(p.root);
  const e = makeMage('#6a1a2a', '#b0b0b8', '#ff5070', 'hood'); setMageStaff(e, ARTIFACT_LIST[7].model); items.push(e.root);
  for (const k of ['imp', 'skeleton', 'treant', 'rat', 'salamander', 'ball', 'cherub', 'pitlord', 'frostlich', 'worldroot', 'sapling', 'decoy', 'egg', 'phoenix', 'snowman', 'leech', 'hydra', 'tesla', 'stormspire', 'clone', 'golem', 'seraph', 'statue', 'mimic', 'bookworm', 'author', 'thing']) items.push(makeUnit(k, null));
  items.push(makeSheep()); const ice = new THREE.Group(); ice.add(makeIceBlock()); items.push(ice);
  camera.position.set(0, 6, 15); camera.lookAt(0, 0.2, -1.5);
} else {
  const list = which === 'staves' ? ARTIFACT_LIST.filter(a => a.slot === 'staff').map(a => a.model) : ARTIFACT_LIST.filter(a => a.slot === 'trinket').map(a => a.model).concat(REAGENT_LIST.map(r => r.model));
  for (const m of list) { const o = makeArtifactModel(m); if (which !== 'staves') { o.scale.setScalar(2.2); o.position.y = 0.6; } const g = new THREE.Group(); g.add(o); items.push(g); }
  camera.position.set(0, which === 'staves' ? 2.2 : 5, which === 'staves' ? 5.5 : 12); camera.lookAt(0, which === 'staves' ? 0.9 : 0.4, 0);
}
const cols = which === "units" ? 8 : which === "staves" ? 10 : 9;
const sp = which === "staves" ? 0.55 : 2.1;
items.forEach((o, i) => { const c = i % cols, r = Math.floor(i / cols); o.position.x = (c - (cols - 1) / 2) * sp; o.position.z = -r * (which === "staves" ? 1 : 2.6); scene.add(o); });
engine.setView({ scene, camera, update: () => {}, bloom: { strength: 0.7, radius: 0.4, threshold: 0.85 } });
let last = performance.now();
function frame(now: number) { const dt = Math.min(0.05, (now - last) / 1000); last = now; engine.frame(dt, now / 1000); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
