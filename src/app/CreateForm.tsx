'use client';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  counterState, counterText, duplicateRowError, findDuplicates, focusAfterDateRemoval, focusAfterRemoval,
  isBlank, mapServerErrors, rowsSummary, shouldBlockEnter, textLength,
} from '@/lib/form';

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const MAX_OPTIONS = 100;

type Slot = { id: number; start: string; end: string };
type Group = { date: string; slots: Slot[] };
type FocusTarget = { kind: 'slot'; id: number } | { kind: 'newdate' } | { kind: 'addSlot'; date: string };

const dayFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmt = (d: string) => dayFmt.format(new Date(d + 'T12:00'));
const localToday = () => new Intl.DateTimeFormat('en-CA').format(new Date()); // YYYY-MM-DD, browser zone
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
// Local wall-clock date+time in the browser's timezone → UTC ISO string.
const toIso = (date: string, time: string) => new Date(`${date}T${time}`).toISOString();
let nextId = 1;

export default function CreateForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newDate, setNewDate] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [titleErr, setTitleErr] = useState('');
  const [descErr, setDescErr] = useState('');
  const [propErr, setPropErr] = useState('');
  const [rowErr, setRowErr] = useState<Map<number, string>>(new Map());
  const [endInvalid, setEndInvalid] = useState<Set<number>>(new Set());
  const [live, setLive] = useState('');
  const [tz, setTz] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef('');
  const focusNext = useRef<FocusTarget | null>(null);

  useEffect(() => { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);
  // Content changed → new request key (an identical resubmit keeps the key → same poll).
  useEffect(() => { if (!submitting) requestKey.current = newKey(); }, [title, description, groups]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = focusNext.current;
    if (!t) return;
    focusNext.current = null;
    const el = t.kind === 'slot' ? document.querySelector<HTMLElement>(`[data-slot="${t.id}"] input`)
      : t.kind === 'addSlot' ? document.querySelector<HTMLElement>(`[data-date="${t.date}"] .js-add-slot`)
      : document.getElementById('newdate');
    el?.focus();
  }, [groups]);

  const flat = () => groups.flatMap((g) => g.slots.map((s) => ({ ...s, date: g.date })));
  const count = () => groups.reduce((n, g) => n + g.slots.length, 0);

  function addDate() {
    if (!newDate) { setPropErr('Vælg en dato først.'); document.getElementById('newdate')?.focus(); return; }
    if (newDate < localToday()) { setPropErr('Datoen ligger i fortiden.'); return; }
    if (groups.some((g) => g.date === newDate)) { setPropErr('Datoen er allerede tilføjet.'); return; }
    if (count() >= MAX_OPTIONS) { setPropErr(`Du kan højst have ${MAX_OPTIONS} tidsforslag.`); return; }
    setPropErr('');
    const slot = { id: nextId++, start: '', end: '' };
    focusNext.current = { kind: 'slot', id: slot.id };
    setGroups((gs) => [...gs, { date: newDate, slots: [slot] }].sort((a, b) => a.date.localeCompare(b.date)));
    setLive('Dato tilføjet: ' + fmt(newDate));
  }
  function addSlot(date: string) {
    if (count() >= MAX_OPTIONS) { setPropErr(`Du kan højst have ${MAX_OPTIONS} tidsforslag.`); return; }
    const slot = { id: nextId++, start: '', end: '' };
    focusNext.current = { kind: 'slot', id: slot.id };
    setGroups((gs) => gs.map((g) => (g.date === date ? { ...g, slots: [...g.slots, slot] } : g)));
  }
  // Focus is decided *before* the element disappears (design §11).
  function removeDate(date: string) {
    focusNext.current = focusAfterDateRemoval(groups, date);
    setGroups((gs) => gs.filter((g) => g.date !== date));
    setLive('Dato fjernet');
  }
  function removeSlot(date: string, id: number) {
    const g = groups.find((x) => x.date === date);
    focusNext.current = g && g.slots.length > 1 ? focusAfterRemoval(groups, date, id) : focusAfterDateRemoval(groups, date);
    setGroups((gs) => gs.map((x) => (x.date === date ? { ...x, slots: x.slots.filter((s) => s.id !== id) } : x)).filter((x) => x.slots.length));
    setLive('Tidspunkt fjernet');
  }
  const updateSlot = (date: string, id: number, patch: Partial<Slot>) =>
    setGroups((gs) => gs.map((g) => (g.date === date ? { ...g, slots: g.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : g)));

  function reset() {
    setTitle(''); setDescription(''); setNewDate(''); setGroups([]); setSummary([]);
    setTitleErr(''); setDescErr(''); setPropErr(''); setRowErr(new Map()); setEndInvalid(new Set());
  }

  function focusFirstError(rows: Map<number, string>, titleBad: boolean, descBad: boolean) {
    const firstRow = flat().find((s) => rows.has(s.id));
    const el = titleBad ? document.getElementById('title')
      : descBad ? document.getElementById('desc')
      : firstRow ? document.querySelector<HTMLElement>(`[data-slot="${firstRow.id}"] input`)
      : document.getElementById('newdate');
    el?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const errs: string[] = [];
    const rows = new Map<number, string>();
    const ends = new Set<number>();

    const tLen = textLength(title.trim());
    const titleBad = isBlank(title) || tLen > TITLE_MAX;
    if (isBlank(title)) { errs.push('Titel skal udfyldes.'); setTitleErr('Giv afstemningen en titel.'); }
    else if (tLen > TITLE_MAX) {
      const m = `Titlen er ${tLen - TITLE_MAX} tegn for lang (højst ${TITLE_MAX}).`;
      errs.push(m); setTitleErr(m);
    } else setTitleErr('');
    const dLen = textLength(description.trim());
    const descBad = dLen > DESC_MAX;
    if (descBad) { const m = `Beskrivelsen er ${dLen - DESC_MAX} tegn for lang (højst ${DESC_MAX}).`; errs.push(m); setDescErr(m); }
    else setDescErr('');

    const all = flat();
    const opts: { start: string; end: string | null }[] = [];
    const now = Date.now();
    const dups = findDuplicates(all);
    for (const s of all) {
      if (!s.start) { rows.set(s.id, 'Udfyld starttid.'); continue; }
      const start = toIso(s.date, s.start);
      if (s.end && s.end <= s.start) { rows.set(s.id, 'Sluttid skal være efter starttid.'); ends.add(s.id); }
      else if (Date.parse(start) < now) rows.set(s.id, 'Tidspunktet ligger i fortiden.');
      else if (dups.has(s.id)) rows.set(s.id, duplicateRowError(dups.get(s.id)!));
      opts.push({ start, end: s.end ? toIso(s.date, s.end) : null });
    }
    if (!all.length) errs.push('Tilføj mindst ét tidsforslag.');
    if (rows.size) errs.push(rowsSummary(rows.size)); // each row error is shown once, on its row
    setRowErr(rows); setEndInvalid(ends); setPropErr('');
    setSummary(errs);
    if (errs.length) { focusFirstError(rows, titleBad, descBad); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey.current },
        body: JSON.stringify({ title, description, time_options: opts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const { rows: byNum, general } = mapServerErrors(Array.isArray(data.errors) ? data.errors : ['Ukendt fejl.']);
        const srv = new Map<number, string>();
        byNum.forEach((msg, n) => { const s = all[n - 1]; if (s) srv.set(s.id, msg); else general.push(`Tidsforslag ${n}: ${msg}`); });
        setRowErr(srv);
        setSummary([...general, ...(srv.size ? [rowsSummary(srv.size)] : [])]);
        setSubmitting(false);
        focusFirstError(srv, false, false);
        return;
      }
      // Hand the one-time admin link to the poll page via sessionStorage — never via the URL/history.
      try { if (data.admin_url) sessionStorage.setItem(`mt-admin-${data.id}`, data.admin_url); } catch { /* private mode */ }
      window.location.assign(`${data.url}?created=1`); // keep button locked while navigating
    } catch {
      setSummary(['Kunne ikke kontakte serveren. Prøv igen.']);
      setSubmitting(false);
    }
  }

  let row = 0;
  return (
    <>
      <form className="card create-form" id="form" noValidate onSubmit={onSubmit} onReset={reset}
        onKeyDown={(e: KeyboardEvent<HTMLFormElement>) => {
          if (shouldBlockEnter(e.key, e.target as HTMLInputElement)) e.preventDefault();
        }}>
        <h1>Opret en afstemning</h1>
        <p className="lead">Foreslå tidspunkter, og del linket med deltagerne.</p>
        <div className="alert" id="summary" role="alert" tabIndex={-1}>
          {summary.length > 0 && (<><strong>Ret venligst følgende:</strong><ul>{summary.map((x) => <li key={x}>{x}</li>)}</ul></>)}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="title">Titel *</label>
          <input className="input" id="title" name="title" placeholder="F.eks. Teammøde om Q4" autoComplete="off"
            aria-describedby="title-err title-count" aria-invalid={titleErr ? true : undefined}
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="field__meta">
            <div className="field__error" id="title-err" aria-live="polite">{titleErr}</div>
            <Counter id="title-count" value={title} max={TITLE_MAX} />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="desc">Beskrivelse <span className="field__hint">(valgfri)</span></label>
          <textarea className="input" id="desc" name="description" placeholder="Hvad handler mødet om? Sted, link, agenda…"
            aria-describedby="desc-err desc-count" aria-invalid={descErr ? true : undefined}
            value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="field__meta">
            <div className="field__error" id="desc-err" aria-live="polite">{descErr}</div>
            <Counter id="desc-count" value={description} max={DESC_MAX} />
          </div>
        </div>
        <h2 id="prop-h">Tidsforslag</h2>
        <div className="add-date">
          <div className="field">
            <label className="field__label" htmlFor="newdate">Vælg dato</label>
            <input className="input" type="date" id="newdate" lang="da" min={tz ? localToday() : undefined}
              value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <button type="button" className="btn btn--secondary" id="adddate" onClick={addDate}>+ Tilføj dato</button>
        </div>
        <p className="tz-note" id="tz">
          {tz && `Tider vises i din tidszone: ${tz}. Deltagere ser dem omregnet til deres egen.`}
        </p>
        <div className="field__error" id="prop-err" aria-live="polite">{propErr}</div>
        <div className="empty" id="empty" hidden={groups.length > 0}>
          <span className="empty__icon" aria-hidden="true">🗓️</span>Ingen tidsforslag endnu.<br />Vælg en dato ovenfor for at komme i gang.
        </div>
        <ul className="proposals" id="proposals" aria-labelledby="prop-h">
          {groups.map((g) => (
            <li className="date-group anim-in" data-date={g.date} key={g.date}>
              <div className="date-group__head">
                <span className="date-group__title">{fmt(g.date)}</span>
                <button type="button" className="btn btn--icon" aria-label={'Fjern dato ' + fmt(g.date)} onClick={() => removeDate(g.date)}>🗑</button>
              </div>
              <ul className="slots">
                {g.slots.map((s) => {
                  row++;
                  const err = rowErr.get(s.id);
                  return (
                    <li className="slot-wrap anim-in" data-slot={s.id} data-row={row} key={s.id}>
                      <div className="slot">
                        <input className="input" type="time" lang="da" step={300} aria-label={`Starttid, tidsforslag ${row}`} value={s.start}
                          aria-invalid={err && !endInvalid.has(s.id) ? true : undefined} aria-describedby={`slot-err-${s.id}`}
                          onChange={(e) => updateSlot(g.date, s.id, { start: e.target.value })} />
                        <span className="slot__sep" aria-hidden="true">–</span>
                        <input className="input" type="time" lang="da" step={300} aria-label={`Sluttid (valgfri), tidsforslag ${row}`} value={s.end}
                          aria-invalid={endInvalid.has(s.id) || undefined} aria-describedby={`slot-err-${s.id}`}
                          onChange={(e) => updateSlot(g.date, s.id, { end: e.target.value })} />
                        <button type="button" className="btn btn--icon" aria-label="Fjern tidspunkt" onClick={() => removeSlot(g.date, s.id)}>✕</button>
                      </div>
                      <div className="slot__error" id={`slot-err-${s.id}`} aria-live="polite">{err}</div>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn btn--ghost js-add-slot" onClick={() => addSlot(g.date)}>+ Tilføj tidspunkt</button>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <button type="reset" className="btn btn--ghost">Annullér</button>
          <button type="submit" className="btn btn--primary" id="submit" disabled={submitting} aria-busy={submitting || undefined}>
            {submitting ? 'Opretter…' : 'Opret afstemning'}
          </button>
        </div>
      </form>
      <p className="sr-only" id="live" aria-live="polite">{live}</p>
    </>
  );
}

/** Live grapheme counter (design §11). Never truncates; warn ≥ 90 %, over limit is blocked on submit. */
function Counter({ id, value, max }: { id: string; value: string; max: number }) {
  const n = textLength(value.trim());
  const st = counterState(n, max);
  return (
    <span className={`counter${st === 'over' ? ' counter--over' : st === 'warn' ? ' counter--warn' : ''}`} id={id} data-max={max}>
      {counterText(n, max)}
    </span>
  );
}
