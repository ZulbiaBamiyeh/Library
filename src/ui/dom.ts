// Small DOM helpers and the shared spell and curio renderers.
import { ESS, SPELLS, TIER_NAME, usesLabel } from '../data/spells';
import { describe, resolveSpell, type Resolved, type SpellInst } from '../data/fusion';
import { ARTIFACTS, RARITY, REAGENTS } from '../data/artifacts';
import { artifactIcon, reagentIcon } from '../render/icons';

export const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => Array.from(root.querySelectorAll(s)) as T[];
export const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const COARSE = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

export function toast(msg: string, gold = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (gold ? ' gold' : '');
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 2800);
}

let modalClose: (() => void) | null = null;
let modalHadLock = false; // the mouse was captured when the dialog opened, so it is captured again when it closes
export function showModal(html: string, onClose?: () => void) {
  if (document.pointerLockElement) { modalHadLock = true; document.exitPointerLock(); } // give the mouse back for the dialog
  const m = $('#modal');
  m.innerHTML = html;
  m.classList.remove('hidden');
  modalClose = onClose || null;
  const f = m.querySelector('button') as HTMLButtonElement | null;
  if (f) f.focus({ preventScroll: true });
}
export function closeModal() {
  const m = $('#modal');
  if (m.classList.contains('hidden')) return;
  m.classList.add('hidden'); m.innerHTML = '';
  const f = modalClose; modalClose = null; f?.();
  if (m.classList.contains('hidden')) {
    const relock = modalHadLock; modalHadLock = false;
    window.dispatchEvent(new CustomEvent('modalclosed', { detail: { relock } }));
  }
}
export function modalOpen() { return !$('#modal').classList.contains('hidden'); }

export function pips(wins: number, losses: number) {
  let h = '<span class="pips" aria-label="' + wins + ' wins">';
  for (let i = 0; i < 10; i++) h += `<span class="pip ${i < wins ? 'win' : ''}"></span>`;
  h += '</span> <span class="pips" aria-label="' + losses + ' losses">';
  for (let i = 0; i < 4; i++) h += `<span class="pip ${i < losses ? 'loss' : ''}"></span>`;
  return h + '</span>';
}

export function goldHtml(n: number) { return `<span class="gold-count"><span class="coin"></span>${n}</span>`; }

export function usesHtml(res: Resolved, left?: number): string {
  if (res.uses === 0) return '<span class="tally">∞</span>';
  if (res.uses === 1) return `<span class="seal ${left === 0 ? 'melted' : ''}" title="Once"></span>`;
  const l = left ?? res.uses;
  let h = '<span class="tally">';
  for (let i = 0; i < res.uses; i++) h += i < res.uses - l ? '<s>|</s>' : '|';
  return h + '</span>';
}

export function spellChip(inst: SpellInst, o: { uses?: number; short?: boolean } = {}): string {
  const res = resolveSpell(inst);
  const ess = [...new Set(res.essences)].map(e => `<i style="background:${ESS[e].color}"></i>`).join('');
  const tier = inst.tier ? `<span class="tier t${inst.tier}">${TIER_NAME[inst.tier]}</span>` : '';
  const cls = ['spell', res.legendary ? 'legend' : '', inst.inf.length ? 'fused' : ''].join(' ');
  return `<span class="${cls}" style="--school:${ESS[SPELLS[inst.base].school].spine}" title="${esc(res.name)}"><span class="nm">${esc(res.name)}</span>${tier}${o.short ? '' : `<span class="ess">${ess}</span><span class="uses">${usesHtml(res, o.uses)}</span>`}</span>`;
}

export function spellDetail(inst: SpellInst, sealed = false): string {
  const res = resolveSpell(inst);
  const d = describe(res);
  if (sealed) {
    return `<div class="pn">???</div><div class="ph">${esc(d.head)}</div><ul><li>Something new would be written here. Bind it to find out.</li></ul>${statsHtml(res)}`;
  }
  const parts = inst.inf.length ? `<div class="ph" style="margin-top:6px">${esc(SPELLS[inst.base].name)} + ${inst.inf.map(id => esc(SPELLS[id].name)).join(' + ')}</div>` : '';
  return `<div class="pn">${esc(res.name)}${inst.tier ? ` <span style="font-size:14px;opacity:.7">(${TIER_NAME[inst.tier]})</span>` : ''}</div><div class="ph">${esc(d.head)}</div>${parts}<ul>${d.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>${statsHtml(res)}`;
}

function statsHtml(res: Resolved) {
  return `<div class="stats"><span><b>${usesLabel(res.uses)}</b> uses</span><span><b>${res.ink}</b> ink</span><span><b>${res.read.toFixed(1)} s</b> to read</span>${res.power > 1.001 ? `<span><b>${Math.round(res.power * 100)}%</b> power</span>` : ''}</div>`;
}

export function artifactCard(id: string, extra = ''): string {
  const a = ARTIFACTS[id];
  const r = RARITY[a.rarity];
  return `<div class="art-card"><div class="icon"><img alt="" src="${artifactIcon(id)}"></div><div>
    <div class="rar" style="color:${shade(r.color)}">${r.name} ${a.slot === 'staff' ? 'staff' : 'trinket'}</div>
    <h2 style="font-size:30px;margin-top:2px">${esc(a.name)}</h2>
    <div class="txt">${esc(a.text)}</div><div class="fl">${esc(a.flavor)}</div>${extra}</div></div>`;
}

export function reagentCard(id: string, extra = ''): string {
  const g = REAGENTS[id];
  return `<div class="art-card"><div class="icon"><img alt="" src="${reagentIcon(id)}"></div><div>
    <div class="rar" style="color:#2a6a8a">Reagent</div>
    <h2 style="font-size:30px;margin-top:2px">${esc(g.name)}</h2>
    <div class="txt">${esc(g.text)}</div><div class="fl">Use it at the Binding Desk.</div>${extra}</div></div>`;
}

// darker version of a rarity colour for text on vellum
function shade(c: string) {
  return ({ '#c9c2ad': '#6a6250', '#5cc0b0': '#1f6a60', '#6fa8ff': '#2a5aa8', '#f0b441': '#8a5a08' } as Record<string, string>)[c] || c;
}

export function artSlotHtml(id: string | null, o: { staff?: boolean; label?: string; attr?: string } = {}) {
  if (!id) return `<button class="art-slot empty ${o.staff ? 'staff' : ''}" ${o.attr || ''}>${o.label || ''}</button>`;
  const a = ARTIFACTS[id];
  return `<button class="art-slot ${o.staff ? 'staff' : ''}" ${o.attr || ''} title="${esc(a.name)}: ${esc(a.text)}"><img alt="${esc(a.name)}" src="${artifactIcon(id)}"><span class="rar" style="background:${RARITY[a.rarity].color}"></span></button>`;
}
