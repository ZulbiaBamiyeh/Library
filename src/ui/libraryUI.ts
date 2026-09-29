// Walking the library: borrow books, peek with candles, find the shop and the desk.
import { app, ui, type Screen } from './app';
import { $, COARSE, closeModal, esc, goldHtml, modalOpen, pips, showModal, spellChip, toast } from './dom';
import { run, saveRun, gainSpell } from '../game/run';
import { SPELL_LIST, LIBRARY_SPELLS, SPELLS, ESS, FORM_INFO, usesLabel, type SpellDef } from '../data/spells';
import { LEVELS, TAKEN_KEY } from '../render/library';
import { openGear, openWare, paintTags, placeTags, setShopChanged, stockShops } from './shopPanel';
import { ambience } from '../audio/sfx';
import { ARTIFACTS, REAGENT_LIST, REAGENTS } from '../data/artifacts';
import { stockOf } from './shopPanel';
import { REACTIONS, COMPOUNDS, LEGENDARIES } from '../data/codex';
import { codex, hint } from '../game/codex';
import { hashStr, mulberry32, weighted } from '../sim/rng';
import { resolveSpell } from '../data/fusion';
import { play } from '../audio/sfx';

const SIZE_WORD = ['A slim volume', 'A stout volume', 'A heavy tome'];
let layoutKey = '';
let arrivedFrom: 'shop' | 'desk' | 'title' | null = null;

export function setArrival(from: 'shop' | 'desk' | 'title') { arrivedFrom = from; }
// The title screen lays the shelves out on its own, so the next visit must lay them out again.
export function forgetLayout() { layoutKey = ''; }

interface Contents { spells: string[]; reagent: string | null; hint: string | null }

// ----- floors: books are remembered per floor, keyed by index plus TAKEN_KEY per floor down -----
const keyOf = (d: number, i: number) => (d ? d * TAKEN_KEY + i : i);

function bookContents(d: number, i: number): Contents {
  const r = run!;
  const b = app.library.book(d, i);
  const rng = mulberry32(hashStr(d ? `${r.id}:${r.round}:d${d}:${i}:c` : `${r.id}:${r.round}:${i}:c`));
  // below the Reading Room the shelves are jumbled, the books rarer, and the oldest spells turn up
  // each wing keeps to its school; deeper down, rarer strays from other schools creep onto the shelves,
  // and the oldest spells hide in far-off wings and little alcoves
  let pool: SpellDef[] = b.chained ? LIBRARY_SPELLS.filter(s => s.rarity >= 1) : LIBRARY_SPELLS.filter(s => s.school === b.school || (d >= 2 && s.rarity >= 1));
  if (d) pool = pool.concat(SPELL_LIST.filter(s => s.depth && s.depth <= d));
  const base = b.chained ? [0, 1, 1.4] : [[1, 0.25, 0.06], [1, 0.7, 0.2], [0.6, 1, 0.6]][b.size];
  const wts = [base[0] * Math.max(0.08, 1 - 0.3 * d), base[1] * (1 + 0.4 * d), base[2] * (1 + 0.8 * d)];
  const stray = (x: SpellDef) => (b.chained || x.school === b.school ? 1 : 0.2);
  const hidden = (1 + 2.5 * b.far * b.far) * (b.nook ? 3 : 1) * (b.hidden ? 4 : 1);
  const weight = (x: SpellDef) => x.depth ? 0.12 * (1 + 0.4 * (d - x.depth)) * hidden * (b.chained || b.glowing ? 2 : 1) : (wts[x.rarity] || 0.01) * stray(x);
  const spells: string[] = [];
  const count = b.glowing ? 2 : 3;
  for (let k = 0; k < count && pool.length; k++) {
    const s = weighted(rng, pool, weight);
    spells.push(s.id); pool = pool.filter(p => p !== s);
  }
  const reagent = (b.chained || (b.size === 2 && rng() < 0.4 + d * 0.08) || rng() < d * 0.04 + (b.hidden ? 0.12 : 0)) ? REAGENT_LIST[Math.floor(rng() * REAGENT_LIST.length)].id : null;
  let h: string | null = null;
  if (b.glowing) {
    const unknown = [...REACTIONS.map(x => x.id), ...Object.values(COMPOUNDS).map(c => c.id), ...LEGENDARIES.map(l => l.id)].filter(id => !codex.found.includes(id) && !codex.hinted.includes(id));
    if (unknown.length) h = unknown[Math.floor(rng() * unknown.length)];
  }
  return { spells, reagent, hint: h };
}

