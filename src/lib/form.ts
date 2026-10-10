// Pure helpers for the create form (unit-tested in tests/form.test.ts).
export { textLength, isBlank } from './validate';

export type CounterState = 'ok' | 'warn' | 'over';
export const counterState = (n: number, max: number, warnAt = 0.9): CounterState =>
  n > max ? 'over' : n >= max * warnAt ? 'warn' : 'ok';
export const counterText = (n: number, max: number) => `${n} / ${max}` + (n > max ? ` – ${n - max} for mange` : '');

export interface FormSlot { id: number; date: string; start: string; end: string }

/**
 * Duplicate rows (same date+start+end). Per design §11 only the *later* occurrence gets an error,
 * naming the row it duplicates. Returns Map<slotId, 1-based row number of the first occurrence>.
 */
export function findDuplicates(slots: FormSlot[]): Map<number, number> {
  const first = new Map<string, number>();
  const dups = new Map<number, number>();
  slots.forEach((s, i) => {
    if (!s.start) return;
    const k = `${s.date}|${s.start}|${s.end}`;
    const row = first.get(k);
    if (row === undefined) first.set(k, i + 1); else dups.set(s.id, row);
  });
  return dups;
}

export const duplicateRowError = (firstRow: number) =>
  `Samme tidspunkt findes allerede ovenfor (tidsforslag ${firstRow}).`;

/** Summary line: "1 tidsforslag skal rettes." / "3 tidsforslag skal rettes." */
export const rowsSummary = (n: number) => `${n} tidsforslag skal rettes.`;

/** Map server errors "Tidsforslag N: …" to row N (1-based, visual order). Others stay general. */
export function mapServerErrors(errors: string[]): { rows: Map<number, string>; general: string[] } {
  const rows = new Map<number, string>();
  const general: string[] = [];
  for (const e of errors) {
    const m = /^Tidsforslag (\d+): (.*)$/.exec(e);
    if (m) rows.set(Number(m[1]), m[2].charAt(0).toUpperCase() + m[2].slice(1)); else general.push(e);
  }
  return { rows, general };
}

/** Enter in a single-line input must not submit (only the submit button does). Textareas keep newlines. */
export function shouldBlockEnter(key: string, target: { tagName: string; type?: string }): boolean {
  if (key !== 'Enter') return false;
  if (target.tagName !== 'INPUT') return false;
  return !['submit', 'button', 'reset', 'checkbox', 'radio'].includes((target.type ?? 'text').toLowerCase());
}

/** After removing slot `removedId`: focus next slot in the same date, else previous, else the date picker (the date group disappears with its last slot). */
export function focusAfterRemoval(
  groups: { date: string; slots: { id: number }[] }[], date: string, removedId: number,
): { kind: 'slot'; id: number } | { kind: 'newdate' } {
  const g = groups.find((x) => x.date === date);
  if (g) {
    const i = g.slots.findIndex((s) => s.id === removedId);
    const rest = g.slots.filter((s) => s.id !== removedId);
    if (rest.length) return { kind: 'slot', id: (rest[i] ?? rest[i - 1] ?? rest[rest.length - 1]).id };
  }
  return { kind: 'newdate' };
}

/** After removing a whole date: focus the next date's first slot, else previous, else the date picker. */
export function focusAfterDateRemoval(groups: { date: string; slots: { id: number }[] }[], date: string) {
  const i = groups.findIndex((g) => g.date === date);
  const rest = groups.filter((g) => g.date !== date);
  const target = rest[i] ?? rest[i - 1];
  return target ? ({ kind: 'slot', id: target.slots[0].id } as const) : ({ kind: 'newdate' } as const);
}
