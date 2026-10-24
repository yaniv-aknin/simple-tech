const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

document.addEventListener('keydown', (e) => {
  if (window.parent === window || !NAV_KEYS.has(e.key)) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  window.parent.postMessage({ deckKey: e.key }, '*');
});