function hintText(id: string): string {
  const r = REACTIONS.find(x => x.id === id);
  if (r) return `${r.recipe} → ${r.name}: ${r.text}.`;
  const c = Object.values(COMPOUNDS).find(x => x.id === id);
  if (c) return `Bind ${c.recipe} into one spell to make ${c.name}: ${c.text}.`;
  const l = LEGENDARIES.find(x => x.id === id);
  if (l) return `${l.recipe} makes ${l.name}.`;
  return '';
}

function renderHud() {
  const r = run!;
  let books = ''; for (let i = 0; i < 3; i++) books += `<span class="ico-book ${i < 3 - r.lib.borrows ? 'used' : ''}"></span>`;
  let candles = ''; for (let i = 0; i < 5; i++) candles += `<span class="ico-candle ${i < 5 - r.lib.candles ? 'used' : ''}"></span>`;
  const d = app.library.level;
  $('#lib-round').innerHTML = `Round ${r.round}<small>${pips(r.wins, r.losses)}</small><small>${r.wins} wins, ${r.losses} of 4 losses</small>`;
  $('#lib-counters').innerHTML = `<div class="counter" title="Gold for the Curio Shop">${goldHtml(r.gold)}</div>
    <div class="counter" title="Books you can still borrow"><span class="icons">${books}</span><span>${r.lib.borrows} to borrow</span></div>
    <div class="counter" title="Candles: each lets you peek inside one book"><span class="icons">${candles}</span></div>`;
  const sat = $('#lib-satchel');
  sat.innerHTML = '';
  r.satchel.forEach((s, i) => {
    if (!s) { sat.insertAdjacentHTML('beforeend', '<span class="slot-empty"></span>'); return; }
    const b = document.createElement('button');
    b.style.cssText = 'background:none;border:0;padding:0';
    b.innerHTML = spellChip(s);
    b.title = `Burn ${resolveSpell(s).name}`;
    b.onclick = () => confirmBurn(i);
    sat.appendChild(b);
  });
  void d;
  const tb = document.getElementById('tag-box');
  if (tb) paintTags(tb, shopHere);
}

function confirmBurn(i: number) {
  const s = run!.satchel[i]!;
  const nm = resolveSpell(s).name;
  showModal(`<div class="sheet" role="dialog" aria-label="Burn spell"><h2 style="font-size:30px">Burn ${esc(nm)}?</h2>
    <p class="lead">It leaves your satchel for good, freeing a slot for something new.</p>
    <div class="actions"><button class="btn" id="m-burn">Burn it</button><button class="btn quiet" id="m-cancel">Keep it</button></div></div>`);
  $('#m-burn').onclick = () => { run!.satchel[i] = null; saveRun(); closeModal(); renderHud(); toast(`${nm} burned.`); };
  $('#m-cancel').onclick = closeModal;
}

