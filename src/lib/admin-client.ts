// Client-side admin token handling (design §18, N1).
const KEY = (slug: string) => `mt-admintok-${slug}`;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Take the token from the URL fragment (never sent to servers), keep it in sessionStorage for this tab,
 * and strip the fragment from the address bar/history. Falls back to the stored token on reload.
 */
export function takeAdminToken(slug: string, loc: { hash: string; pathname: string; search: string },
  store: Pick<Storage, 'getItem' | 'setItem'>, replace: (url: string) => void): string | null {
  const frag = loc.hash.replace(/^#/, '');
  if (frag) {
    replace(loc.pathname + loc.search);
    if (TOKEN_RE.test(frag)) { try { store.setItem(KEY(slug), frag); } catch { /* ignore */ } return frag; }
    return null;
  }
  try { const t = store.getItem(KEY(slug)); return t && TOKEN_RE.test(t) ? t : null; } catch { return null; }
}

export function storeAdminToken(slug: string, token: string, store: Pick<Storage, 'setItem'>) {
  try { store.setItem(KEY(slug), token); } catch { /* ignore */ }
}

export function forgetAdminToken(slug: string, store: Pick<Storage, 'removeItem'>) {
  try { store.removeItem(KEY(slug)); } catch { /* ignore */ }
}
