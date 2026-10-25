const icon = (paths: string) =>
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const PLAY = icon('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>');
export const PAUSE = icon('<path d="M8 5v14M16 5v14"/>');
export const RESET = icon('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/>');
export const CLOSE = icon('<path d="M6 6l12 12M18 6 6 18"/>');

/** One tick of a clock: a play triangle against a bar. */
export const STEP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M6 5v14l10-7z"/>' +
  '<path d="M19 5v14"/></svg>';

export const POWER =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';
