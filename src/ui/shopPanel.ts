// Buying and managing curios, in the Curio Shop behind the Reading Room or at a hidden stall in the depths.
// Shop -1 is the Curio Shop; any other number is the floor a hidden stall is on.
import * as THREE from 'three';
import { app } from './app';
import { $, artSlotHtml, artifactCard, closeModal, esc, goldHtml, reagentCard, showModal, toast } from './dom';
import { run, saveRun, priceOf, sellPrice, rerollPrice, rollStock, secretStock, type ShopItem } from '../game/run';
import { ARTIFACTS, RARITY, REAGENTS } from '../data/artifacts';
import { reagentIcon } from '../render/icons';
import { play } from '../audio/sfx';

const STASH_MAX = 4;

export function stockOf(shop: number): ShopItem[] { return shop === -1 ? run!.shop.stock : secretStock(run!, shop); }

// Put this round's wares on the counter and on every stall.
export function stockShops() {
  const r = run!, lib = app.library;
  app.shop.setStock(r.shop.stock);
  for (const k in lib.stalls) lib.stalls[k].setStock(secretStock(r, +k));
}

function hasRoom(slot: 'staff' | 'trinket'): boolean {
  const r = run!;
  if (slot === 'staff') return !r.staff || r.stash.length < STASH_MAX;
  return r.trinkets.some(t => !t) || r.stash.length < STASH_MAX;
}

let onChange: () => void = () => {};
export function setShopChanged(f: () => void) { onChange = f; }

function buy(shop: number, i: number) {
  const r = run!;
  const it = stockOf(shop)[i];
  const price = priceOf(it);
  if (it.sold) return;
  if (r.gold < price) { closeModal(); return; }
  if (it.kind === 'reagent') {
    r.reagents.push(it.id);
  } else {
    const a = ARTIFACTS[it.id];
    if (!hasRoom(a.slot)) { closeModal(); toast('No room: sell or stash something first.'); return; }
    if (a.slot === 'staff') {
      if (r.staff) r.stash.push(r.staff);
      r.staff = it.id;
    } else {
      const free = r.trinkets.findIndex(t => !t);
      if (free >= 0) r.trinkets[free] = it.id; else r.stash.push(it.id);
    }
  }
  r.gold -= price;
  it.sold = true;
  if (it.id === 'candlestub' && r.trinkets.includes('candlestub')) r.lib.candles++; // its candle is lit at once
  saveRun();
  closeModal();
  if (shop === -1) app.shop.markSold(i);
  else {
    const st = app.library.stalls[shop];
    st.markSold(i);
    const p = st.worldPos(i);
    app.library.embers.burst(p.x, p.y + 0.4, p.z, 50, '#ffe7a0', 2.5, 0.1, 1, { gravity: 0.5 });
  }
  play('coin');
  const name = it.kind === 'art' ? ARTIFACTS[it.id].name : REAGENTS[it.id].name;
  toast(`${name} is yours.`, true);
  onChange();
}

export function openWare(shop: number, i: number) {
  const r = run!;
  const it = stockOf(shop)[i];
  if (!it || it.sold) return;
  const price = priceOf(it);
  const card = it.kind === 'art' ? artifactCard(it.id) : reagentCard(it.id);
  const room = it.kind === 'reagent' || hasRoom(ARTIFACTS[it.id].slot);
  const where = it.kind === 'art' ? (ARTIFACTS[it.id].slot === 'staff' ? (r.staff ? `Replaces your ${ARTIFACTS[r.staff].name}, which goes to your stash.` : 'Goes straight into your hand.') : (r.trinkets.some(t => !t) ? 'Goes into a free trinket slot.' : 'Your trinket slots are full: it goes to your stash.')) : '';
  showModal(`<div class="sheet" role="dialog" aria-label="Curio">${card}
    ${where ? `<div class="meta" style="margin-top:12px">${esc(where)}</div>` : ''}
    <div class="actions"><button class="btn gold" id="s-buy" ${r.gold >= price && room ? '' : 'disabled'}>Buy for ${price} gold</button><button class="btn quiet" id="s-close">Not today</button></div>
    ${r.gold < price ? `<div class="warn">You have ${r.gold} gold.</div>` : ''}${!room ? '<div class="warn">No room: sell or stash something first.</div>' : ''}</div>`);
  $('#s-buy').onclick = () => buy(shop, i);
  $('#s-close').onclick = closeModal;
}

