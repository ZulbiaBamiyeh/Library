// The Binding Desk: one screen, no scrolling. The tome on the left, the binding altar in the
// middle, the satchel and details on the right. Drag spells with mouse or touch, or tap to pick up and tap to place.
import { app, ui, type Screen } from './app';
import { $, artifactCard, closeModal, esc, goldHtml, modalOpen, pips, reagentCard, showModal, spellChip, spellDetail, toast } from './dom';
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
    return `<div class="bd-result empty"><div class="bd-glyph">✦</div><div>${!b && !f ? 'Drop a spell on <b>Base</b>: what the new spell <i>is</i>.<br>Then one on <b>Infusion</b>: what it is <i>made of</i>. The infusion is used up.' : !b ? 'Now add a base: the spell the infusion binds into.' : 'Now add an infusion, or pick one from the list below.'}</div></div>`;
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
  return `<div class="bd-reag"><span class="bd-reag-h">Reagents, applied to the base:</span>${ids.map(id => `<button class="bd-rg" data-reagent="${id}" title="${esc(REAGENTS[id].text)}"><img alt="" src="${reagentIcon(id)}"><span>${esc(REAGENTS[id].name)}${counts[id] > 1 ? ` ×${counts[id]}` : ''}</span></button>`).join('')}</div>`;
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
    <div class="bd-title"><h2>The Binding Desk</h2><div class="bd-sub">Round ${r.round} ${pips(r.wins, r.losses)} ${goldHtml(r.gold)}</div><div class="bd-opp">Next duel: <b>${esc(opp.name)}</b>, ${esc(opp.title || '')}</div></div>
    <div class="bd-tabs" role="tablist"><button role="tab" data-tab="tome" class="${tab === 'tome' ? 'on' : ''}">Tome</button><button role="tab" data-tab="bind" class="${tab === 'bind' ? 'on' : ''}">Bind</button></div>
    <div class="bd-nav"><button class="btn quiet small" id="d-codex">Codex</button><button class="btn quiet small" id="d-lib">Library</button><button class="btn quiet small" id="d-relax" aria-pressed="false">Sit back</button>
      <button class="btn gold" id="d-duel">Begin the duel →</button></div>
  </header>
  <main class="bd-main" data-tab="${tab}">`;
  // --- tome ---
  h += `<section class="bd-tome"><div class="bd-page">
    <div class="bd-ph"><h3>Incantation</h3><span>read top to bottom, then loops</span></div><div class="bd-lines">`;
  r.lines.forEach((_, i) => { h += `<div class="bd-line"><span class="n">${i + 1}</span>${slotHtml({ where: 'line', i }, 'empty line')}</div>`; });
  if (nextLine) h += `<div class="bd-line locked"><span class="n">${r.lines.length + 1}</span><span class="bd-slot empty"><span class="ph">opens in round ${nextLine}</span></span></div>`;
  h += `</div>`;
  if (r.wards.length) {
    h += `<div class="bd-ph"><h3>Wards</h3><span>fire when the condition happens</span></div><div class="bd-lines">`;
    r.wards.forEach((w, i) => {
      h += `<div class="bd-ward"><select data-cond="${i}" id="ward-cond-${i}" aria-label="Ward ${i + 1} condition">${WARD_CONDS.map(c => `<option value="${c.id}" ${w.cond === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>${slotHtml({ where: 'ward', i }, 'spell')}</div>`;
    });
    h += `</div>`;
  }
  if (nextWard) h += `<div class="bd-note">${r.wards.length ? 'Another ward line' : 'Ward lines, spells that fire on a condition, open'} in round ${nextWard}.</div>`;
  h += `<div class="bd-stats"><span><b>${st.ink}</b> ink a loop</span><span><b>${st.time.toFixed(0)} s</b> a loop</span><span><b>${inkForRound(r.round)}</b> ink</span><span><b>${hpForRound(r.round)}</b> health</span>${r.lib.forbidden ? `<span class="warn"><b>${r.lib.forbidden * 2}</b> Hex from forbidden books</span>` : ''}</div>
    </div></section>`;
  // --- altar ---
  h += `<section class="bd-altar ${born ? 'born' : ''}">
    <svg class="bd-ring" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="84" class="dash" /><circle cx="100" cy="100" r="58" /></svg>
    <div class="bd-pair">${bigSlot({ where: 'base', i: 0 }, 'Base', 'what it is')}<div class="bd-plus">+</div>${bigSlot({ where: 'inf', i: 0 }, 'Infusion', 'what it is made of')}</div>
    ${resultHtml()}
    <div class="bd-bindrow"><button class="btn gold bd-bind" id="d-bind" ${canBind() ? '' : 'disabled'}>Bind</button><span class="bd-left">${r.bindings} binding${r.bindings === 1 ? '' : 's'} left this round</span>${r.desk.base || r.desk.inf ? '<button class="btn quiet small" id="d-clear">Clear the altar</button>' : ''}</div>
    ${candidates()}${reagentButtons()}
  </section>`;
  // --- side ---
  h += `<section class="bd-side"><div class="bd-box"><h4>Satchel <small>${r.satchel.filter(Boolean).length}/6</small></h4><div class="bd-sat">${r.satchel.map((_, i) => slotHtml({ where: 'sat', i }, 'empty')).join('')}</div></div>
    <div class="bd-box bd-info">${infoHtml()}</div></section>`;
  h += `</main>`;
  d.innerHTML = h;
  born = false;
  wire();
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
  const el = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null;
  if (!el || e.button > 0) return;
  const ref: Ref = { where: el.dataset.w as Ref['where'], i: +el.dataset.i! };
  if (!slotGet(run!, ref)) return;
  drag = { ref, x: e.clientX, y: e.clientY, ghost: null, id: e.pointerId, src: el };
}
function onMove(e: PointerEvent) {
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
  $('#d-lib').onclick = () => { setArrival('desk'); app.go('library'); };
  $('#d-relax').onclick = () => setRelaxed(!app.study.relaxed);
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
const onKey = (e: KeyboardEvent) => {
  if (e.code === 'Escape' && app.study.relaxed && !modalOpen()) { setRelaxed(false); return; }
  if (e.code === 'Escape' && sel) { sel = null; render(); }
};

// ----- the study around the desk: sit back to take it in, and look over your curios on their shelves -----
function setRelaxed(on: boolean) {
  app.study.relaxed = on;
  document.getElementById('bd')?.classList.toggle('relaxed', on);
  document.getElementById('study-back')?.classList.toggle('hidden', !on);
  if (!on) { app.study.hover = null; document.getElementById('study-tip')?.classList.add('hidden'); app.engine.renderer.domElement.style.cursor = ''; }
}
function onStudyMove(e: PointerEvent) {
  const st = app.study;
  st.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (!st.relaxed || modalOpen()) return;
  const s = st.pick(e.clientX, e.clientY);
  st.hover = s;
  const tip = document.getElementById('study-tip');
  if (tip) {
    if (s) { tip.textContent = s.kind === 'art' ? ARTIFACTS[s.id].name : REAGENTS[s.id].name; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.classList.remove('hidden'); }
    else tip.classList.add('hidden');
  }
  app.engine.renderer.domElement.style.cursor = s ? 'pointer' : '';
}
function onStudyClick(e: PointerEvent) {
  const st = app.study;
  if (!st.relaxed || modalOpen()) return;
  const s = st.pick(e.clientX, e.clientY);
  if (!s) return;
  showModal(`<div class="sheet" role="dialog">${s.kind === 'art' ? artifactCard(s.id) : reagentCard(s.id)}<div class="actions"><button class="btn quiet" id="st-close">Put it back</button></div></div>`);
  $('#st-close').onclick = closeModal;
}

export const deskScreen: Screen = {
  mount() {
    const r = run!;
    const st = app.study;
    st.relaxed = false;
    st.setOwned(r.staff, r.trinkets, r.stash, r.reagents);
    app.engine.setView(st);
    while (r.lines.length < linesForRound(r.round)) r.lines.push(null);
    while (r.wards.length < wardsForRound(r.round)) r.wards.push({ cond: 'loop', spell: null });
    ui().innerHTML = `<div id="bd"></div><div id="study-tip" class="hidden"></div><button id="study-back" class="btn quiet hidden">Back to the desk</button>`;
    $('#study-back').onclick = () => setRelaxed(false);
    sel = null;
    // put the first new spell in reach: if the tome has room and the satchel has spells, the tab opens on Bind
    tab = 'bind';
    render();
    const d = $('#bd');
    for (const [k, f] of listeners) d.addEventListener(k, f);
    window.addEventListener('keydown', onKey);
    const cv = app.engine.renderer.domElement;
    cv.addEventListener('pointermove', onStudyMove); cv.addEventListener('pointerup', onStudyClick);
  },
  unmount() {
    const cv = app.engine.renderer.domElement;
    cv.removeEventListener('pointermove', onStudyMove); cv.removeEventListener('pointerup', onStudyClick);
    cv.style.cursor = '';
    app.study.relaxed = false; app.study.hover = null;
    window.removeEventListener('keydown', onKey);
    document.querySelectorAll('.bd-ghost').forEach(g => g.remove());
    drag = null;
    closeModal();
  },
};
