// Duel playback: runs the simulation once, then plays its event log on the board.
import * as THREE from 'three';
import { app, ui, type Screen } from './app';
import { $, closeModal, esc, goldHtml, pips, showModal, toast } from './dom';
import { run, saveRun, playerTome, prepareRound, saveGhost, clearRun, store } from '../game/run';
import { discover } from '../game/codex';
import { runDuel } from '../sim/duel';
import type { BreakdownItem, DuelEvent, DuelResult, Snap } from '../sim/types';
import { ESS, SPELLS } from '../data/spells';
import { ARTIFACTS } from '../data/artifacts';
import { STATUSES, STATUS_INFO, REACTIONS } from '../data/codex';
import type { Resolved } from '../data/fusion';
import { hashStr } from '../sim/rng';
import { goldForResult, MAX_LOSSES, MAX_WINS } from '../game/progression';
import { artifactIcon } from '../render/icons';
import { castSound, impactSound, play, type Sfx } from '../audio/sfx';

const ROBES: Record<string, string> = {
  'Affliction Warlock': '#2a0f2a', 'Imp Engine': '#6a1a12', 'Frost Lock': '#1a3050', 'Storm Conductor': '#5a4a12',
  'Trickster': '#3a1a5a', 'Holy Martyr': '#8a7a50', 'Plaguebringer': '#2a4020', 'Stone Warden': '#4a4038', 'Your own ghost': '#1a2a3a',
  'Pyroclast': '#7a2a0a', 'Wintershade': '#1a2440', 'Chronomancer': '#3a2060', 'Tinker': '#4a3a20',
};

let res: DuelResult;
let T = 0, speed = 1, slow = 1, paused = false, ei = 0, si = 0, ended = false, resultShown = false;
let outcome: { won: boolean; draw: boolean; gold: number; over: boolean } | null = null;
let lineEls: [HTMLElement[], HTMLElement[]] = [[], []];
let wardEls: [HTMLElement[], HTMLElement[]] = [[], []];
let lastOrder = ['', ''];
let lastChips = ['', ''];
const castTotals = new Map<number, { side: number; name: string; dmg: number; heal: number; t: number }>();
const reactTimes: number[] = [];
let newFinds: string[] = [];
const unitBars = new Map<number, HTMLElement>();
let calloutT = 0, castbarT = [0, 0], artFlash: Record<string, number> = {};
const tmp = new THREE.Vector3();
let duelRound = 1;

function project(p: THREE.Vector3): { x: number; y: number; ok: boolean } {
  tmp.copy(p).project(app.board.camera);
  return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight, ok: tmp.z < 1 };
}

function floatNum(pos: THREE.Vector3, text: string, cls: string, color?: string) {
  const p = project(pos);
  if (!p.ok) return;
  const el = document.createElement('div');
  el.className = 'fnum ' + cls;
  el.textContent = text;
  el.style.left = (p.x + (Math.random() - 0.5) * 30) + 'px'; el.style.top = p.y + 'px';
  if (color && cls === 'dmg') el.style.color = mix(color);
  if (color && cls === 'dot') el.style.color = color;
  $('#labels').appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
function mix(c: string) { const a = new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.55); return '#' + a.getHexString(); }

function plateHtml(side: 0 | 1) {
  const n = res.names[side];
  const title = side === 0 ? `Apprentice · run ${run!.runNo}` : (run!.opponent?.title || '');
  const arts = res.arts[side].map(id => `<span class="a" data-art="${side}:${id}" title="${esc(ARTIFACTS[id]?.name || id)}: ${esc(ARTIFACTS[id]?.text || '')}"><img alt="" src="${artifactIcon(id)}"></span>`).join('');
  return `<div class="who"><span class="n">${esc(n)}</span><span class="t">${esc(title)}</span></div>
    <div class="bar hp ${side === 0 ? 'me' : ''}"><i class="lag"></i><i class="v"></i></div>
    <div style="display:flex;justify-content:space-between;${side ? 'flex-direction:row-reverse;' : ''}"><span class="hpnum"></span><span class="hpnum inknum"></span></div>
    <div class="bar ink"><i class="v"></i></div>
    <div class="chips"></div><div class="arts">${arts}</div>`;
}