function spellChoice(id: string, k: number, canBorrow: boolean): string {
  const d = SPELLS[id];
  const owned = [...run!.lines, ...run!.satchel, ...run!.wards.map(w => w.spell)].some(s => s && s.base === id && s.tier < 2);
  const res = resolveSpell({ uid: 0, base: id, inf: [], tier: 0 });
  return `<div class="choice ${d.depth ? 'ancient' : ''}"><div class="info"><div>${spellChip({ uid: 0, base: id, inf: [], tier: 0 })}${d.depth ? '<span class="ancient-tag">Ancient</span>' : ''}${owned ? '<span class="owned-note">you own this: borrowing upgrades it</span>' : ''}</div>
    <div class="desc"><span class="formtag">${FORM_INFO[d.form].name} · ${usesLabel(d.uses)} · ${res.ink} ink · ${res.read.toFixed(1)} s</span><br>${esc(d.text)}.</div></div>
    <button class="btn" data-take="${k}" ${canBorrow ? '' : 'disabled'}>Borrow</button></div>`;
}

function openBook(d: number, i: number) {
  const r = run!, L = r.lib, b = app.library.book(d, i);
  const peeked = !!L.peeked[keyOf(d, i)];
  const c = peeked ? bookContents(d, i) : null;
  const spine = b.chained ? '#2c2c32' : ESS[b.school].spine;
  let h = `<div class="book-card" role="dialog" aria-label="${esc(b.title)}" style="--school:${spine}"><div class="spine"></div><div class="body">
    <h2>${esc(b.title)}</h2>
    <div class="meta">${SIZE_WORD[b.size]} bound in ${b.chained ? 'iron chains' : ESS[b.school].school.toLowerCase() + ' colours'}${b.glowing ? ', faintly glowing' : ''}.</div>`;
  if (b.chained && !peeked) h += `<div class="warn">A forbidden book. Opening it puts 2 Hex on you at the start of your next duel.</div>`;
  if (!c) {
    h += `<div class="actions" style="margin-top:16px">
      <button class="btn" id="b-peek" ${L.candles ? '' : 'disabled'}>Peek inside (1 candle)</button>
      <button class="btn quiet" id="b-blind" ${L.borrows ? '' : 'disabled'}>Borrow blind</button>
      <button class="btn quiet" id="b-close">Put it back</button></div>`;
    if (!L.candles) h += `<div class="meta" style="margin-top:8px">No candles left. You can still borrow blind: you get one of its spells at random.</div>`;
  } else {
    if (c.hint) {
      h += `<div class="hint">A note in the margin: <i>${esc(hintText(c.hint))}</i></div>`;
      hint(c.hint);
    }
    h += `<div class="choices">${c.spells.map((id, k) => spellChoice(id, k, L.borrows > 0)).join('')}`;
    if (c.reagent) {
      const g = REAGENTS[c.reagent];
      h += `<div class="choice"><div class="info"><div style="font-family:var(--serif);font-size:18px">${esc(g.name)} <span class="formtag">reagent</span></div><div class="desc">${esc(g.text)}</div></div><button class="btn" data-reagent="1" ${L.borrows ? '' : 'disabled'}>Take</button></div>`;
    }
    h += `</div><div class="actions"><button class="btn quiet" id="b-close">Put it back</button></div>`;
    if (!L.borrows) h += `<div class="meta" style="margin-top:8px">You have borrowed all three books this round.</div>`;
  }
  h += `</div></div>`;
  showModal(h);
  play('page');
  const close = document.getElementById('b-close'); if (close) close.onclick = closeModal;
  const peek = document.getElementById('b-peek');
  if (peek) peek.onclick = () => { L.candles--; L.peeked[keyOf(d, i)] = true; if (b.chained) L.forbidden++; saveRun(); renderHud(); openBook(d, i); };
  const blind = document.getElementById('b-blind');
  if (blind) blind.onclick = () => {
    const cc = bookContents(d, i);
    const pick = cc.spells[Math.floor(mulberry32(hashStr(r.id + ':' + i + ':blind'))() * cc.spells.length)];
    if (b.chained) L.forbidden++;
    borrow(d, i, pick);
  };
  document.querySelectorAll<HTMLButtonElement>('[data-take]').forEach(bt => bt.onclick = () => borrow(d, i, c!.spells[+bt.dataset.take!]));
  const rg = document.querySelector<HTMLButtonElement>('[data-reagent]');
  if (rg) rg.onclick = () => {
    r.reagents.push(c!.reagent!);
    L.borrows--; L.taken[keyOf(d, i)] = true; app.library.hideBook(d, i);
    saveRun(); closeModal(); renderHud();
    toast(`${REAGENTS[c!.reagent!].name} added to your reagents.`, true);
  };
}

