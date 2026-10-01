// The Binding Desk: one screen, no scrolling. The tome on the left, the binding altar in the
// middle, the satchel and details on the right. Drag spells with mouse or touch, or tap to pick up and tap to place.
import { app, ui, type Screen } from './app';
import { $, artifactCard, closeModal, COARSE, esc, modalOpen, pips, reagentCard, showModal, spellChip, spellDetail, toast } from './dom';
import { run, saveRun, slotGet, slotSet, allOwned, type Ref } from '../game/run';
import { discover, isFound } from '../game/codex';
import { canInfuse, discoveriesOf, fuse, maxInfusions, resolveSpell, type SpellInst } from '../data/fusion';
import { ESS, FORM_INFO, SPELLS } from '../data/spells';
import { ARTIFACTS, REAGENTS } from '../data/artifacts';
import { COMPOUNDS, LEGENDARY } from '../data/codex';
import { WARD_CONDS, type WardCond } from '../sim/types';
import { PACE } from '../sim/duel';
import { hpForRound, inkForRound, linesForRound, wardsForRound, LINE_UNLOCKS, WARD_UNLOCKS } from '../game/progression';
import { reagentIcon } from '../render/icons';
import { showCodex } from './codexUI';
import { setArrival } from './libraryUI';
import { play } from '../audio/sfx';

let sel: Ref | null = null;
let born = false; // play the "just bound" animation on the next render
let tab: 'bind' | 'tome' = 'bind';

const same = (a: Ref | null, b: Ref) => !!a && a.where === b.where && a.i === b.i;
const refAttr = (r: Ref) => `data-w="${r.where}" data-i="${r.i}"`;

function slotHtml(ref: Ref, empty: string, cls = 'bd-slot') {
  const s = slotGet(run!, ref);
  const isSel = same(sel, ref);
  return `<button class="${cls} ${s ? 'full' : 'empty'} ${isSel ? 'sel' : ''} ${sel && !isSel ? 'can' : ''}" ${refAttr(ref)} aria-label="${esc(s ? resolveSpell(s).name : empty)}">${s ? spellChip(s) : `<span class="ph">${esc(empty)}</span>`}</button>`;
}

function tomeStats() {
  const r = run!;
  let ink = 0, time = 0;
  for (const s of r.lines) {
    if (!s) continue;
    const res = resolveSpell(s);
    ink += res.ink; time += Math.max(PACE.minCycle, res.read + PACE.recover);
  }
  return { ink, time: time + PACE.recharge };
}

// A large card for the Base and Infusion slots.
function bigSlot(ref: Ref, label: string, hint: string) {
  const s = slotGet(run!, ref);
  const isSel = same(sel, ref);
  let inner = `<span class="lbl">${label}</span>`;
  if (s) {
    const res = resolveSpell(s);
    const ess = [...new Set(res.essences)];
    inner += `<span class="nm">${esc(res.name)}${s.tier ? ` <small>${s.tier === 2 ? 'Gold' : 'Silver'}</small>` : ''}</span>
      <span class="meta">${FORM_INFO[res.form].name} · ${ess.length ? ess.map(e => `<i style="background:${ESS[e].color}"></i>${ESS[e].name}`).join(' ') : 'no essence'}</span>
      <span class="parts">${[s.base, ...s.inf].map(id => esc(SPELLS[id].name)).join(' + ')}${s.inf.length ? ` <small>(${s.inf.length}/${maxInfusions(s)})</small>` : ''}</span>`;
  } else inner += `<span class="hint">${esc(hint)}</span>`;
  return `<button class="bd-big ${s ? 'full' : 'empty'} ${isSel ? 'sel' : ''} ${sel && !isSel ? 'can' : ''}" ${refAttr(ref)} style="${s ? `--ess:${ESS[resolveSpell(s).primary].color}` : ''}">${inner}</button>`;
}

function resultHtml(): string {
  const r = run!;
  const b = r.desk.base, f = r.desk.inf;
  if (!b || !f) {
    return `<div class="bd-result empty"><div class="bd-glyph">✦</div><div>${!b && !f ? 'Place a spell on <b>Base</b>, then another on <b>Infusion</b>.' : !b ? 'Now a base for it to bind into.' : 'Now an infusion, or pick one below.'}</div></div>`;
  }
  const err = canInfuse(b, f);
  if (err) return `<div class="bd-result empty"><div>${esc(err)}</div></div>`;
  const out = fuse(b, f, 0);
  const res = resolveSpell(out);
  const sealed = discoveriesOf(res).some(id => !isFound(id));
  return `<div class="bd-result preview ${sealed ? 'sealed' : ''} ${res.legendary && !sealed ? 'legend' : ''}">${spellDetail(out, sealed)}</div>`;
}