function tomeHtml(side: 0 | 1) {
  const lines = res.lines[side];
  let h = '<div class="lbl">Incantation</div>';
  lines.forEach((r, idx) => {
    if (!r) return;
    h += `<div class="tl" data-idx="${idx}" style="--school:${ESS[SPELLS[r.base.id].school].spine};--glow:${ESS[r.primary].color}"><span class="fill"></span><span class="num">${idx + 1}</span><span class="nm">${esc(r.name)}</span><span class="u"></span></div>`;
  });
  const wards = res.wards[side].map((w, i) => w ? `<div class="tl ward-l" data-ward="${i}" style="--school:${ESS[SPELLS[w.res.base.id].school].spine};--glow:${ESS[w.res.primary].color}"><span class="fill"></span><span class="nm">${esc(condName(w.cond))} → ${esc(w.res.name)}</span><span class="cd"></span></div>` : '').join('');
  if (wards) h += `<div class="lbl">Wards</div>${wards}`;
  return h;
}
function condName(c: string) { return ({ struck: 'Struck', half: 'Below half', every8: 'Every 8 s', loop: 'On loop', afflicted: 'Afflicted', summondies: 'Summon dies' } as Record<string, string>)[c] || c; }

function usesText(r: Resolved, left: number) {
  if (r.uses === 0) return '∞';
  if (r.uses === 1) return left > 0 ? '<span class="seal"></span>' : '<span class="seal melted"></span>';
  return `${left}/${r.uses}`;
}

function updateHud(s: Snap) {
  s.m.forEach((m, side) => {
    const plate = $(side === 0 ? '#plate-me' : '#plate-them');
    const k = Math.max(0, m.hp / m.maxHp);
    (plate.querySelector('.bar.hp .v') as HTMLElement).style.width = (k * 100) + '%';
    (plate.querySelector('.bar.hp .lag') as HTMLElement).style.width = (k * 100) + '%';
    (plate.querySelector('.hpnum') as HTMLElement).textContent = `${Math.ceil(m.hp)} / ${m.maxHp}`;
    (plate.querySelector('.inknum') as HTMLElement).textContent = `${Math.floor(m.ink)} ink`;
    (plate.querySelector('.bar.ink .v') as HTMLElement).style.width = (100 * m.ink / m.maxInk) + '%';
    let chips = '';
    STATUSES.forEach((st, i) => { const n = m.st[i]; if (n > 0) chips += `<span class="chip" style="color:${STATUS_INFO[st].color}"><i style="background:${STATUS_INFO[st].color}"></i>${STATUS_INFO[st].name} ${n}</span>`; });
    for (const c of m.curses) chips += `<span class="chip curse" data-key="${c.key}" style="color:${ESS[c.ess].color}"><i style="background:${ESS[c.ess].color}"></i>${esc(c.name)}${c.left !== undefined ? ` ${Math.ceil(c.left)}s` : ''}</span>`;
    for (const a of m.auras) chips += `<span class="chip aura" style="color:${ESS[a.ess].color}"><i style="background:${ESS[a.ess].color}"></i>${esc(a.name)}</span>`;
    if (m.block) chips += `<span class="chip wd">Ward ×${m.block}</span>`;
    if (m.mirror) chips += `<span class="chip wd">Mirror</span>`;
    if (m.counter) chips += `<span class="chip wd">Counter</span>`;
    if (m.sanctuary) chips += `<span class="chip wd">Sanctuary</span>`;
    if (m.angel) chips += `<span class="chip wd">Guardian Angel</span>`;
    if (m.frozen) chips += `<span class="chip" style="color:#9fdcff"><i style="background:#9fdcff"></i>Frozen</span>`;
    if (m.morph) chips += `<span class="chip" style="color:#c59bff"><i style="background:#c59bff"></i>${m.morph === 'imp' ? 'Impmorphed' : 'Sheep'}</span>`;
    if (m.silence) chips += `<span class="chip">Silenced</span>`;
    if (m.hexSelf) chips += `<span class="chip curse">Babel ×${m.hexSelf}</span>`;
    if (chips !== lastChips[side]) { (plate.querySelector('.chips') as HTMLElement).innerHTML = chips; lastChips[side] = chips; }
    // tome
    const col = $(side === 0 ? '#tome-me' : '#tome-them');
    const orderKey = m.order.join(',');
    if (orderKey !== lastOrder[side]) {
      lastOrder[side] = orderKey;
      const first = col.querySelector('.lbl');
      let prev: Element | null = first;
      for (const idx of m.order) { const el = lineEls[side][idx]; if (el && prev) { prev.after(el); prev = el; } }
    }
    const readingIdx = m.phase === 'reading' ? m.order[m.line] : -1;
    const nextPos: number[] = [];
    for (let p = 0; p < m.order.length && nextPos.length < 3; p++) {
      const pos = (Math.max(0, m.line) + p) % m.order.length;
      nextPos.push(m.order[pos]);
    }
    m.order.forEach((idx) => {
      const el = lineEls[side][idx]; if (!el) return;
      const r = res.lines[side][idx]!;
      const left = m.uses[idx] ?? -1;
      const spent = left === 0;
      el.classList.toggle('spent', spent);
      el.classList.toggle('blot', m.blots.includes(idx));
      el.classList.toggle('reading', idx === readingIdx);
      el.classList.toggle('show-m', nextPos.includes(idx));
      (el.querySelector('.fill') as HTMLElement).style.width = idx === readingIdx ? `${Math.min(100, 100 * m.prog / Math.max(0.01, m.total))}%` : '0%';
      const u = el.querySelector('.u') as HTMLElement;
      const ut = usesText(r, left < 0 ? 1 : left);
      if (u.dataset.v !== ut) { u.innerHTML = ut; u.dataset.v = ut; }
    });
    wardEls[side].forEach((el, i) => {
      if (!el) return;
      const cd = m.wardCd[i], left = m.wardUses[i];
      (el.querySelector('.cd') as HTMLElement).textContent = left === 0 ? 'spent' : cd > 0 ? `${Math.ceil(cd)}s` : '';
      el.classList.toggle('spent', left === 0);
    });
  });
  const vs = $('#vs');
  vs.innerHTML = `Round ${duelRound}<b>${Math.floor(Math.max(0, s.t))}s</b>`;
  vs.classList.toggle('sudden', s.t > 75);
}

