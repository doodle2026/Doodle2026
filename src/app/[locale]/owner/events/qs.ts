/** URL state for the owner list (shared by the server page and the client filters). */
export type F = { q: string; status: string; pl: string; period: string; sort: string; dir: string };
export const qs = (f: Partial<F> & { page?: number }) => {
  const u = new URLSearchParams();
  for (const k of ['q', 'status', 'pl', 'period'] as const) if (f[k]) u.set(k, f[k]!);
  if (f.sort && (f.sort !== 'createdAt' || f.dir !== 'desc')) { u.set('sort', f.sort); u.set('dir', f.dir || 'desc'); }
  if (f.page && f.page > 1) u.set('page', String(f.page));
  const s = u.toString(); return s ? `?${s}` : '';
};

