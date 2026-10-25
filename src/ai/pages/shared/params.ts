/**
 * Page state kept in the URL: in the shell, the query of its hash (`#ai/markov/build/?book=1`); on a page on its
 * own, the query string. A page that was left no longer changes it.
 */
export function pageParams(page: HTMLElement) {
  const [path, hashQuery] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(location.hash ? hashQuery : location.search);

  const getParam = (name: string) => params.get(name);

  function getIntParam(name: string, fallback: number) {
    const n = Number(getParam(name));
    return getParam(name) !== null && Number.isInteger(n) ? n : fallback;
  }

  function setParam(name: string, value: string | number | null) {
    if (!page.isConnected) return;
    if (value === null) params.delete(name);
    else params.set(name, String(value));
    const query = params.size ? '?' + params : '';
    history.replaceState(null, '', location.hash ? '#' + path + query : location.pathname + query);
  }

  return {getParam, getIntParam, setParam};
}

/** Opens another page of the site with the given state: within the shell by its hash, on a page on its own by its URL. */
export function openPage(route: string, query: Record<string, string | number>) {
  const search = '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  if (location.hash) location.hash = '#' + route + search;
  else location.href = import.meta.env.BASE_URL + route + search;
}