function castbar(side: number, html: string) {
  const el = $(side === 0 ? '#cb-me' : '#cb-them');
  el.innerHTML = html; el.classList.add('on');
  castbarT[side] = 2.4;
}

function callout(text: string, sub: string, side: number, gold?: boolean) {
  const c = $('#callout');
  c.className = 'show ' + (side === 0 ? 'mine' : 'theirs');
  c.innerHTML = `<div class="w">${side === 0 ? 'Yours' : 'Theirs'}</div><div class="t" style="${gold ? '' : 'color:#f0e0ff'}">${esc(text)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}`;
  calloutT = 2.2;
  slow = Math.min(slow, 0.3);
}

function soundFor(ev: DuelEvent) {
  switch (ev.type) {
    case 'cast': castSound(ev.ess, ev.form === 'burst'); if (ev.legendary) play('legend'); break;
    case 'dmg': if (ev.kind !== 'dot' && ev.kind !== 'curse' && ev.amt >= 2) impactSound(ev.ess, Math.min(2, ev.amt / 15)); break;
    case 'react': play(({ frozen: 'freeze', shatter: 'shatter', blaze: 'blaze', conduct: 'conduct', resist: 'block' } as Record<string, Sfx>)[ev.id] || 'react'); break;
    case 'spawn': play('summon', ev.temp ? 0.5 : 1); break;
    case 'heal': if (ev.amt >= 4) play('heal'); break;
    case 'curse': play('curse'); break;
    case 'death': if (ev.tgt < 2) play('death'); break;
    case 'end': setTimeout(() => play(ev.winner === 0 ? 'victory' : 'defeat'), 400); break;
    case 'wardUse': play(ev.kind === 'mirror' ? 'reflect' : 'block'); break;
    case 'ward': play('ward'); break;
    case 'fizzle': play('fizzle'); break;
    case 'strike': if (ev.ess === 'storm') play('thunder', 0.6); break;
    case 'callout': if (ev.gold) play('legend'); else play('react'); break;
    case 'art': play('artifact'); break;
    case 'morph': play('sheep'); break;
    case 'burst': if (ev.flight <= 0) play('burst'); else setTimeout(() => play('burst'), ev.flight * 1000 / Math.max(0.25, speed)); break;
  }
}

