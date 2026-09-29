// The Codex: reactions, compound essences and legendary spells, found across all runs.
import { $, closeModal, esc, showModal } from './dom';
import { COMPOUNDS, LEGENDARIES, REACTIONS } from '../data/codex';
import { ARTIFACT_LIST, RARITY } from '../data/artifacts';
import { artifactIcon } from '../render/icons';
import { codex } from '../game/codex';

type Tab = 'reactions' | 'compounds' | 'legendary' | 'curios';
let tab: Tab = 'reactions';

function entry(found: boolean, hinted: boolean, name: string, recipe: string, text: string, riddle: string) {
  return `<div class="cx ${found ? 'found' : ''}"><div class="n">${found ? esc(name) : 'Undiscovered'}</div>${found || hinted ? `<div class="r"><b>${esc(recipe)}</b>: ${esc(text)}</div>` : `<div class="rd">${esc(riddle)}</div>`}</div>`;
}

function body(): string {
  const f = (id: string) => codex.found.includes(id), h = (id: string) => codex.hinted.includes(id);
  if (tab === 'reactions') return REACTIONS.map(r => entry(f(r.id), h(r.id), r.name, r.recipe, r.text, r.riddle)).join('');
  if (tab === 'compounds') return Object.values(COMPOUNDS).map(c => entry(f(c.id), h(c.id), c.name, c.recipe, c.text, c.riddle)).join('');
  if (tab === 'legendary') return LEGENDARIES.map(l => entry(f(l.id), h(l.id), l.name, l.recipe, l.text, l.riddle)).join('');
  return ARTIFACT_LIST.map(a => `<div class="cx" style="display:flex;gap:10px;align-items:center"><img alt="" src="${artifactIcon(a.id)}" style="width:44px;height:44px"><div><div class="n">${esc(a.name)} <span style="font-family:var(--sans);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${RARITY[a.rarity].color === '#c9c2ad' ? '#6a6250' : RARITY[a.rarity].color}">${RARITY[a.rarity].name} ${a.slot}</span></div><div class="r">${esc(a.text)}</div></div></div>`).join('');
}

export function showCodex() {
  const count = (ids: string[]) => ids.filter(id => codex.found.includes(id)).length;
  const tabs: [Tab, string][] = [
    ['reactions', `Reactions ${count(REACTIONS.map(r => r.id))}/${REACTIONS.length}`],
    ['compounds', `Compounds ${count(Object.values(COMPOUNDS).map(c => c.id))}/${Object.keys(COMPOUNDS).length}`],
    ['legendary', `Legendary ${count(LEGENDARIES.map(l => l.id))}/${LEGENDARIES.length}`],
    ['curios', 'Curios'],
  ];
  showModal(`<div class="sheet" role="dialog" aria-label="Codex" style="width:min(94vw,620px)"><h2>Codex</h2>
    <p class="lead">What you discover carries over between runs. Glowing books in the library hold hints; binding a compound or legendary for the first time writes it here in gold.</p>
    <div class="codex-tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="codex-list">${body()}</div>
    <div class="actions"><button class="btn" id="cx-close">Close</button></div></div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab as Tab; showCodex(); });
  $('#cx-close').onclick = closeModal;
}
