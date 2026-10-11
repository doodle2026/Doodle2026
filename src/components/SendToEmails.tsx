'use client';
/**
 * "Send til e-mails" on the confirmation page – design-spec §46.1–46.6 (phase 1: one address per line, Send per line).
 * Uses the existing invitations API (admin Bearer, Invitation model, limits, suppression list): one recipient per click.
 * PM: opted-out addresses are never revealed – the server answers "rejected" (neutral text), no pre-check.
 * Quota (poll/hour/day) comes with GET on load and with every send; status re-polled every 20 s while the tab is visible.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/use';
import { useLp } from '@/i18n/link';
import { graphemes, MESSAGE_MAX, validEmail } from '@/lib/recipients';

type Invitee = { email: string; delivery: string };
type Quota = { poll: number; hour: number; day: number }; // §46.8 QuotaRemaining
type St = 'idle' | 'sending' | 'sent' | 'failed' | 'bounced' | 'rejected';
type Row = { id: number; value: string; status: St; touched: boolean; earlier?: boolean };
const POLL_MS = 20_000;
let uid = 0;
/** Unsent drafts survive remounts (share panel hidden/shown) but not a reload (§46.2: drafts are lost on reload). */
const drafts = new Map<string, { rows: Row[]; message: string }>();
const newRow = (value = '', status: St = 'idle', earlier = false): Row => ({ id: ++uid, value, status, touched: !!value, earlier });
/** trim, drop mailto:, lower-case the domain (§46.3). */
export const normSe = (v: string) => { v = v.trim().replace(/^mailto:/i, ''); const i = v.lastIndexOf('@'); return i < 0 ? v : v.slice(0, i) + '@' + v.slice(i + 1).toLowerCase(); };
const key = (v: string) => normSe(v).toLowerCase();
const fromDelivery = (d: string): St => (d === 'bounced' ? 'bounced' : d === 'failed' ? 'failed' : 'sent');
const FINAL = new Set(['delivered', 'bounced', 'failed', 'unsub']);

