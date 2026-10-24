import type {Machine} from './machine.ts';

export type Direction = -1 | 1;

/**
 * Memory-mapped keyboard: 255 while left is down, 1 while right is down, 0 otherwise.
 * A tap shorter than one CPU read stays latched until the CPU has read it.
 */
export class Keyboard {
  private readonly machine: Machine;
  private readonly addr: number;
  private held = 0;
  private unread = false;

  constructor(machine: Machine, addr: number) {
    this.machine = machine;
    this.addr = addr;
    machine.onRead = (a, v) => {
      if (a === addr) this.onRead(v);
    };
  }

  press(dir: Direction) {
    this.machine.write(this.addr, dir < 0 ? 255 : 1);
    this.held = dir;
    this.unread = true;
  }

  release(dir: Direction) {
    if (this.held !== dir) return;
    this.held = 0;
    if (!this.unread) this.machine.write(this.addr, 0);
  }

  private onRead(v: number) {
    this.unread = false;
    if (v !== 0 && !this.held) this.machine.write(this.addr, 0);
  }
}
