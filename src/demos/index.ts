import {concurrencySetup} from './concurrency/concurrency';
import {ConcurrencyView} from './concurrency/view';
import {boot, type Demo} from './demo';
import {pongSetup} from './pong/pong';
import {PongView} from './pong/view';

export const DEMOS = {
  pong: {
    defaultMode: 'vars',
    start() {
      const session = boot(pongSetup());
      return {session, view: new PongView(session)};
    },
  },
  procs: {
    defaultMode: 'vars',
    start({processes}) {
      const session = boot(concurrencySetup(processes));
      return {session, view: new ConcurrencyView(session, processes)};
    },
  },
} satisfies Record<string, Demo>;

export type DemoKey = keyof typeof DEMOS;
