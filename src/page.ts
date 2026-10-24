/**
 * Builds a page inside `root`, which it then owns. The page stops (its loops, timers and listeners outside
 * `root`) when `signal` aborts.
 */
export type Mount = (root: HTMLElement, signal: AbortSignal) => void;
