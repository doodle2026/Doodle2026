'use client';
/**
 * Month calendar with multi- or single-select (design §0.3 / doodle-ui datepicker.js), React port.
 * ARIA grid: table role=grid (aria-multiselectable), gridcells with aria-selected + roving tabindex.
 * Keys: ←→ ±1 day, ↑↓ ±1 week, Home/End week start/end, PageUp/PageDown ±1 month (Shift ±1 year),
 * Space/Enter toggles, Shift+Enter / Shift+click selects a range from the last anchor.
 * All date math is on 'YYYY-MM-DD' strings in UTC – never local Date objects.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, addMonths, dateRange, firstOfMonth, formatDateLongCap, formatDateShort, localTodayIso, monthLabel, weekdayMon } from '@/lib/dates';

const WD = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
const WDL = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

export interface DatePickerProps {
  selected: string[]; onChange(dates: string[], msg?: string): void;
  max?: number; min?: string; taken?: string[]; mode?: 'multi' | 'single'; initialMonth?: string;
  onError?(msg: string): void; id?: string; label?: string;
}

export default function DatePicker({ selected, onChange, max = 100, min, taken = [], mode = 'multi', initialMonth, onError, id = 'dp', label }: DatePickerProps) {
  const [today, setToday] = useState('');
  useEffect(() => setToday(localTodayIso()), []); // browser calendar; '' during SSR → nothing disabled yet
  const lo = min ?? today;
  const sel = new Set(selected), tk = new Set(taken);
  const [focus, setFocus] = useState(() => initialMonth ?? [...selected].sort()[0] ?? '');
  const cur = focus || lo || selected[0] || '2026-01-01';
  const anchor = useRef<string | null>(null);
  const hasFocus = useRef(false);
  const grid = useRef<HTMLTableElement>(null);
  useEffect(() => { if (!focus && lo) setFocus(lo); }, [lo, focus]);
  useEffect(() => { if (hasFocus.current) grid.current?.querySelector<HTMLElement>(`[data-d="${cur}"]`)?.focus(); }, [cur]);

  const single = mode === 'single';
  const err = (m: string) => onError?.(m);
  function toggle(s: string, shift: boolean) {
    if (tk.has(s)) return err('Datoen er allerede foreslået.');
    if (lo && s < lo) return err('Datoen ligger i fortiden.');
    if (single) { anchor.current = s; return onChange([s], `${formatDateShort(s)} valgt`); }
    if (shift && anchor.current) {
      const r = dateRange(anchor.current, s).filter((x) => (!lo || x >= lo) && !sel.has(x) && !tk.has(x));
      if (sel.size + r.length > max) return err(`Du kan højst vælge ${max} datoer. Intervallet ville give ${sel.size + r.length}.`);
      anchor.current = s;
      return onChange([...selected, ...r].sort(), `${r.length} datoer tilføjet`);
    }
    anchor.current = s;
    if (sel.has(s)) return onChange(selected.filter((x) => x !== s), `${formatDateShort(s)} fravalgt`);
    if (sel.size >= max) return err(`Du kan højst vælge ${max} datoer.`);
    onChange([...selected, s].sort(), `${formatDateShort(s)} valgt`);
  }
  const clampMin = (n: string) => (lo && n < lo ? lo : n);
  function onKey(e: KeyboardEvent<HTMLTableElement>) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('td[data-d]');
    if (!t) return;
    const k = e.key, dow = weekdayMon(cur);
    let n: string | null = null;
    if (k === 'ArrowLeft') n = addDays(cur, -1); else if (k === 'ArrowRight') n = addDays(cur, 1);
    else if (k === 'ArrowUp') n = addDays(cur, -7); else if (k === 'ArrowDown') n = addDays(cur, 7);
    else if (k === 'Home') n = addDays(cur, -dow); else if (k === 'End') n = addDays(cur, 6 - dow);
    else if (k === 'PageUp') n = addMonths(cur, e.shiftKey ? -12 : -1); else if (k === 'PageDown') n = addMonths(cur, e.shiftKey ? 12 : 1);
    else if (k === ' ' || k === 'Enter') { e.preventDefault(); e.stopPropagation(); toggle(cur, e.shiftKey); return; }
    else return;
    e.preventDefault(); hasFocus.current = true; setFocus(clampMin(n));
  }

  const first = firstOfMonth(cur);
  const start = addDays(first, -weekdayMon(first));
  const weeks: string[][] = [];
  for (let w = 0, d = start; w < 6; w++) {
    const row: string[] = [];
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) row.push(d);
    weeks.push(row);
    if (w >= 4 && d.slice(0, 7) !== cur.slice(0, 7)) break;
  }
  const prevDisabled = !!lo && addDays(first, -1) < lo;

  return (
    <div className="dp" id={id}>
      <div className="dp__head">
        <button type="button" className="btn btn--icon dp__nav" aria-label="Forrige måned" disabled={prevDisabled}
          onClick={() => setFocus(clampMin(addMonths(cur, -1)))}>‹</button>
        <h3 className="dp__month" id={`${id}-m`} aria-live="polite">{monthLabel(cur)}</h3>
        <button type="button" className="btn btn--icon dp__nav" aria-label="Næste måned" onClick={() => setFocus(addMonths(cur, 1))}>›</button>
      </div>
      <table className="dp__grid" role="grid" ref={grid} aria-labelledby={`${id}-m`} aria-describedby={`${id}-h`}
        aria-label={label} {...(single ? {} : { 'aria-multiselectable': true })} onKeyDown={onKey}
        onFocus={() => { hasFocus.current = true; }} onBlur={() => { hasFocus.current = false; }}>
        <thead><tr>{WD.map((w, i) => <th scope="col" abbr={WDL[i]} key={w}>{w}</th>)}</tr></thead>
        <tbody>
          {weeks.map((row) => (
            <tr key={row[0]}>
              {row.map((s) => {
                const out = s.slice(0, 7) !== cur.slice(0, 7), past = !!lo && s < lo, isTk = tk.has(s), on = sel.has(s), isToday = s === today;
                return (
                  <td key={s} role="gridcell" data-d={s} tabIndex={s === cur ? 0 : -1} aria-selected={on}
                    {...(past || isTk ? { 'aria-disabled': true } : {})}
                    className={`dp__day${out ? ' dp__day--out' : ''}${on ? ' is-sel' : ''}${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}${isTk ? ' is-taken' : ''}`}
                    aria-label={`${formatDateLongCap(s)}${isToday ? ', i dag' : ''}${isTk ? ', allerede foreslået' : ''}${on ? ', valgt' : ''}`}
                    onClick={(e) => { hasFocus.current = true; setFocus(s); toggle(s, e.shiftKey); }}>
                    {Number(s.slice(8))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dp__help" id={`${id}-h`}>
        {single ? 'Piletaster flytter · Enter vælger · PageUp/PageDown skifter måned'
          : <>Klik for at til-/fravælge. <span className="dp__desk">Shift+klik vælger et interval. </span>Tastatur: piletaster, Mellemrum/Enter, PageUp/PageDown.</>}
      </p>
    </div>
  );
}

/** Removable chips for the chosen dates (design §0.3). Focus after removal: next chip → previous → calendar. */
export function DateChips({ dates, onRemove, max, onClear, calendarId = 'dp' }: { dates: string[]; onRemove(d: string): void; max: number; onClear?(): void; calendarId?: string }) {
  const n = dates.length;
  const cls = n >= max ? ' counter--over' : n >= max * 0.9 ? ' counter--warn' : '';
  function remove(d: string) {
    const i = dates.indexOf(d), rest = dates.filter((x) => x !== d), next = rest[i] ?? rest[i - 1];
    onRemove(d);
    setTimeout(() => {
      const el = next ? document.querySelector<HTMLElement>(`[data-chip="${next}"] button`) : document.querySelector<HTMLElement>(`#${calendarId} td[tabindex="0"]`);
      el?.focus();
    }, 0);
  }
  return (
    <div className="date-chips-wrap">
      <div className="date-chips-head">
        <h3 id="chips-h">Valgte datoer</h3>
        <span className={`counter${cls}`} id="date-count" aria-live="polite">{n}/{max} datoer</span>
      </div>
      {n === 0 && <div className="empty" id="empty"><span className="empty__icon" aria-hidden="true">🗓️</span>Ingen datoer valgt endnu.<br />Tryk på datoer i kalenderen.</div>}
      <ul className="date-chips" id="date-chips" aria-labelledby="chips-h">
        {dates.map((d) => (
          <li className="date-chip anim-in" data-chip={d} key={d}>{formatDateShort(d)}
            <button type="button" aria-label={`Fjern ${formatDateLongCap(d)}`} onClick={() => remove(d)}>✕</button></li>
        ))}
      </ul>
      {n >= 2 && onClear && <button type="button" className="link-btn" id="clear-dates" onClick={onClear}>Ryd alle</button>}
    </div>
  );
}
