import {concurrencySetup} from './concurrency/concurrency.ts';
import {ConcurrencyView} from './concurrency/view.ts';
import {boot, type Demo} from './demo.ts';
import {pongSetup} from './pong/pong.ts';
import {PongView} from './pong/view.ts';

export const DEMOS = {
  pong: {
    start() {
      const session = boot(pongSetup());
      return {session, view: new PongView(session)};
    },
  },
  procs: {
    start({processes, cores, chart}) {
      const session = boot(concurrencySetup(processes, cores));
      return {session, view: new ConcurrencyView(session, processes, chart)};
    },
  },
} satisfies Record<string, Demo>;

export type DemoKey = keyof typeof DEMOS;
