// The Binding Desk: fuse spells, apply reagents, and write the tome.
import { app, ui, type Screen } from './app';
import { $, closeModal, esc, goldHtml, pips, showModal, spellChip, spellDetail, toast } from './dom';
import { run, saveRun, slotGet, slotSet, type Ref } from '../game/run';
import { discover, isFound } from '../game/codex';
import { canInfuse, discoveriesOf, fuse, resolveSpell, type SpellInst } from '../data/fusion';
import { REAGENTS } from '../data/artifacts';
import { COMPOUNDS, LEGENDARY } from '../data/codex';
import { WARD_CONDS, type WardCond } from '../sim/types';
import { PACE } from '../sim/duel';
import { hpForRound, inkForRound, linesForRound, wardsForRound } from '../game/progression';
import { reagentIcon } from '../render/icons';
import { showCodex } from './codexUI';
import { setArrival } from './libraryUI';
import { play } from '../audio/sfx';

let sel: Ref | null = null;
let shimmer = false;

const same = (a: Ref | null, b: Ref) => !!a && a.where === b.where && a.i === b.i;
const refAttr = (r: Ref) => `data-w="${r.where}" data-i="${r.i}"`;

function slotHtml(ref: Ref, empty: string, cls = 'slot') {
  const s = slotGet(run!, ref);
  const isSel = same(sel, ref);
  const tgt = sel && !isSel;
  return `<button class="${cls} ${s ? '' : 'empty'} ${isSel ? 'selected' : ''} ${tgt ? 'target' : ''}" ${refAttr(ref)} ${s ? 'draggable="true"' : ''} aria-label="${esc(s ? resolveSpell(s).name : empty)}">${s ? spellChip(s) : esc(empty)}</button>`;
}

function describeTome() {
  const r = run!;
  let ink = 0, time = 0, n = 0;
  for (const s of r.lines) {
    if (!s) continue;
    const res = resolveSpell(s);
    ink += res.ink; time += Math.max(PACE.minCycle, res.read + PACE.recover); n++;
  }
  return { ink, time: time + PACE.recharge, n };
}

function preview(): string {
  const r = run!;
  const b = r.desk.base, f = r.desk.inf;
  if (!b && !f) return `<div class="dim" style="font-size:14px;margin-top:8px">Place a spell as the <b>base</b> (what it is) and another as the <b>infusion</b> (what it's made of). The infusion is used up.</div>`;
  if (b && !f) return `<div class="preview">${spellDetail(b)}</div>`;
  if (!b && f) return `<div class="dim" style="font-size:14px;margin-top:8px">Now place a base spell to bind ${esc(resolveSpell(f).name)} into.</div>`;
  const err = canInfuse(b!, f!);
  if (err) return `<div class="preview">${spellDetail(b!)}</div><div class="dim" style="margin-top:6px;font-size:13px">${esc(err)}</div>`;
  const out = fuse(b!, f!, 0);
  const res = resolveSpell(out);
  const sealed = discoveriesOf(res).some(id => !isFound(id));
  return `<div class="preview ${sealed ? 'sealed' : ''} ${shimmer ? 'shimmer' : ''}">${spellDetail(out, sealed)}</div>`;
}