function onEvent(ev: DuelEvent) {
  soundFor(ev);
  switch (ev.type) {
    case 'read': castbar(ev.side, `<span style="color:${ESS[ev.ess].color}">Reading</span> ${esc(ev.name)}`); break;
    case 'cast': {
      castTotals.set(ev.castId, { side: ev.side, name: ev.name, dmg: 0, heal: 0, t: T });
      castbar(ev.side, `${ev.via ? `<span class="dim">${esc(ev.via)}:</span> ` : ''}<span style="color:${ESS[ev.ess].color}">${esc(ev.name)}</span><span class="res" id="cr-${ev.castId}"></span>`);
      if (ev.line >= 0) { const el = lineEls[ev.side][ev.line]; if (el) { el.classList.remove('cast'); void el.offsetWidth; el.classList.add('cast'); } }
      if (ev.legendary) slow = Math.min(slow, 0.35);
      break;
    }
    case 'wardLine': { const el = wardEls[ev.side][ev.idx]; if (el) { el.classList.remove('cast'); void el.offsetWidth; el.classList.add('cast'); } break; }
    case 'dmg': {
      if (ev.castId) {
        const c = castTotals.get(ev.castId);
        if (c) { c.dmg += ev.amt; const e = document.getElementById('cr-' + ev.castId); if (e) e.textContent = `${Math.round(c.dmg)} damage`; }
      }
      break;
    }
    case 'fizzle': castbar(ev.side, `<span class="dim">${esc(ev.name || 'Spell')}:</span> <span style="color:#e07a86">${esc(ev.reason)}</span>`); break;
    case 'react': {
      if (ev.id !== 'resist' && REACTIONS.some(r => r.id === ev.id)) {
        if (discover(ev.id)) { toast(`New reaction in your Codex: ${ev.name}`, true); newFinds.push(ev.name); }
        slow = Math.min(slow, 0.45);
        reactTimes.push(T);
        while (reactTimes.length && reactTimes[0] < T - 2) reactTimes.shift();
        if (reactTimes.length === 3) callout('Chain reaction!', `${reactTimes.length} reactions in a breath`, ev.tgt < 2 ? 1 - ev.tgt : (app.board.units.get(ev.tgt)?.side === 0 ? 1 : 0), true);
      }
      break;
    }
    case 'callout': callout(ev.text, ev.sub, ev.side, ev.gold); break;
    case 'curse': case 'cursePulse': {
      const el = document.querySelector(`.chip.curse[data-key="${ev.key}"]`);
      if (el) { el.classList.remove('pulse'); void (el as HTMLElement).offsetWidth; el.classList.add('pulse'); }
      break;
    }
    case 'art': {
      const k = `${ev.side}:${ev.id}`;
      const el = document.querySelector(`[data-art="${k}"]`);
      if (el) { el.classList.add('flash'); artFlash[k] = 0.9; }
      const p = app.board.bodyPos(ev.side).setY(2.6);
      floatNum(p, ev.text || ARTIFACTS[ev.id]?.name || '', 'dot', ARTIFACTS[ev.id]?.model.glow);
      break;
    }
    case 'sudden': banner('Sudden Death', true); break;
    case 'death': if (ev.tgt < 2) slow = 0.2; break;
    case 'end': {
      ended = true;
      const won = ev.winner === 0;
      setTimeout(() => banner(ev.winner === -1 ? 'A Draw' : won ? 'Victory' : 'Defeat', !won), 350);
      break;
    }
  }
}

function banner(text: string, red = false) {
  const b = document.getElementById('banner');
  if (b) b.remove();
  const el = document.createElement('div');
  el.id = 'banner'; el.className = red ? 'red' : ''; el.textContent = text;
  ui().appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function updateUnitBars() {
  const seen = new Set<number>();
  for (const u of app.board.units.values()) {
    if (!u.alive || !u.snap) continue;
    seen.add(u.id);
    let el = unitBars.get(u.id);
    if (!el) {
      el = document.createElement('div');
      el.className = `ubar ${u.side === 0 ? 'me' : 'them'} ${u.snap.temp ? 'temp' : ''}`;
      el.innerHTML = '<i></i>';
      $('#labels').appendChild(el); unitBars.set(u.id, el);
    }
    const p = project(tmp.copy(u.group.position).setY(u.group.position.y + u.height + 0.25));
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    (el.firstChild as HTMLElement).style.width = `${100 * Math.max(0, u.snap.hp / u.snap.maxHp)}%`;
  }
  for (const [id, el] of unitBars) if (!seen.has(id)) { el.remove(); unitBars.delete(id); }
}

function setSpeed(s: number) {
  speed = s; paused = false;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +(b as HTMLElement).dataset.speed! === s));
  $('#d-pause').textContent = 'Pause';
}