// What each owned spell would make if bound into the base (or with the infusion, if only that is set).
function candidates(): string {
  const r = run!;
  const b = r.desk.base, f = r.desk.inf;
  if ((b && f) || (!b && !f)) return '';
  const owned = allOwned(r).filter(o => o.ref.where !== 'base' && o.ref.where !== 'inf');
  if (!owned.length) return `<div class="bd-cands"><div class="bd-cands-h">Borrow more spells in the library to have something to bind.</div></div>`;
  const rows = owned.map(o => {
    const out = b ? fuse(b, o.s, 0) : fuse(o.s, f!, 0);
    const err = b ? canInfuse(b, o.s) : canInfuse(o.s, f!);
    const res = resolveSpell(out);
    const disc = discoveriesOf(res);
    const sealed = disc.some(id => !isFound(id));
    return { o, name: err ? null : sealed ? '???' : res.name, rank: res.legendary ? 3 : sealed ? 2 : disc.length ? 1 : 0, ess: res.primary };
  }).filter(x => x.name).sort((a, c) => c.rank - a.rank);
  const lead = b ? `Bind into ${esc(resolveSpell(b).name)}:` : `Use as a base for ${esc(resolveSpell(f!).name)}:`;
  return `<div class="bd-cands"><div class="bd-cands-h">${lead}</div><div class="bd-cands-l">${rows.map(x =>
    `<button class="bd-cand ${x.rank >= 2 ? 'rare' : ''}" data-cand="${x.o.ref.where}:${x.o.ref.i}"><span class="from">${esc(resolveSpell(x.o.s).name)}</span><span class="to" style="color:${x.rank >= 2 ? '' : ESS[x.ess].color}">→ ${esc(x.name!)}</span></button>`).join('')}</div></div>`;
}

function reagentButtons() {
  const counts: Record<string, number> = {};
  for (const x of run!.reagents) counts[x] = (counts[x] || 0) + 1;
  const ids = Object.keys(counts);
  if (!ids.length) return '';
  return `<div class="bd-reag">${ids.map(id => `<button class="bd-rg" data-reagent="${id}" title="${esc(REAGENTS[id].text)}"><img alt="" src="${reagentIcon(id)}"><span>${esc(REAGENTS[id].name)}${counts[id] > 1 ? ` ×${counts[id]}` : ''}</span></button>`).join('')}</div>`;
}

function infoHtml(): string {
  const r = run!;
  const s = sel ? slotGet(r, sel) : null;
  if (!s) {
    return `<h4>How binding works</h4><ul class="bd-how">
      <li><b>Base</b> decides what the spell <i>is</i>: a bolt, a summon, a curse.</li>
      <li><b>Infusion</b> adds its essence and a trait. It is used up.</li>
      <li>Two different essences form a <b>compound</b>. Exact four-part recipes become <b>legendary</b>.</li>
      <li>Drag spells between slots, or tap one to pick it up and tap where it goes.</li></ul>`;
  }
  const where = sel!.where;
  return `<div class="preview bd-sel">${spellDetail(s)}</div><div class="bd-acts">
    ${where !== 'base' ? '<button class="btn small" data-act="base">To base</button>' : ''}
    ${where !== 'inf' ? '<button class="btn small" data-act="inf">To infusion</button>' : ''}
    ${where !== 'line' ? '<button class="btn quiet small" data-act="line">Write in tome</button>' : ''}
    ${where !== 'sat' ? '<button class="btn quiet small" data-act="sat">To satchel</button>' : ''}
    <button class="btn quiet small" data-act="burn">Burn</button></div>`;
}

