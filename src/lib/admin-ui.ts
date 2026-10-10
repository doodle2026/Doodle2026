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

export type EditErr = { msg: string; fields: 'date'[] } | null;

/** Close dialog preselection (K1): current chosen option, else first best, else none (''). */
export function closeDefault(chosenId: number | null, opts: { id: number }[], best: Set<number>): string {
  if (chosenId !== null && opts.some((o) => o.id === chosenId)) return String(chosenId);
  const b = opts.find((o) => best.has(o.id));
  return b ? String(b.id) : '';
}