function applyResult() {
  const r = run!;
  const won = res.winner === 0;
  const draw = res.winner === -1;
  const gold = goldForResult(r.round, won);
  r.gold += gold;
  if (won) r.wins++; else if (!draw) r.losses++;
  r.history.push({ round: r.round, won, name: res.names[1], title: r.opponent?.title || '' });
  for (const id of res.found) discover(id);
  saveGhost(r);
  const over = r.wins >= MAX_WINS || r.losses >= MAX_LOSSES;
  const best = store.get('inkbound2.best', 0);
  if (over && r.wins > best) store.set('inkbound2.best', r.wins);
  // advance now, so a reload can't replay the same round for more gold
  if (!over) { r.round++; prepareRound(); } else saveRun();
  return { won, draw, gold, over };
}

// ----- damage breakdown on the result sheet -----
type Book = 'dealt' | 'taken' | 'healed';
let bdSide = 0, bdBook: Book = 'dealt';
const ART_NAMES = new Set(Object.values(ARTIFACTS).map(a => a.name));
const KIND_NAME: Record<string, string> = { spell: 'Spell', summon: 'Summon', status: 'Status', curse: 'Curse', field: 'Field', reaction: 'Reaction', retribution: 'Aura', heal: '', other: '' };
const KIND_COLOR: Record<string, string> = { status: '#b0603a', reaction: '#c9a13b', heal: '#3f9a6a', other: '#7a6a8a' };

function breakdownRows(): string {
  const items: BreakdownItem[] = res.breakdown[bdSide][bdBook];
  const total = items.reduce((a, e) => a + e.amt, 0);
  if (!total) return `<p class="brk-empty">${bdBook === 'healed' ? 'No healing.' : 'Nothing here.'}</p>`;
  const shown = items.slice(0, 8);
  const rest = items.slice(8);
  if (rest.length) shown.push({ label: `${rest.length} other source${rest.length > 1 ? 's' : ''}`, amt: rest.reduce((a, e) => a + e.amt, 0), ess: null, kind: 'other' });
  const max = Math.max(...shown.map(e => e.amt));
  return shown.map(e => {
    const art = ART_NAMES.has(e.label.replace(/ \(own\)$/, ''));
    const color = e.ess ? ESS[e.ess].color : bdBook === 'healed' ? KIND_COLOR.heal : KIND_COLOR[e.kind] || KIND_COLOR.other;
    const kind = art ? 'Curio' : bdBook === 'healed' ? '' : KIND_NAME[e.kind] ?? '';
    return `<div class="brk-row"><div class="brk-name">${esc(e.label)}${kind ? `<small>${kind}</small>` : ''}</div>
      <div class="brk-bar"><i style="width:${(100 * e.amt / max).toFixed(1)}%;background:${color}"></i></div>
      <div class="brk-num">${e.amt}<small>${Math.round(100 * e.amt / total)}%</small></div></div>`;
  }).join('');
}

function breakdownHtml(): string {
  const tab = (b: Book, label: string) => `<button class="brk-tab ${bdBook === b ? 'on' : ''}" data-bd-book="${b}" aria-pressed="${bdBook === b}">${label}</button>`;
  const who = (s: number, label: string) => `<button class="brk-who ${bdSide === s ? 'on' : ''}" data-bd-side="${s}" aria-pressed="${bdSide === s}">${label}</button>`;
  return `<div class="brk" id="brk-box"><div class="brk-head"><div class="brk-tabs">${tab('dealt', 'Dealt')}${tab('taken', 'Taken')}${tab('healed', 'Healing')}</div>
    <div class="brk-whos">${who(0, 'You')}${who(1, 'Opponent')}</div></div><div class="brk-rows" id="brk-rows">${breakdownRows()}</div></div>`;
}

