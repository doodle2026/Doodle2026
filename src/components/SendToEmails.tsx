'use client';
/**
 * "Send til e-mails" on the confirmation page (spec 11. okt. 2026, phase 1: one address per line, Send per line).
 * MINIMAL placeholder UI until Doodle UI's design arrives. Uses the existing invitations API (admin token, same model,
 * limits and suppression list); one recipient per request; status is re-polled every 20 s while open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/use';
import { useLp } from '@/i18n/link';
import { MESSAGE_MAX, normEmail, validEmail } from '@/lib/recipients';

type Invitee = { email: string; delivery: string };
type Quota = { poll_remaining: number; hour_remaining: number; day_remaining: number };
type Row = { key: number; email: string; touched: boolean; state: 'draft' | 'sending' | 'error'; error?: string };
const POLL_MS = 20_000;
let seq = 0;
const blank = (): Row => ({ key: ++seq, email: '', touched: false, state: 'draft' });

export default function SendToEmails({ slug, token }: { slug: string; token: string }) {
  const { t, locale } = useI18n();
  const lp = useLp();
  const [open, setOpen] = useState(true);
  const [sent, setSent] = useState<Invitee[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [closed, setClosed] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, blank));
  const [message, setMessage] = useState('');
  const busy = useRef(new Set<number>());

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}/invitations${path}`, {
      ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return { res, data: await res.json().catch(() => ({})) };
  }, [slug, token]);
  const apply = (d: { invitees?: Invitee[]; quota?: Quota; reminder?: { closed?: boolean } }) => {
    if (d.invitees) setSent(d.invitees); if (d.quota) setQuota(d.quota); if (d.reminder) setClosed(!!d.reminder.closed);
  };
  const refresh = useCallback(async () => { const { res, data } = await api(''); if (res.ok) apply(data); }, [api]);
  useEffect(() => { void refresh(); const id = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS); return () => clearInterval(id); }, [refresh]);

  const invited = new Set(sent.map((s) => s.email));
  const remaining = quota ? Math.min(quota.poll_remaining, quota.day_remaining, quota.hour_remaining) : 1;
  const limitMsg = !quota ? null : quota.poll_remaining <= 0 ? t('app.smLimitPoll', { n: 200 })
    : quota.day_remaining <= 0 ? t('app.smLimitDay') : quota.hour_remaining <= 0 ? t('app.smLimitHour') : null;
  const rowError = (r: Row) => {
    const e = normEmail(r.email);
    if (!e) return null;
    if (!validEmail(e)) return t('app.smInvalid');
    if (invited.has(e) || rows.some((o) => o.key !== r.key && normEmail(o.email) === e && o.key < r.key)) return t('app.smAlready');
    return null;
  };
  const upd = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function send(r: Row) {
    if (busy.current.has(r.key) || !normEmail(r.email) || rowError(r) || limitMsg || closed) { upd(r.key, { touched: true }); return; }
    busy.current.add(r.key); upd(r.key, { state: 'sending', error: undefined });
    try {
      const { res, data } = await api('', { method: 'POST', body: JSON.stringify({ recipients: [normEmail(r.email)], message: message.trim() || undefined, locale }) });
      if (res.ok) { apply(data); setRows((rs) => rs.filter((x) => x.key !== r.key)); return; }
      const code = data.code as string | undefined;
      const error = code === 'quota' ? t('app.smLimitDay') : code === 'too_many_per_poll' ? t('app.smLimitPoll', { n: 200 })
        : code === 'poll_hourly_limit' ? t('app.smLimitHour') : code === 'no_new_recipients' || code === 'already_invited' ? t('app.smAlready')
        : code === 'invalid_recipients' ? t('app.smInvalid') : code === 'closed' ? t('app.smClosed') : t('app.smError');
      upd(r.key, { state: 'error', error }); void refresh();
    } catch { upd(r.key, { state: 'error', error: t('app.smError') }); }
    finally { busy.current.delete(r.key); }
  }
  async function retry(email: string) {
    const { res, data } = await api('/retry', { method: 'POST', body: JSON.stringify({ email }) });
    if (res.ok) apply(data); else void refresh();
  }
  const statusOf = (d: string) => d === 'bounced' ? t('app.smBounced') : d === 'unsub' ? t('app.smUnsub') : d === 'failed' ? t('app.smNotSent') : t('app.smSent');
  const canMore = quota ? rows.length < Math.max(0, remaining) : true;

  return (
    <section className="card send-mails" id="send-mails" aria-labelledby="sm-h">
      <h2 id="sm-h" className="h3">
        <button type="button" className="link-btn" aria-expanded={open} aria-controls="sm-body" aria-label={t('app.smToggle')} onClick={() => setOpen(!open)}>
          {t('app.smTitle')}
        </button>
      </h2>
      <p className="field__hint">{t('app.smSub')}</p>
      {open && (
        <div id="sm-body">
          {limitMsg && <div className="alert" role="status" id="sm-limit">{limitMsg}</div>}
          <label className="label" htmlFor="sm-msg">{t('app.smMessage')}</label>
          <textarea className="input" id="sm-msg" rows={2} maxLength={MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} />
          <ul className="sm-list" id="sm-sent">
            {sent.map((s) => (
              <li key={s.email} className="sm-row" data-status={s.delivery}>
                <input className="input" readOnly value={s.email} aria-label={s.email} />
                <span className="meta">{statusOf(s.delivery)}</span>
                {s.delivery === 'failed' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => retry(s.email)}>{t('app.smRetry')}</button>}
              </li>
            ))}
          </ul>
          <ul className="sm-list" id="sm-rows">
            {rows.map((r, i) => {
              const err = r.touched ? rowError(r) : null;
              const disabled = !normEmail(r.email) || !!rowError(r) || r.state === 'sending' || !!limitMsg || closed;
              return (
                <li key={r.key} className="sm-row">
                  <input className="input" type="email" inputMode="email" autoComplete="off" value={r.email} aria-label={t('app.smEmailAria', { n: sent.length + i + 1 })}
                    aria-invalid={!!err} readOnly={r.state === 'sending'}
                    onChange={(e) => upd(r.key, { email: e.target.value, state: r.state === 'error' ? 'draft' : r.state, error: undefined })}
                    onBlur={() => upd(r.key, { touched: true })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(r); } }} />
                  <button type="button" className="btn btn--primary btn--sm" disabled={disabled} aria-busy={r.state === 'sending'} onClick={() => send(r)}>
                    {r.state === 'sending' ? t('app.smSending') : r.state === 'error' ? t('app.smRetry') : t('app.smSend')}
                  </button>
                  {(err || r.error) && <span className="field__error" role="alert">{r.state === 'error' ? `${t('app.smNotSent')}: ${r.error}` : err}</span>}
                </li>
              );
            })}
          </ul>
          {canMore && <button type="button" className="btn btn--secondary btn--sm" id="sm-more" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 5 }, blank)])}>{t('app.smMore')}</button>}
          <p><a href={lp(`/p/${slug}/admin#${token}`)} id="sm-admin">{t('app.smAdminLink')}</a></p>
        </div>
      )}
    </section>
  );
}
