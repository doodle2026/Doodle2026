'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphemes, MAX_PER_POLL, MAX_PER_SEND, MESSAGE_MAX, parseRecipients } from '@/lib/recipients';
import { useI18n } from '@/i18n/use';
import { BCP } from '@/lib/dates';

type Api = (path: string, init?: RequestInit) => Promise<{ res: Response; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Delivery = 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'blocked';
interface Row { email: string; name: string | null; delivery: Delivery; reason: string | null; updated_at: string; response: 'invited' | 'answered' | 'revoked' | null; linked_from: string | null }
interface State {
  invitees: Row[]; organizer_name: string; mail_blocked: boolean; tracking: boolean; public_answers: { id: number; name: string }[];
  limits: { per_send: number; per_poll: number; used: number; message_max: number };
  reminder: { used: number; max: number; next_allowed_at: string | null; recipient_count: number; answered_count: number; closed: boolean };
}
/** Delivery badges (design §30.3 "Levering"; §38 colours). sent and delivered both read "Leveret"/"Sendt". */
const DLV: Record<Delivery, [string, string, string]> = {
  queued: ['st.queued', '…', 'queued'], sent: ['app.dlvSent', '✉', 'sent'], delivered: ['st.fSent', '✉', 'sent'],
  failed: ['st.fFailed', '!', 'failed'], bounced: ['st.fBounced', '⊘', 'bounced'], blocked: ['st.blocked', '⊘', 'blocked'],
};
type Filter = 'all' | 'queued' | 'sent' | 'failed' | 'bounced' | 'blocked' | 'answered' | 'waiting' | 'public';
const mailable = (r: Row) => r.delivery !== 'bounced' && r.delivery !== 'blocked';
const inFilter = (r: Row, f: Filter) => f === 'all' || (f === 'sent' ? r.delivery === 'sent' || r.delivery === 'delivered'
  : f === 'answered' ? r.response === 'answered' : f === 'waiting' ? r.response === 'invited' && mailable(r) : f === 'public' ? false : r.delivery === f);
const ANS = { invited: ['st.invited', '○', 'st st--invited'], answered: ['st.fAnswered', '✓', 'st st--answered'], revoked: ['st.revoked', '⊗', 'st st--unsub'] } as const;
/** Delivery time in the viewer's zone and locale (§45.5: toLocaleString(bcp, 2-digit hour/minute)). */
const when = (iso: string, loc: keyof typeof BCP) => new Intl.DateTimeFormat(BCP[loc], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
export function waitParts(ms: number) { const m = Math.max(1, Math.ceil(ms / 60_000)); return { h: Math.floor(m / 60), m: m % 60 || (m < 60 ? m : 0) }; }

export default function InviteSection({ api, slug, closed, onDenied, onStatus }: {
  api: Api; slug: string; closed: boolean; onDenied: () => void; onStatus: (m: string) => void;
}) {
  const { t, tr, rich, locale } = useI18n();
  const [st, setSt] = useState<State | null>(null);
  const [addr, setAddr] = useState('');
  const [msg, setMsg] = useState('');
  const [orgName, setOrgName] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [track, setTrack] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'revoke'; email: string } | { kind: 'resend'; email: string; answered: boolean } | { kind: 'link'; pid: number; name: string } | null>(null);
  const [linkSel, setLinkSel] = useState('');
  const [linkErr, setLinkErr] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const cdlg = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<string | null>(null);
  // Render only one layout (table ≥640 px, list below) so each row has exactly one "Send nyt link" in the DOM/a11y tree.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { const m = matchMedia('(max-width:639px)'); const f = () => setNarrow(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const dlg = useRef<HTMLDialogElement>(null);
  const remBtn = useRef<HTMLButtonElement>(null);

  const denied = useRef(onDenied); denied.current = onDenied;
  const load = useCallback(async () => {
    const { res, data } = await api('/invitations');
    if (res.status === 401 || res.status === 403) { denied.current(); return; }
    if (res.ok) { setSt(data); setOrgName((o) => o || data.organizer_name); if (data.tracking) setTrack(true); }
  }, [api]);
  useEffect(() => { load(); }, [load, closed]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(h); }, []);

  const parsed = useMemo(() => parseRecipients(addr, st?.invitees.map((r) => r.email) ?? []), [addr, st]);
  const used = st?.limits.used ?? 0, left = MAX_PER_POLL - used, b = parsed.valid.length;
  const n = graphemes(msg);
  const batchErr = b > MAX_PER_SEND ? t('inv.errBatch', { max: MAX_PER_SEND, n: b - MAX_PER_SEND })
    : b > left ? t('inv.errPoll', { max: MAX_PER_POLL, left, n: b - left }) : '';
  const msgErr = n > MESSAGE_MAX ? t('inv.pmsgTooLong', { n: n - MESSAGE_MAX }) : '';
  const canSend = b > 0 && !batchErr && !msgErr && !parsed.invalid.length && !sending && !closed && !st?.mail_blocked;
  const shownName = orgName.trim() || t('app.organizer');

  // Live preview of the real template (debounced; only while <details> is open).
  useEffect(() => {
    if (!previewOpen || msgErr) return;
    const h = setTimeout(async () => {
      const { res, data } = await api('/invitations/preview', { method: 'POST', body: JSON.stringify({ message: msg, organizer_name: orgName }) });
      if (res.ok) setPreview(data);
    }, 400);
    return () => clearTimeout(h);
  }, [previewOpen, msg, orgName, msgErr, api]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true); setErr([]);
    try {
      const { res, data } = await api('/invitations', { method: 'POST', body: JSON.stringify({ recipients: addr, message: msg, organizer_name: orgName, track }) });
      if (res.status === 401 || (res.status === 403 && data.code !== 'mail_blocked')) { onDenied(); return; }
      if (!res.ok) { setErr(Array.isArray(data.errors) ? data.errors : [t('app.sendFailed')]); return; }
      setSt(data); setAddr(''); setMsg('');
      onStatus(t('app.sentStatus', { n: data.sent, failed: data.failed ?? 0, suppressed: data.suppressed ?? 0 }));
    } catch { setErr([t('app.network')]); } finally { setSending(false); }
  }

  async function sendReminder() {
    dlg.current?.close();
    const { res, data } = await api('/reminders', { method: 'POST' });
    if (res.status === 401) { onDenied(); return; }
    if (!res.ok) { setErr(Array.isArray(data.errors) ? data.errors : [t('app.remFailed')]); return; }
    setSt(data);
    onStatus(t('rem.sent', { n: data.recipients }));
    setTimeout(() => remBtn.current?.focus(), 0);
  }

  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 8000); return () => clearTimeout(h); }, [toast]);
  useEffect(() => { if (confirm) { cdlg.current?.showModal(); setTimeout(() => document.getElementById('c-cancel')?.focus(), 0); } }, [confirm]);
  useEffect(() => { if (returnFocus.current) { document.querySelector<HTMLElement>(returnFocus.current)?.focus(); returnFocus.current = null; } });

  async function action(name: 'resend' | 'revoke' | 'link' | 'unlink', payload: Record<string, unknown>) {
    const { res, data } = await api(`/invitations/${name}`, { method: 'POST', body: JSON.stringify(payload) });
    if (res.status === 401) { onDenied(); return null; }
    if (!res.ok) { setErr(Array.isArray(data.errors) ? data.errors : [t('app.actionFailed')]); return null; }
    setErr([]); setSt(data); return data;
  }
  const esc = (e: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(e) : e);
  /** §44.8: "Send nyt link" – always confirmed, because the old link stops working. */
  const resend = (r: Row) => { setConfirm({ kind: 'resend', email: r.email, answered: r.response === 'answered' }); };
  async function confirmOk() {
    if (!confirm) return;
    if (confirm.kind === 'resend') {
      const email = confirm.email; cdlg.current?.close(); setConfirm(null);
      if (await action('resend', { email })) setToast({ text: t('resend.toast', { email }) });
      returnFocus.current = `[data-resend="${esc(email)}"]`;
    } else if (confirm.kind === 'revoke') {
      const email = confirm.email; cdlg.current?.close(); setConfirm(null);
      if (await action('revoke', { email })) { setToast({ text: t('app.revokedToast', { email }) }); returnFocus.current = `[data-resend="${esc(email)}"]`; }
    } else {
      if (!linkSel) { setLinkErr(true); document.getElementById('linksel')?.focus(); return; }
      const { pid, name } = confirm, email = linkSel; cdlg.current?.close(); setConfirm(null);
      if (await action('link', { email, participant_id: pid })) {
        setToast({ text: t('link.toast', { name, email }), undo: async () => { setToast(null); await action('unlink', { email }); } });
      }
    }
  }

  if (!st) return null;
  const R = st.invitees;
  const T = st.tracking;
  const counts: Record<Filter, number> = { all: R.length, queued: 0, sent: 0, failed: 0, bounced: 0, blocked: 0, answered: 0, waiting: 0, public: st.public_answers.length };
  for (const r of R) for (const f of ['queued', 'sent', 'failed', 'bounced', 'blocked', 'answered', 'waiting'] as const) if (inFilter(r, f)) counts[f]++;
  const F: [Filter, string][] = T
    ? [['all', t('st.fAll')], ['answered', t('st.fAnswered')], ['waiting', t('st.fWaiting')], ['failed', t('st.fFailed')], ['blocked', t('st.fBlocked')], ['public', t('st.fPublic')]]
    : [['all', t('st.fAll')], ['sent', t('st.fSent')], ['failed', t('st.fFailed')], ['blocked', t('st.fBlocked')]];
  if (counts.queued) F.splice(1, 0, ['queued', t('st.fQueued')]);
  const openInvitees = R.filter((r) => r.response === 'invited' && mailable(r));
  const ans = (r: Row) => r.response && (<>
    <span className={ANS[r.response][2]} style={r.response === 'invited' ? { background: 'var(--c-bg)', border: '1px solid var(--c-border-strong)', color: 'var(--c-text)' } : undefined}><span aria-hidden="true">{ANS[r.response][1]}</span> {tr(ANS[r.response][0])}</span>
    {r.linked_from && <div className="meta">{t('st.linkedFrom', { name: r.linked_from })} · <button type="button" className="link-btn" onClick={() => action('unlink', { email: r.email })}>{t('common.undo')}</button></div>}
  </>);
  const act = (r: Row) => !r.response || !mailable(r) ? <span className="meta">–</span>
    : r.response === 'revoked' ? <button type="button" className="btn btn--ghost btn--sm" data-resend={r.email} onClick={() => resend(r)}>{t('st.newLink')}</button>
    : <div className="row-actions"><button type="button" className="btn btn--ghost btn--sm" data-resend={r.email} onClick={() => resend(r)}>{t('st.newLink')}</button>
        <button type="button" className="btn btn--danger-ghost btn--sm" data-revoke={r.email} onClick={() => setConfirm({ kind: 'revoke', email: r.email })}>{t('st.revoke')}</button></div>;
  const list = R.filter((r) => inFilter(r, filter));
  const show = showAll ? list : list.slice(0, 8);
  const rem = st.reminder, recips = rem.recipient_count;
  const waitMs = rem.next_allowed_at ? new Date(rem.next_allowed_at).getTime() - now : 0;
  const maxed = rem.used >= rem.max, cooling = !maxed && waitMs > 0;
  const badge = (r: Row) => <span className={`st st--${DLV[r.delivery][2]}`}><span aria-hidden="true">{DLV[r.delivery][1]}</span> {tr(DLV[r.delivery][0])}</span>;
  const chipGroup = (cls: string, h: string, items: string[], kind: string, why: string) => items.length > 0 && (
    <div className={`chip-group chip-group--${cls}`}><p className="chip-group__h">{h} ({items.length})</p>
      <ul>{items.map((e, i) => <li key={i} className={`echip echip--${kind}`}><span className="echip__addr">{e}</span><span className="echip__why">{why}</span></li>)}</ul></div>
  );

  return (
    <section className="section" id="invite" aria-labelledby="inv-h">
      <h2 id="inv-h">{t('inv.h')}</h2>
      <p className="tz-note" style={{ marginTop: -8 }}>{t('inv.note')}</p>
      {closed ? (
        <div className="closed-banner" role="status" style={{ marginBottom: 'var(--s-3)' }}><span className="closed-banner__icon" aria-hidden="true">🔒</span>
          <div><h2>{t('poll.closedH')}</h2><p>{t('inv.closedP')}</p></div></div>
      ) : st.mail_blocked ? (
        <div className="alert" role="status">{t('app.mailBlocked')}</div>
      ) : (
        <form id="inv-form" noValidate onSubmit={send}>
          <div className="alert" role="alert" hidden={!err.length}>{err.map((x, i) => <div key={i}>{x}</div>)}</div>
          <div className="invite-usage" id="usage">
            <span>{rich('inv.usage', { used, max: MAX_PER_POLL, b })}</span>
            <span className="meter" role="img" aria-label={t('inv.meterAria', { n: used + b, max: MAX_PER_POLL })}><span className="meter-row">
              <span className="meter__used" style={{ width: `${(used / MAX_PER_POLL) * 100}%` }} />
              <span className="meter__batch" style={{ width: `${(Math.min(b, Math.max(left, 0)) / MAX_PER_POLL) * 100}%` }} /></span></span>
            <span>{t('inv.maxPerSend', { n: MAX_PER_SEND })}</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="addr">{t('inv.recipients')}</label>
            <textarea className="input" id="addr" rows={3} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={t('inv.addrPh')}
              autoComplete="off" spellCheck={false} aria-describedby="addr-hint addr-err" aria-invalid={!!batchErr || parsed.invalid.length > 0 || undefined} />
            <p className="field__hint" id="addr-hint">{rich('inv.addrHint')}</p>
            <div className="field__error" id="addr-err" aria-live="polite">{batchErr}</div>
            <div className="chip-groups" id="groups" aria-live="polite">
              {chipGroup('err', t('inv.grpInvalid'), parsed.invalid, 'invalid', t('inv.whyInvalid'))}
              {chipGroup('warn', t('inv.grpDup'), parsed.duplicates, 'dup', t('inv.whyDup'))}
              {chipGroup('warn', t('inv.grpAlready'), parsed.alreadyInvited, 'already', t('inv.whyAlready'))}
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="orgname">{t('app.orgName')} <span className="field__hint">{t('app.orgNameHint')}</span></label>
            <input className="input" id="orgname" maxLength={50} value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="name" placeholder={t('app.orgNamePh')} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pmsg">{t('inv.pmsg')} <span className="field__hint">{t('common.optional')}</span></label>
            <textarea className="input" id="pmsg" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} aria-describedby="pmsg-count pmsg-err"
              placeholder={t('inv.pmsgPh')} aria-invalid={!!msgErr || undefined} />
            <div className="field__meta"><div className="field__error" id="pmsg-err" aria-live="polite">{msgErr}</div>
              <span className={`counter${n > MESSAGE_MAX ? ' counter--over' : n >= 900 ? ' counter--warn' : ''}`} id="pmsg-count">{n} / {MESSAGE_MAX}</span></div>
          </div>
          <div className="switch-row"><label className="switch"><input type="checkbox" role="switch" id="track" checked={track} disabled={st.tracking}
            onChange={(e) => setTrack(e.target.checked)} aria-describedby="track-d" /><span className="switch__ui" aria-hidden="true" /><span className="switch__label">{t('inv.track')}</span></label>
            <p className="field__hint" id="track-d">{rich('inv.trackDesc')}
              {st.tracking && t('app.trackOn')}</p></div>
          <div className="mail-preview" id="mailprev"><dl>
            <dt>{t('inv.from')}</dt><dd><strong>{t('app.fromVal', { name: shownName })}</strong> {'<noreply@…>'}</dd>
            <dt>{t('inv.replyTo')}</dt><dd>{rich('app.replyNone')}</dd>
            <dt>{t('inv.to')}</dt><dd>{t('inv.toVal')}</dd>
            <dt>{t('inv.subject')}</dt><dd>{preview?.subject || '…'}</dd>
            <dt>{t('inv.link')}</dt><dd>{track ? rich('app.linkPersonalVal', { path: `/${locale}/p/${slug}#inv=…` }) : rich('inv.linkPublic', { path: `/${locale}/p/${slug}` })}</dd></dl>
            <details onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="btn btn--ghost btn--sm" style={{ margin: 'var(--s-2) var(--s-4)' }}>{t('inv.previewBtn')}</summary>
              {preview && <iframe title={t('inv.previewTitle')} sandbox="" srcDoc={preview.html} style={{ width: '100%', minHeight: 520, border: 0 }} />}
            </details>
          </div>
          <p className="privacy">{t('inv.privacy')}{track && t('inv.trackPrivacy')}</p>
          <div className="form-actions"><button className="btn btn--primary" id="inv-send" type="submit" disabled={!canSend} aria-busy={sending || undefined}>
            {t('inv.send', { n: b })}</button></div>
        </form>
      )}

      {!closed && R.length > 0 && (
        <div className="reminder" aria-labelledby="rem-h" id="reminder">
          <div className="reminder__row"><h3 id="rem-h" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{t('rem.h')}</h3>
            <span className="reminder__count"><span className="dots" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i < rem.used ? 'on' : ''} />)}</span> {t('app.remUsed', { used: rem.used, max: rem.max })}</span></div>
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>{T
            ? rich('rem.toOpen', { n: recips })
            : rich('app.remToAll', { n: recips })}</p>
          <div className="reminder__row">
            <button type="button" className="btn btn--secondary" id="rem-btn" ref={remBtn} disabled={maxed || cooling || !recips || st.mail_blocked}
              aria-describedby="rem-wait" onClick={() => { dlg.current?.showModal(); document.getElementById('rem-cancel')?.focus(); }}>{t('rem.btn', { n: recips })}</button>
            {maxed ? <span className="reminder__wait" id="rem-wait">{t('app.remMaxed', { max: rem.max })}</span>
              : cooling ? <span className="reminder__wait" id="rem-wait" role="timer" aria-live="off">{waitParts(waitMs).h ? rich('rem.cooldown', waitParts(waitMs)) : rich('app.remMin', waitParts(waitMs))}</span>
              : <span className="reminder__wait" id="rem-wait">{t('app.remRule', { max: rem.max })}</span>}
          </div>
        </div>
      )}

      {R.length > 0 && (
        <>
          <h3 id="st-h" style={{ margin: 'var(--s-5) 0 var(--s-2)' }}>{t('st.h')}</h3>
          <div className="filters" role="group" aria-label={t('st.filterAria')} id="filters">
            {F.map(([k, l]) => <button key={k} type="button" data-f={k} aria-pressed={filter === k} onClick={() => { setFilter(k); setShowAll(false); }}>{l}<span className="n">{counts[k]}</span></button>)}
          </div>
          {!narrow && <table className="rtable" id="rtable"><caption className="sr-only">{t('st.caption')}</caption>
            <thead>{T ? <tr><th scope="col">{t('st.colRecipient')}</th><th scope="col">{t('st.colDelivery')}</th><th scope="col">{t('st.colResponse')}</th><th scope="col"><span className="sr-only">{t('st.colActions')}</span></th></tr>
              : <tr><th scope="col">{t('st.colRecipient')}</th><th scope="col">{t('st.colDelivery')}</th><th scope="col">{t('st.colLatest')}</th></tr>}</thead>
            <tbody>{filter === 'public' ? null : show.length ? show.map((r) => T ? (
              <tr key={r.email}><td className="addr">{r.email}<div className="meta">{when(r.updated_at, locale)}</div></td><td>{badge(r)}{r.reason && r.delivery !== 'blocked' && <div className="meta">{r.reason}</div>}</td><td>{ans(r)}</td><td>{act(r)}</td></tr>
            ) : (
              <tr key={r.email}><td className="addr">{r.email}</td><td>{badge(r)}{r.reason && r.delivery !== 'blocked' && <div className="meta">{r.reason}</div>}</td><td className="meta">{when(r.updated_at, locale)}</td></tr>
            )) : <tr><td colSpan={T ? 4 : 3} className="meta">{t('st.none')}</td></tr>}</tbody>
          </table>}
          {narrow && <ul className="rlist" id="rlist">{filter === 'public' ? null : show.length ? show.map((r) => (
            <li key={r.email}><span className="addr">{r.email}</span><span className="badges">{badge(r)}{T && ans(r)}</span><span className="meta">{when(r.updated_at, locale)}{r.reason && r.delivery !== 'blocked' ? ` · ${r.reason}` : ''}</span>
              {T && <span style={{ gridColumn: '1/-1' }}>{act(r)}</span>}</li>
          )) : <li className="meta">{t('st.none')}</li>}</ul>}
          {T && (filter === 'all' || filter === 'public') && st.public_answers.length > 0 && (
            <div className="pub" aria-labelledby="pub-h" id="public-answers"><h4 id="pub-h">{t('pub.h')} <span className="meta">{t('pub.notInvitedParen')}</span></h4>
              <p className="field__hint">{t('pub.hint')}</p>
              <ul className="pub__list">{st.public_answers.map((p) => (
                <li key={p.id}><span className="pub__name">{p.name}</span><span className="st st--unsub">{t('st.fPublic')}</span>
                  <button type="button" className="btn btn--secondary btn--sm" data-linkp={p.id} onClick={() => { setLinkSel(''); setLinkErr(false); setConfirm({ kind: 'link', pid: p.id, name: p.name }); }}>{t('pub.linkTo')}</button></li>
              ))}</ul></div>
          )}
          {list.length > show.length && <p className="field__hint">{t('st.showing', { shown: show.length, total: list.length })} <button type="button" className="link-btn" onClick={() => setShowAll(true)}>{t('st.showAll')}</button></p>}
        </>
      )}

      <dialog className="modal" ref={dlg} aria-labelledby="rem-dh" aria-describedby="rem-dp" onClose={() => remBtn.current?.focus()}>
        <h2 id="rem-dh">{t('rem.dlgH', { n: recips })}</h2>
        <p id="rem-dp">{T ? rich('rem.dlgOpen', { n: recips }) : rich('rem.dlgAll', { n: recips })}{t('rem.dlgLeft', { left: rem.max - rem.used })}</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" id="rem-cancel" onClick={() => dlg.current?.close()}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" id="rem-ok" onClick={sendReminder}>{t('rem.dlgOk', { n: recips })}</button>
        </div>
      </dialog>

      <dialog className="modal" ref={cdlg} aria-labelledby="c-h" onClose={() => setConfirm(null)}>
        {confirm?.kind === 'revoke' && (<>
          <h2 id="c-h">{t('revoke.h', { email: confirm.email })}</h2>
          <p>{rich('app.revokeP')}</p>
          <div className="modal__actions"><button type="button" className="btn btn--ghost" id="c-cancel" onClick={() => cdlg.current?.close()}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--danger" id="c-ok" onClick={confirmOk}>{t('revoke.ok')}</button></div></>)}
        {confirm?.kind === 'resend' && (<>
          <h2 id="c-h">{t('resend.h', { email: confirm.email })}</h2>
          <p>{rich('resend.p', { answered: confirm.answered ? 'yes' : 'no' })}</p>
          <div className="modal__actions"><button type="button" className="btn btn--ghost" id="c-cancel" onClick={() => cdlg.current?.close()}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" id="c-ok" onClick={confirmOk}>{t('st.newLink')}</button></div></>)}
        {confirm?.kind === 'link' && (<>
          <h2 id="c-h">{t('link.h', { name: confirm.name })}</h2>
          <p>{t('link.p')}</p>
          <label className="field__label" htmlFor="linksel">{t('link.label')}</label>
          <select className="input" id="linksel" value={linkSel} aria-invalid={linkErr || undefined} aria-describedby="linksel-h" onChange={(e) => { setLinkSel(e.target.value); setLinkErr(false); }}>
            <option value="">{t('link.choose')}</option>{openInvitees.map((r) => <option key={r.email} value={r.email}>{r.email}</option>)}</select>
          <p className="field__hint" id="linksel-h">{linkErr ? t('app.chooseRecipient') : t('link.hint')}</p>
          <div className="modal__actions"><button type="button" className="btn btn--ghost" id="c-cancel" onClick={() => cdlg.current?.close()}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" id="c-ok" onClick={confirmOk}>{t('link.ok')}</button></div></>)}
      </dialog>
      <div aria-live="polite">{toast && <div className="toast-undo" role="status" id="inv-toast"><span>{toast.text}</span>{toast.undo && <button type="button" id="inv-undo" onClick={toast.undo}>{t('common.undo')}</button>}</div>}</div>
    </section>
  );
}