// Your staff, trinkets, stash and reagents; the Curio Shop can also reroll its counter from here.
export function openGear(shop: number | null) {
  const r = run!;
  const reag: Record<string, number> = {};
  for (const x of r.reagents) reag[x] = (reag[x] || 0) + 1;
  const rp = rerollPrice(r);
  showModal(`<div class="sheet gear-sheet" role="dialog" aria-label="Your curios">
    <h4>Your curios <small>${goldHtml(r.gold)}</small></h4>
    <div class="gear-row">${artSlotHtml(r.staff, { staff: true, label: 'no staff', attr: 'data-eq="staff"' })}${r.trinkets.map((t, i) => artSlotHtml(t, { label: 'trinket', attr: `data-eq="t${i}"` })).join('')}</div>
    <h4>Stash <small>${r.stash.length}/${STASH_MAX} · unequipped</small></h4>
    <div class="gear-row">${r.stash.map((t, i) => artSlotHtml(t, { attr: `data-stash="${i}"` })).join('') || '<span class="dim" style="font-size:13px">Nothing stashed.</span>'}</div>
    ${r.reagents.length ? `<h4>Reagents <small>use at the Binding Desk</small></h4><div class="gear-row">${Object.entries(reag).map(([id, n]) => `<div class="art-slot" title="${esc(REAGENTS[id].name)}"><img alt="" src="${reagentIcon(id)}"><span class="cnt">${n}</span></div>`).join('')}</div>` : ''}
    <div class="actions">${shop === -1 ? `<button class="btn quiet" id="g-reroll" ${r.gold >= rp ? '' : 'disabled'}>Reroll the counter (${rp} gold)</button>` : ''}<button class="btn quiet" id="g-close">Done</button></div></div>`);
  document.querySelectorAll<HTMLButtonElement>('#modal [data-eq]').forEach(b => b.onclick = () => equippedMenu(b.dataset.eq!, shop));
  document.querySelectorAll<HTMLButtonElement>('#modal [data-stash]').forEach(b => b.onclick = () => stashMenu(+b.dataset.stash!, shop));
  $('#g-close').onclick = closeModal;
  const rr = document.getElementById('g-reroll');
  if (rr) rr.onclick = () => {
    const p = rerollPrice(r);
    if (r.gold < p) return;
    r.gold -= p; r.shop.rerolls++;
    r.shop.stock = rollStock(r, r.shop.rerolls);
    saveRun(); app.shop.setStock(r.shop.stock); play('reroll');
    onChange(); openGear(shop);
  };
}

function equippedMenu(slot: string, shop: number | null) {
  const r = run!;
  const id = slot === 'staff' ? r.staff : r.trinkets[+slot.slice(1)];
  if (!id) { toast(r.stash.length ? 'Pick something from your stash to equip it.' : 'Buy a curio to fill this slot.'); return; }
  const sp = sellPrice(id);
  showModal(`<div class="sheet" role="dialog">${artifactCard(id)}
    <div class="actions"><button class="btn" id="e-stash" ${r.stash.length < STASH_MAX ? '' : 'disabled'}>Unequip to stash</button>${shop !== null ? `<button class="btn quiet" id="e-sell">Sell for ${sp} gold</button>` : ''}<button class="btn quiet" id="e-close">Keep it on</button></div></div>`);
  const remove = () => { if (slot === 'staff') r.staff = null; else r.trinkets[+slot.slice(1)] = null; };
  $('#e-stash').onclick = () => { remove(); r.stash.push(id); saveRun(); onChange(); openGear(shop); };
  const sell = document.getElementById('e-sell');
  if (sell) sell.onclick = () => { remove(); r.gold += sp; saveRun(); play('coin'); onChange(); openGear(shop); };
  $('#e-close').onclick = () => openGear(shop);
}