function borrow(d: number, i: number, id: string) {
  const r = run!, L = r.lib;
  const got = gainSpell(r, id);
  if (!got.placed) { closeModal(); toast('Your satchel is full. Burn a spell in it to make room.'); return; }
  if (got.upgraded) toast(`${SPELLS[id].name} upgraded to ${got.upgraded.tier === 2 ? 'Gold' : 'Silver'}.`, true);
  else toast(`${SPELLS[id].name} added to your satchel.`);
  L.borrows--; L.taken[keyOf(d, i)] = true; app.library.hideBook(d, i);
  saveRun(); closeModal(); renderHud();
}

// ----- arriving on a floor -----
function onFloor(d: number) {
  const r = run!;
  renderHud();
  // the deepest floor reached is remembered, but nothing announces where you are
  if (d > (r.lib.depth || 0)) { r.lib.depth = d; saveRun(); }
}

// ----- the Duelling Ring, through the west arch -----
function enterRing() {
  const r = run!, lib = app.library;
  if (lib.atArena()) { lib.pos.x = -8.4; lib.keys = {}; lib.joy = { x: 0, y: 0 }; }
  if (!r.lines.some(Boolean)) {
    toast('Your tome is blank. Write at least one spell on a line at the Binding Desk first.');
    return;
  }
  const notes: string[] = [];
  if (r.lib.borrows > 0) notes.push(`You can still borrow ${r.lib.borrows} book${r.lib.borrows > 1 ? 's' : ''}.`);
  const loose = [r.desk.base, r.desk.inf].filter(Boolean);
  if (loose.length) notes.push(`${loose.map(x => esc(resolveSpell(x!).name)).join(' and ')} ${loose.length > 1 ? 'are' : 'is'} on the altar, not in your tome.`);
  const empty = r.lines.filter(l => !l).length, spare = r.satchel.filter(Boolean).length;
  if (empty && spare) notes.push(`${empty} line${empty > 1 ? 's' : ''} of your tome ${empty > 1 ? 'are' : 'is'} blank, and your satchel holds ${spare} spell${spare > 1 ? 's' : ''}.`);
  if (r.bindings > 0 && spare + r.lines.filter(Boolean).length >= 2) notes.push(`${r.bindings} binding${r.bindings > 1 ? 's' : ''} left this round.`);
  const opp = r.opponent;
  showModal(`<div class="sheet" role="dialog" aria-label="The Duelling Ring"><h2 style="font-size:30px">The Duelling Ring</h2>
    ${opp ? `<p class="lead">Opponent: <b>${esc(opp.name)}</b>${opp.title ? ` (${esc(opp.title)})` : ''}</p>` : ''}
    ${notes.length ? `<ul class="warn" style="margin-top:10px">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}
    <div class="actions"><button class="btn gold" id="m-ring">Step into the Ring</button><button class="btn quiet" id="m-desk">Binding Desk</button><button class="btn quiet" id="m-stay">Not yet</button></div></div>`);
  play('door');
  $('#m-ring').onclick = () => { closeModal(); app.go('duel'); };
  $('#m-desk').onclick = () => { closeModal(); app.go('desk'); };
  $('#m-stay').onclick = closeModal;
}

function tipText(p: NonNullable<ReturnType<typeof app.library.pick>>): string {
  if (p.kind === 'ware') {
    const it = stockOf(p.shop)[p.i];
    return it.kind === 'art' ? ARTIFACTS[it.id].name : REAGENTS[it.id].name;
  }
  return p.kind === 'book' ? app.library.book(p.d, p.i).title : p.kind === 'arena' ? 'The Duelling Ring' : 'The Binding Desk';
}

// ----- the shops: the Curio Shop behind the east doorway, and whatever is kept in the depths -----
let shopHere: number | null = null;
function setShopHere(s: number | null) {
  if (s === shopHere) return;
  shopHere = s;
  const tb = document.getElementById('tag-box');
  if (tb) paintTags(tb, s);
  if (s === -1 && run && !run.shop.visited) { run.shop.visited = true; saveRun(); }
  ambience(s === -1 ? 'shop' : 'library');
}
// Walk straight into the Curio Shop (from a button, or arriving from the desk).
export function enterShop() {
  const lib = app.library;
  lib.pos.set(10.7, 1.62, 0); lib.eyeH = 1.62; lib.yaw = -Math.PI / 2; lib.pitch = -0.16; lib.vy = 0; lib.crouch = false;
  play('door');
}

// ----- input -----
const input = { down: false, id: -1, lx: 0, ly: 0, t0: 0, moved: 0 };
let lockAllowed = true; // turns false for good if the browser refuses pointer lock before it has ever worked
let everLocked = false;
let handlers: { t: EventTarget; k: string; f: EventListener }[] = [];
function on(t: EventTarget, k: string, f: EventListener) { t.addEventListener(k, f); handlers.push({ t, k, f }); }

export const libraryScreen: Screen = {
  mount() {
    const r = run!;
    const lib = app.library;
    lib.titleSpin = false;
    const lk = `${r.id}:${r.round}`;
    if (layoutKey !== lk) {
      lib.layoutAll(r.id, r.round, r.lib.taken);
      layoutKey = lk;
      lib.pos.set(0, 1.62, 6.4); lib.yaw = 0; lib.pitch = 0; lib.vy = 0;
    }
    lib.onLevel = onFloor;
    lib.onLand = (speed) => { if (speed > 16) { play('block'); app.library.embers.burst(lib.pos.x, lib.pos.y - 1.5, lib.pos.z, 20, LEVELS[lib.level].mote, 2.5, 0.08, 0.8, { gravity: 2 }); } };
    // coming in from another room puts you back in the Reading Room (or in the shop, if that is where you were going)
    if (arrivedFrom === 'shop') enterShop();
    if (arrivedFrom === 'desk' || arrivedFrom === 'title') { lib.pos.set(0, 1.62, 6.4); lib.eyeH = 1.62; lib.yaw = 0; lib.pitch = -0.05; lib.vy = 0; lib.crouch = false; }
    arrivedFrom = null;
    app.engine.setView(lib);
    ui().innerHTML = `
      <div class="topbar"><div class="plate round-info" id="lib-round"></div><div class="plate counters" id="lib-counters"></div></div>
      <div id="crosshair"></div><div id="tag-box"></div>
      <div id="look-prompt" class="hidden">Click to look around · WASD walk · Shift run · Space jump · C crouch · I curios · Esc frees the mouse</div>
      <button id="crouch-btn" class="btn quiet small ${COARSE ? '' : 'hidden'}" aria-pressed="false">Crouch</button>
      <div id="joystick" class="${COARSE ? '' : 'hidden'}"><div class="knob"></div></div>
      <div id="hover-tip" class="hidden"></div>
      <div class="lib-bottom">
        <div class="plate satchel"><div class="satchel-label">Satchel · tap a spell to burn it</div><div class="satchel-row" id="lib-satchel"></div></div>
        <div class="nav-btns"><button class="btn quiet" id="to-ring" aria-label="Duelling Ring">← <span class="nl">Duelling </span>Ring</button><button class="btn quiet" id="to-gear" aria-label="Your curios">Curios</button><button class="btn quiet" id="to-shop" aria-label="Curio Shop"><span class="nl">Curio </span>Shop →</button><button class="btn gold" id="to-desk" aria-label="Binding Desk"><span class="nl">Binding </span>Desk</button></div>
      </div>`;
    shopHere = null;
    stockShops();
    setShopChanged(() => { renderHud(); });
    renderHud();
    $('#to-shop').onclick = () => { if (lib.inShop() !== -1) enterShop(); };
    $('#to-gear').onclick = () => openGear(lib.inShop());
    const cb = $('#crouch-btn');
    cb.onclick = () => { lib.crouch = !lib.crouch; cb.setAttribute('aria-pressed', String(lib.crouch)); cb.classList.toggle('on', lib.crouch); };
    $('#to-ring').onclick = enterRing;
    $('#to-desk').onclick = () => app.go('desk');
    const canvas = app.engine.renderer.domElement;
    const active = () => app.screen === 'library' && !modalOpen();
    const act = (p: ReturnType<typeof lib.pick>) => {
      if (p?.kind === 'book') openBook(p.d, p.i);
      else if (p?.kind === 'ware') openWare(p.shop, p.i);
      else if (p?.kind === 'desk') app.go('desk');
      else if (p?.kind === 'arena') enterRing();
    };
    // on a computer the mouse steers the view directly (pointer lock); on touch you drag
    const locked = () => document.pointerLockElement === canvas;
    let mouseLook = !COARSE && lockAllowed;
    // if the page may not capture the mouse (some embedded frames), fall back to drag-to-look
    // a refusal after the lock has worked once is only the browser's cool-down after the mouse was freed;
    // the next click tries again
    const lockRefused = () => { if (everLocked) { paintPrompt(); return; } mouseLook = false; lockAllowed = false; paintPrompt(); };
    const tryLock = () => {
      if (!('requestPointerLock' in canvas)) { lockRefused(); return; }
      try { const pr = canvas.requestPointerLock() as unknown as Promise<void> | undefined; pr?.catch?.(lockRefused); } catch { lockRefused(); }
    };
    // closing a book or a dialog that was opened with the mouse captured captures it again
    on(window, 'modalclosed', ((e: CustomEvent<{ relock: boolean }>) => { if (e.detail.relock && mouseLook && app.screen === 'library' && !locked()) tryLock(); }) as EventListener);
    const paintPrompt = () => { const el = document.getElementById('look-prompt'); if (el) el.classList.toggle('hidden', !mouseLook || locked() || modalOpen()); };
    on(document, 'pointerlockerror', lockRefused as EventListener);
    paintPrompt();
    on(document, 'pointerlockchange', (() => { if (locked()) everLocked = true; paintPrompt(); if (!locked()) { lib.setHover(null); $('#hover-tip').classList.add('hidden'); } }) as EventListener);
    on(document, 'mousemove', ((e: MouseEvent) => {
      if (!locked() || !active()) return;
      lib.yaw -= e.movementX * 0.0022; lib.pitch = Math.max(-1.35, Math.min(1.35, lib.pitch - e.movementY * 0.0022));
    }) as EventListener);
    on(canvas, 'pointerdown', ((e: PointerEvent) => {
      if (!active()) return;
      if (mouseLook && e.pointerType === 'mouse') {
        if (!locked()) {
          tryLock();
          if (mouseLook) return;
        } else {
          act(lib.pick(window.innerWidth / 2, window.innerHeight / 2));
          return;
        }
      }
      input.down = true; input.id = e.pointerId; input.lx = e.clientX; input.ly = e.clientY; input.t0 = performance.now(); input.moved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }) as EventListener);
    on(canvas, 'pointermove', ((e: PointerEvent) => {
      if (!active()) return;
      if (input.down && e.pointerId === input.id) {
        const dx = e.clientX - input.lx, dy = e.clientY - input.ly;
        input.lx = e.clientX; input.ly = e.clientY; input.moved += Math.abs(dx) + Math.abs(dy);
        const s = e.pointerType === 'touch' ? 0.006 : 0.0045;
        lib.yaw -= dx * s; lib.pitch = Math.max(-1.2, Math.min(1.2, lib.pitch - dy * s));
      } else if (e.pointerType === 'mouse' && !locked()) {
        const p = lib.pick(e.clientX, e.clientY);
        lib.setHover(p);
        const tip = $('#hover-tip');
        if (p) {
          tip.textContent = tipText(p);
          tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.classList.remove('hidden');
          canvas.style.cursor = 'pointer';
        } else { tip.classList.add('hidden'); canvas.style.cursor = 'grab'; }
      }
    }) as EventListener);
    on(canvas, 'pointerup', ((e: PointerEvent) => {
      if (!active() || e.pointerId !== input.id) return;
      input.down = false;
      if (input.moved < 8 && performance.now() - input.t0 < 1500) act(lib.pick(e.clientX, e.clientY));
    }) as EventListener);
    on(window, 'keydown', ((e: KeyboardEvent) => {
      if (e.code === 'Escape') { closeModal(); return; }
      if (!active()) return;
      if (e.code === 'Space') { e.preventDefault(); lib.jump(); return; }
      if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); openGear(lib.inShop()); return; }
      lib.keys[e.code] = true;
    }) as EventListener);
    on(window, 'keyup', ((e: KeyboardEvent) => { lib.keys[e.code] = false; }) as EventListener);
    on(window, 'blur', (() => { lib.keys = {}; }) as EventListener);
    on($('#modal'), 'pointerdown', ((e: PointerEvent) => { if ((e.target as HTMLElement).id === 'modal') closeModal(); }) as EventListener);
    // touch joystick
    const j = $('#joystick'), knob = j.querySelector('.knob') as HTMLElement;
    let pid = -1, cx = 0, cy = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy), max = 42;
      if (m > max) { dx = dx / m * max; dy = dy / m * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`; lib.joy.x = dx / max; lib.joy.y = dy / max;
    };
    j.addEventListener('pointerdown', e => { pid = e.pointerId; const rc = j.getBoundingClientRect(); cx = rc.left + rc.width / 2; cy = rc.top + rc.height / 2; j.setPointerCapture(pid); move(e); e.preventDefault(); });
    j.addEventListener('pointermove', move);
    const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; knob.style.transform = ''; lib.joy.x = lib.joy.y = 0; };
    j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
  },
  unmount() {
    for (const h of handlers) h.t.removeEventListener(h.k, h.f);
    handlers = [];
    app.library.keys = {}; app.library.joy = { x: 0, y: 0 };
    app.library.setHover(null);
    app.library.onLevel = undefined; app.library.onLand = undefined;
    app.library.crouch = false;
    setShopHere(null);
    setShopChanged(() => {});
    if (document.pointerLockElement) document.exitPointerLock();
    app.engine.renderer.domElement.style.cursor = '';
    closeModal();
  },
  tick() {
    setShopHere(app.library.inShop());
    placeTags();
    if (app.library.atArena() && !modalOpen()) enterRing();
    // with the mouse captured, whatever sits under the crosshair is what you would click
    const cv = app.engine.renderer.domElement;
    if (document.pointerLockElement === cv && !modalOpen()) {
      const p = app.library.pick(window.innerWidth / 2, window.innerHeight / 2);
      app.library.setHover(p);
      const tip = document.getElementById('hover-tip');
      if (tip) { if (p) { tip.textContent = tipText(p); tip.style.left = window.innerWidth / 2 + 'px'; tip.style.top = window.innerHeight / 2 + 'px'; tip.classList.remove('hidden'); } else tip.classList.add('hidden'); }
    }
    const lp = document.getElementById('look-prompt'); if (lp && !COARSE) lp.classList.toggle('hidden', !lockAllowed || document.pointerLockElement === cv || modalOpen());
  },
};
