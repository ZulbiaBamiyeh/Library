// Walking the library: borrow books, peek with candles, find the shop and the desk.
import { app, ui, type Screen } from './app';
import { $, COARSE, closeModal, esc, goldHtml, modalOpen, pips, showModal, spellChip, toast } from './dom';
import { run, saveRun, gainSpell } from '../game/run';
import { SPELL_LIST, SPELLS, ESS, FORM_INFO, usesLabel, type SpellDef } from '../data/spells';
import { REAGENT_LIST, REAGENTS } from '../data/artifacts';
import { REACTIONS, COMPOUNDS, LEGENDARIES } from '../data/codex';
import { codex, hint } from '../game/codex';
import { hashStr, mulberry32, weighted } from '../sim/rng';
import { resolveSpell } from '../data/fusion';
import { play } from '../audio/sfx';

const SIZE_WORD = ['A slim volume', 'A stout volume', 'A heavy tome'];
let layoutKey = '';
let arrivedFrom: 'shop' | 'desk' | 'title' | null = null;

export function setArrival(from: 'shop' | 'desk' | 'title') { arrivedFrom = from; }

interface Contents { spells: string[]; reagent: string | null; hint: string | null }

function bookContents(i: number): Contents {
  const r = run!;
  const b = app.library.books[i];
  const rng = mulberry32(hashStr(`${r.id}:${r.round}:${i}:c`));
  let pool: SpellDef[] = b.chained ? SPELL_LIST.filter(s => s.rarity >= 1) : SPELL_LIST.filter(s => s.school === b.school);
  const wts = b.chained ? [0, 1, 1.4] : [[1, 0.25, 0.06], [1, 0.7, 0.2], [0.6, 1, 0.6]][b.size];
  const spells: string[] = [];
  const count = b.glowing ? 2 : 3;
  for (let k = 0; k < count && pool.length; k++) {
    const s = weighted(rng, pool, x => wts[x.rarity] || 0.01);
    spells.push(s.id); pool = pool.filter(p => p !== s);
  }
  const reagent = (b.chained || (b.size === 2 && rng() < 0.4)) ? REAGENT_LIST[Math.floor(rng() * REAGENT_LIST.length)].id : null;
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
  const hintEl = $('#lib-hint');
  hintEl.textContent = COARSE ? 'Drag to look, use the stick to walk, tap a book to open it.' : 'Drag to look, WASD to walk, click a book to open it. The Curio Shop is through the lit door.';
  if (r.lib.borrows === 0) hintEl.textContent = 'You have borrowed three books. Visit the Curio Shop, or go to the Binding Desk.';
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
  return `<div class="choice"><div class="info"><div>${spellChip({ uid: 0, base: id, inf: [], tier: 0 })}${owned ? '<span class="owned-note">you own this: borrowing upgrades it</span>' : ''}</div>
    <div class="desc"><span class="formtag">${FORM_INFO[d.form].name} · ${usesLabel(d.uses)} · ${res.ink} ink · ${res.read.toFixed(1)} s</span><br>${esc(d.text)}.</div></div>
    <button class="btn" data-take="${k}" ${canBorrow ? '' : 'disabled'}>Borrow</button></div>`;
}

function openBook(i: number) {
  const r = run!, L = r.lib, b = app.library.books[i];
  const peeked = !!L.peeked[i];
  const c = peeked ? bookContents(i) : null;
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
  if (peek) peek.onclick = () => { L.candles--; L.peeked[i] = true; if (b.chained) L.forbidden++; saveRun(); renderHud(); openBook(i); };
  const blind = document.getElementById('b-blind');
  if (blind) blind.onclick = () => {
    const cc = bookContents(i);
    const pick = cc.spells[Math.floor(mulberry32(hashStr(r.id + ':' + i + ':blind'))() * cc.spells.length)];
    if (b.chained) L.forbidden++;
    borrow(i, pick);
  };
  document.querySelectorAll<HTMLButtonElement>('[data-take]').forEach(bt => bt.onclick = () => borrow(i, c!.spells[+bt.dataset.take!]));
  const rg = document.querySelector<HTMLButtonElement>('[data-reagent]');
  if (rg) rg.onclick = () => {
    r.reagents.push(c!.reagent!);
    L.borrows--; L.taken[i] = true; app.library.hideBook(i);
    saveRun(); closeModal(); renderHud();
    toast(`${REAGENTS[c!.reagent!].name} added to your reagents.`, true);
  };
}

