import './style.css';
import {initTheme, mountThemeToggle} from './theme.ts';
import {PROC_HUES, procColor} from './demos/concurrency/concurrency.ts';
import {DEMOS, type DemoKey} from './demos/index.ts';
import {atBreakpoint, finishKernel, tick, type DemoView, type Session} from './demos/demo.ts';
import type {Direction} from './machine/keyboard.ts';
import type {Mount} from './page.ts';
import {RateChart} from './ui/chart.ts';
import {Clock} from './ui/clock.ts';
import {CpuPanel} from './ui/cpu.ts';
import {$, toggleOn} from './ui/dom.ts';
import {Listing, type Lang} from './ui/listing.ts';
import {RamGrid} from './ui/ram.ts';
import {attachTooltip} from './ui/tooltip.ts';

const MAX_STEPS_PER_FRAME = 400;
const DEFAULT_PROCESSES = 1;
const PANELS = ['vars', 'ins', 'cpu', 'ram'] as const;
type Panel = (typeof PANELS)[number];
const DEFAULT_PANELS: Panel[] = ['vars', 'ins'];
/** The pages beside the simulator, by the path of their stand-alone copy. */
const PAGES: Record<string, () => Promise<Mount>> = {
  'computer/virtual-memory/': () => import('./demos/virtual/page.ts').then(m => m.mount),
  'ai/markov/build/': () => import('./ai/pages/markov/build.ts').then(m => m.mount),
  'ai/markov/predict/': () => import('./ai/pages/markov/predict.ts').then(m => m.mount),
  'ai/gpts/gpt2-markov/': () => import('./ai/pages/gpts/gpts.ts').then(m => m.mountTask('gpt2-markov')),
  'ai/gpts/2-4-6/': () => import('./ai/pages/gpts/gpts.ts').then(m => m.mountTask('2-4-6')),
  'ai/gpts/s-m-l-apples/': () => import('./ai/pages/gpts/gpts.ts').then(m => m.mountTask('s-m-l-apples')),
  'ai/gpts/s-m-l/': () => import('./ai/pages/gpts/gpts.ts').then(m => m.mountTask('s-m-l')),
  'ai/gpts/wikipedia/': () => import('./ai/pages/gpts/wikipedia.ts').then(m => m.mount),
  'ai/gpts/python/': () => import('./ai/pages/gpts/tools.ts').then(m => m.mount),
  'ai/gpts/context/': () => import('./ai/pages/gpts/context.ts').then(m => m.mount),
};

const breakpoints = new Set<number>();
const listing = new Listing($('listing'));
const ram = new RamGrid($('ram'));
const clock = new Clock({
  label: 'Clock: instructions per second',
  stepTitle: 'Step one tick: an instruction, or one phase of it while the CPU or RAM is shown',
  step: () => tick(session.cores, phasesShown(), showKernel),
  setting: () => {
    if (demoKey === 'procs') chart.mark(performance.now());
  },
  turnedOff: () => {
    chart.clear();
    restart();
  },
});
$('clock').replaceWith(clock.el);
/** The counts per second of the concurrency demo, which go on across restarts until the machine is turned off. */
const chart = new RateChart(
  $('rateChart'),
  PROC_HUES.map((_, i) => procColor(i, true)),
);
attachTooltip($('listing'));
listing.breakpoints = breakpoints;
listing.onAddressHover = addr => ram.highlight(addr);

let demoKey: DemoKey = 'pong';
let page: string | null = null;
let pageStop: AbortController | null = null;
let processes = DEFAULT_PROCESSES;
let cores = 1;
let showKernel = false;
let cpus: CpuPanel[] = [];
let shown = new Set<Panel>(DEFAULT_PANELS);
let session: Session;
let view: DemoView;
let lastT = 0;

function restart() {
  if (demoKey === 'procs') chart.mark(performance.now());
  ({session, view} = DEMOS[demoKey].start({processes, cores, chart}));
  const count = session.cores.length;
  $('cpus').dataset.cores = String(count);
  $('cpus').replaceChildren();
  cpus = session.cores.map((_, k) => new CpuPanel($('cpus'), count === 1 ? 'CPU' : `Core ${k + 1}`, k));
  if (!showKernel) session.cores.forEach(finishKernel);
  ram.build(session);
  listing.build(session);
}

/** The URL hash is `<demo or page path>?<params>`, e.g. `#procs?n=4` or `#ai/markov/build/?book=1`. */
function writeDemoHash() {
  const params = new URLSearchParams();
  if (PANELS.some(p => shown.has(p) !== DEFAULT_PANELS.includes(p))) {
    params.set('show', PANELS.filter(p => shown.has(p)).join(',') || 'none');
  }
  if (demoKey === 'procs' && processes !== DEFAULT_PROCESSES) params.set('n', String(processes));
  if (demoKey === 'procs' && cores !== 1) params.set('cores', String(cores));
  if (demoKey === 'procs' && showKernel) params.set('kernel', '1');
  const query = params.size ? '?' + params : '';
  history.replaceState(null, '', '#' + demoKey + query);
}

/** Shows the chosen panels and gives the columns of the layout to those that are left. The Machine panel stays. */
function setPanels(panels: Iterable<Panel>) {
  shown = new Set(panels);
  for (const p of PANELS) document.body.dataset[p] = shown.has(p) ? 'on' : 'off';
  toggleOn($('views'), b => shown.has(b.dataset.view as Panel));
  const middle = shown.has('cpu') || shown.has('ram');
  const columns = [
    'minmax(340px, 416px)',
    middle && 'minmax(400px, 576px)',
    shown.has('ins') && 'minmax(340px, 1fr)',
  ].filter(Boolean);
  $('layout').style.setProperty('--columns', columns.join(' '));
  listing.refit();
}

