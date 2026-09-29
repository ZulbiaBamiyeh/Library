import './styles.css';
import { Engine } from './render/engine';
import { Library } from './render/library';
import { Shop } from './render/shop';
import { Study } from './render/study';
import { Board } from './render/board';
import { app, type Screen, type ScreenName } from './ui/app';
import { titleScreen } from './ui/titleUI';
import { enterShop, libraryScreen, setArrival } from './ui/libraryUI';
import { deskScreen } from './ui/deskUI';
import { duelScreen } from './ui/duelUI';
import { loadRun, run } from './game/run';
import { ambience, initAudio, isMuted, setMuted } from './audio/sfx';
import { quality, setQualityMode, QUALITY_MODES } from './render/quality';
import { toast } from './ui/dom';

// the Curio Shop is a room of the library, so going to the shop means walking into it there
const screens: Record<Exclude<ScreenName, 'shop'>, Screen> = { title: titleScreen, library: libraryScreen, desk: deskScreen, duel: duelScreen };

const canvas = document.getElementById('gl') as HTMLCanvasElement;
app.engine = new Engine(canvas);
app.library = new Library();
app.shop = new Shop();
app.library.attachShop(app.shop);
app.study = new Study();
app.board = new Board();
loadRun();

let current: Screen | null = null;
let busy = false;
let pending: ScreenName | null = null;
app.go = (to: ScreenName) => {
  if (to === 'shop') {
    if (app.screen === 'library' && !busy) { enterShop(); return; }
    setArrival('shop');
  }
  let name: Exclude<ScreenName, 'shop'> = to === 'shop' ? 'library' : to;
  if (busy) { pending = name; return; }
  if (current && app.screen === name) return;
  if (name !== 'title' && !run) name = 'title';
  busy = true;
  const fade = document.getElementById('fade')!;
  // stepping into (or out of) the study is a step sideways out of the world
  fade.classList.toggle('portal', name === 'desk' || app.screen === 'desk');
  fade.classList.add('on');
  setTimeout(() => {
    current?.unmount();
    app.screen = name;
    current = screens[name];
    current.mount();
    ambience(name === 'duel' ? 'duel' : 'library');
    if (run && name !== 'title' && name !== 'duel') run.phase = name as typeof run.phase;
    setTimeout(() => {
      fade.classList.remove('on'); busy = false;
      if (pending) { const p = pending; pending = null; app.go(p); }
    }, 60);
  }, current ? 320 : 0);
};

initAudio();
const muteBtn = document.createElement('button');
muteBtn.id = 'mute';
muteBtn.className = 'btn quiet tiny';
const paintMute = () => { muteBtn.textContent = isMuted() ? 'Sound off' : 'Sound on'; muteBtn.setAttribute('aria-pressed', String(!isMuted())); };
paintMute();
muteBtn.onclick = () => { setMuted(!isMuted()); paintMute(); };
// graphics: Auto steps down by itself on a slow machine; the others fix the level
const gfxBtn = document.createElement('button');
gfxBtn.id = 'gfx';
gfxBtn.className = 'btn quiet tiny';
const LEVEL_NAME = ['low', 'medium', 'high'];
const paintGfx = () => { gfxBtn.textContent = quality.mode === 'auto' ? `Graphics: auto (${LEVEL_NAME[quality.level]})` : `Graphics: ${quality.mode}`; };
paintGfx();
gfxBtn.onclick = () => { setQualityMode(QUALITY_MODES[(QUALITY_MODES.indexOf(quality.mode) + 1) % QUALITY_MODES.length]); paintGfx(); };
app.engine.onQualityDrop = (lv) => { paintGfx(); toast(`Graphics lowered to ${LEVEL_NAME[lv]} to keep things smooth.`); };
const sys = document.createElement('div');
sys.id = 'sys';
sys.append(gfxBtn, muteBtn);
document.body.appendChild(sys);

app.go('title');

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * app.devSpeed;
  last = now;
  const time = now / 1000;
  current?.tick?.(dt, time);
  app.engine.frame(dt, time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dev handle for testing in the console
(window as unknown as { inkbound: typeof app }).inkbound = app;
(window as unknown as { inkboundBusy: () => boolean }).inkboundBusy = () => busy;
(window as unknown as { inkboundReload: () => unknown }).inkboundReload = () => loadRun();
if (import.meta.env.DEV) import('./dev/fuzzBoard').then(m => { (window as unknown as { inkboundFuzz: (n: number, s?: number) => string }).inkboundFuzz = (n, s) => m.fuzzBoard(app.board, n, s); });