function borrow(i: number, id: string) {
  const r = run!, L = r.lib;
  const got = gainSpell(r, id);
  if (!got.placed) { closeModal(); toast('Your satchel is full. Burn a spell in it to make room.'); return; }
  if (got.upgraded) toast(`${SPELLS[id].name} upgraded to ${got.upgraded.tier === 2 ? 'Gold' : 'Silver'}.`, true);
  else toast(`${SPELLS[id].name} added to your satchel.`);
  L.borrows--; L.taken[i] = true; app.library.hideBook(i);
  saveRun(); closeModal(); renderHud();
}

// ----- input -----
const input = { down: false, id: -1, lx: 0, ly: 0, t0: 0, moved: 0 };
let handlers: { t: EventTarget; k: string; f: EventListener }[] = [];
function on(t: EventTarget, k: string, f: EventListener) { t.addEventListener(k, f); handlers.push({ t, k, f }); }

export const libraryScreen: Screen = {
  mount() {
    const r = run!;
    const lib = app.library;
    lib.titleSpin = false;
    const key = `${r.id}:${r.round}`;
    if (layoutKey !== key) { lib.layout(r.id, r.round, r.lib.taken); layoutKey = key; lib.pos.set(0, 1.62, 6.4); lib.yaw = 0; lib.pitch = 0; }
    if (arrivedFrom === 'shop') { lib.pos.set(8.2, 1.62, 0); lib.yaw = Math.PI / 2; lib.pitch = 0; }
    if (arrivedFrom === 'desk') { lib.pos.set(0, 1.62, 6.4); lib.yaw = 0; lib.pitch = -0.05; }
    arrivedFrom = null;
    app.engine.setView(lib);
    ui().innerHTML = `
      <div class="topbar"><div class="plate round-info" id="lib-round"></div><div class="plate counters" id="lib-counters"></div></div>
      <div id="lib-hint"></div><div id="crosshair"></div>
      <div id="joystick" class="${COARSE ? '' : 'hidden'}"><div class="knob"></div></div>
      <div id="hover-tip" class="hidden"></div>
      <div class="lib-bottom">
        <div class="plate satchel"><div class="satchel-label">Satchel · tap a spell to burn it</div><div class="satchel-row" id="lib-satchel"></div></div>
        <div class="nav-btns"><button class="btn quiet" id="to-shop">Curio Shop →</button><button class="btn gold" id="to-desk">Binding Desk</button></div>
      </div>`;
    renderHud();
    $('#to-shop').onclick = () => app.go('shop');
    $('#to-desk').onclick = () => app.go('desk');
    const canvas = app.engine.renderer.domElement;
    const active = () => app.screen === 'library' && !modalOpen();
    on(canvas, 'pointerdown', ((e: PointerEvent) => {
      if (!active()) return;
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
      } else if (e.pointerType === 'mouse') {
        const p = lib.pick(e.clientX, e.clientY);
        lib.setHover(p);
        const tip = $('#hover-tip');
        if (p) {
          tip.textContent = p.kind === 'book' ? lib.books[p.i].title : p.kind === 'door' ? 'Curios & Oddments' : 'The Binding Desk';
          tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.classList.remove('hidden');
          canvas.style.cursor = 'pointer';
        } else { tip.classList.add('hidden'); canvas.style.cursor = 'grab'; }
      }
    }) as EventListener);
    on(canvas, 'pointerup', ((e: PointerEvent) => {
      if (!active() || e.pointerId !== input.id) return;
      input.down = false;
      if (input.moved < 8 && performance.now() - input.t0 < 1500) {
        const p = lib.pick(e.clientX, e.clientY);
        if (p?.kind === 'book') openBook(p.i);
        else if (p?.kind === 'door') app.go('shop');
        else if (p?.kind === 'desk') app.go('desk');
      }
    }) as EventListener);
    on(window, 'keydown', ((e: KeyboardEvent) => {
      if (e.code === 'Escape') { closeModal(); return; }
      if (!active()) return;
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
    app.engine.renderer.domElement.style.cursor = '';
    closeModal();
  },
  tick() {
    if (app.library.atDoor() && !modalOpen()) { app.library.pos.x = 8.6; app.go('shop'); }
  },
};
