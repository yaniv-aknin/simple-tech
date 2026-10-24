import {parseC} from '../demos/c-source.ts';
import type {Session} from '../demos/demo.ts';
import type {Program} from '../machine/assembler.ts';
import {commentFor, hex, hex2} from '../machine/format.ts';
import type {Machine} from '../machine/machine.ts';

export type Lang = 'asm' | 'c';

const MIN_COLUMN_PX = 400;

const C_KEYWORDS = /\b(void|uint8_t|uint16_t|struct|for|if|else|goto)\b/g;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colorC(code: string) {
  const ci = code.indexOf('//');
  const body = ci < 0 ? code : code.slice(0, ci);
  const comment = ci < 0 ? '' : code.slice(ci);
  return (
    esc(body).replace(C_KEYWORDS, '<span class="kw">$1</span>') +
    (comment ? `<span class="ccm">${esc(comment)}</span>` : '')
  );
}

function section(parent: HTMLElement) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  return parent.appendChild(sec);
}

/** Moves a CSS class to whichever row is keyed by the latest `set()`. */
class Marker<K> {
  private shown: K | null = null;
  private readonly rows: Map<K, HTMLElement>;
  private readonly cls: string;

  constructor(rows: Map<K, HTMLElement>, cls: string) {
    this.rows = rows;
    this.cls = cls;
  }

  set(key: K | null) {
    if (key === this.shown) return;
    if (this.shown !== null) this.rows.get(this.shown)?.classList.remove(this.cls);
    if (key !== null) this.rows.get(key)?.classList.add(this.cls);
    this.shown = key;
  }

  reset() {
    this.shown = null;
  }
}

export class Listing {
  private readonly el: HTMLElement;
  private lang: Lang = 'asm';
  private program!: Program;
  private readonly rowByAddr = new Map<number, HTMLElement>();
  private readonly rowByTag = new Map<string, HTMLElement>();
  /** One set of markers per core, in classes such as `cur0` and `next1`. */
  private marks: {
    asmCur: Marker<number>;
    asmNext: Marker<number>;
    cCur: Marker<string>;
    cNext: Marker<string>;
  }[] = [];
  private followed: HTMLElement | null = null;
  /** Addresses where the clock stops; the owner of the listing keeps the set. */
  breakpoints = new Set<number>();
  /** Told which address the pointer is on in the listing, or null when it leaves. */
  onAddressHover: (addr: number | null) => void = () => {};

  constructor(el: HTMLElement) {
    this.el = el;
    new ResizeObserver(() => this.fit()).observe(el);
  }

  setLang(lang: Lang) {
    this.lang = lang;
    this.el.dataset.lang = lang;
    this.followed = null;
    this.fit();
  }

  /**
   * Show the program in the fewest columns (each at least MIN_COLUMN_PX wide) that hold it without
   * scrolling; if even the most that fit are not enough, use those and scroll.
   */
  private fit() {
    const rows = this.el.querySelector<HTMLElement>(this.lang === 'c' ? '#crows' : '#rows');
    if (!rows) return;
    const most = Math.max(1, Math.floor(this.el.offsetWidth / MIN_COLUMN_PX));
    this.el.style.overflow = 'hidden';
    rows.style.columnFill = 'auto';
    rows.style.height = this.el.clientHeight + 'px';
    for (let count = 1; count <= most; count++) {
      rows.style.columnCount = String(count);
      if (rows.scrollWidth <= rows.clientWidth) {
        this.el.style.overflow = '';
        return;
      }
    }
    rows.style.columnFill = 'balance';
    rows.style.height = '';
    this.el.style.overflow = '';
  }

  /** Sets or clears the breakpoint on an address. */
  toggleBreakpoint(addr: number) {
    if (!this.breakpoints.delete(addr)) this.breakpoints.add(addr);
    this.showBreakpoints();
  }

  private showBreakpoints() {
    for (const [addr, row] of this.rowByAddr) row.classList.toggle('bp', this.breakpoints.has(addr));
  }

  /** Redraws the columns after parts of the listing were hidden or shown. */
  refit() {
    this.fit();
  }