function stashMenu(i: number, shop: number | null) {
  const r = run!;
  const id = r.stash[i];
  const a = ARTIFACTS[id];
  const sp = sellPrice(id);
  const opts = a.slot === 'staff'
    ? `<button class="btn" data-to="staff">Equip${r.staff ? ` (swap with ${esc(ARTIFACTS[r.staff].name)})` : ''}</button>`
    : r.trinkets.map((t, k) => `<button class="btn ${t ? 'quiet' : ''}" data-to="t${k}">${t ? `Swap with ${esc(ARTIFACTS[t].name)}` : `Equip in slot ${k + 1}`}</button>`).join('');
  showModal(`<div class="sheet" role="dialog">${artifactCard(id)}<div class="actions">${opts}${shop !== null ? `<button class="btn quiet" id="x-sell">Sell for ${sp} gold</button>` : ''}<button class="btn quiet" id="x-close">Leave it</button></div></div>`);
  document.querySelectorAll<HTMLButtonElement>('#modal [data-to]').forEach(b => b.onclick = () => {
    const to = b.dataset.to!;
    r.stash.splice(i, 1);
    if (to === 'staff') { if (r.staff) r.stash.push(r.staff); r.staff = id; }
    else { const k = +to.slice(1); if (r.trinkets[k]) r.stash.push(r.trinkets[k]!); r.trinkets[k] = id; }
    saveRun(); onChange(); openGear(shop);
  });
  const sell = document.getElementById('x-sell');
  if (sell) sell.onclick = () => { r.stash.splice(i, 1); r.gold += sp; saveRun(); play('coin'); onChange(); openGear(shop); };
  $('#x-close').onclick = () => openGear(shop);
}

// ----- price tags that float under each ware -----
let tags: HTMLElement[] = [];
let tagShop: number | null = null;

export function paintTags(box: HTMLElement, shop: number | null) {
  tagShop = shop;
  box.innerHTML = '';
  tags = [];
  if (shop === null) return;
  const r = run!;
  tags = stockOf(shop).map(it => {
    const t = document.createElement('div');
    t.className = 'ptag' + (it.sold ? ' sold' : '');
    const name = it.kind === 'art' ? ARTIFACTS[it.id].name : REAGENTS[it.id].name;
    const rar = it.kind === 'art' ? RARITY[ARTIFACTS[it.id].rarity] : { name: 'Reagent', color: '#8fc8ff' };
    const price = priceOf(it);
    t.innerHTML = `<div class="r" style="color:${rar.color}">${rar.name}</div><div class="n">${esc(name)}</div>${it.sold ? '<div class="p">sold</div>' : `<div class="p ${r.gold < price ? 'poor' : ''}"><span class="coin"></span>${price}</div>`}`;
    box.appendChild(t);
    return t;
  });
}

const tmp = new THREE.Vector3();
export function placeTags() {
  if (tagShop === null) return;
  const cam = app.library.camera, eye = app.library.pos;
  tags.forEach((t, i) => {
    if (tagShop === -1) app.shop.slots[i].root.localToWorld(tmp.set(0, -0.02, 0.45));
    else app.library.stalls[tagShop!].worldPos(i, tmp);
    const dist = tmp.distanceTo(eye);
    tmp.project(cam);
    const on = tmp.z < 1 && dist < 7.5 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    t.style.display = on ? '' : 'none';
    if (!on) return;
    t.style.left = (tmp.x * 0.5 + 0.5) * window.innerWidth + 'px'; t.style.top = (-tmp.y * 0.5 + 0.5) * window.innerHeight + 'px';
    t.style.opacity = String(Math.max(0.25, Math.min(1, (7.5 - dist) / 2.5)));
  });
}
