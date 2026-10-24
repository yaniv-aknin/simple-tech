const STORE = 'theme';
type Theme = 'light' | 'dark';

const SUN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 ' +
  '1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORE);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const current = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ??
  (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

/** Use the saved theme, and follow changes made in other pages of the site (such as the shell around an iframe). */
export function initTheme() {
  apply(stored());
  addEventListener('storage', e => {
    if (e.key === STORE) apply(stored());
  });
}

/** The light/dark switch in the bottom-left corner. */
export function mountThemeToggle() {
  const button = document.createElement('button');
  button.className = 'themetoggle';
  const render = () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    button.innerHTML = next === 'light' ? SUN : MOON;
    button.title = `Switch to ${next} mode`;
  };
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORE, next);
    } catch {
      // Without storage the choice lasts until the page closes.
    }
    apply(next);
    render();
    button.blur();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', render);
  render();
  document.body.append(button);
}
