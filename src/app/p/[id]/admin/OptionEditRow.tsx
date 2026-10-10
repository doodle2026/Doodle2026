'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { optionLabel } from '@/lib/format';
import { formatDateShort, localTodayIso } from '@/lib/dates';
import type { EditErr } from '@/lib/admin-ui';
import DatePicker from '@/components/DatePicker';

type O = { date: string };
export interface EditableOpt extends O { id: number; votes: number }
export interface EditResult { date: string; reset_votes: boolean }

/** Design §0.6: "Skift dato" inline row with a single-select calendar. Esc cancels, Enter (on a radio-free input) saves. */
export default function OptionEditRow({ opt, others, onSave, onCancel }: {
  opt: EditableOpt; others: O[];
  onSave: (v: EditResult) => Promise<EditErr>; onCancel: () => void;
}) {
  const orig = opt.date ?? '';
  const [pick, setPick] = useState(orig);
  const [action, setAction] = useState<'reset' | 'keep'>('reset');
  const [err, setErr] = useState<EditErr>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus(); }, []);
  const taken = others.map((o) => o.date);

  async function save() {
    if (saving) return;
    if (!pick) { setErr({ msg: 'Vælg en dato i kalenderen.', fields: ['date'] }); return; }
    if (taken.includes(pick)) { setErr({ msg: 'Den dato findes allerede som et andet forslag.', fields: ['date'] }); return; }
    if (pick !== orig && pick < localTodayIso()) { setErr({ msg: 'Datoen ligger i fortiden.', fields: ['date'] }); return; }
    setSaving(true);
    const r = await onSave({ date: pick, reset_votes: opt.votes > 0 && action === 'reset' });
    setSaving(false);
    if (r) setErr(r);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  return (
    <div className="opt-edit" role="group" aria-labelledby="oe-h" data-editing={opt.id} onKeyDown={onKey} ref={box}>
      <p id="oe-h" className="field__label" style={{ margin: '0 0 var(--s-2)' }}>Skift dato – {optionLabel(opt)}</p>
      {!opt.date && <p className="field__hint">Ældre forslag med klokkeslæt. Skifter du dato, bliver det et rent datoforslag (hele dagen).</p>}
      <DatePicker id="oe-cal" mode="single" selected={pick ? [pick] : []} initialMonth={pick || undefined} taken={taken}
        min={orig && orig < localTodayIso() ? orig : undefined} label="Ny dato"
        onChange={(ds) => { setPick(ds[0]); setErr(null); }} onError={(m) => setErr({ msg: m, fields: ['date'] })} />
      <p className="field__hint" id="oe-sel" aria-live="polite">Ny dato: <strong>{pick ? formatDateShort(pick) : '–'}</strong></p>
      <div className="field__error" id="oe-err" aria-live="polite">{err?.msg ?? ''}</div>
      {opt.votes > 0 && (
        <fieldset>
          <legend>{opt.votes} {opt.votes === 1 ? 'deltager har' : 'deltagere har'} svaret på denne dato. Hvad skal der ske med svarene?</legend>
          <label className="radio"><input type="radio" name="oe-v" value="reset" checked={action === 'reset'} onChange={() => setAction('reset')} />{' '}
            <span><strong>Nulstil svarene</strong> (anbefalet) – deltagerne skal svare igen på den nye dato.</span></label>
          <label className="radio"><input type="radio" name="oe-v" value="keep" checked={action === 'keep'} onChange={() => setAction('keep')} />{' '}
            <span><strong>Behold svarene</strong> – kun hvis du rettede en fejl, og svarene stadig gælder.</span></label>
        </fieldset>
      )}
      <div className="opt-edit__actions">
        <button type="button" className="btn btn--primary btn--sm" data-oe-save onClick={save} disabled={saving} aria-busy={saving || undefined}>Gem dato</button>
        <button type="button" className="btn btn--ghost btn--sm" data-oe-cancel onClick={onCancel}>Annullér</button>
        <span className="field__hint" style={{ alignSelf: 'center' }}>Esc annullerer</span>
      </div>
    </div>
  );
}
