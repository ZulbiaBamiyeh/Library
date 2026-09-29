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
      <p class="tag">Borrow spells from the library, bind them into stranger ones, buy odd curios next door, and read your tome aloud against another mage's ghost.</p>
      <div class="row">
        ${live ? `<button class="btn gold" id="t-continue">Continue run · round ${r!.round}</button>` : ''}
        <button class="btn ${live ? 'quiet' : 'gold'}" id="t-new">Begin a new run</button>
        <button class="btn quiet" id="t-codex">Codex</button>
      </div>
      <div class="how">
        <b>The Library.</b> Spine colour tells the school. Spend candles to peek inside; borrow three books a round.<br>
        <b>Curios &amp; Oddments.</b> Through the lit door. Spend duel winnings on staves, trinkets and reagents that bend the rules.<br>
        <b>The Binding Desk.</b> Bind one spell into another: the base decides what it is, the infusion what it's made of.<br>
        <b>The Duel.</b> Your mage reads your tome top to bottom, one spell every few seconds. Win ten before you lose four.
        ${best ? `<br><span class="dim">Best run: ${best} wins.</span>` : ''}
      </div></div></div>`;
    const c = document.getElementById('t-continue');
    if (c) c.onclick = () => { setArrival('title'); app.go('library'); };
    $('#t-new').onclick = () => { newRun(); setArrival('title'); app.go('library'); };
    $('#t-codex').onclick = showCodex;
  },
  unmount() { app.library.titleSpin = false; },
};
