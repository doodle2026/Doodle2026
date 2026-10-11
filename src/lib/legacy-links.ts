/**
 * H2 – old link formats (from early mails/bookmarks). Returns the new locale-less target or null.
 *  /p/<id>/admin/<token> → /p/<id>/admin#<token> · /p/<id>?edit=<token> → /p/<id>#edit=<token> · /e/<id> → /p/<id>
 * Nothing here is logged (middleware never logs paths or queries).
 */
export function legacyRedirect(path: string, q: URLSearchParams): string | null {
  let m = /^\/p\/([^/]+)\/admin\/([^/]+)\/?$/.exec(path);
  if (m) return `/p/${m[1]}/admin#${m[2]}`;
  m = /^\/e\/([^/]+)\/?$/.exec(path);
  if (m) return `/p/${m[1]}${q.toString() ? `?${q}` : ''}`;
  m = /^\/p\/([^/]+)\/?$/.exec(path);
  const edit = q.get('edit');
  if (m && edit) {
    const rest = new URLSearchParams(q); rest.delete('edit');
    return `/p/${m[1]}${rest.toString() ? `?${rest}` : ''}#edit=${encodeURIComponent(edit)}`;
  }
  return null;
}

