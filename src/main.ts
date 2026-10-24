import './style.css';
import {DEMOS, type DemoKey} from './demos';
import type {DemoView, Session, ViewMode} from './demos/demo';
import type {Direction} from './machine/keyboard';
import {CpuPanel} from './ui/cpu';
import {$, toggleOn} from './ui/dom';
import {Listing, type Lang} from './ui/listing';
import {RamGrid} from './ui/ram';
import {attachTooltip} from './ui/tooltip';

const SPEEDS = [0, 1, 5, 10, 50, 100, 500];
const MAX_STEPS_PER_FRAME = 400;

const listing = new Listing($('listing'));
const ram = new RamGrid($('ram'));
const cpu = new CpuPanel();
attachTooltip($('listing'));

let demoKey: DemoKey = 'pong';
let page: string | null = null;
let processes = 2;
let mode: ViewMode = 'vars';
let speedIdx = 0;
let session: Session;
let view: DemoView;
let budget = 0;
let lastT = 0;

function restart() {
  ({session, view} = DEMOS[demoKey].start({processes}));
  budget = 0;
  ram.build(session);
  listing.build(session);
}

function setMode(m: ViewMode) {
  mode = m;
  document.body.dataset.mode = m;
  toggleOn($('modes'), b => b.dataset.mode === m);
}

function setLang(lang: Lang) {
  listing.setLang(lang);
  toggleOn($('lang'), b => b.dataset.lang === lang);
}

function setSpeed(i: number) {
  speedIdx = i;
  budget = 0;
  toggleOn($('speed'), b => Number(b.dataset.i) === i);
}

function setProcesses(n: number) {
  processes = n;
  toggleOn($('nsel'), b => Number(b.dataset.n) === n);
}

function switchDemo(key: DemoKey) {
  demoKey = key;
  page = null;
  document.body.dataset.demo = key;
  toggleOn($('tabs'), b => b.dataset.demo === key);
  $('ctl-' + key).appendChild($('controls'));
  setSpeed(0);
  setMode(DEMOS[key].defaultMode);
  restart();
}

function showPage(url: string) {
  page = url;
  setSpeed(0);
  document.body.dataset.demo = 'page';
  toggleOn($('tabs'), b => b.dataset.page === url);
  const iframe = $<HTMLIFrameElement>('page');
  if (iframe.getAttribute('src') !== url) iframe.src = url;
}

function frame(t: number) {
  const dt = Math.min(100, t - lastT) / 1000;
  lastT = t;
  const ips = SPEEDS[speedIdx];
  const m = session.machine;
  if (ips > 0) {
    const byPhase = mode === 'ram' && ips <= 10;
    budget += dt * ips * (byPhase ? 2 : 1);
    let n = 0;
    while (budget >= 1 && n < MAX_STEPS_PER_FRAME) {
      if (byPhase) m.stepPhase();
      else m.stepInstruction();
      budget--;
      n++;
    }
    if (n >= MAX_STEPS_PER_FRAME) budget = 0;
  }
  if (page === null) {
    view.render(t);
    cpu.render(m);
    listing.update(m, ips <= 10);
    ram.render(m, t);
  }
  requestAnimationFrame(frame);
}

const buttons = (id: string) => [...$(id).querySelectorAll('button')];

for (const b of buttons('modes')) b.onclick = () => setMode(b.dataset.mode as ViewMode);
for (const b of buttons('tabs'))
  b.onclick = () => (b.dataset.page ? showPage(b.dataset.page) : switchDemo(b.dataset.demo as DemoKey));
for (const b of buttons('lang')) b.onclick = () => setLang(b.dataset.lang as Lang);
for (const b of buttons('speed')) b.onclick = () => setSpeed(Number(b.dataset.i));
for (const b of buttons('nsel'))
  b.onclick = () => {
    setProcesses(Number(b.dataset.n));
    restart();
  };
$('rst').onclick = () => {
  setSpeed(0);
  restart();
};

const press = (dir: Direction) => view.keyboard?.press(dir);
const release = (dir: Direction) => view.keyboard?.release(dir);

const KEY_DIRS = new Map<string, Direction>([
  ['ArrowLeft', -1],
  ['ArrowRight', 1],
]);

addEventListener('keydown', e => {
  const dir = KEY_DIRS.get(e.key);
  if (dir) {
    press(dir);
    e.preventDefault();
  }
});
addEventListener('keyup', e => {
  const dir = KEY_DIRS.get(e.key);
  if (dir) release(dir);
});
addEventListener('blur', () => {
  release(-1);
  release(1);
});

setProcesses(processes);
setLang('asm');
switchDemo('pong');
requestAnimationFrame(frame);
