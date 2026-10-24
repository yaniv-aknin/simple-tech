import type {DemoSetup} from '../demo';
import source from './pong.asm?raw';
import cSource from './pong.c?raw';

export const ADDR = {KEY: 0xf0, PX: 0xf1, BX: 0xf2, BY: 0xf3, DX: 0xf4, DY: 0xf5, SCORE: 0xf6};

export const VAR_INFO: Record<keyof typeof ADDR, string> = {
  KEY: 'keyboard: 255 left, 1 right',
  PX: 'paddle: left end (3 wide)',
  BX: 'puck: x position (0 to 15)',
  BY: 'puck: y (0 top, 11 paddle)',
  DX: 'puck: x speed (255 = left)',
  DY: 'puck: y speed (255 = up)',
  SCORE: 'wall hits',
};

export const pongSetup = (): DemoSetup => ({
  source,
  cSource,
  symbols: ADDR,
  names: Object.fromEntries(Object.entries(ADDR).map(([k, v]) => [v, k])),
  cellColor: () => '',
});
