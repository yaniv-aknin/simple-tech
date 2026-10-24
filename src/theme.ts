const STORE = 'theme';
type Theme = 'light' | 'dark';

const SUN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 ' +
  '1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const GITHUB =
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 ' +
  '2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-' +
  '.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 ' +
  '0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.' +
  '16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.1' +
  '5.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

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

/** The light/dark switch in the bottom-left corner, with a link to the source beside it. */
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
  const source = Object.assign(document.createElement('a'), {
    className: 'sourcelink',
    href: 'https://github.com/yaniv-aknin/simple-tech',
    title: 'Source on GitHub',
    innerHTML: GITHUB,
  });
  source.target = '_blank';
  source.rel = 'noopener';
  document.body.append(button, source);
}
