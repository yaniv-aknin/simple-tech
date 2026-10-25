import './clock.css';

export const SPEEDS = [0, 1, 5, 10, 50, 100, 500];
/** The speed the machine runs at when it is turned on. */
const POWER_ON_SPEED = SPEEDS.indexOf(10);

const POWER_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';

const STEP_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M6 5v14l10-7z"/>' +
  '<path d="M19 5v14"/></svg>';

/** Set in session storage once Power has been clicked; until then, a power button that is off glows. */
const CLICKED = 'powerClicked';

const clickedBefore = () => {
  try {
    return sessionStorage.getItem(CLICKED) !== null;
  } catch {
    return false;
  }
};

const button = (className: string, html: string, onclick: () => void) => {
  const b = Object.assign(document.createElement('button'), {className, innerHTML: html});
  b.onclick = () => {
    b.blur();
    onclick();
  };
  return b;
};

export interface ClockOptions {
  label: string;
  stepTitle: string;
  /** One tick, for the step button. */
  step(): void;
  /** Called before the user sets the speed, with its buttons or by turning the machine on. */
  setting?(): void;
  /** Called as the machine is turned on, before the clock runs. */
  turningOn?(): void;
  /** Called once the machine is turned off and the clock stopped; it resets the machine. */
  turnedOff(): void;
}

/**
 * A machine's clock: its speed, in instructions per second, with a button to step one tick, and its power button.
 * The machine is off after a reset, until the clock first runs or steps.
 */
export class Clock {
  readonly el = Object.assign(document.createElement('div'), {className: 'clock'});
  private readonly speeds: HTMLButtonElement[];
  private readonly power: HTMLButtonElement;
  private speed = 0;
  private powered = false;
  private budget = 0;

  constructor(opts: ClockOptions) {
    const step = button('step', STEP_ICON, () => {
      this.setSpeed(0);
      this.setPower(true);
      opts.step();
    });
    step.title = opts.stepTitle;
    step.setAttribute('aria-label', 'Step');
    this.speeds = SPEEDS.map((ips, i) =>
      button('', String(ips), () => {
        opts.setting?.();
        this.setSpeed(i);
      }),
    );
    this.power = button('power', POWER_ICON, () => {
      try {
        sessionStorage.setItem(CLICKED, '1');
      } catch {}
      if (this.powered) {
        this.off();
        opts.turnedOff();
      } else {
        opts.setting?.();
        opts.turningOn?.();
        this.setSpeed(POWER_ON_SPEED);
      }
    });
    this.power.setAttribute('aria-label', 'Power');
    const seg = Object.assign(document.createElement('div'), {className: 'seg'});
    seg.append(step, ...this.speeds);
    const row = Object.assign(document.createElement('div'), {className: 'clock-row'});
    row.append(seg, this.power);
    this.el.append(
      Object.assign(document.createElement('div'), {className: 'dim clock-label', textContent: opts.label}),
      row,
    );
    this.off();
  }

  /** Instructions per second; 0 while the clock is stopped. */
  get ips() {
    return SPEEDS[this.speed];
  }

  /** Stops the clock, and leaves the machine on. */
  stop() {
    this.setSpeed(0);
  }

  /** Stops the clock and turns the machine off, without resetting it. */
  off() {
    this.setSpeed(0);
    this.setPower(false);
  }

  /** Turns the machine on at its usual speed, if it is off. */
  wake() {
    if (!this.powered) this.setSpeed(POWER_ON_SPEED);
  }

  /** How many ticks are due after `dt` seconds, at `perInstruction` ticks an instruction, and at most `max`. */
  due(dt: number, perInstruction: number, max: number) {
    this.budget += dt * this.ips * perInstruction;
    const n = Math.min(Math.floor(this.budget), max);
    this.budget = n === max ? 0 : this.budget - n;
    return n;
  }

  private setSpeed(i: number) {
    this.speed = i;
    this.budget = 0;
    this.speeds.forEach((b, j) => b.classList.toggle('on', j === i));
    if (i > 0) this.setPower(true);
  }

  private setPower(on: boolean) {
    this.powered = on;
    this.power.classList.toggle('on', on);
    this.power.classList.toggle('invite', !on && !clickedBefore());
    this.power.title = on
      ? 'Turn off: stop the clock, and reset the memory and the CPU'
      : 'Turn on: run the clock at 10 instructions per second';
  }
}
