/** Page state kept in the URL, mirrored into the shell's hash so the shell's URL can be shared. */
export function getParam(name: string) {
  return new URLSearchParams(location.search).get(name);
}

export function getIntParam(name: string, fallback: number) {
  const n = Number(getParam(name));
  return getParam(name) !== null && Number.isInteger(n) ? n : fallback;
}

export function setParam(name: string, value: string | number | null) {
  const params = new URLSearchParams(location.search);
  if (value === null) params.delete(name);
  else params.set(name, String(value));
  const query = params.size ? '?' + params : '';
  history.replaceState(null, '', location.pathname + query + location.hash);
  if (window.parent === window) return;
  const path = window.parent.location.hash.slice(1).split('?')[0];
  window.parent.history.replaceState(null, '', '#' + path + query);
}
