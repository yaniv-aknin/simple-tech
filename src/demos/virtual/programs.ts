import {hex} from '../../machine/format.ts';
import type {ProcessDef} from './system.ts';

/** Every program starts at address 0x00 of its own memory, except the scribbler, which sits at 0x10. */
export const PROCESSES: ProcessDef[] = [
  {
    name: 'Counter',
    blurb: 'Adds 1 to a number in memory, forever.',
    symbols: {COUNT: 0x80},
    source: `
.org 0x00
loop:
  LOAD A, [COUNT]   ; read the count
  INC A             ; add 1
  STORE [COUNT], A  ; write it back
  JMP loop
`,
    watch: [{label: 'count', addr: 0x80}],
  },
  {
    name: 'Fibonacci',
    blurb: 'Each number is the sum of the two before it: 1, 2, 3, 5, 8, 13...',
    symbols: {X: 0x80, Y: 0x81},
    data: {0x81: 1},
    source: `
.org 0x00
loop:
  LOAD A, [X]       ; x
  LOAD B, [Y]       ; y
  ADD A, B          ; x + y
  STORE [X], A      ; that is the new x
  ADD A, B          ; plus y again
  STORE [Y], A      ; that is the new y
  JMP loop
`,
    watch: [
      {label: 'x', addr: 0x80},
      {label: 'y', addr: 0x81},
    ],
  },
  {
    name: 'Scribbler',
    blurb: 'Writes one value over memory, one address after another.',
    symbols: {},
    params: [
      {key: 'start', label: 'Start at', initial: 0x00},
      {key: 'value', label: 'Write', initial: 0xff},
    ],
    source: ({start, value}) => `
.org 0x10
  LDI A, ${start}          ; start at address ${hex(start)}
  LDI B, ${value}          ; the value to write is ${hex(value)}
loop:
  STX [0], B        ; overwrite the byte at address A
  INC A             ; move on to the next address
  JMP loop
`,
    watch: [{label: 'address in A', reg: 'a', hex: true}],
  },
];
