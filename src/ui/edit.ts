import {hex2} from '../machine/format.ts';

/**
 * Turns a memory cell into a two-digit hex field. Enter or leaving the field keeps a valid value and passes it
 * to `commit`; Escape drops the edit. While it is open, `setText` leaves the cell alone.
 */
export function editByte(cell: HTMLElement, current: number, commit: (value: number) => void) {
  if (cell.dataset.editing) return;
  cell.dataset.editing = '1';
  const input = Object.assign(document.createElement('input'), {
    className: 'byteedit',
    value: hex2(current),
    maxLength: 4,
    spellcheck: false,
  });
  cell.textContent = '';
  cell.append(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    const value = parseInt(input.value.replace(/^0x/i, ''), 16);
    delete cell.dataset.editing;
    cell.textContent = '';
    if (keep && value >= 0 && value <= 255) commit(value);
  };
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}
