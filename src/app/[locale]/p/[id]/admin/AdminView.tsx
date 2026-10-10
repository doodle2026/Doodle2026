'use client';
import { useLp } from '@/i18n/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AdminEvent } from '@/lib/events';
import { forgetAdminToken, storeAdminToken, takeAdminToken } from '@/lib/admin-client';
import { bestIds } from '@/lib/format';
import { useI18n } from '@/i18n/use';
import { MAX_DATE_OPTIONS } from '@/lib/dates';
import DatePicker from '@/components/DatePicker';
import AdminResults from './AdminResults';
import InviteSection from './InviteSection';
import OptionEditRow, { type EditResult } from './OptionEditRow';
import { closeDefault, type EditErr } from '@/lib/admin-ui';
import { copyText } from '@/lib/share';
import { counterState, counterText, isBlank, liveTitleError, mapServerErrors, textLength } from '@/lib/form';

const TITLE_MAX = 200;
const DESC_MAX = 2000;

type Opt = { key: string; id?: number; date: string; votes: number };
const sortKey = (o: Opt) => o.date;
type Dialog = null | 'close' | 'reopen' | 'rotate' | 'delete-poll';
let seq = 0;

export default function AdminView({ slug, shareUrl }: { slug: string; shareUrl: string }) {
  const lp = useLp();
  const { t, fd, rich } = useI18n();
  const optionLabel = (o: { date: string }) => fd(o.date);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [ev, setEv] = useState<AdminEvent | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [opts, setOpts] = useState<Opt[]>([]);
  const [confirmedRemovals, setConfirmedRemovals] = useState(0);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState('');
  const [optErr, setOptErr] = useState('');
  const [summary, setSummary] = useState<string[]>([]);
  const [banner, setBanner] = useState('');
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [chosen, setChosen] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newAdminUrl, setNewAdminUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<'' | 'url' | 'admin'>('');
  const [live, setLive] = useState('');
  const dlgRef = useRef<HTMLDialogElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const focusAfter = useRef<string | null>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/events/${slug}${path}`, {
      ...init,
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }, [slug, token]);

  const load = useCallback((data: AdminEvent) => {
    setEv(data);
    setTitle(data.title); setDesc(data.description);
    setOpts(data.time_options.map((o) => ({ key: `o${o.id}`, id: o.id, date: o.date, votes: o.votes.total })));
    setConfirmedRemovals(0); setPendingRemove(null);
  }, []);

  /** Results changed on the server (delete/choose): refresh vote counts without discarding unsaved form edits. */
  const syncVotes = (e: AdminEvent) => setOpts((prev) => prev.map((o) => ({ ...o, votes: e.time_options.find((x) => x.id === o.id)?.votes.total ?? o.votes })));

  useEffect(() => {
    const tok = takeAdminToken(slug, location, sessionStorage, (u) => history.replaceState(null, '', u));
    if (!tok) { setState('denied'); return; }
    setToken(tok);
  }, [slug]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { res, data } = await api('/admin');
        if (res.status === 401 || res.status === 403) { setState('denied'); return; }
        if (!res.ok) { setState('error'); return; }
        load(data); setState('ready');
      } catch { setState('error'); }
    })();
  }, [token, api, load]);

  useEffect(() => {
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  if (state === 'loading') return <div className="card"><p>{t('app.loading')}</p></div>;
  if (state === 'denied') {
    return (
      <section className="card notfound" aria-labelledby="den-h">
        <h1 id="den-h">{t('app.deniedH')}</h1>
        <p className="lead">{t('app.deniedP')}</p>
        <div className="notfound__actions"><a className="btn btn--primary" href={lp(`/p/${slug}`)}>{t('app.seePoll')}</a></div>
      </section>
    );
  }
  if (state === 'error' || !ev) return <div className="card"><div className="alert" role="alert">{t('app.loadFailed')}</div></div>;

  const best = bestIds(ev.time_options);
  const optById = new Map(ev.time_options.map((o) => [o.id, o]));

  function onTitle(v: string) {
    setTitle(v);
    // N2: clear the error as soon as the field is valid again.
    setTitleErr((err) => liveTitleError(err, v, TITLE_MAX));
  }

  function removeOpt(o: Opt, idx: number) {
    if (opts.length === 1) { setOptErr(t('app.minOneDate')); return; }
    if (o.votes > 0 && pendingRemove !== o.key) {
      setPendingRemove(o.key);
      focusAfter.current = '[data-confirm-remove]';
      return;
    }
    if (o.votes > 0) setConfirmedRemovals((n) => n + 1);
    const next = opts.filter((x) => x.key !== o.key);
    setOpts(next); setPendingRemove(null); setOptErr('');
    setLive(t('app.removedLive', { date: optionLabel(o) }));
    const target = next[idx] ?? next[idx - 1];
    focusAfter.current = target ? `[data-rm="${target.key}"]` : '#nd';
  }

  /** §0.6: "+ Tilføj datoer" calendar popover; already proposed dates are taken. Legacy polls also only get dates (§0.7). */
  function addDates() {
    const fresh = addSel.filter((d) => !opts.some((o) => o.date === d));
    if (!fresh.length) return;
    if (opts.length + fresh.length > MAX_DATE_OPTIONS) { setOptErr(t('app.maxOptions', { max: MAX_DATE_OPTIONS })); return; }
    setOptErr('');
    setOpts([...opts, ...fresh.map((d) => ({ key: `n${++seq}`, date: d, votes: 0 }))].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    setLive(t('app.addedLive', { n: fresh.length }));
    setAddSel([]); setAddOpen(false);
    focusAfter.current = '#addopt';
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const tLen = textLength(title.trim());
    const errs: string[] = [];
    if (isBlank(title)) { setTitleErr(t('err.titleRequired')); errs.push(t('app.titleRequiredSum')); }
    else if (tLen > TITLE_MAX) { const m = t('err.titleTooLong', { n: tLen - TITLE_MAX, max: TITLE_MAX }); setTitleErr(m); errs.push(m); }
    const dLen = textLength(desc.trim());
    if (dLen > DESC_MAX) errs.push(t('err.descTooLong', { n: dLen - DESC_MAX, max: DESC_MAX }));
    setSummary(errs);
    if (errs.length) { document.getElementById(isBlank(title) || tLen > TITLE_MAX ? 'title' : 'desc')?.focus(); return; }
    setSaving(true); setBanner('');
    try {
      const { res, data } = await api('', {
        method: 'PATCH',
        body: JSON.stringify({
          title, description: desc, confirm_remove_voted: confirmedRemovals > 0,
          options: opts.map((o) => ({ ...(o.id ? { id: o.id } : {}), date: o.date })),
        }),
      });
      if (res.status === 401 || res.status === 403) { setState('denied'); return; }
      if (!res.ok) {
        const { rows, general } = mapServerErrors(Array.isArray(data.errors) ? data.errors : [t('app.unknownError')]);
        setSummary([...general, ...[...rows].map(([n, m]) => `${t('app.dateRow', { n, date: opts[n - 1] ? optionLabel(opts[n - 1]) : '?' })}: ${m}`)]);
        document.getElementById('summary')?.focus();
        return;
      }
      load(data);
      setSummary([]);
      setBanner(t('app.savedLive'));
    } catch {
      setSummary([t('app.network')]);
    } finally { setSaving(false); }
  }

  /** §31: save one option right away (own endpoint), keep other unsaved form edits. */
  async function saveOption(id: number, v: EditResult): Promise<EditErr> {
    try {
      const { res, data } = await api(`/options/${id}`, { method: 'PATCH', body: JSON.stringify(v) });
      if (res.status === 401 || res.status === 403) { setState('denied'); return null; }
      if (res.status === 409 && data.code === 'duplicate_option') return { msg: t('admin.errDup'), fields: ['date'] };
      if (!res.ok) return { msg: (Array.isArray(data.errors) && data.errors[0]) || t('app.dateSaveFailed'), fields: ['date'] };
      setEv(data);
      const fresh = data.time_options.find((x: AdminEvent['time_options'][number]) => x.id === id);
      setOpts((prev) => prev.map((o) => (o.id === id ? { ...o, date: fresh.date, votes: fresh.votes.total } : o))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
      setEditingId(null);
      const n = data.reset_votes_count as number;
      const chosenNote = n > 0 && data.chosen_option_id === id ? t('app.checkChoice') : '';
      setBanner(t('admin.dateChanged', { date: optionLabel(fresh), mode: n > 0 ? 'reset' : 'kept', n }) + chosenNote);
      focusAfter.current = `[data-oe="${id}"]`;
      return null;
    } catch { return { msg: t('app.network'), fields: [] }; }
  }

  function openDialog(kind: Exclude<Dialog, null>) {
    lastFocus.current = document.activeElement as HTMLElement;
    if (kind === 'close') {
      // K1: preselect the CURRENT final date; only without one fall back to the most votes.
      setChosen(closeDefault(ev!.chosen_option_id, ev!.time_options, best));
    }
    setDialog(kind);
    setTimeout(() => { dlgRef.current?.showModal(); document.getElementById('dlg-cancel')?.focus(); }, 0);
  }
  function closeDialog() { dlgRef.current?.close(); }

  async function confirmDialog() {
    if (busy) return;
    setBusy(true);
    try {
      const path = dialog === 'close' ? '/close' : dialog === 'reopen' ? '/reopen' : '/rotate-admin';
      const body = dialog === 'close' ? { chosen_option_id: chosen ? Number(chosen) : null } : {};
      if (dialog === 'delete-poll') {
        const { res, data } = await api('', { method: 'DELETE' });
        if (res.status === 401 || res.status === 403) { setState('denied'); return; }
        if (!res.ok && res.status !== 404) { dlgRef.current?.close(); setSummary(Array.isArray(data.errors) ? data.errors : [t('app.deleteFailed')]); return; }
        forgetAdminToken(slug, sessionStorage);
        location.replace(lp('/?deleted=1'));
        return;
      }
      const { res, data } = await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (res.status === 401 || res.status === 403) { closeDialog(); setState('denied'); return; }
      if (!res.ok) { setSummary(Array.isArray(data.errors) ? data.errors : [t('app.unknownError')]); closeDialog(); return; }
      setEv(data);
      if (dialog === 'close') {
        const c = data.chosen_option_id ? optById.get(data.chosen_option_id) : null;
        setBanner(c ? t('app.closedChosen', { date: optionLabel(c) }) : t('admin.closedOk'));
      } else if (dialog === 'reopen') {
        setBanner(t('admin.reopenedOk'));
      } else {
        storeAdminToken(slug, data.admin_token, sessionStorage);
        setToken(data.admin_token);
        setNewAdminUrl(`${location.origin}${lp(data.admin_url)}`);
        setBanner(t('app.rotatedOk'));
      }
      closeDialog();
    } catch {
      setSummary([t('app.network')]); closeDialog();
    } finally { setBusy(false); }
  }

  async function copy(which: 'url' | 'admin', text: string, inputId: string) {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const r = await copyText(text, { clipboard: navigator.clipboard, legacyCopy: () => { input?.select(); return document.execCommand?.('copy') ?? false; } });
    if (r === 'copied') { setCopied(which); setLive(which === 'url' ? t('share.copiedPub') : t('share.copiedAdmin')); setTimeout(() => setCopied(''), 2000); }
    else { input?.focus(); input?.select(); setLive(t('share.copyFailedLive')); }
  }

  const closed = ev.is_closed;
  const dlgText = dialog === 'delete-poll'
    ? { h: t('app.delPollH', { title: ev.title }), p: t('app.delPollP', { count: t('date.count', { n: ev.time_options.length }), n: ev.participants.length }), ok: t('app.delForever'), cls: 'btn--danger' }
    : dialog === 'close'
    ? { h: t('admin.closeQ'), p: t('admin.closeP'), ok: t('admin.closePoll'), cls: 'btn--danger' }
    : dialog === 'reopen'
      ? { h: t('admin.reopenQ'), p: t('app.reopenP'), ok: t('admin.reopen'), cls: 'btn--primary' }
      : { h: t('app.rotateH'), p: t('app.rotateP'), ok: t('app.rotateOk'), cls: 'btn--danger' };

  return (
    <div className="card">
      <div className="admin-head">
        <span className="admin-badge">{t('admin.badge')}</span>
        <span className={`status ${closed ? 'status--closed' : 'status--open'}`}>
          <span aria-hidden="true">●</span> {closed ? t('admin.statusClosed') : t('admin.statusOpen')}
        </span>
      </div>
      <div className="alert" id="summary" role="alert" tabIndex={-1}>
        {summary.length > 0 && (<><strong>{t('common.fixN', { n: summary.length })}</strong><ul>{summary.map((x) => <li key={x}>{x}</li>)}</ul></>)}
      </div>
      <div id="banner" role="status">{banner && <div className="success">{banner}</div>}</div>

      {newAdminUrl && (
        <div className="linkbox linkbox--secret" role="group" aria-labelledby="na-l" aria-describedby="na-d">
          <p className="linkbox__label" id="na-l"><span className="icon-lock" aria-hidden="true">!</span> {t('app.newAdminLabel')}</p>
          <p className="linkbox__desc" id="na-d">{rich('app.newAdminDesc')}</p>
          <div className="linkbox__row">
            <input className="input" id="new-admin-url" readOnly value={newAdminUrl} aria-label={t('app.newAdminAria')} onFocus={(e) => e.currentTarget.select()} />
            <div className="linkbox__actions">
              <button type="button" className={`btn btn--secondary${copied === 'admin' ? ' btn--copied' : ''}`} onClick={() => copy('admin', newAdminUrl, 'new-admin-url')}>
                {copied === 'admin' ? `✓ ${t('common.copied')}` : t('share.copyAdmin')}
              </button>
            </div>
          </div>
        </div>
      )}

      <section aria-labelledby="sh-h">
        <h1 id="sh-h" style={{ fontSize: 'var(--fs-lg)' }}>{t('admin.shareH')}</h1>
        <div className="linkbox" style={{ marginTop: 'var(--s-2)' }}>
          <div className="linkbox__row">
            <input className="input" id="url" readOnly value={shareUrl} aria-label={t('admin.publicLink')} onFocus={(e) => e.currentTarget.select()} />
            <div className="linkbox__actions">
              <button type="button" className={`btn ${copied === 'url' ? 'btn--copied' : 'btn--primary'}`} onClick={() => copy('url', shareUrl, 'url')}>
                {copied === 'url' ? `✓ ${t('common.copied')}` : t('common.copyLink')}
              </button>
              <a className="btn btn--ghost" href={lp(`/p/${slug}`)} target="_blank" rel="noopener noreferrer">{t('admin.openAsParticipant')}</a>
            </div>
          </div>
        </div>
      </section>

      <InviteSection api={api} slug={slug} closed={ev.is_closed} onDenied={() => setState('denied')} onStatus={(m) => { setBanner(m); setLive(m); }} />
      <AdminResults ev={ev} setEv={(e) => { setEv(e); syncVotes(e); }} api={api} appUrl={shareUrl.replace(/\/[a-z]{2}\/p\/[^/]+$/, '')}
        onDenied={() => setState('denied')} onStatus={(m) => { setBanner(m); setLive(m); }} onError={(e) => setSummary(e)} />

      <form className="section" id="edit" noValidate aria-labelledby="ed-h" onSubmit={save}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}>
        <h2 id="ed-h">{t('admin.editH')}</h2>
        <div className="field">
          <label className="field__label" htmlFor="title">{t('common.title')}</label>
          <input className="input" id="title" value={title} onChange={(e) => onTitle(e.target.value)} autoComplete="off"
            aria-describedby="title-err title-count" aria-invalid={titleErr ? true : undefined} />
          <div className="field__meta">
            <div className="field__error" id="title-err" aria-live="polite">{titleErr}</div>
            <Counter id="title-count" value={title} max={TITLE_MAX} />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="desc">{t('common.description')} <span className="field__hint">{t('common.optional')}</span></label>
          <textarea className="input" id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} aria-describedby="desc-count" />
          <div className="field__meta"><span /><Counter id="desc-count" value={desc} max={DESC_MAX} /></div>
        </div>
        <h3 style={{ margin: 'var(--s-4) 0 var(--s-2)' }}>{t('poll.datesH')}</h3>
        <ul className="opt-list" id="opts">
          {opts.map((o, i) => {
            const label = optionLabel(o);
            const removing = pendingRemove === o.key;
            if (o.id !== undefined && editingId === o.id) {
              return (
                <li key={o.key}>
                  <OptionEditRow opt={{ id: o.id, date: o.date, votes: o.votes }}
                    others={opts.filter((x) => x.key !== o.key)}
                    onCancel={() => { setEditingId(null); focusAfter.current = `[data-oe="${o.id}"]`; }}
                    onSave={(v) => saveOption(o.id!, v)} />
                </li>
              );
            }
            return (
              <li key={o.key}>
                <div className={`opt${removing ? ' opt--removing' : ''}`}>
                  <span className="opt__when">{label}</span>
                  <span className="opt__votes">{t('admin.nAnswers', { n: o.votes })}</span>
                  {o.id !== undefined && (
                    <button type="button" className="btn btn--icon" data-oe={o.id} aria-label={t('app.editAria', { date: label })} onClick={() => { setEditingId(o.id!); setPendingRemove(null); }}>✎</button>
                  )}
                  <button type="button" className="btn btn--icon" data-rm={o.key} aria-label={t('admin.removeDateAria', { date: label })} onClick={() => removeOpt(o, i)}>✕</button>
                </div>
                {removing && (
                  <div className="inline-warn" role="alert">
                    {rich('admin.removeWarn', { n: o.votes })}
                    <div className="inline-warn__actions">
                      <button type="button" className="btn btn--danger btn--sm" data-confirm-remove onClick={() => removeOpt(o, i)}>{t('admin.removeAnyway')}</button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPendingRemove(null); focusAfter.current = `[data-rm="${o.key}"]`; }}>{t('admin.keep')}</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <button type="button" className="btn btn--secondary" id="addopt" aria-expanded={addOpen} aria-controls="addpop"
            onClick={() => { setAddOpen(!addOpen); setAddSel([]); }}>{t('admin.addDates')}</button>
        </div>
        {addOpen && (
          <div className="dp-pop" id="addpop"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAddOpen(false); setAddSel([]); document.getElementById('addopt')?.focus(); } }}>
            <DatePicker id="addcal" selected={addSel} taken={opts.filter((o) => o.date).map((o) => o.date!)} max={Math.max(0, MAX_DATE_OPTIONS - opts.length)}
              label={t('app.addDatesLabel')} onChange={(ds, msg) => { setAddSel(ds); setOptErr(''); if (msg) setLive(msg); }} onError={(m) => setOptErr(m)} />
            <p className="field__hint">{t('app.dottedEsc')}</p>
            <div className="opt-edit__actions">
              <button type="button" className="btn btn--primary btn--sm" id="addgo" disabled={!addSel.length} onClick={addDates}>
                {t('admin.addN', { n: addSel.length })}</button>
            </div>
          </div>
        )}
        <div className="field__error" id="opt-err" aria-live="polite">{optErr}</div>
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" id="save" disabled={saving} aria-busy={saving || undefined}>
            {saving ? (<><span className="spinner" aria-hidden="true" /> {t('vote.saving')}</>) : t('admin.save')}
          </button>
        </div>
      </form>

      <section className="section" aria-labelledby="dz-h">
        <div className="danger">
          {closed ? (
            <>
              <h2 id="dz-h">{t('admin.dzClosedH')}</h2>
              <p>{t('admin.dzClosedP')}</p>
              <button type="button" className="btn btn--danger-ghost" id="toggle" onClick={() => openDialog('reopen')}>{t('admin.reopenPoll')}</button>
            </>
          ) : (
            <>
              <h2 id="dz-h">{t('admin.dzH')}</h2>
              <p>{t('app.dzCloseP')}</p>
              <button type="button" className="btn btn--danger" id="toggle" onClick={() => openDialog('close')}>{t('admin.closePollEllipsis')}</button>
            </>
          )}
          <p>{t('app.rotateHint')}</p>
          <button type="button" className="btn btn--danger-ghost" id="rotate" onClick={() => openDialog('rotate')}>{t('app.rotateBtn')}</button>
          <p>{t('app.deleteHint')}</p>
          <button type="button" className="btn btn--danger" id="delete-poll" onClick={() => openDialog('delete-poll')}>{t('app.deleteBtn')}</button>
        </div>
      </section>

      <dialog className="modal" ref={dlgRef} aria-labelledby="dlg-h" aria-describedby="dlg-p"
        onClose={() => { setDialog(null); lastFocus.current?.focus(); }}>
        {dialog && (
          <>
            <h2 id="dlg-h">{dlgText.h}</h2>
            <p id="dlg-p">{dlgText.p}</p>
            {dialog === 'close' && (
              <div>
                <label className="field__label" htmlFor="pick">{t('app.finalOptional')}</label>
                <select className="input" id="pick" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  <option value="">{t('app.notNow')}</option>
                  {ev.time_options.map((o) => (
                    <option key={o.id} value={o.id}>{optionLabel(o)}{best.has(o.id) ? t('app.mostYes') : ''}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" id="dlg-cancel" onClick={closeDialog}>{t('common.cancel')}</button>
              <button type="button" className={`btn ${dlgText.cls}`} id="dlg-ok" onClick={confirmDialog} disabled={busy} aria-busy={busy || undefined}>{dlgText.ok}</button>
            </div>
          </>
        )}
      </dialog>
      <p className="sr-only" aria-live="polite">{live}</p>
    </div>
  );
}

function Counter({ id, value, max }: { id: string; value: string; max: number }) {
  const { tr } = useI18n();
  const n = textLength(value.trim());
  const st = counterState(n, max);
  return <span className={`counter${st === 'over' ? ' counter--over' : st === 'warn' ? ' counter--warn' : ''}`} id={id}>{counterText(n, max, tr)}</span>;
}
