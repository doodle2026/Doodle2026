import { nameKey, normalizeName } from './validate';
import type { Tr } from '@/i18n/translator';
// Pure helpers for the voting UI (unit-tested).
export type Vote = 'yes' | 'maybe' | 'no' | null;
export const NEXT: Record<string, Vote> = { null: 'yes', yes: 'maybe', maybe: 'no', no: null };
export const nextVote = (v: Vote): Vote => NEXT[String(v)];
/** Shortcut keys from the catalog (`vote.keys`: en "y,m,n", da "j,m,n", fr "o,p,n", de "j,v,n"). */
export const keyVotes = (keys: string): Record<string, Vote> => {
  const [y, m, n] = keys.toLowerCase().split(',').map((k) => k.trim());
  return { [y]: 'yes', [m]: 'maybe', [n]: 'no' };
};
export const ICON: Record<string, string> = { yes: '✓', maybe: '( )', no: '✕', null: '–' };
/** Catalog key for a vote state's label. */
export const voteKey = (v: Vote) => (v ? `vote.${v}` : 'vote.none');

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
export const totalText = (t: Totals, tr: Tr) => tr('vote.totalShort', { yes: t.yes, maybe: t.maybe });

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
/** Step 5: personal invite link #inv=<token> (also #invite=). */
export function inviteTokenFromHash(hash: string): string | null | 'invalid' {
  const m = /^#(?:inv|invite)=(.*)$/.exec(hash);
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
  helpers: { isBlank: (s: string) => boolean; textLength: (s: string) => number }, t: Tr): string {
  const v = normalizeName(raw);
  if (helpers.isBlank(raw)) return t('err.nameRequired');
  const n = helpers.textLength(v);
  if (n > 100) return t('err.nameTooLong', { n: n - 100 });
  if (others.some((p) => p.id !== exceptId && nameKey(p.name) === nameKey(v))) return t('err.nameTaken', { name: v });
  return '';
}

/** V5: confirmation text depends on fresh save vs. returning visit, and on whether the poll is closed. */
export function savedMessage(name: string, fresh: boolean, closed: boolean, t: Tr): string {
  if (closed) return t('app.savedClosed', { name });
  return fresh ? t('vote.saved', { name }) : t('app.savedReturning', { name });
}

/** V3: the grid (≥ 640 px) and the mobile cards are operated differently. */
export const hintFor = (wide: boolean, t: Tr) => (wide ? t('vote.hint') : t('app.hintCards'));

