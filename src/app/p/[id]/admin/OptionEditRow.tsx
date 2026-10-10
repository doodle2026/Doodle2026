'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { localDate, localTime, whenLabel } from '@/lib/format';
import { defaultVoteAction, validateOptionEdit, type EditErr } from '@/lib/admin-ui';

export interface EditableOpt { id: number; start_at: string; end_at: string | null; votes: number }
export interface EditResult { start_at: string; end_at: string | null; reset_votes: boolean }

const local = (o: { start_at: string; end_at: string | null }) =>
  ({ date: localDate(o.start_at), start: localTime(o.start_at).replace('.', ':'), end: o.end_at ? localTime(o.end_at).replace('.', ':') : '' });

/** Design §31: inline edit of one time option (.opt-edit). Enter saves, Esc cancels. */
export default function OptionEditRow({ opt, others, onSave, onCancel }: {
  opt: EditableOpt; others: { start_at: string; end_at: string | null }[];
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

  async function save() {
    if (saving) return;
    const e = validateOptionEdit(v, others.map(local), new Date());
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
      <p id="oe-h" className="field__label" style={{ margin: '0 0 var(--s-2)' }}>Redigér tidsforslag – {whenLabel(opt.start_at, opt.end_at)}</p>
      <div className="opt-edit__grid">
        <div className="field"><label className="field__label" htmlFor="oe-d">Dato</label>
          <input ref={dateRef} className="input" type="date" id="oe-d" lang="da" value={v.date} onChange={set('date')} {...inv('date')} /></div>
        <div className="field"><label className="field__label" htmlFor="oe-s">Start</label>
          <input className="input" type="time" id="oe-s" lang="da" step={300} value={v.start} onChange={set('start')} {...inv('start')} /></div>
        <div className="field"><label className="field__label" htmlFor="oe-e">Slut <span className="field__hint">(valgfri)</span></label>
          <input className="input" type="time" id="oe-e" lang="da" step={300} value={v.end} onChange={set('end')} {...inv('end')} /></div>
      </div>
      <div className="field__error" id="oe-err" aria-live="polite">{err?.msg ?? ''}</div>
      {opt.votes > 0 && (
        <fieldset>
          <legend>{opt.votes} {opt.votes === 1 ? 'deltager har' : 'deltagere har'} svaret på dette tidspunkt. Hvad skal der ske med svarene?</legend>
          <label className="radio"><input type="radio" name="oe-v" value="reset" checked={action === 'reset'} onChange={() => { setAction('reset'); setTouchedAction(true); }} />{' '}
            <span><strong>Nulstil svarene</strong> (anbefalet når dato eller starttid ændres) – deltagerne skal svare igen på det nye tidspunkt.</span></label>
          <label className="radio"><input type="radio" name="oe-v" value="keep" checked={action === 'keep'} onChange={() => { setAction('keep'); setTouchedAction(true); }} />{' '}
            <span><strong>Behold svarene</strong> – kun ved små rettelser, fx sluttid eller en tastefejl.</span></label>
        </fieldset>
      )}
      <div className="opt-edit__actions">
        <button type="button" className="btn btn--primary btn--sm" data-oe-save onClick={save} disabled={saving} aria-busy={saving || undefined}>Gem tidspunkt</button>
        <button type="button" className="btn btn--ghost btn--sm" data-oe-cancel onClick={onCancel}>Annullér</button>
        <span className="field__hint" style={{ alignSelf: 'center' }}>Enter gemmer · Esc annullerer</span>
      </div>
    </div>
  );
}
