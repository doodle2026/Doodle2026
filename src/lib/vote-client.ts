// Pure helpers for the voting UI (unit-tested).
export type Vote = 'yes' | 'maybe' | 'no' | null;
export const NEXT: Record<string, Vote> = { null: 'yes', yes: 'maybe', maybe: 'no', no: null };
export const nextVote = (v: Vote): Vote => NEXT[String(v)];
export const KEY_VOTE: Record<string, Vote> = { j: 'yes', m: 'maybe', n: 'no' };
export const LABEL: Record<string, [string, string]> = { yes: ['✓', 'Ja'], maybe: ['( )', 'Måske'], no: ['✕', 'Nej'], null: ['–', 'Ikke svaret'] };

export interface Totals { yes: number; maybe: number; no: number }
export function totals(rows: Vote[][], nOpts: number): Totals[] {
  return Array.from({ length: nOpts }, (_, i) => {
    const t = { yes: 0, maybe: 0, no: 0 };
    for (const r of rows) { const v = r[i]; if (v) t[v]++; }
    return t;
  });
}
/** Best = highest score (yes 2, maybe 1); ties all; nothing when all 0 (design §15.3). */
export function bestMask(t: Totals[]): boolean[] {
  const sc = t.map((x) => x.yes * 2 + x.maybe), m = Math.max(0, ...sc);
  return sc.map((s) => m > 0 && s === m);
}
export const totalText = (t: Totals) => `${t.yes} ja${t.maybe ? `, ${t.maybe} måske` : ''}`;

// --- personal edit token (fragment → localStorage, per poll) -----------------------------------
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export interface Stored { token: string; pid: number }
const KEY = (slug: string) => `mt-edit-${slug}`;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `#edit=<token>` → token (and the caller strips the fragment). Anything else → null. */
export function editTokenFromHash(hash: string): string | null | 'invalid' {
  const m = /^#edit=(.*)$/.exec(hash);
  if (!m) return null;
  return TOKEN_RE.test(m[1]) ? m[1] : 'invalid';
}
export function readStored(slug: string, s: Store): Stored | null {
  try {
    const v = JSON.parse(s.getItem(KEY(slug)) ?? 'null');
    return v && typeof v.token === 'string' && TOKEN_RE.test(v.token) && Number.isSafeInteger(v.pid) ? v : null;
  } catch { return null; }
}
export function writeStored(slug: string, v: Stored | null, s: Store) {
  try { if (v) s.setItem(KEY(slug), JSON.stringify(v)); else s.removeItem(KEY(slug)); } catch { /* ignore */ }
}

/** Client-side name check (server is authoritative). `exceptId` skips your own row while editing. */
export function nameError(raw: string, others: { id: number; name: string }[], exceptId: number | null,
  helpers: { isBlank: (s: string) => boolean; textLength: (s: string) => number }): string {
  const v = raw.replace(/[\u200B\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (helpers.isBlank(raw)) return 'Skriv dit navn, så de andre kan se, hvem der har svaret.';
  const n = helpers.textLength(v);
  if (n > 100) return `Navnet er ${n - 100} tegn for langt (højst 100).`;
  const key = (s: string) => s.normalize('NFKC').toLocaleLowerCase('da').replace(/\s+/g, ' ').trim();
  if (others.some((p) => p.id !== exceptId && key(p.name) === key(v))) return `"${v}" har allerede svaret. Tilføj f.eks. et efternavn.`;
  return '';
}
