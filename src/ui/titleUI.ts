// Title: the library turning slowly behind the name.
import { app, ui, type Screen } from './app';
import { $ } from './dom';
import { run, loadRun, newRun, clearRun, store } from '../game/run';
import { MAX_LOSSES, MAX_WINS } from '../game/progression';
import { showCodex } from './codexUI';
import { forgetLayout, setArrival } from './libraryUI';

export const titleScreen: Screen = {
  mount() {
    app.library.titleSpin = true;
    app.library.layoutAll(0, 0);
    forgetLayout();
    app.engine.setView(app.library);
    const r = run || loadRun();
    const live = r && r.wins < MAX_WINS && r.losses < MAX_LOSSES;
    if (r && !live) clearRun();
    const best = store.get('inkbound2.best', 0);
    ui().innerHTML = `<div id="title"><div class="inner">
      <h1>Inkbound</h1>
      <p class="tag">You are a mage, and this is your library. The upper floors you know well. Below them the shelves go down further than anyone has followed, and some of those books are so old that nobody remembers who wrote them, or when, or why they were chained shut.</p>
      <div class="row">
        ${live ? `<button class="btn gold" id="t-continue">Continue run · round ${r!.round}</button>` : ''}
        <button class="btn ${live ? 'quiet' : 'gold'}" id="t-new">Begin a new run</button>
        <button class="btn quiet" id="t-codex">Codex</button>
      </div>
      ${best ? `<div class="how dim">Best run: ${best} wins.</div>` : ''}
      </div></div></div>`;
    const c = document.getElementById('t-continue');
    if (c) c.onclick = () => { setArrival('title'); app.go('library'); };
    $('#t-new').onclick = () => { newRun(); setArrival('title'); app.go('library'); };
    $('#t-codex').onclick = showCodex;
  },
  unmount() { app.library.titleSpin = false; },
};