function render() {
  const r = run!;
  const d = $('#desk');
  const info = describeTome();
  const selItem = sel ? slotGet(r, sel) : null;
  let h = `<div class="desk-head"><div><h2>The Binding Desk</h2><div class="sub">Round ${r.round} ${pips(r.wins, r.losses)} · ${goldHtml(r.gold)}</div></div>
    <div class="acts"><button class="btn quiet small" id="d-codex">Codex</button><button class="btn quiet small" id="d-lib">← Library</button><button class="btn quiet small" id="d-shop">Curio Shop</button></div></div>`;
  h += `<div class="desk-grid"><div>`;
  h += `<div class="spread"><div class="page left"><h3>Incantation</h3><div class="note">Read top to bottom, then it loops. Spent once spells are skipped.</div>`;
  const maxLines = 10;
  for (let i = 0; i < maxLines; i++) {
    if (i >= r.lines.length) {
      const unlock = [2, 4, 6, 8, 10].filter(x => x > r.round)[i - r.lines.length];
      if (!unlock) continue;
      h += `<div class="line locked"><span class="num">${i + 1}</span><span class="slot">Unlocks in round ${unlock}</span></div>`;
      continue;
    }
    h += `<div class="line"><span class="num">${i + 1}</span>${slotHtml({ where: 'line', i }, 'empty line')}</div>`;
  }
  h += `<div class="tome-stats">One loop costs about <b>${info.ink} ink</b> and takes about <b>${info.time.toFixed(0)} s</b>. You have <b>${inkForRound(r.round)} ink</b>, regaining 4 per second, and <b>${hpForRound(r.round)} health</b>.${r.lib.forbidden ? `<br>Forbidden reading: you start the next duel with <b>${r.lib.forbidden * 2} Hex</b>.` : ''}</div></div>`;
  h += `<div class="page right"><h3>Wards</h3><div class="note">When the condition happens, the spell fires at once, if you have the ink.</div>`;
  r.wards.forEach((w, i) => {
    h += `<div class="ward"><select data-cond="${i}" aria-label="Ward ${i + 1} condition">${WARD_CONDS.map(c => `<option value="${c.id}" ${w.cond === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select><span class="arrow">→</span>${slotHtml({ where: 'ward', i }, 'spell')}</div>`;
  });
  const nextW = [3, 6].filter(x => x > r.round)[0];
  if (nextW && r.wards.length < 4) h += `<div class="ward" style="opacity:.45;grid-template-columns:1fr"><span style="font-family:var(--serif);font-style:italic;font-size:14px;padding:0 4px">Another ward line unlocks in round ${nextW}</span></div>`;
  const wc = r.wards.map(w => WARD_CONDS.find(c => c.id === w.cond)?.text).filter(Boolean);
  h += `<div class="tome-stats">${wc.map(t => `· ${esc(t!)}`).join('<br>')}</div>`;
  h += `</div></div></div>`;
  // side column
  h += `<div class="side-col"><div class="panel"><h4>Bind <small>${r.bindings} binding${r.bindings === 1 ? '' : 's'} left this round</small></h4>
    <div class="bind-slots"><div>${bindSlot({ where: 'base', i: 0 }, 'Base')}</div><div class="plus">+</div><div>${bindSlot({ where: 'inf', i: 0 }, 'Infusion')}</div></div>
    ${preview()}
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn gold" id="d-bind" ${canBind() ? '' : 'disabled'}>Bind</button><button class="btn quiet small" id="d-clear" ${r.desk.base || r.desk.inf ? '' : 'disabled'}>Return to satchel</button></div>
    ${r.reagents.length ? `<h4 style="margin-top:14px">Reagents <small>applied to the base</small></h4><div class="reagents">${reagentButtons()}</div>` : ''}
  </div>`;
  h += `<div class="panel"><h4>Satchel <small>6 slots</small></h4><div class="sat-grid">${r.satchel.map((_, i) => slotHtml({ where: 'sat', i }, 'empty')).join('')}</div></div>`;
  h += `<div class="panel inspect">${selItem ? `<div class="preview">${spellDetail(selItem)}</div><div class="acts">
      <button class="btn small" data-act="base">As base</button><button class="btn small" data-act="inf">As infusion</button><button class="btn quiet small" data-act="sat">To satchel</button><button class="btn quiet small" data-act="burn">Burn</button></div>`
    : `<h4>How it works</h4><div class="dim">Tap a spell, then tap where it should go, or drag it. The base decides what the spell <i>is</i>; the infusion decides what it's <i>made of</i>. Two different essences in one spell can form a compound. Some exact four-part recipes become legendary.</div>`}</div>`;
  h += `</div></div>`;
  const opp = r.opponent!;
  h += `<div class="desk-foot"><div class="opp-preview">Your next opponent: <b>${esc(opp.name)}</b>, ${esc(opp.title || '')}</div><button class="btn gold" id="d-duel" style="font-size:22px;padding:14px 22px">Begin the duel</button></div>`;
  d.innerHTML = h;
  shimmer = false;
  wire();
}

function bindSlot(ref: Ref, label: string) {
  const s = slotGet(run!, ref);
  const isSel = same(sel, ref);
  return `<button class="bind-slot ${isSel ? 'selected' : ''} ${sel && !isSel ? 'target' : ''}" ${refAttr(ref)} ${s ? 'draggable="true"' : ''}><span class="lbl">${label}</span>${s ? spellChip(s) : '<span class="dim" style="font-family:var(--serif);font-style:italic">empty</span>'}</button>`;
}

function reagentButtons() {
  const counts: Record<string, number> = {};
  for (const x of run!.reagents) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts).map(([id, n]) => `<button class="reagent" data-reagent="${id}" title="${esc(REAGENTS[id].text)}"><img alt="" src="${reagentIcon(id)}"><span>${esc(REAGENTS[id].name)}${n > 1 ? ` ×${n}` : ''}</span></button>`).join('');
}

function canBind() {
  const r = run!;
  return !!(r.desk.base && r.desk.inf && r.bindings > 0 && !canInfuse(r.desk.base, r.desk.inf));
}

function move(from: Ref, to: Ref) {
  const r = run!;
  const a = slotGet(r, from), b = slotGet(r, to);
  slotSet(r, to, a); slotSet(r, from, b);
  saveRun();
}

function firstFreeSat(): number { return run!.satchel.findIndex(s => !s); }

function act(kind: string) {
  const r = run!;
  if (!sel) return;
  const s = slotGet(r, sel);
  if (!s) return;
  if (kind === 'base' || kind === 'inf') { move(sel, { where: kind, i: 0 }); sel = null; }
  else if (kind === 'sat') {
    if (sel.where === 'sat') return;
    const f = firstFreeSat();
    if (f < 0) { toast('Your satchel is full.'); return; }
    move(sel, { where: 'sat', i: f }); sel = null;
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
  shimmer = true;
  render();
}

function useReagent(id: string) {
  const r = run!;
  const b = r.desk.base;
  if (!b) { toast('Put a spell in the Base slot first.'); return; }
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
  saveRun(); toast(`${REAGENTS[id].name}: ${msg}`, true); shimmer = true; render();
}

function click(ref: Ref) {
  const r = run!;
  const item = slotGet(r, ref);
  if (!sel) { if (item) sel = ref; render(); return; }
  if (same(sel, ref)) { sel = null; render(); return; }
  move(sel, ref); sel = null; render();
}

function wire() {
  const d = $('#desk');
  d.querySelectorAll<HTMLElement>('[data-w]').forEach(b => {
    const ref: Ref = { where: b.dataset.w as Ref['where'], i: +b.dataset.i! };
    b.onclick = () => click(ref);
    b.addEventListener('dragstart', e => { sel = ref; e.dataTransfer?.setData('text/plain', JSON.stringify(ref)); b.style.opacity = '.5'; });
    b.addEventListener('dragend', () => { b.style.opacity = ''; });
    b.addEventListener('dragover', e => { e.preventDefault(); b.classList.add('dragover'); });
    b.addEventListener('dragleave', () => b.classList.remove('dragover'));
    b.addEventListener('drop', e => {
      e.preventDefault(); b.classList.remove('dragover');
      try { const from = JSON.parse(e.dataTransfer!.getData('text/plain')) as Ref; if (!same(from, ref)) move(from, ref); } catch { /* ignore */ }
      sel = null; render();
    });
  });
  d.querySelectorAll<HTMLSelectElement>('[data-cond]').forEach(s => s.onchange = () => { run!.wards[+s.dataset.cond!].cond = s.value as WardCond; saveRun(); render(); });
  d.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act!));
  d.querySelectorAll<HTMLButtonElement>('[data-reagent]').forEach(b => b.onclick = () => useReagent(b.dataset.reagent!));
  $('#d-bind').onclick = bind;
  $('#d-clear').onclick = () => {
    const r = run!;
    for (const w of ['base', 'inf'] as const) {
      const s = r.desk[w]; if (!s) continue;
      const f = firstFreeSat();
      if (f < 0) { toast('Your satchel is full.'); break; }
      r.satchel[f] = s; r.desk[w] = null;
    }
    saveRun(); render();
  };
  $('#d-codex').onclick = showCodex;
  $('#d-lib').onclick = () => { setArrival('desk'); app.go('library'); };
  $('#d-shop').onclick = () => app.go('shop');
  $('#d-duel').onclick = () => {
    const r = run!;
    if (!r.lines.some(Boolean)) { toast('Write at least one spell on a line of your tome.'); return; }
    const loose = [r.desk.base, r.desk.inf].filter(Boolean) as SpellInst[];
    if (loose.length) {
      showModal(`<div class="sheet"><h2 style="font-size:28px">Leave the desk?</h2><p class="lead">${loose.map(s => esc(resolveSpell(s).name)).join(' and ')} ${loose.length > 1 ? 'are' : 'is'} still on the desk, not in your tome. ${r.bindings ? `You also have ${r.bindings} binding${r.bindings > 1 ? 's' : ''} left.` : ''}</p><div class="actions"><button class="btn gold" id="m-go">Duel anyway</button><button class="btn quiet" id="m-stay">Stay</button></div></div>`);
      $('#m-go').onclick = () => { closeModal(); sel = null; app.go('duel'); };
      $('#m-stay').onclick = closeModal;
      return;
    }
    sel = null; app.go('duel');
  };
}

export const deskScreen: Screen = {
  mount() {
    const lib = app.library;
    lib.titleSpin = false;
    lib.pos.set(0, 2.5, 6.6); lib.yaw = Math.PI; lib.pitch = -0.55;
    app.engine.setView(lib);
    // keep the tome line count in sync with the round
    const r = run!;
    while (r.lines.length < linesForRound(r.round)) r.lines.push(null);
    while (r.wards.length < wardsForRound(r.round)) r.wards.push({ cond: 'struck', spell: null });
    ui().innerHTML = `<div id="desk"></div>`;
    sel = null;
    render();
  },
  unmount() { closeModal(); },
};
