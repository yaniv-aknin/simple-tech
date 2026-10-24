import {poster, type Post} from '../../core/openai.ts';
import './key.css';

const STORE = 'openai-api-key';

const KEY_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/>' +
  '<path d="M10.7 12.3 20 3m-4 4 3 3m-5-1 2 2"/></svg>';

function stored() {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

function store(key: string | null) {
  try {
    if (key) localStorage.setItem(STORE, key);
    else localStorage.removeItem(STORE);
  } catch {
    // Without storage the key lasts until the page closes.
  }
  memory = key;
  icon.hidden = !key;
}

let memory = stored();
let asking: Promise<string> | null = null;

const icon = Object.assign(document.createElement('button'), {
  className: 'keyicon',
  title: 'OpenAI API key saved in this browser',
  innerHTML: KEY_ICON,
  hidden: !memory,
});
icon.addEventListener('click', () => {
  if (confirm('Forget the OpenAI API key saved in this browser?')) store(null);
  icon.blur();
});
document.body.append(icon);

function ask(): Promise<string> {
  const dialog = document.createElement('dialog');
  dialog.className = 'keydialog';
  dialog.innerHTML = `<form method="dialog">
    <h2>OpenAI API key</h2>
    <p>Edited prompts run live: this browser sends them straight to OpenAI, using your key.
    The key is saved in this browser only.</p>
    <input type="password" placeholder="sk-…" autocomplete="off" spellcheck="false" required>
    <div class="row"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="ok">Save</button></div>
  </form>`;
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    dialog.addEventListener('close', () => {
      const key = dialog.querySelector('input')!.value.trim();
      dialog.remove();
      if (dialog.returnValue === 'ok' && key) {
        store(key);
        resolve(key);
      } else {
        reject(new Error('Needs an OpenAI API key'));
      }
    });
    dialog.showModal();
  });
}

/** The saved key, or one the visitor types in now. Rejects if they cancel. */
export function requireKey(): Promise<string> {
  if (memory) return Promise.resolve(memory);
  asking ??= ask().finally(() => (asking = null));
  return asking;
}

export const livePost = async (): Promise<Post> => poster(await requireKey());