function wireBreakdown() {
  const box = document.getElementById('brk-box'); if (!box) return;
  box.onclick = (e) => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!t) return;
    if (t.dataset.bdBook) bdBook = t.dataset.bdBook as Book;
    if (t.dataset.bdSide) bdSide = +t.dataset.bdSide;
    box.querySelectorAll<HTMLButtonElement>('.brk-tab').forEach(b => { b.classList.toggle('on', b.dataset.bdBook === bdBook); b.setAttribute('aria-pressed', String(b.dataset.bdBook === bdBook)); });
    box.querySelectorAll<HTMLButtonElement>('.brk-who').forEach(b => { b.classList.toggle('on', +b.dataset.bdSide! === bdSide); b.setAttribute('aria-pressed', String(+b.dataset.bdSide! === bdSide)); });
    $('#brk-rows').innerHTML = breakdownRows();
  };
}

function showResult() {
  if (resultShown) return;
  resultShown = true;
  const r = run!;
  if (!outcome) outcome = applyResult();
  const out = outcome;
  const title = out.draw ? 'A draw' : out.won ? 'Victory' : 'Defeat';
  const lead = out.draw ? 'Both mages fell, or neither would.' : out.won ? `${esc(res.names[1])} closes their tome.` : `${esc(res.names[1])} reads you out of the duel.`;
  bdSide = 0; bdBook = 'dealt';
  const endTitle = r.wins >= MAX_WINS ? 'The run is complete: ten victories.' : r.losses >= MAX_LOSSES ? 'The run is over: four defeats.' : '';
  showModal(`<div class="sheet wide" role="dialog" aria-label="Result"><h2>${title}</h2><p class="lead">${lead}</p>
    <div class="result-stats">
      <div>Damage dealt<b>${res.stats.dealt[0]}</b></div><div>Damage taken<b>${res.stats.dealt[1]}</b></div>
      <div>Healing<b>${res.stats.healed[0]}</b></div><div>Gold earned<b>+${out.gold}</b></div>
    </div>
    ${breakdownHtml()}
    ${newFinds.length ? `<p class="lead" style="color:#6b5310">Written into the Codex: ${newFinds.map(esc).join(', ')}.</p>` : ''}
    <p class="lead" style="margin-top:14px">Record: ${pips(r.wins, r.losses)} · ${goldHtml(r.gold).replace('gold-count', 'gold-count" style="color:#8a5a08')}</p>
    ${endTitle ? `<h4>${esc(endTitle)}</h4>` : ''}
    <div class="actions">${endTitle ? '<button class="btn gold" id="r-new">Back to the title</button>' : '<button class="btn gold" id="r-next">To the next round</button>'}<button class="btn quiet" id="r-replay">Watch again</button></div></div>`);
  const next = document.getElementById('r-next');
  if (next) next.onclick = () => { closeModal(); app.go('library'); };
  const nw = document.getElementById('r-new');
  if (nw) nw.onclick = () => { closeModal(); clearRun(); app.go('title'); };
  $('#r-replay').onclick = () => { closeModal(); restart(); };
  wireBreakdown();
}

