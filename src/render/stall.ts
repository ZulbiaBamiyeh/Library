// A hidden shop somewhere deep in the stacks: a low table, three wares on cushions, and whoever keeps it.
import * as THREE from 'three';
import { ARTIFACTS, REAGENTS, RARITY } from '../data/artifacts';
import type { ShopItem } from '../game/run';
import type { StallDef } from '../data/stalls';
import { glowSprite, makeArtifactModel, makeUnit } from './models';
import { woodTex } from './textures';

interface Ware { root: THREE.Group; model: THREE.Group | null; ring: THREE.Mesh; pick: THREE.Mesh; item: ShopItem | null; spin: number; lift: number; bought: number; staff: boolean }

export class Stall {
  group = new THREE.Group();
  wares: Ware[] = [];
  keeper: THREE.Group;
  hover = -1;
  private lamp: THREE.Sprite;
  private sold = 0;
  private base = 0;

  constructor(M: StallDef, flame: string) {
    const d = M.d;
    const g = this.group;
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(21 + d, [70, 46, 32], 256, 512, 1), roughness: 0.8 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.9), wood); top.position.set(0, 0.86, 0.3); g.add(top);
    for (const [x, z] of [[-1.1, -0.05], [1.1, -0.05], [-1.1, 0.65], [1.1, 0.65]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08), wood); leg.position.set(x, 0.43, z); g.add(leg); }
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.02), new THREE.MeshStandardMaterial({ color: M.cloth, roughness: 1 }));
    cloth.position.set(0, 0.62, 0.76); g.add(cloth);
    this.keeper = makeUnit(M.unit, M.tint);
    // small keepers stand on a crate behind the table so they can see over it
    if (M.lift) { const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, M.lift, 0.8), wood); crate.position.set(0, M.lift / 2, -0.75); g.add(crate); }
    this.keeper.scale.setScalar(M.scale); this.keeper.position.set(0, M.lift || 0, -0.75); g.add(this.keeper);
    this.base = M.lift || 0;
    // a lamp on the table
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#2a2018', metalness: 0.7, roughness: 0.4 }));
    lamp.position.set(0.95, 1.05, 0.05); g.add(lamp);
    this.lamp = glowSprite(flame, 0.9, 0.8); this.lamp.position.set(0.95, 1.3, 0.05); g.add(this.lamp);
    [-0.7, 0, 0.7].forEach(x => {
      const root = new THREE.Group(); root.position.set(x, 0.9, 0.38); g.add(root);
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.08, 18), new THREE.MeshStandardMaterial({ color: M.cloth, roughness: 1 }));
      cushion.position.y = 0.04; root.add(cushion);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.36, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; root.add(ring);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.7), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = 0.45; root.add(pick);
      this.wares.push({ root, model: null, ring, pick, item: null, spin: x * 3, lift: 0, bought: 0, staff: false });
    });
  }

  setStock(items: ShopItem[]) {
    this.wares.forEach((w, i) => {
      if (w.model) { w.root.remove(w.model); w.model = null; }
      const it = items[i] || null;
      w.item = it; w.bought = 0;
      w.root.visible = !!it;
      if (!it) return;
      const spec = it.kind === 'art' ? ARTIFACTS[it.id].model : REAGENTS[it.id].model;
      const m = makeArtifactModel(spec);
      w.staff = spec.kind.startsWith('staff');
      if (w.staff) { m.scale.setScalar(0.5); m.rotation.z = 0.25; } else m.scale.setScalar(1.0);
      w.model = m; w.root.add(m);
      (w.ring.material as THREE.MeshBasicMaterial).color.set(it.kind === 'art' ? RARITY[ARTIFACTS[it.id].rarity].color : '#8fc8ff');
      m.visible = !it.sold;
    });
  }

  pickRay(rc: THREE.Raycaster): { i: number; dist: number } | null {
    const live = this.wares.filter(w => w.item && !w.item.sold);
    const hits = rc.intersectObjects(live.map(w => w.pick), false);
    if (!hits.length) return null;
    return { i: this.wares.findIndex(w => w.pick === hits[0].object), dist: hits[0].distance };
  }

  // Where a ware sits in the world (for its price tag and the sparkle when it sells).
  worldPos(i: number, out = new THREE.Vector3()) { return this.wares[i].root.localToWorld(out.set(0, -0.02, 0.36)); }

  markSold(i: number) { const w = this.wares[i]; if (w?.model) { w.bought = 0.001; this.sold = 1; } }

  update(dt: number, time: number, eye: THREE.Vector3) {
    this.wares.forEach((w, i) => {
      if (!w.model) return;
      w.lift += ((i === this.hover ? 1 : 0) - w.lift) * Math.min(1, dt * 8);
      w.spin += dt * (0.4 + w.lift * 1.5);
      w.model.rotation.y = w.spin;
      w.model.position.y = (w.staff ? 0.08 : 0.4) + w.lift * 0.15 + Math.sin(time * 1.4 + i) * 0.025;
      (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + w.lift * 0.5 + Math.sin(time * 2 + i) * 0.08;
      if (w.bought > 0) {
        w.bought += dt;
        const k = Math.min(1, w.bought / 0.6);
        w.model.scale.setScalar((w.staff ? 0.5 : 1) * (1 - k));
        w.model.position.y += k * 0.8;
        if (k >= 1) { w.model.visible = false; w.bought = 0; }
      }
    });
    // the keeper turns to watch you, and bows a little after a sale
    const local = this.group.worldToLocal(eye.clone());
    const want = Math.atan2(local.x - this.keeper.position.x, local.z - this.keeper.position.z);
    this.keeper.rotation.y += (Math.max(-0.9, Math.min(0.9, want)) - this.keeper.rotation.y) * Math.min(1, dt * 2);
    this.sold = Math.max(0, this.sold - dt * 0.8);
    this.keeper.rotation.x = Math.sin(this.sold * Math.PI) * 0.25;
    this.keeper.position.y = this.base + Math.sin(time * 1.3) * 0.02;
    this.lamp.scale.setScalar(0.9 + Math.sin(time * 9) * 0.05);
  }
}
