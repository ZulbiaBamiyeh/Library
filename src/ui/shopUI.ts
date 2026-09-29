// Curios & Oddments: buy staves, trinkets and reagents; equip, stash and sell.
import { app, ui, type Screen } from './app';
import { $, artSlotHtml, artifactCard, closeModal, esc, goldHtml, modalOpen, reagentCard, showModal, toast } from './dom';
import { run, saveRun, priceOf, sellPrice, rerollPrice, rollStock, type ShopItem } from '../game/run';
import { ARTIFACTS, RARITY, REAGENTS } from '../data/artifacts';
import { reagentIcon } from '../render/icons';
import { setArrival } from './libraryUI';
import { play } from '../audio/sfx';

const STASH_MAX = 4;
const KEEPER = 'Madame Verdigris';
const LINES = {
  greet: ['Come in, come in. Mind the jars; some of them are awake.', 'Ah, a reader. Everything here has been read, once. By something.', 'Welcome to Curios & Oddments. Nothing is cursed that you can prove.', 'Back again? The shelves have missed you. The jars less so.'],
  mythic: ['Oh, that one. It chose to be sold. Let us not ask why.', 'Careful. That piece has opinions.'],
  rare: ['A fine eye. That was dredged from the Forbidden Stacks.', 'That one hums at night. It is a good hum, mostly.'],
  buy: ['Wrapped in moth-silk, as is proper.', 'It is yours now. It knows.', 'A pleasure. Do return it if it starts whispering your name.', 'Spend wisely. Or beautifully. Preferably both.'],
  poor: ['Your purse is lighter than your ambition, dear.', 'Win a duel or two, then we shall talk.'],
  reroll: ['Let me see what the back room is hiding.', 'Fresh from the cellar. Some of it still twitching.'],
  sell: ['I will find it a good home. Or a shelf.', 'Hmm. It will fetch a price, from someone.'],
  full: ['Your pockets are full. Sell something, or leave it on the counter for another fool.'],
};
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

let tags: HTMLElement[] = [];
let sayTimer = 0;

function say(line: string) {
  const k = $('#keeper-line');
  if (!k) return;
  k.innerHTML = `<div class="who">${KEEPER}</div><div class="bubble">${esc(line)}</div>`;
  sayTimer = 7;
}

function renderGear() {
  const r = run!;
  const g = $('#gear');
  const reag: Record<string, number> = {};
  for (const x of r.reagents) reag[x] = (reag[x] || 0) + 1;
  g.innerHTML = `
    <h4>Your curios <small>staff and ${r.trinkets.length} trinket slots</small></h4>
    <div class="gear-row">${artSlotHtml(r.staff, { staff: true, label: 'no staff', attr: 'data-eq="staff"' })}${r.trinkets.map((t, i) => artSlotHtml(t, { label: 'trinket', attr: `data-eq="t${i}"` })).join('')}</div>
    <h4>Stash <small>${r.stash.length}/${STASH_MAX} · unequipped</small></h4>
    <div class="gear-row">${r.stash.map((t, i) => artSlotHtml(t, { attr: `data-stash="${i}"` })).join('') || '<span class="dim" style="font-size:13px">Nothing stashed.</span>'}</div>
    ${r.reagents.length ? `<h4>Reagents <small>use at the Binding Desk</small></h4><div class="gear-row">${Object.entries(reag).map(([id, n]) => `<div class="art-slot" title="${esc(REAGENTS[id].name)}"><img alt="" src="${reagentIcon(id)}"><span class="cnt">${n}</span></div>`).join('')}</div>` : ''}`;
  g.querySelectorAll<HTMLButtonElement>('[data-eq]').forEach(b => b.onclick = () => equippedMenu(b.dataset.eq!));
  g.querySelectorAll<HTMLButtonElement>('[data-stash]').forEach(b => b.onclick = () => stashMenu(+b.dataset.stash!));
  $('#shop-gold').innerHTML = goldHtml(r.gold);
  const rp = rerollPrice(r);
  const rr = $('#reroll') as HTMLButtonElement;
  rr.innerHTML = `Reroll the counter <span class="k">${rp} gold</span>`;
  rr.disabled = r.gold < rp;
}

function renderTags() {
  const r = run!;
  const box = $('#tags');
  box.innerHTML = '';
  tags = r.shop.stock.map((it, i) => {
    const t = document.createElement('div');
    t.className = 'ptag' + (it.sold ? ' sold' : '');
    const name = it.kind === 'art' ? ARTIFACTS[it.id].name : REAGENTS[it.id].name;
    const rar = it.kind === 'art' ? RARITY[ARTIFACTS[it.id].rarity] : { name: 'Reagent', color: '#8fc8ff' };
    const price = priceOf(it);
    t.innerHTML = `<div class="r" style="color:${rar.color}">${rar.name}</div><div class="n">${esc(name)}</div>${it.sold ? '<div class="p">sold</div>' : `<div class="p ${r.gold < price ? 'poor' : ''}"><span class="coin"></span>${price}</div>`}`;
    box.appendChild(t);
    t.dataset.i = String(i);
    return t;
  });
}

