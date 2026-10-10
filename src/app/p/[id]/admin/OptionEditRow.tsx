'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { localDate, localTime, optionLabel } from '@/lib/format';
import { minAllowedDate } from '@/lib/dates';
import { defaultVoteAction, validateOptionEdit, type EditErr } from '@/lib/admin-ui';

type O = { date: string | null; start_at: string | null; end_at: string | null };
export interface EditableOpt extends O { id: number; votes: number }
/** Date polls send { date }; legacy timed polls { start_at, end_at }. */
export type EditResult = ({ date: string } | { start_at: string; end_at: string | null }) & { reset_votes: boolean };

const local = (o: O) => (o.date
  ? { date: o.date, start: '', end: '' }
  : { date: localDate(o.start_at!), start: localTime(o.start_at!).replace('.', ':'), end: o.end_at ? localTime(o.end_at).replace('.', ':') : '' });

function validateDateEdit(date: string, others: O[], orig: string): EditErr {
  if (!date) return { msg: 'Udfyld en dato.', fields: ['date'] };
  if (others.some((o) => o.date === date)) return { msg: 'Den dato findes allerede som et andet forslag.', fields: ['date'] };
  if (date !== orig && date < minAllowedDate()) return { msg: 'Datoen ligger i fortiden.', fields: ['date'] };
  return null;
}

/** Design §31: inline edit of one time option (.opt-edit). Enter saves, Esc cancels. */
export default function OptionEditRow({ opt, others, onSave, onCancel }: {
  opt: EditableOpt; others: O[];
  onSave: (v: EditResult) => Promise<EditErr>; onCancel: () => void;
}) {
  const orig = local(opt);
  const [v, setV] = useState(orig);
  const [action, setAction] = useState<'reset' | 'keep'>('keep');
  const [touchedAction, setTouchedAction] = useState(false);
  const [err, setErr] = useState<EditErr>(null);
  const [saving, setSaving] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { dateRef.current?.focus(); }, []);
  // Preselect: only end changed → keep; date/start changed → reset (user choice wins once touched).
  useEffect(() => { if (!touchedAction) setAction(defaultVoteAction(orig, v)); }, [v.date, v.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const dateMode = opt.date !== null;
  async function save() {
    if (saving) return;
    if (dateMode) {
      const de = validateDateEdit(v.date, others, orig.date);
      if (de) { setErr(de); return; }
      setSaving(true);
      const r = await onSave({ date: v.date, reset_votes: opt.votes > 0 && action === 'reset' });
      setSaving(false);
      if (r) setErr(r);
      return;
    }
    const e = validateOptionEdit(v, others.filter((o) => o.start_at).map(local), new Date());
    // Unchanged past option may be saved as-is (e.g. only to keep it); only flag the past if it changed.
    if (e && !(e.msg.includes('fortiden') && v.date === orig.date && v.start === orig.start)) { setErr(e); return; }
    setSaving(true);
    const start = new Date(`${v.date}T${v.start}`);
    let end: Date | null = null;
    if (v.end) end = new Date(`${v.date}T${v.end}`);
    const r = await onSave({ start_at: start.toISOString(), end_at: end ? end.toISOString() : null, reset_votes: opt.votes > 0 && action === 'reset' });
    setSaving(false);
    if (r) setErr(r);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'radio') { e.preventDefault(); save(); }
  }
  const inv = (f: 'date' | 'start' | 'end') => (err?.fields.includes(f) ? { 'aria-invalid': true as const, 'aria-describedby': 'oe-err' } : {});
  const set = (k: 'date' | 'start' | 'end') => (e: React.ChangeEvent<HTMLInputElement>) => { setV({ ...v, [k]: e.target.value }); setErr(null); };

  return (
    <div className="opt-edit" role="group" aria-labelledby="oe-h" data-editing={opt.id} onKeyDown={onKey}>
      <p id="oe-h" className="field__label" style={{ margin: '0 0 var(--s-2)' }}>Redigér {dateMode ? 'dato' : 'tidsforslag'} – {optionLabel(opt)}</p>
      <div className="opt-edit__grid">
        <div className="field"><label className="field__label" htmlFor="oe-d">Dato</label>
          <input ref={dateRef} className="input" type="date" id="oe-d" lang="da" value={v.date} onChange={set('date')} {...inv('date')} /></div>
        {!dateMode && <><div className="field"><label className="field__label" htmlFor="oe-s">Start</label>
          <input className="input" type="time" id="oe-s" lang="da" step={300} value={v.start} onChange={set('start')} {...inv('start')} /></div>
        <div className="field"><label className="field__label" htmlFor="oe-e">Slut <span className="field__hint">(valgfri)</span></label>
          <input className="input" type="time" id="oe-e" lang="da" step={300} value={v.end} onChange={set('end')} {...inv('end')} /></div></>}
      </div>
      <div className="field__error" id="oe-err" aria-live="polite">{err?.msg ?? ''}</div>
      {opt.votes > 0 && (
        <fieldset>
          <legend>{opt.votes} {opt.votes === 1 ? 'deltager har' : 'deltagere har'} svaret på {dateMode ? 'denne dato' : 'dette tidspunkt'}. Hvad skal der ske med svarene?</legend>
          <label className="radio"><input type="radio" name="oe-v" value="reset" checked={action === 'reset'} onChange={() => { setAction('reset'); setTouchedAction(true); }} />{' '}
            <span><strong>Nulstil svarene</strong> (anbefalet når {dateMode ? 'datoen' : 'dato eller starttid'} ændres) – deltagerne skal svare igen.</span></label>
          <label className="radio"><input type="radio" name="oe-v" value="keep" checked={action === 'keep'} onChange={() => { setAction('keep'); setTouchedAction(true); }} />{' '}
            <span><strong>Behold svarene</strong> – kun ved små rettelser, fx en tastefejl.</span></label>
        </fieldset>
      )}
      <div className="opt-edit__actions">
        <button type="button" className="btn btn--primary btn--sm" data-oe-save onClick={save} disabled={saving} aria-busy={saving || undefined}>{dateMode ? 'Gem dato' : 'Gem tidspunkt'}</button>
        <button type="button" className="btn btn--ghost btn--sm" data-oe-cancel onClick={onCancel}>Annullér</button>
        <span className="field__hint" style={{ alignSelf: 'center' }}>Enter gemmer · Esc annullerer</span>
      </div>
    </div>
  );
}
