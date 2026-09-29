import './styles.css';
import { Engine } from './render/engine';
import { Library } from './render/library';
import { Shop } from './render/shop';
import { Board } from './render/board';
import { app, type Screen, type ScreenName } from './ui/app';
import { titleScreen } from './ui/titleUI';
import { libraryScreen } from './ui/libraryUI';
import { shopScreen } from './ui/shopUI';
import { deskScreen } from './ui/deskUI';
import { duelScreen } from './ui/duelUI';
import { loadRun, run } from './game/run';
import { ambience, initAudio, isMuted, setMuted } from './audio/sfx';

const screens: Record<ScreenName, Screen> = { title: titleScreen, library: libraryScreen, shop: shopScreen, desk: deskScreen, duel: duelScreen };

const canvas = document.getElementById('gl') as HTMLCanvasElement;
app.engine = new Engine(canvas);
app.library = new Library();
app.shop = new Shop();
app.board = new Board();
loadRun();

let current: Screen | null = null;
let busy = false;
let pending: ScreenName | null = null;
app.go = (name: ScreenName) => {
  if (busy) { pending = name; return; }
  if (current && app.screen === name) return;
  if (name !== 'title' && !run) name = 'title';
  busy = true;
  const fade = document.getElementById('fade')!;
  fade.classList.add('on');
  setTimeout(() => {
    current?.unmount();
    app.screen = name;
    current = screens[name];
    current.mount();
    ambience(name === 'shop' ? 'shop' : name === 'duel' ? 'duel' : 'library');
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
document.body.appendChild(muteBtn);

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