function hasRoom(slot: 'staff' | 'trinket'): boolean {
  const r = run!;
  if (slot === 'staff') return !r.staff || r.stash.length < STASH_MAX;
  return r.trinkets.some(t => !t) || r.stash.length < STASH_MAX;
}

function buy(i: number) {
  const r = run!;
  const it = r.shop.stock[i];
  const price = priceOf(it);
  if (it.sold) return;
  if (r.gold < price) { say(pick(LINES.poor)); closeModal(); return; }
  if (it.kind === 'reagent') {
    r.reagents.push(it.id);
  } else {
    const a = ARTIFACTS[it.id];
    if (!hasRoom(a.slot)) { say(pick(LINES.full)); closeModal(); toast('No room: sell or stash something first.'); return; }
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
  saveRun();
  closeModal();
  app.shop.markSold(i);
  play('coin');
  say(pick(LINES.buy));
  const name = it.kind === 'art' ? ARTIFACTS[it.id].name : REAGENTS[it.id].name;
  toast(`${name} is yours.`, true);
  renderTags(); renderGear();
}

function openItem(i: number) {
  const r = run!;
  const it = r.shop.stock[i];
  if (it.sold) return;
  const price = priceOf(it);
  if (it.kind === 'art') {
    const a = ARTIFACTS[it.id];
    if (a.rarity === 3) say(pick(LINES.mythic)); else if (a.rarity === 2) say(pick(LINES.rare));
  }
  const card = it.kind === 'art' ? artifactCard(it.id) : reagentCard(it.id);
  const room = it.kind === 'reagent' || hasRoom(ARTIFACTS[it.id].slot);
  const where = it.kind === 'art' ? (ARTIFACTS[it.id].slot === 'staff' ? (r.staff ? `Replaces your ${ARTIFACTS[r.staff].name}, which goes to your stash.` : 'Goes straight into your hand.') : (r.trinkets.some(t => !t) ? 'Goes into a free trinket slot.' : 'Your trinket slots are full: it goes to your stash.')) : '';
  showModal(`<div class="sheet" role="dialog" aria-label="Curio">${card}
    ${where ? `<div class="meta" style="margin-top:12px">${esc(where)}</div>` : ''}
    <div class="actions"><button class="btn gold" id="s-buy" ${r.gold >= price && room ? '' : 'disabled'}>Buy for ${price} gold</button><button class="btn quiet" id="s-close">Not today</button></div>
    ${r.gold < price ? '<div class="warn">You cannot afford it yet.</div>' : ''}${!room ? '<div class="warn">No room: sell or stash something first.</div>' : ''}</div>`);
  $('#s-buy').onclick = () => buy(i);
  $('#s-close').onclick = closeModal;
}

function equippedMenu(slot: string) {
  const r = run!;
  const id = slot === 'staff' ? r.staff : r.trinkets[+slot.slice(1)];
  if (!id) { toast(r.stash.length ? 'Pick something from your stash to equip it.' : 'Buy a curio from the counter to fill this slot.'); return; }
  const sp = sellPrice(id);
  showModal(`<div class="sheet" role="dialog">${artifactCard(id)}
    <div class="actions"><button class="btn" id="e-stash" ${r.stash.length < STASH_MAX ? '' : 'disabled'}>Unequip to stash</button><button class="btn quiet" id="e-sell">Sell for ${sp} gold</button><button class="btn quiet" id="e-close">Keep it on</button></div></div>`);
  const remove = () => { if (slot === 'staff') r.staff = null; else r.trinkets[+slot.slice(1)] = null; };
  $('#e-stash').onclick = () => { remove(); r.stash.push(id); saveRun(); closeModal(); renderGear(); };
  $('#e-sell').onclick = () => { remove(); r.gold += sp; saveRun(); closeModal(); say(pick(LINES.sell)); renderGear(); renderTags(); };
  $('#e-close').onclick = closeModal;
}

function stashMenu(i: number) {
  const r = run!;
  const id = r.stash[i];
  const a = ARTIFACTS[id];
  const sp = sellPrice(id);
  const opts = a.slot === 'staff'
    ? `<button class="btn" data-to="staff">Equip${r.staff ? ` (swap with ${esc(ARTIFACTS[r.staff].name)})` : ''}</button>`
    : r.trinkets.map((t, k) => `<button class="btn ${t ? 'quiet' : ''}" data-to="t${k}">${t ? `Swap with ${esc(ARTIFACTS[t].name)}` : `Equip in slot ${k + 1}`}</button>`).join('');
  showModal(`<div class="sheet" role="dialog">${artifactCard(id)}<div class="actions">${opts}<button class="btn quiet" id="x-sell">Sell for ${sp} gold</button><button class="btn quiet" id="x-close">Leave it</button></div></div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-to]').forEach(b => b.onclick = () => {
    const to = b.dataset.to!;
    r.stash.splice(i, 1);
    if (to === 'staff') { if (r.staff) r.stash.push(r.staff); r.staff = id; }
    else { const k = +to.slice(1); if (r.trinkets[k]) r.stash.push(r.trinkets[k]!); r.trinkets[k] = id; }
    saveRun(); closeModal(); renderGear();
  });
  $('#x-sell').onclick = () => { r.stash.splice(i, 1); r.gold += sp; saveRun(); closeModal(); say(pick(LINES.sell)); renderGear(); renderTags(); };
  $('#x-close').onclick = closeModal;
}

let handlers: { t: EventTarget; k: string; f: EventListener }[] = [];
function on(t: EventTarget, k: string, f: EventListener) { t.addEventListener(k, f); handlers.push({ t, k, f }); }

export const shopScreen: Screen = {
  mount() {
    const r = run!;
    const shop = app.shop;
    shop.setStock(r.shop.stock);
    app.engine.setView(shop);
    ui().innerHTML = `
      <div class="topbar">
        <div class="plate shop-head">Curios &amp; Oddments<small>Staves, trinkets and reagents · Round ${r.round}</small></div>
        <div class="plate counters"><div class="counter" id="shop-gold"></div><button class="btn quiet small" id="reroll"></button></div>
      </div>
      <div id="tags"></div>
      <div class="keeper" id="keeper-line"></div>
      <div class="plate gear" id="gear"></div>
      <div class="shop-nav">
        <button class="btn quiet small" id="s-lib">← Library</button><button class="btn gold small" id="s-desk">Binding Desk</button>
      </div>`;
    renderTags(); renderGear();
    say(r.shop.visited ? pick(LINES.greet.slice(3)) : pick(LINES.greet.slice(0, 3)));
    play('door');
    r.shop.visited = true; saveRun();
    $('#s-lib').onclick = () => { setArrival('shop'); app.go('library'); };
    $('#s-desk').onclick = () => app.go('desk');
    $('#reroll').onclick = () => {
      const p = rerollPrice(r);
      if (r.gold < p) { say(pick(LINES.poor)); return; }
      r.gold -= p; r.shop.rerolls++;
      r.shop.stock = rollStock(r, r.shop.rerolls);
      saveRun(); shop.setStock(r.shop.stock); renderTags(); renderGear(); say(pick(LINES.reroll)); play('reroll');
    };
    const canvas = app.engine.renderer.domElement;
    let drag = -1, lastX = 0, moved = 0;
    on(canvas, 'pointerdown', ((e: PointerEvent) => { drag = e.pointerId; lastX = e.clientX; moved = 0; }) as EventListener);
    on(canvas, 'pointermove', ((e: PointerEvent) => {
      shop.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (shop.narrow && drag === e.pointerId) {
        const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx);
        shop.pan = Math.max(-2.4, Math.min(2.4, shop.pan - dx * 0.012));
      }
      if (modalOpen()) return;
      const i = shop.pick(e.clientX, e.clientY);
      shop.hover = i;
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
    }) as EventListener);
    on(canvas, 'pointerup', ((e: PointerEvent) => {
      drag = -1;
      if (modalOpen() || moved > 10) return;
      const i = shop.pick(e.clientX, e.clientY);
      if (i >= 0) openItem(i);
    }) as EventListener);
    on(window, 'keydown', ((e: KeyboardEvent) => { if (e.code === 'Escape') closeModal(); }) as EventListener);
    on($('#modal'), 'pointerdown', ((e: PointerEvent) => { if ((e.target as HTMLElement).id === 'modal') closeModal(); }) as EventListener);
  },
  unmount() {
    for (const h of handlers) h.t.removeEventListener(h.k, h.f);
    handlers = [];
    app.engine.renderer.domElement.style.cursor = '';
    app.shop.hover = -1;
    closeModal();
    tags = [];
  },
  tick(dt: number) {
    const r = run!;
    tags.forEach((t, i) => {
      const p = app.shop.screenPos(i);
      t.style.left = p.x + 'px'; t.style.top = p.y + 'px';
      t.style.display = p.visible && r.shop.stock[i] ? '' : 'none';
    });
    if (sayTimer > 0) { sayTimer -= dt; if (sayTimer <= 0) { const k = $('#keeper-line'); if (k) k.innerHTML = ''; } }
  },
};

export type { ShopItem };
