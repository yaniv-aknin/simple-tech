import {parseC} from '../demos/c-source';
import type {Session} from '../demos/demo';
import type {Program} from '../machine/assembler';
import {hex, hex2} from '../machine/format';
import type {Machine} from '../machine/machine';

export type Lang = 'asm' | 'c';

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
  private readonly asmCur = new Marker(this.rowByAddr, 'cur');
  private readonly asmNext = new Marker(this.rowByAddr, 'next');
  private readonly cCur = new Marker(this.rowByTag, 'cur');
  private readonly cNext = new Marker(this.rowByTag, 'next');

  constructor(el: HTMLElement) {
    this.el = el;
  }

  setLang(lang: Lang) {
    this.lang = lang;
    this.el.dataset.lang = lang;
  }

  build({program, setup}: Session) {
    this.program = program;
    this.el.innerHTML = '';
    this.rowByAddr.clear();
    this.rowByTag.clear();
    for (const m of [this.asmCur, this.asmNext, this.cCur, this.cNext]) m.reset();
    this.buildAsm(program);
    this.buildC(setup.cSource, program);
    this.el.scrollTop = 0;
  }

  private buildAsm(program: Program) {
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
        d.children[3].textContent = it.comment ? '; ' + it.comment : '';
        d.dataset.op = String(it.bytes[0]);
        this.rowByAddr.set(it.addr, d);
      }
      if (!sec || it.kind === 'note' || (it.kind === 'label' && prevKind !== 'note')) sec = section(rows);
      sec.appendChild(d);
      prevKind = it.kind;
    }
  }

  private buildC(src: string, program: Program) {
    const rows = document.createElement('div');
    rows.id = 'crows';
    this.el.appendChild(rows);
    let sec: HTMLElement | null = null;
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
    }
  }

  update(m: Machine, follow: boolean) {
    const cur = m.next === 'fetch' ? null : m.executing;
    const next = m.next === 'fetch' ? m.pc : null;
    const curTag = cur === null ? null : (this.program.tagAt.get(cur) ?? null);
    const nextTag = next === null ? null : (this.program.tagAt.get(next) ?? null);
    this.asmCur.set(cur);
    this.asmNext.set(next);
    this.cCur.set(curTag);
    this.cNext.set(nextTag);
    if (!follow) return;
    const row =
      this.lang === 'c' ? this.rowByTag.get(curTag ?? nextTag ?? '') : this.rowByAddr.get(cur ?? next ?? -1);
    if (!row) return;
    const el = this.el;
    const top = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    if (top < el.scrollTop + 20 || top > el.scrollTop + el.clientHeight - 40) {
      el.scrollTop = top - el.clientHeight / 2;
    }
  }
}