  build({program, setup, cores}: Session) {
    this.program = program;
    this.el.innerHTML = '';
    this.rowByAddr.clear();
    this.rowByTag.clear();
    this.marks = cores.map((_, k) => ({
      asmCur: new Marker(this.rowByAddr, `cur${k}`),
      asmNext: new Marker(this.rowByAddr, `next${k}`),
      cCur: new Marker(this.rowByTag, `cur${k}`),
      cNext: new Marker(this.rowByTag, `next${k}`),
    }));
    this.buildAsm(program, setup.kernelEnd ?? 0);
    this.buildC(setup.cSource, program, setup.kernelEnd ?? 0);
    this.showBreakpoints();
    this.el.scrollTop = 0;
    this.followed = null;
    this.fit();
  }

  private buildAsm(program: Program, kernelEnd: number) {
    const rows = document.createElement('div');
    rows.id = 'rows';
    this.el.appendChild(rows);
    let sec: HTMLElement | null = null;
    let prevKind: string | null = null;
    for (const it of program.items) {
      const d = document.createElement('div');
      if (it.kind === 'note') {
        d.className = 'note';
        d.textContent = it.text;
      } else if (it.kind === 'label') {
        d.className = 'lbl';
        d.textContent = it.name + ':';
      } else {
        d.className = 'ins';
        d.innerHTML = `<span class="ad">${hex(it.addr)}</span><span class="by">${hex2(it.bytes[0])} ${hex2(it.bytes[1])}</span><span class="asm"></span><span class="cm"></span>`;
        d.children[2].textContent = it.text;
        d.children[3].textContent = commentFor(it) ? '; ' + commentFor(it) : '';
        d.dataset.op = String(it.bytes[0]);
        d.dataset.arg = String(it.bytes[1]);
        const address = d.children[0] as HTMLElement;
        address.title = 'Click to stop the clock when it gets here. Click again to remove.';
        address.addEventListener('click', () => this.toggleBreakpoint(it.addr));
        address.addEventListener('mouseenter', () => this.onAddressHover(it.addr));
        address.addEventListener('mouseleave', () => this.onAddressHover(null));
        this.rowByAddr.set(it.addr, d);
        if (it.addr < kernelEnd) sec?.classList.add('kernel-code');
      }
      if (!sec || it.kind === 'note' || (it.kind === 'label' && prevKind !== 'note')) sec = section(rows);
      sec.appendChild(d);
      prevKind = it.kind;
    }
  }

  private buildC(src: string, program: Program, kernelEnd: number) {
    const rows = document.createElement('div');
    rows.id = 'crows';
    this.el.appendChild(rows);
    let sec: HTMLElement | null = null;
    const kernelTags = new Set([...program.tagAt].filter(([addr]) => addr < kernelEnd).map(([, tag]) => tag));
    for (const line of parseC(src)) {
      if (!line.text.trim()) {
        sec = null;
        continue;
      }
      const d = document.createElement('div');
      d.className = 'cl';
      d.innerHTML = `<span class="ln">${line.n}</span><span class="code">${colorC(line.text)}</span><span class="cn"></span>`;
      if (line.tag) {
        d.children[2].textContent = `${program.tagCount.get(line.tag) ?? 0} ins`;
        this.rowByTag.set(line.tag, d);
      }
      sec ??= section(rows);
      sec.appendChild(d);
      if (line.tag && kernelTags.has(line.tag)) sec.classList.add('kernel-code');
    }
  }

  /** Marks what each core is running and about to run; the view follows the first core. */
  update(cores: Machine[], follow: boolean) {
    let followed: {
      cur: number | null;
      next: number | null;
      curTag: string | null;
      nextTag: string | null;
    } | null = null;
    cores.forEach((m, k) => {
      const cur = m.next === 'fetch' ? null : m.executing;
      const next = m.next === 'fetch' ? m.pc : null;
      const curTag = cur === null ? null : (this.program.tagAt.get(cur) ?? null);
      const nextTag = next === null ? null : (this.program.tagAt.get(next) ?? null);
      const marks = this.marks[k];
      marks.asmCur.set(cur);
      marks.asmNext.set(next);
      marks.cCur.set(curTag);
      marks.cNext.set(nextTag);
      if (k === 0) followed = {cur, next, curTag, nextTag};
    });
    const f = followed!;
    const row =
      this.lang === 'c'
        ? this.rowByTag.get(f.curTag ?? f.nextTag ?? '')
        : this.rowByAddr.get(f.cur ?? f.next ?? -1);
    if (!follow || !row || row === this.followed) return;
    this.followed = row;
    const el = this.el;
    const top = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    if (top < el.scrollTop + 20 || top > el.scrollTop + el.clientHeight - 40) {
      el.scrollTop = top - el.clientHeight / 2;
    }
  }
}