function restart() {
  app.board.reset();
  T = -1.2; ei = 0; si = 0; ended = false; slow = 1; paused = false; resultShown = false;
  castTotals.clear(); reactTimes.length = 0; lastOrder = ['', '']; lastChips = ['', ''];
  for (const el of unitBars.values()) el.remove();
  unitBars.clear();
  app.board.applySnap(res.snaps[0]);
  updateHud(res.snaps[0]);
}

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export const duelScreen: Screen = {
  mount() {
    const r = run!;
    const me = playerTome(r), opp = r.opponent!;
    res = runDuel(me, opp, hashStr(`${r.id}:${r.round}:duel`));
    resultShown = false; outcome = null; newFinds = [];
    duelRound = r.round;
    const oppStaff = opp.artifacts.find(id => ARTIFACTS[id]?.slot === 'staff') || null;
    app.board.setup({ robes: ['#1f3f6a', ROBES[opp.title || ''] || '#5a1424'], staffs: [r.staff, oppStaff] });
    app.board.hooks = { onNumber: floatNum, onBigText: (p, t, c) => floatNum(p, t, 'big', c) };
    app.board.engineFlash = (c, s) => app.engine.pulse(c, s);
    app.engine.setView(app.board);
    ui().innerHTML = `
      <div class="duel-top"><div class="plate dplate" id="plate-me">${plateHtml(0)}</div><div class="plate dplate right" id="plate-them">${plateHtml(1)}</div></div>
      <div class="vs" id="vs"></div>
      <div class="castbar me"><span class="cb" id="cb-me"></span></div><div class="castbar them"><span class="cb" id="cb-them"></span></div>
      <div class="tome-col me" id="tome-me">${tomeHtml(0)}</div><div class="tome-col them" id="tome-them">${tomeHtml(1)}</div>
      <div id="callout"></div>
      <div class="duel-ctrl"><button class="btn quiet" id="d-pause">Pause</button><button class="btn quiet" data-speed="0.5">½×</button><button class="btn quiet on" data-speed="1">1×</button><button class="btn quiet" data-speed="2">2×</button><button class="btn quiet" data-speed="4">4×</button><button class="btn quiet" id="d-skip">Skip</button></div>`;
    lineEls = [[], []]; wardEls = [[], []];
    for (const side of [0, 1] as const) {
      const col = $(side === 0 ? '#tome-me' : '#tome-them');
      col.querySelectorAll<HTMLElement>('.tl[data-idx]').forEach(el => { lineEls[side][+el.dataset.idx!] = el; });
      col.querySelectorAll<HTMLElement>('.tl[data-ward]').forEach(el => { wardEls[side][+el.dataset.ward!] = el; });
    }
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed!));
    $('#d-pause').onclick = () => { paused = !paused; $('#d-pause').textContent = paused ? 'Play' : 'Pause'; };
    $('#d-skip').onclick = () => {
      // jump to the end: show the final state and the result
      ei = res.events.length; T = res.duration + 3; ended = true;
      app.board.reset();
      const last = res.snaps[res.snaps.length - 1];
      app.board.applySnap(last); updateHud(last);
      showResult();
    };
    keyHandler = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); paused = !paused; $('#d-pause').textContent = paused ? 'Play' : 'Pause'; } };
    window.addEventListener('keydown', keyHandler);
    speed = 1;
    restart();
    banner(`${res.names[0]} vs ${res.names[1]}`);
  },
  unmount() {
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    for (const el of unitBars.values()) el.remove();
    unitBars.clear();
    $('#labels').innerHTML = '';
    app.board.reset();
    closeModal();
  },
  tick(dt: number) {
    if (!res) return;
    slow = Math.min(1, slow + dt * 1.4);
    if (!paused && !resultShown) T += dt * speed * slow;
    while (ei < res.events.length && res.events[ei].t <= T) {
      const ev = res.events[ei++];
      app.board.handle(ev, T);
      onEvent(ev);
    }
    while (si < res.snaps.length - 1 && res.snaps[si + 1].t <= T) si++;
    const s = res.snaps[si];
    if (s) { app.board.applySnap(s); updateHud(s); }
    app.board.updateProjectiles(T);
    updateUnitBars();
    for (const side of [0, 1] as const) {
      const cb = $(side === 0 ? '#cb-me' : '#cb-them').parentElement as HTMLElement;
      const p = project(app.board.bodyPos(side).setY(side === 0 ? 3.5 : 0).setZ(side === 0 ? 5.4 : -4.2));
      cb.style.left = p.x + 'px'; cb.style.top = p.y + 'px';
      cb.style.transform = side === 0 ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
    }
    for (const side of [0, 1]) { if (castbarT[side] > 0) { castbarT[side] -= dt; if (castbarT[side] <= 0) $(side === 0 ? '#cb-me' : '#cb-them').classList.remove('on'); } }
    if (calloutT > 0) { calloutT -= dt; if (calloutT <= 0) $('#callout').classList.remove('show'); }
    for (const k of Object.keys(artFlash)) { artFlash[k] -= dt; if (artFlash[k] <= 0) { document.querySelector(`[data-art="${k}"]`)?.classList.remove('flash'); delete artFlash[k]; } }
    if (ended && T > res.duration + 2.2 && !resultShown) showResult();
  },
};
