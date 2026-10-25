import './power.css';

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';

/** Makes `button` a power button, grey while off and green while on. The function it returns switches it. */
export function powerButton(button: HTMLButtonElement) {
  button.classList.add('power');
  button.innerHTML = ICON;
  button.setAttribute('aria-label', 'Power');
  return (on: boolean) => {
    button.classList.toggle('on', on);
    button.title = on
      ? 'Turn off: stop the clock, and reset the memory and the CPU'
      : 'Turn on: run the clock at 10 instructions per second';
  };
}