function render() {
  const r = run!;
  const d = $('#bd');
  app.study.setOwned(r.staff, r.trinkets, r.stash, r.reagents); // binding can use up a reagent on the desk
  const st = tomeStats();
  const nextLine = LINE_UNLOCKS.find(x => x > r.round && linesForRound(x) > r.lines.length);
  const nextWard = WARD_UNLOCKS.find(x => x > r.round && wardsForRound(x) > r.wards.length);
  const opp = r.opponent!;
  let h = `<header class="bd-head">
    <div class="bd-title"><h2>${app.screen === 'desk' ? 'The Binding Desk' : 'Your Tome'}</h2><div class="bd-sub">Round ${r.round} ${pips(r.wins, r.losses)} <span class="bd-opp">· next: <b>${esc(opp.name)}</b></span></div></div>
    <div class="bd-tabs" role="tablist"><button role="tab" data-tab="tome" class="${tab === 'tome' ? 'on' : ''}">Tome</button><button role="tab" data-tab="bind" class="${tab === 'bind' ? 'on' : ''}">Bind</button></div>
    <div class="bd-nav"><button class="btn quiet small" id="d-how" aria-label="How binding works">?</button><button class="btn quiet small" id="d-codex">Codex</button><button class="btn quiet small" id="d-leave">${app.screen === 'desk' ? 'Leave the desk' : 'Close the tome'}</button>
      <button class="btn gold" id="d-duel">Begin the duel →</button></div>
  </header>
  <main class="bd-main" data-tab="${tab}">`;
  // --- tome ---
  h += `<section class="bd-tome"><div class="bd-page">
    <div class="bd-ph"><h3>Your tome</h3></div><div class="bd-lines">`;
  r.lines.forEach((_, i) => { h += `<div class="bd-line"><span class="n">${i + 1}</span>${slotHtml({ where: 'line', i }, 'empty line')}</div>`; });
  if (nextLine) h += `<div class="bd-line locked"><span class="n">${r.lines.length + 1}</span><span class="bd-slot empty"><span class="ph">opens in round ${nextLine}</span></span></div>`;
  h += `</div>`;
  if (r.wards.length) {
    h += `<div class="bd-ph"><h3>Wards</h3></div><div class="bd-lines">`;
    r.wards.forEach((w, i) => {
      h += `<div class="bd-ward"><select data-cond="${i}" id="ward-cond-${i}" aria-label="Ward ${i + 1} condition">${WARD_CONDS.map(c => `<option value="${c.id}" ${w.cond === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>${slotHtml({ where: 'ward', i }, 'spell')}</div>`;
    });
    h += `</div>`;
  }
  if (nextWard && !r.wards.length) h += `<div class="bd-note">Wards open in round ${nextWard}.</div>`;
  h += `<div class="bd-stats"><span title="ink a loop / ink you have"><b>${st.ink}</b>/${inkForRound(r.round)} ink</span><span><b>${st.time.toFixed(0)} s</b> loop</span><span><b>${hpForRound(r.round)}</b> hp</span>${r.lib.forbidden ? `<span class="warn"><b>${r.lib.forbidden * 2}</b> Hex</span>` : ''}</div>
    </div></section>`;
  // --- altar ---
  h += `<section class="bd-altar ${born ? 'born' : ''}">
    <svg class="bd-ring" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="84" class="dash" /><circle cx="100" cy="100" r="58" /></svg>
    <div class="bd-pair">${bigSlot({ where: 'base', i: 0 }, 'Base', 'what it is')}<div class="bd-plus">+</div>${bigSlot({ where: 'inf', i: 0 }, 'Infusion', 'what it is made of')}</div>
    ${resultHtml()}
    <div class="bd-bindrow"><button class="btn gold bd-bind" id="d-bind" ${canBind() ? '' : 'disabled'}>Bind</button><span class="bd-left">${r.bindings} left</span>${r.desk.base || r.desk.inf ? '<button class="btn quiet small" id="d-clear">Clear</button>' : ''}</div>
    ${candidates()}${reagentButtons()}
  </section>`;
  // --- side ---
  h += `<section class="bd-side"><div class="bd-box"><h4>Satchel <small>${r.satchel.filter(Boolean).length}/6</small></h4><div class="bd-sat">${r.satchel.map((_, i) => slotHtml({ where: 'sat', i }, 'empty')).join('')}</div></div>
    ${sel && slotGet(r, sel) && !lastTouch ? `<div class="bd-box bd-info">${infoHtml()}</div>` : ''}</section>`;
  h += `</main>`;
  d.innerHTML = h;
  document.getElementById('bd-peek')?.classList.add('hidden'); peekKey = '';
  born = false;
  wire();
  touchSheet();
}

// On a phone there is no hovering: tapping a spell picks it up and slides its card up from the bottom,
// with what you can do with it. Tap the card's close (or the spell again) to put it down.
let lastTouch = COARSE;
function touchSheet() {
  const sh = document.getElementById('bd-sheet');
  if (!sh) return;
  const s = sel ? slotGet(run!, sel) : null;
  if (!s || !lastTouch) { sh.classList.add('hidden'); sh.innerHTML = ''; return; }
  const where = sel!.where;
  sh.innerHTML = `<div class="preview">${spellDetail(s)}</div><div class="bd-acts">
    ${where !== 'base' ? '<button class="btn small" data-act="base">To base</button>' : ''}
    ${where !== 'inf' ? '<button class="btn small" data-act="inf">To infusion</button>' : ''}
    ${where !== 'line' ? '<button class="btn quiet small" data-act="line">Write in tome</button>' : ''}
    ${where !== 'sat' ? '<button class="btn quiet small" data-act="sat">To satchel</button>' : ''}
    <button class="btn quiet small" data-act="burn">Burn</button><button class="btn quiet small" id="sh-close">Close</button></div>
    <div class="bd-sheet-hint">or tap a slot to move it there</div>`;
  sh.classList.remove('hidden');
  sh.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act!));
  $('#sh-close').onclick = () => { sel = null; render(); };
}

function canBind() {
  const r = run!;
  return !!(r.desk.base && r.desk.inf && r.bindings > 0 && !canInfuse(r.desk.base, r.desk.inf));
}

function move(from: Ref, to: Ref) {
  const r = run!;
  if (same(from, to)) return;
  const a = slotGet(r, from), b = slotGet(r, to);
  slotSet(r, to, a); slotSet(r, from, b);
  saveRun();
}

function firstFree(where: 'sat' | 'line'): number { return (where === 'sat' ? run!.satchel : run!.lines).findIndex(s => !s); }

function act(kind: string) {
  const r = run!;
  if (!sel) return;
  const s = slotGet(r, sel);
  if (!s) return;
  if (kind === 'base' || kind === 'inf') { move(sel, { where: kind, i: 0 }); sel = null; }
  else if (kind === 'sat' || kind === 'line') {
    const f = firstFree(kind);
    if (f < 0) { toast(kind === 'sat' ? 'Your satchel is full.' : 'Every line of your tome is written. Drag onto a line to swap.'); return; }
    move(sel, { where: kind, i: f }); sel = null;
  } else if (kind === 'burn') {
    const nm = resolveSpell(s).name;
    const ref = sel;
    showModal(`<div class="sheet"><h2 style="font-size:30px">Burn ${esc(nm)}?</h2><p class="lead">It is gone for good.</p><div class="actions"><button class="btn" id="m-yes">Burn it</button><button class="btn quiet" id="m-no">Keep it</button></div></div>`);
    $('#m-yes').onclick = () => { slotSet(r, ref, null); sel = null; saveRun(); closeModal(); render(); toast(`${nm} burned.`); };
    $('#m-no').onclick = closeModal;
    return;
  }
  render();
}

function bind() {
  const r = run!;
  if (!canBind()) return;
  const out = fuse(r.desk.base!, r.desk.inf!, ++r.uid);
  const res = resolveSpell(out);
  r.desk.base = out; r.desk.inf = null; r.bindings--;
  for (const id of discoveriesOf(res)) {
    if (discover(id)) {
      const name = LEGENDARY[id]?.name || Object.values(COMPOUNDS).find(c => c.id === id)?.name || id;
      toast(`Written into the Codex in gold: ${name}`, true);
    }
  }
  toast(`Bound: ${res.name}.`);
  play('bind');
  saveRun();
  sel = { where: 'base', i: 0 };
  born = true;
  render();
}

function useReagent(id: string) {
  const r = run!;
  const b = r.desk.base;
  if (!b) { toast('Put a spell on the Base first.'); return; }
  const res = resolveSpell(b);
  let ok = true, msg = '';
  switch (id) {
    case 'everburning': if (res.uses === 0) { ok = false; msg = 'It is already endless.'; } else { b.ever = (b.ever || 0) + 1; msg = 'The ink catches and does not go out.'; } break;
    case 'quicksilver': if ((b.quick || 0) >= 2 || res.read <= 0.7) { ok = false; msg = 'It cannot read any faster.'; } else { b.quick = (b.quick || 0) + 1; msg = 'The words slip out quicker.'; } break;
    case 'gilded': if (b.gilded) { ok = false; msg = 'It already has a gilded thread.'; } else { b.gilded = true; msg = 'It can now hold a fourth infusion.'; } break;
    case 'unbinding': if (!b.inf.length) { ok = false; msg = 'There is nothing bound into it.'; } else { b.inf = []; b.gilded = false; msg = 'The infusions fall away.'; } break;
  }
  if (!ok) { toast(msg); return; }
  r.reagents.splice(r.reagents.indexOf(id), 1);
  saveRun(); toast(`${REAGENTS[id].name}: ${msg}`, true); born = true; play('bind', 0.6); render();
}

function click(ref: Ref) {
  const r = run!;
  const item = slotGet(r, ref);
  if (!sel) { if (item) { sel = ref; play('page', 0.4); } render(); return; }
  if (same(sel, ref)) { sel = null; render(); return; }
  move(sel, ref);
  sel = null;
  render();
}

// ---------- pointer drag and drop (mouse and touch) ----------
let drag: { ref: Ref; x: number; y: number; ghost: HTMLElement | null; id: number; src: HTMLElement } | null = null;

function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el ? el.closest('[data-w]') as HTMLElement | null : null;
}

function onDown(e: PointerEvent) {
  lastTouch = e.pointerType !== 'mouse';
  const el = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null;
  if (!el || e.button > 0) return;
  const ref: Ref = { where: el.dataset.w as Ref['where'], i: +el.dataset.i! };
  if (!slotGet(run!, ref)) return;
  drag = { ref, x: e.clientX, y: e.clientY, ghost: null, id: e.pointerId, src: el };
}
// ----- hover a spell (in the tome, the satchel, the altar or the list of bindings) to read what it does -----
let peekKey = '';
function peek(e: PointerEvent) {
  const card = document.getElementById('bd-peek');
  if (!card) return;
  const hide = () => { card.classList.add('hidden'); peekKey = ''; };
  if (drag?.ghost || e.pointerType !== 'mouse') { hide(); return; }
  const t = e.target as HTMLElement;
  const slot = t.closest('[data-w]') as HTMLElement | null, cand = t.closest('[data-cand]') as HTMLElement | null;
  let inst: SpellInst | null = null, sealed = false, key = '', anchor: HTMLElement | null = null;
  if (slot) {
    inst = slotGet(run!, { where: slot.dataset.w as Ref['where'], i: +slot.dataset.i! });
    key = 's' + slot.dataset.w + slot.dataset.i; anchor = slot;
  } else if (cand) {
    // what this binding would make
    const r = run!, [w, i] = cand.dataset.cand!.split(':');
    const o = slotGet(r, { where: w as Ref['where'], i: +i });
    if (o) {
      inst = r.desk.base ? fuse(r.desk.base, o, 0) : fuse(o, r.desk.inf!, 0);
      sealed = discoveriesOf(resolveSpell(inst)).some(id => !isFound(id));
      key = 'c' + cand.dataset.cand; anchor = cand;
    }
  }
  if (!inst || !anchor) { hide(); return; }
  if (key !== peekKey) { card.innerHTML = spellDetail(inst, sealed); card.className = `preview ${sealed ? 'sealed' : ''}`; peekKey = key; }
  // beside the thing, on whichever side has room
  const rc = anchor.getBoundingClientRect(), cw = card.offsetWidth || 300, ch = card.offsetHeight || 200;
  const x = rc.right + 12 + cw < window.innerWidth ? rc.right + 12 : Math.max(8, rc.left - 12 - cw);
  const y = Math.max(8, Math.min(window.innerHeight - ch - 8, rc.top + rc.height / 2 - ch / 2));
  card.style.left = x + 'px'; card.style.top = y + 'px';
}

function onMove(e: PointerEvent) {
  peek(e);
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
    const chip = drag.src.querySelector('.spell, .nm') as HTMLElement | null;
    const g = document.createElement('div');
    g.className = 'bd-ghost';
    g.innerHTML = drag.src.classList.contains('bd-big') ? spellChip(slotGet(run!, drag.ref)!) : (chip ? chip.outerHTML : '');
    document.body.appendChild(g);
    drag.ghost = g;
    drag.src.classList.add('dragging');
    $('#bd').classList.add('dragmode');
  }
  e.preventDefault();
  drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
  document.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
  const t = targetAt(e.clientX, e.clientY);
  if (t && t !== drag.src) t.classList.add('over');
}
function onUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (!d.ghost) return; // a plain click; the click handler deals with it
  d.ghost.remove();
  $('#bd')?.classList.remove('dragmode');
  const t = targetAt(e.clientX, e.clientY);
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  if (t) {
    const to: Ref = { where: t.dataset.w as Ref['where'], i: +t.dataset.i! };
    if (!same(d.ref, to)) { move(d.ref, to); play('page', 0.5); sel = to.where === 'base' || to.where === 'inf' ? null : sel; }
  }
  render();
}
let suppressClick = false;

function wire() {
  const d = $('#bd');
  d.querySelectorAll<HTMLElement>('[data-w]').forEach(b => {
    const ref: Ref = { where: b.dataset.w as Ref['where'], i: +b.dataset.i! };
    b.addEventListener('click', () => { if (!suppressClick) click(ref); });
  });
  d.querySelectorAll<HTMLSelectElement>('[data-cond]').forEach(s => s.onchange = () => { run!.wards[+s.dataset.cond!].cond = s.value as WardCond; saveRun(); });
  d.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act!));
  d.querySelectorAll<HTMLButtonElement>('[data-reagent]').forEach(b => b.onclick = () => useReagent(b.dataset.reagent!));
  d.querySelectorAll<HTMLButtonElement>('[data-cand]').forEach(b => b.onclick = () => {
    const [w, i] = b.dataset.cand!.split(':');
    const r = run!;
    move({ where: w as Ref['where'], i: +i }, { where: r.desk.base ? 'inf' : 'base', i: 0 });
    sel = null; play('page', 0.5); render();
  });
  d.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab as typeof tab; render(); });
  $('#d-bind').onclick = bind;
  const clr = document.getElementById('d-clear');
  if (clr) clr.onclick = () => {
    const r = run!;
    for (const w of ['base', 'inf'] as const) {
      const s = r.desk[w]; if (!s) continue;
      const f = firstFree('sat');
      if (f < 0) { toast('Your satchel is full.'); break; }
      r.satchel[f] = s; r.desk[w] = null;
    }
    sel = null; saveRun(); render();
  };
  $('#d-codex').onclick = showCodex;
  $('#d-leave').onclick = () => setTome(false);
  $('#d-how').onclick = () => {
    showModal(`<div class="sheet" role="dialog" aria-label="How binding works"><h2 style="font-size:28px">How binding works</h2><ul class="bd-how" style="font-size:15px">
      <li><b>Base</b> decides what the spell <i>is</i>: a bolt, a summon, a curse.</li>
      <li><b>Infusion</b> adds its essence and a trait. It is used up.</li>
      <li>Two different essences form a <b>compound</b>. Exact four-part recipes become <b>legendary</b>.</li>
      <li>Reagents apply to the spell on the base.</li>
      <li>Drag spells between slots, or tap one to pick it up and tap where it goes.</li></ul>
      <div class="actions"><button class="btn quiet" id="h-close">Back to the desk</button></div></div>`);
    $('#h-close').onclick = closeModal;
  };
  $('#d-duel').onclick = () => {
    const r = run!;
    if (!r.lines.some(Boolean)) { toast('Write at least one spell on a line of your tome.'); return; }
    const loose = [r.desk.base, r.desk.inf].filter(Boolean) as SpellInst[];
    if (loose.length) {
      showModal(`<div class="sheet"><h2 style="font-size:28px">Leave the altar?</h2><p class="lead">${loose.map(s => esc(resolveSpell(s).name)).join(' and ')} ${loose.length > 1 ? 'are' : 'is'} still on the altar, not in your tome.</p><div class="actions"><button class="btn gold" id="m-go">Duel anyway</button><button class="btn quiet" id="m-stay">Stay</button></div></div>`);
      $('#m-go').onclick = () => { closeModal(); sel = null; app.go('duel'); };
      $('#m-stay').onclick = closeModal;
      return;
    }
    sel = null; app.go('duel');
  };
}

const listeners: [string, EventListener][] = [['pointerdown', onDown as EventListener], ['pointermove', onMove as EventListener], ['pointerup', onUp as EventListener], ['pointercancel', onUp as EventListener]];

// ----- the tome opens over whatever screen you are on: at the desk by sitting down, anywhere with E -----
let tomeOn = false;
let onTomeChange: (on: boolean) => void = () => {};
export const tomeOpen = () => tomeOn;
export function mountTome(host: HTMLElement, changed: (on: boolean) => void) {
  host.insertAdjacentHTML('beforeend', '<div id="bd" class="closed"></div><div id="bd-peek" class="preview hidden"></div><div id="bd-sheet" class="hidden"></div>');
  tomeOn = false; onTomeChange = changed; sel = null; tab = 'bind'; drag = null;
  const d = $('#bd');
  for (const [k, f] of listeners) d.addEventListener(k, f);
  d.addEventListener('pointerleave', () => { document.getElementById('bd-peek')?.classList.add('hidden'); peekKey = ''; });
}
export function setTome(on: boolean) {
  if (on === tomeOn || !document.getElementById('bd')) return;
  tomeOn = on;
  $('#bd').classList.toggle('closed', !on);
  // the rest of the screen's HUD steps aside while the tome is open
  for (const el of Array.from(ui().children)) if (!el.id.startsWith('bd')) el.classList.toggle('tome-hide', on);
  if (on) {
    if (document.pointerLockElement) document.exitPointerLock();
    const r = run!;
    while (r.lines.length < linesForRound(r.round)) r.lines.push(null);
    while (r.wards.length < wardsForRound(r.round)) r.wards.push({ cond: 'loop', spell: null });
    sel = null; render(); play('page', 0.5);
  } else {
    sel = null; touchSheet();
    document.querySelectorAll('.bd-ghost').forEach(g => g.remove());
    document.getElementById('bd-peek')?.classList.add('hidden'); peekKey = '';
    drag = null;
  }
  onTomeChange(on);
}
// E opens and closes the tome; Esc puts down what you hold, then closes it. True when the key was used.
export function tomeKey(e: KeyboardEvent): boolean {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return false;
  if (e.code === 'Escape' && tomeOn) {
    if (modalOpen()) closeModal(); else if (sel) { sel = null; render(); } else setTome(false);
    return true;
  }
  if (e.code === 'KeyE' && !modalOpen() && !e.repeat) { setTome(!tomeOn); return true; }
  return false;
}
// ----- the study: walk about, sit at the desk to bind, go home through the door -----
const input = { down: false, id: -1, lx: 0, ly: 0, t0: 0, moved: 0 };
let lockAllowed = true;
let handlers: { t: EventTarget; k: string; f: EventListener }[] = [];
function on(t: EventTarget, k: string, f: EventListener) { t.addEventListener(k, f); handlers.push({ t, k, f }); }
const cvs = () => app.engine.renderer.domElement;
const locked = () => document.pointerLockElement === cvs();

function setSeated(on: boolean) { setTome(on); }
function tryLock() {
  const c = cvs();
  try { const pr = c.requestPointerLock() as unknown as Promise<void> | undefined; pr?.catch?.(() => {}); } catch { /* not allowed here */ }
}
function showTip(text: string | null, x: number, y: number) {
  const tip = document.getElementById('study-tip');
  if (!tip) return;
  if (text) { tip.textContent = text; tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.remove('hidden'); } else tip.classList.add('hidden');
}
type StudyPick = ReturnType<typeof app.study.pick>;
function tipOf(p: StudyPick): string | null {
  if (!p) return null;
  if (p.kind === 'desk') return 'The Binding Desk';
  if (p.kind === 'door') return 'Back to the library';
  if (p.kind === 'book') return p.title;
  return p.s.kind === 'art' ? ARTIFACTS[p.s.id].name : REAGENTS[p.s.id].name;
}
function actOn(p: StudyPick) {
  if (!p) return;
  if (p.kind === 'desk') setSeated(true);
  else if (p.kind === 'door') { setArrival('desk'); app.go('library'); }
  else if (p.kind === 'curio') {
    showModal(`<div class="sheet" role="dialog">${p.s.kind === 'art' ? artifactCard(p.s.id) : reagentCard(p.s.id)}<div class="actions"><button class="btn quiet" id="st-close">Put it back</button></div></div>`);
    $('#st-close').onclick = closeModal;
  }
}
const onKey = (e: KeyboardEvent) => {
  const st = app.study;
  if (tomeKey(e)) return;
  if (e.code === 'Escape') { if (modalOpen()) closeModal(); return; }
  if (st.seated || modalOpen()) return;
  if (e.code === 'Enter') { actOn(st.pick(window.innerWidth / 2, window.innerHeight / 2)); return; }
  st.keys[e.code] = true;
};
const onKeyUp = (e: KeyboardEvent) => { app.study.keys[e.code] = false; };

function wireStudy() {
  const st = app.study, c = cvs();
  const walking = () => !st.seated && !modalOpen() && app.screen === 'desk';
  const paintPrompt = () => { const el = document.getElementById('look-prompt'); if (el) el.classList.toggle('hidden', COARSE || !lockAllowed || locked() || !walking()); };
  on(document, 'pointerlockerror', (() => { lockAllowed = false; paintPrompt(); }) as EventListener);
  on(document, 'pointerlockchange', (() => { paintPrompt(); if (!locked()) showTip(null, 0, 0); }) as EventListener);
  on(document, 'mousemove', ((e: MouseEvent) => {
    if (!locked() || !walking()) return;
    st.yaw -= e.movementX * 0.0022; st.pitch = Math.max(-1.35, Math.min(1.35, st.pitch - e.movementY * 0.0022));
  }) as EventListener);
  on(c, 'pointerdown', ((e: PointerEvent) => {
    if (!walking()) return;
    if (!COARSE && lockAllowed && e.pointerType === 'mouse') {
      if (!locked()) { tryLock(); return; }
      actOn(st.pick(window.innerWidth / 2, window.innerHeight / 2));
      return;
    }
    input.down = true; input.id = e.pointerId; input.lx = e.clientX; input.ly = e.clientY; input.t0 = performance.now(); input.moved = 0;
  }) as EventListener);
  on(c, 'pointermove', ((e: PointerEvent) => {
    if (!walking()) return;
    if (input.down && e.pointerId === input.id) {
      const dx = e.clientX - input.lx, dy = e.clientY - input.ly;
      input.lx = e.clientX; input.ly = e.clientY; input.moved += Math.abs(dx) + Math.abs(dy);
      st.yaw -= dx * 0.005; st.pitch = Math.max(-1.2, Math.min(1.2, st.pitch - dy * 0.005));
    } else if (!locked()) {
      const p = st.pick(e.clientX, e.clientY);
      showTip(tipOf(p), e.clientX, e.clientY);
      st.hover = p?.kind === 'curio' ? p.s : null;
    }
  }) as EventListener);
  on(c, 'pointerup', ((e: PointerEvent) => {
    if (!walking() || e.pointerId !== input.id) return;
    input.down = false;
    if (input.moved < 8 && performance.now() - input.t0 < 1500) actOn(st.pick(e.clientX, e.clientY));
  }) as EventListener);
  on(window, 'keydown', onKey as EventListener);
  on(window, 'keyup', onKeyUp as EventListener);
  on(window, 'blur', (() => { st.keys = {}; }) as EventListener);
  on(window, 'modalclosed', ((e: CustomEvent<{ relock: boolean }>) => { if (e.detail.relock && walking() && lockAllowed) tryLock(); }) as EventListener);
  // touch stick
  const j = $('#joystick'), knob = j.querySelector('.knob') as HTMLElement;
  let pid = -1, cx = 0, cy = 0;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy), max = 42;
    if (m > max) { dx = dx / m * max; dy = dy / m * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; st.joy.x = dx / max; st.joy.y = dy / max;
  };
  j.addEventListener('pointerdown', e => { pid = e.pointerId; const rc = j.getBoundingClientRect(); cx = rc.left + rc.width / 2; cy = rc.top + rc.height / 2; j.setPointerCapture(pid); move(e); e.preventDefault(); });
  j.addEventListener('pointermove', move);
  const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; knob.style.transform = ''; st.joy.x = st.joy.y = 0; };
  j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
  paintPrompt();
}

export const deskScreen: Screen = {
  mount() {
    const r = run!;
    const st = app.study;
    st.arrive();
    st.setOwned(r.staff, r.trinkets, r.stash, r.reagents);
    st.setShelf(r.shelf || []);
    app.engine.setView(st);
    ui().innerHTML = `<div id="study-hud"><div id="crosshair"></div>
        <div id="look-prompt" class="hidden">Click to look around · WASD walk · click the desk or press E to bind · the door leads back · Esc frees the mouse</div>
        <div id="joystick" class="${COARSE ? '' : 'hidden'}"><div class="knob"></div></div></div>
      <div id="study-tip" class="hidden"></div>`;
    mountTome(ui(), on => {
      st.seated = on;
      if (on) { st.hover = null; st.keys = {}; showTip(null, 0, 0); } else if (lockAllowed && !COARSE) tryLock();
    });
    wireStudy();
  },
  tick() {
    const st = app.study;
    if (st.atDoor() && !modalOpen()) { setArrival('desk'); app.go('library'); return; }
    // with the mouse captured, name whatever is under the crosshair
    if (locked() && !st.seated && !modalOpen()) {
      const p = st.pick(window.innerWidth / 2, window.innerHeight / 2);
      showTip(tipOf(p), window.innerWidth / 2, window.innerHeight / 2);
      st.hover = p?.kind === 'curio' ? p.s : null;
    }
  },
  unmount() {
    for (const h of handlers) h.t.removeEventListener(h.k, h.f);
    handlers = [];
    const st = app.study;
    st.seated = false; st.hover = null; st.keys = {}; st.joy = { x: 0, y: 0 };
    if (document.pointerLockElement) document.exitPointerLock();
    cvs().style.cursor = '';
    document.querySelectorAll('.bd-ghost').forEach(g => g.remove());
    drag = null;
    closeModal();
  },
};