function setLang(lang: Lang) {
  listing.setLang(lang);
  toggleOn($('lang'), b => b.dataset.lang === lang);
}

function setProcesses(n: number) {
  processes = n;
  toggleOn($('nsel'), b => Number(b.dataset.n) === n);
}

function setKernel(on: boolean) {
  showKernel = on;
  document.body.dataset.kernel = on ? 'on' : 'off';
  toggleOn($('ksel'), b => (b.dataset.k === '1') === on);
  ram.hideKernel(!on);
  listing.refit();
  if (!on) session?.cores.forEach(finishKernel);
}

function setCores(n: number) {
  cores = n;
  toggleOn($('csel'), b => Number(b.dataset.c) === n);
}

function switchDemo(key: DemoKey) {
  if (key !== demoKey) breakpoints.clear();
  demoKey = key;
  page = null;
  unmountPage();
  document.body.dataset.demo = key;
  showTab(b => b.dataset.demo === key);
  clock.off();
  restart();
}

/** Marks the current tab, and names it in the banner that stands for the sidebar on a narrow screen. */
function showTab(isOn: (b: HTMLElement) => boolean) {
  toggleOn($('tabs'), isOn);
  $('current').textContent = $('tabs').querySelector('.on')?.textContent ?? '';
}

/** On a narrow screen, the sidebar is a banner that opens to show the tabs. */
function setMenu(open: boolean) {
  document.body.dataset.menu = open ? 'open' : 'closed';
  $('menu').setAttribute('aria-expanded', String(open));
}

function unmountPage() {
  pageStop?.abort();
  pageStop = null;
  $('page').replaceChildren();
}

async function mountPage(path: string) {
  unmountPage();
  const stop = (pageStop = new AbortController());
  const mount = await PAGES[path]();
  if (!stop.signal.aborted) mount($('page'), stop.signal);
}

/** Every visit builds the page afresh, from the state in the URL. */
function showPage(path: string) {
  page = path;
  clock.stop();
  document.body.dataset.demo = 'page';
  showTab(b => b.dataset.page === path);
  void mountPage(path);
}

function route() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  if (path in PAGES) {
    showPage(path);
    return;
  }
  const params = new URLSearchParams(query);
  const key = path in DEMOS ? (path as DemoKey) : 'pong';
  const n = Number(params.get('n'));
  setProcesses(key === 'procs' && [1, 2, 4, 8].includes(n) ? n : DEFAULT_PROCESSES);
  const c = Number(params.get('cores'));
  setCores(key === 'procs' && [2, 4].includes(c) ? c : 1);
  setKernel(key === 'procs' && params.get('kernel') === '1');
  switchDemo(key);
  const wanted = params.get('show');
  setPanels(wanted === null ? DEFAULT_PANELS : PANELS.filter(p => wanted.split(',').includes(p)));
  writeDemoHash();
}

/** Whether the fetch and execute phases can be seen, which makes a tick one phase and not a whole instruction. */
const phasesShown = () => shown.has('cpu') || shown.has('ram');

function frame(t: number) {
  if (!session) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(100, t - lastT) / 1000;
  lastT = t;
  const ips = clock.ips;
  const byPhase = phasesShown() && ips <= 10;
  const due = clock.due(dt, byPhase ? 2 : 1, MAX_STEPS_PER_FRAME);
  for (let i = 0; i < due; i++) {
    tick(session.cores, byPhase, showKernel);
    if (atBreakpoint(session.cores, breakpoints)) {
      clock.stop();
      break;
    }
  }
  if (page === null) {
    view.render(t, clock.powered);
    cpus.forEach((cpu, k) => cpu.render(session.cores[k]));
    listing.update(session.cores, ips <= 10);
    ram.render(session.cores, t);
  }
  requestAnimationFrame(frame);
}

const buttons = (id: string) => [...$(id).querySelectorAll('button')];

for (const b of buttons('views'))
  b.onclick = () => {
    const panel = b.dataset.view as Panel;
    setPanels(shown.has(panel) ? [...shown].filter(p => p !== panel) : [...shown, panel]);
    writeDemoHash();
  };
for (const b of buttons('tabs'))
  b.onclick = () => {
    setMenu(false);
    location.hash = b.dataset.page ?? b.dataset.demo!;
  };
$('menu').onclick = () => setMenu(document.body.dataset.menu !== 'open');
addEventListener('click', e => {
  if (!(e.target as Element).closest('.sidebar')) setMenu(false);
});
for (const b of buttons('lang')) b.onclick = () => setLang(b.dataset.lang as Lang);
for (const b of buttons('nsel'))
  b.onclick = () => {
    setProcesses(Number(b.dataset.n));
    restart();
    writeDemoHash();
  };
for (const b of buttons('ksel'))
  b.onclick = () => {
    chart.mark(performance.now());
    setKernel(b.dataset.k === '1');
    writeDemoHash();
  };
for (const b of buttons('csel'))
  b.onclick = () => {
    setCores(Number(b.dataset.c));
    restart();
    writeDemoHash();
  };
const press = (dir: Direction) => view?.keyboard?.press(dir);
const release = (dir: Direction) => view?.keyboard?.release(dir);

const KEY_DIRS = new Map<string, Direction>([
  ['ArrowLeft', -1],
  ['ArrowRight', 1],
]);

addEventListener('keydown', e => {
  if (page !== null) return;
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

initTheme();
mountThemeToggle($('tools'));
setProcesses(processes);
setCores(cores);
setKernel(showKernel);
setLang('asm');
addEventListener('hashchange', route);
route();
requestAnimationFrame(frame);