export default function SendToEmails({ slug, token }: { slug: string; token: string }) {
  const { t, tr, locale } = useI18n();
  const lp = useLp();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<Row[]>(() => {
    const d = drafts.get(slug)?.rows ?? [];
    return [...d, ...Array.from({ length: Math.max(0, 5 - d.length) }, () => newRow())];
  });
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [pmOpen, setPmOpen] = useState(() => !!drafts.get(slug)?.message);
  const [message, setMessage] = useState(() => drafts.get(slug)?.message ?? '');
  const [live, setLive] = useState('');
  const [ipWait, setIpWait] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const loaded = useRef(false);
  const sentHere = useRef(0);

  const ipTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startIpWait = (sec: number) => {
    const until = Date.now() + sec * 1000; clearInterval(ipTimer.current);
    const tick = () => { const left = until - Date.now(); if (left <= 0) { clearInterval(ipTimer.current); setIpWait(null); } else setIpWait(Math.floor(left / 60_000)); };
    tick(); ipTimer.current = setInterval(tick, 15_000);
  };
  useEffect(() => () => clearInterval(ipTimer.current), []);
  useEffect(() => {
    drafts.set(slug, { rows: rows.filter((r) => !r.earlier && r.status !== 'sent' && r.status !== 'sending' && r.status !== 'bounced').map((r) => ({ ...r, status: r.status === 'failed' ? 'failed' : 'idle' })), message });
  }, [slug, rows, message]);
  const say = (m: string) => { setLive(''); setTimeout(() => setLive(m), 30); };
  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}/invitations${path}`, {
      ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return { res, data: await res.json().catch(() => ({})) };
  }, [slug, token]);

  const apply = useCallback((d: { invitees?: Invitee[]; remaining?: Quota }) => {
    if (d.remaining) setQuota(d.remaining);
    if (!d.invitees) return;
    const inv = d.invitees;
    setInvitees(inv);
    const by = new Map(inv.map((i) => [i.email, i.delivery]));
    setRows((rs) => {
      let next = rs.map((r) => {
        const d2 = by.get(key(r.value));
        if (!d2 || !(r.status === 'sent' || r.status === 'bounced' || r.status === 'failed')) return r;
        const s = fromDelivery(d2);
        if (s === 'bounced' && r.status !== 'bounced') say(t('se.liveBounced', { email: r.value }));
        return s === r.status ? r : { ...r, status: s };
      });
      if (!loaded.current) { // reload: earlier invitations on top, read-only
        loaded.current = true;
        next = [...inv.map((i) => newRow(i.email, fromDelivery(i.delivery), true)), ...next];
      }
      return next;
    });
  }, [t]);

  const refresh = useCallback(async () => { const { res, data } = await api(''); if (res.ok) apply(data); }, [api, apply]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      // stop polling once every sent invitation has a final status
      if (loaded.current && invitees.length && invitees.every((i) => FINAL.has(i.delivery))) return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, invitees]);

  const left = quota ? Math.min(quota.poll, quota.day, quota.hour) : Infinity;
  const limitMsg = !quota && ipWait === null ? '' : ipWait !== null ? t('se.limitIp', { min: ipWait }) : !quota ? '' : quota.day <= 0 ? t('se.limitDay') : quota.hour <= 0 ? t('se.limitHour') : quota.poll <= 0 ? t('se.limitPoll') : '';
  const invited = new Set(invitees.map((i) => i.email));

  function check(r: Row, i: number, all: Row[]): { kind: 'invalid' | 'already' | 'pending'; msg?: string } | null {
    if (r.earlier || r.status !== 'idle' && r.status !== 'failed' && r.status !== 'rejected') return null;
    const v = normSe(r.value); if (!v) return null;
    if (!validEmail(v)) return r.touched ? { kind: 'invalid', msg: t('se.invalid') } : { kind: 'pending' };
    if (invited.has(key(v))) return { kind: 'already', msg: `${t('se.already')} – ${t('se.alreadyHint')}` };
    const j = all.findIndex((o, k) => k < i && !o.earlier && normSe(o.value) && key(o.value) === key(v));
    if (j > -1) return { kind: 'already', msg: `${t('se.already')} – ${t('se.dupRow', { n: j + 1 - all.filter((o) => o.earlier).length })}` };
    return null;
  }
  const upd = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const focus = (sel: string) => setTimeout(() => rootRef.current?.querySelector<HTMLElement>(sel)?.focus(), 0);

  async function send(r: Row) {
    const i = rows.findIndex((x) => x.id === r.id);
    const value = normSe(r.value);
    const c = check({ ...r, value, touched: true }, i, rows);
    if (r.status === 'sending' || limitMsg || !validEmail(value) || (c && c.kind !== 'pending')) { upd(r.id, { touched: true, value }); return; }
    upd(r.id, { status: 'sending', value, touched: true });
    try {
      const { res, data } = await api('', { method: 'POST', body: JSON.stringify({ recipients: [value], message: message.trim() || undefined, locale }) });
      if (res.ok) {
        apply(data);
        const st = (data.results as { email: string; status: string }[] | undefined)?.find((x) => x.email === key(value))?.status;
        if (st === 'blocked') { upd(r.id, { status: 'rejected' }); say(`${t('se.blocked')}: ${value}`); focus(`#se-i${r.id}`); return; }
        if (st === 'failed') { upd(r.id, { status: 'failed' }); say(t('se.liveFailed', { email: value })); return; }
        sentHere.current++;
        setRows((rs) => {
          const next = rs.map((x) => (x.id === r.id ? { ...x, status: 'sent' as St } : x));
          const nx = next.find((o) => o.status === 'idle' && !o.earlier && !normSe(o.value));
          focus(nx ? `#se-i${nx.id}` : '#se-more');
          return next;
        });
        say(t('se.liveSent', { email: value }));
      } else {
        if (data.remaining) setQuota(data.remaining); else void refresh();
        if (res.status === 429 && data.code === 'ip_limit') startIpWait(Number(res.headers.get('Retry-After') || data.retry_after || 3600)); // §46.9: local countdown, no auto-resend
        upd(r.id, { status: data.code === 'already_invited' || data.code === 'no_new_recipients' ? 'idle' : 'failed' });
        if (data.code === 'no_new_recipients') void refresh();
        say(t('se.liveFailed', { email: value }));
      }
    } catch { upd(r.id, { status: 'failed' }); say(t('se.liveFailed', { email: value })); }
  }

  function more() {
    const idle = rows.filter((r) => !r.earlier && r.status === 'idle').length;
    const n = Math.min(5, Math.max(0, left - idle));
    if (!n) return;
    const add = Array.from({ length: n }, () => newRow());
    setRows((rs) => [...rs, ...add]); focus(`#se-i${add[0].id}`); say(t('se.liveRows'));
  }

  const idleCount = rows.filter((r) => !r.earlier && r.status === 'idle').length;
  const showMore = !limitMsg && idleCount < left;
  const pmLen = graphemes(message);
  let lineNo = 0;

  return (
    <section className="se" id="se" aria-labelledby="se-h" ref={rootRef}>
      <div className="se-head">
        <button type="button" className="se-toggle" id="se-toggle" aria-controls="se-body" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="se-toggle__icon" aria-hidden="true">✉</span>
          <span><span className="se-title" id="se-h">{t('se.title')}</span><span className="se-sub">{t('se.subtitle')}</span></span>
          <span className="se-caret" aria-hidden="true">▾</span>
        </button>
      </div>
      <div id="se-body" hidden={!open}>
        <p className="se-note"><span aria-hidden="true">🔒</span> {t('se.neverAdmin')} {quota && <span className="meta" id="se-left">{t('se.remaining', { n: quota.poll })}</span>}</p>
        <p className="se-note" id="se-linknote">{t('se.linkNote')}</p>
        {quota && <p className="se-note" id="se-quota" aria-live="polite">{t('se.quotaHint', { poll: quota.poll, day: quota.day, hour: quota.hour })}</p>}
        <div id="se-limit">{limitMsg && <p className="se-limit" role="alert"><span aria-hidden="true">{'⛔'}</span> {limitMsg}</p>}</div>
        <button type="button" className="link-btn se-pm-toggle" id="se-pm-toggle" aria-expanded={pmOpen} aria-controls="se-pm"
          onClick={() => { setPmOpen(!pmOpen); if (!pmOpen) focus('#se-pmsg'); }}>{'+ '}{t('se.pmsgToggle')}</button>
        <div className="field se-pm" id="se-pm" hidden={!pmOpen}>
          <label className="field__label" htmlFor="se-pmsg">{t('inv.pmsg')}</label>
          <textarea className="input" id="se-pmsg" rows={2} placeholder={t('inv.pmsgPh')} aria-describedby="se-pcount" value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={pmLen > MESSAGE_MAX} />
          <div className="field__meta"><span className="counter" id="se-pcount">{t('common.counter', { n: pmLen, max: MESSAGE_MAX })}</span></div>
        </div>
        <div id="se-rowsview">
          <ol className="se-rows" id="se-rows" aria-labelledby="se-h">
            {rows.map((r, i) => {
              if (!r.earlier) lineNo++;
              const n = r.earlier ? i + 1 : lineNo;
              const c = check(r, i, rows);
              const ro = r.earlier || r.status === 'sent' || r.status === 'sending' || r.status === 'bounced';
              const bad = c?.kind === 'invalid' || r.status === 'failed' || r.status === 'bounced' || r.status === 'rejected';
              const warn = c?.kind === 'already';
              const lim = !!limitMsg && r.status !== 'sent';
              const v = normSe(r.value);
              const dis = !v || (!!c && c.kind !== 'pending') || !validEmail(v) || lim || r.status === 'rejected';
              return (
                <li key={r.id} className={`se-row${ro ? ' is-done' : ''}${bad ? ' is-bad' : ''}${warn ? ' is-warn' : ''}`} data-row={r.id} data-status={r.earlier ? 'earlier' : r.status}>
                  <label className="sr-only" htmlFor={`se-i${r.id}`}>{t('se.emailLabel', { n })}</label>
                  <div className="se-row__line">
                    <input className="input se-input" id={`se-i${r.id}`} type="email" inputMode="email" autoComplete="off" spellCheck={false}
                      value={r.value} placeholder={i === 0 ? t('se.emailPh') : ''} aria-describedby={`se-s${r.id}`} readOnly={ro} aria-invalid={bad || undefined}
                      onChange={(e) => upd(r.id, { value: e.target.value, status: r.status === 'rejected' || r.status === 'failed' ? 'idle' : r.status })}
                      onBlur={(e) => { if (!r.touched && r.value.trim() && (e.relatedTarget as HTMLElement | null)?.dataset?.send !== String(r.id)) upd(r.id, { touched: true, value: normSe(r.value) }); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (r.status !== 'sent' && !ro) void send(r); } }} />
                    <span className="se-btnwrap">
                      {r.status === 'sending' ? <button type="button" className="btn btn--secondary btn--sm se-btn" disabled aria-busy="true"><span className="spinner" aria-hidden="true" /> {t('se.sending')}</button>
                        : r.status === 'bounced' ? <button type="button" className="btn btn--sm se-btn se-btn--bounced" disabled>{'⊘ '}{t('se.bouncedBtn')}</button>
                        : r.status === 'sent' || r.earlier ? <button type="button" className="btn btn--sm se-btn se-btn--done" disabled>{t('se.sent')}</button>
                        : r.status === 'failed' ? <button type="button" className="btn btn--secondary btn--sm se-btn" data-send={r.id} disabled={lim} onClick={() => send(r)}>{t('se.retry')}</button>
                        : <button type="button" className="btn btn--secondary btn--sm se-btn" data-send={r.id} disabled={dis} aria-label={t('se.sendAria', { n })} onClick={() => send(r)}>{t('se.send')}</button>}
                    </span>
                  </div>
                  <div className="se-row__st" id={`se-s${r.id}`} aria-live="off">
                    {r.earlier && r.status === 'sent' ? <span className="se-st se-st--sent">✓ {t('se.sentEarlier')}</span>
                      : r.status === 'failed' ? <span className="se-st se-st--err"><strong>{t('se.failed')}</strong> – {t('se.failedWhy')}</span>
                      : r.status === 'bounced' ? <span className="se-st se-st--err">{'⊘ '}{t('se.bounced')}</span>
                      : r.status === 'rejected' ? <span className="se-st se-st--err">– {t('se.blocked')}</span>
                      : c?.msg ? <span className={`se-st ${c.kind === 'invalid' ? 'se-st--err' : 'se-st--warn'}`}>{c.kind === 'invalid' ? '!' : '↺'} {c.msg}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn btn--ghost btn--sm" id="se-more" aria-label={t('se.moreAria')} hidden={!showMore} onClick={more}>{'+ '}{t('se.more')}</button>
        </div>
        <p className="privacy se-privacy">{tr('inv.privacy')}</p>
        <p className="se-adminlink"><a href={lp(`/p/${slug}/admin#${token}`)} id="se-admin">{t('se.adminLink')} {'→'}</a></p>
        <p className="sr-only" id="se-live" aria-live="polite">{live}</p>
      </div>
    </section>
  );
}
