// Pure helpers for the admin UI (unit-tested).

/** Toast text after pick / change / clear (design §27). */
export function undoMessage(prev: number | null, next: number | null, label: string): string {
  if (next === null) return 'Valget er fjernet.';
  return prev === null ? `${label} er valgt.` : `Skiftet til ${label}.`;
}

/** Focus target after deleting `id` from an ordered list: next, else previous, else null (→ heading). */
export function focusAfterDelete(ids: number[], id: number): number | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

export type EditErr = { msg: string; fields: ('date' | 'start' | 'end')[] } | null;
/** Inline option edit validation (design §31). `others` are the OTHER options as local date/start/end strings. */
export function validateOptionEdit(v: { date: string; start: string; end: string }, others: { date: string; start: string; end: string }[], now: Date): EditErr {
  if (!v.date || !v.start) return { msg: 'Udfyld dato og starttid.', fields: [...(!v.date ? ['date' as const] : []), ...(!v.start ? ['start' as const] : [])] };
  if (v.end && v.end <= v.start) return { msg: 'Sluttid skal være efter starttid.', fields: ['end'] };
  if (others.some((o) => o.date === v.date && o.start === v.start && (o.end || '') === (v.end || ''))) {
    return { msg: 'Det tidspunkt findes allerede som et andet forslag.', fields: ['date', 'start'] };
  }
  if (new Date(`${v.date}T${v.start}`).getTime() < now.getTime()) return { msg: 'Tidspunktet ligger i fortiden.', fields: ['date', 'start'] };
  return null;
}

/** Default for "what happens to the answers": only the end changed → keep, else reset (§31). */
export const defaultVoteAction = (orig: { date: string; start: string }, v: { date: string; start: string }) =>
  orig.date === v.date && orig.start === v.start ? 'keep' : 'reset';
