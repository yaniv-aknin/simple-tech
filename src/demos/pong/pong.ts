import type {DemoSetup} from '../demo';
import source from './pong.asm?raw';

export const ADDR = {KEY: 0xf0, PX: 0xf1, BX: 0xf2, BY: 0xf3, DX: 0xf4, DY: 0xf5, SCORE: 0xf6};

export const VAR_INFO: Record<keyof typeof ADDR, string> = {
  KEY: 'keyboard: 255 = left, 1 = right, 0 = nothing',
  PX: 'paddle: x of its left end (it is 3 wide)',
  BX: 'puck: x position (0 to 15)',
  BY: 'puck: y position (0 = top, 11 = paddle row)',
  DX: 'puck: x speed (1 = right, 255 = left)',
  DY: 'puck: y speed (1 = down, 255 = up)',
  SCORE: 'wall hits',
};

export const pongSetup = (): DemoSetup => ({
  source,
  symbols: ADDR,
  names: Object.fromEntries(Object.entries(ADDR).map(([k, v]) => [v, k])),
  cellColor: () => '',
});
