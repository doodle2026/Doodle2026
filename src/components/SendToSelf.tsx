'use client';
/**
 * "Send til mig selv" (design §48, send-to-self.js) – one shared trigger + <dialog> for the confirmation page and admin page.
 * Native showModal() (background inert) + Tab trap, Esc/backdrop close, focus back to the trigger, Enter submits,
 * aria-live announcements. Bottom sheet < 640 px, lifted above the on-screen keyboard via visualViewport (--kb).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

const RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
/** j***@j***.dk (first char of local part / first domain label + TLD). */
/** Same shape as the server's sent_to (spec): first letter of the local part, full domain – u***@example.com. */
export const maskSelf = (e: string) => { const i = e.lastIndexOf('@'); return `${e[0] ?? ''}***@${e.slice(i + 1)}`; };

export type StsError = 'required' | 'invalid' | 'blocked' | 'token' | 'wait' | 'poll_max' | 'ip' | 'hour' | 'quota' | 'server' | 'offline';
/** HTTP → error kind (§48.2, mapResponse() in send-to-self.js). */
/** Retry-After as delta-seconds or HTTP date → seconds (≥ 0). */
export function retrySecs(v: string | null, now = Date.now()): number {
  if (!v) return 0;
  const n = Number(v); if (Number.isFinite(n)) return Math.max(0, Math.ceil(n));
  const d = Date.parse(v); return Number.isFinite(d) ? Math.max(0, Math.ceil((d - now) / 1000)) : 0;
}
export function mapResponse(status: number, body: { reason?: string } | null, retryAfter: string | null): [StsError, { sec?: number; min?: number }?] {
  const s = retrySecs(retryAfter);
  if (status === 400) return ['invalid'];
  if (status === 401 || status === 403) return ['token'];
  if (status === 409) return ['blocked'];
  if (status === 429) {
    const r = body?.reason;
    return r === 'wait' ? ['wait', { sec: s || 60 }] : r === 'poll_max' ? ['poll_max'] : r === 'quota' ? ['quota'] : [r === 'hour' ? 'hour' : 'ip', { sec: s || 60, min: Math.ceil((s || 60) / 60) }];
  }
  return ['server'];
}

type Alert = { text: string; copy?: boolean; kind?: 'wait' | 'ip' | 'hour'; until?: number };
type View = { kind: 'form'; busy?: boolean; field?: string; alert?: Alert } | { kind: 'sent'; email: string; remaining: number };

export default function SendToSelf({ slug, token, adminUrl }: { slug: string; token: string; adminUrl: string }) {
  const t = useTranslations('self'), tc = useTranslations('common');
  const locale = useLocale();
  const dlg = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>({ kind: 'form' });
  const [val, setVal] = useState('');
  const [live, setLive] = useState('');
  const [copied, setCopied] = useState(false);
  const announce = (m: string) => { setLive(''); setTimeout(() => setLive(m), 40); };
  const [now, setNow] = useState(() => Date.now());
  const until = view.kind === 'form' ? view.alert?.until : undefined;
  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
  // Live countdown for wait/ip/hour: ticks every second, Send stays disabled until 0, then the message clears.
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => { const n = Date.now(); setNow(n); if (n >= until) { clearInterval(id); setView((v) => (v.kind === 'form' && v.alert?.until === until ? { kind: 'form' } : v)); } }, 1000);
    return () => clearInterval(id);
  }, [until]);
  const timedText = (a: Alert) => (a.kind === 'wait' ? t('errWait', { sec: left }) : t('errIp', { min: Math.ceil(left / 60) }));

  useEffect(() => {
    const d = dlg.current, vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!d || !vv) return;
    const upd = () => d.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
    vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd);
    return () => { vv.removeEventListener('resize', upd); vv.removeEventListener('scroll', upd); };
  }, []);
  useEffect(() => { // focus target after each view change
    if (!dlg.current?.open) return;
    if (view.kind === 'sent') document.getElementById('sts-done')?.focus();
    else if (!view.busy) (document.getElementById('sts-copy') ?? input.current)?.focus();
  }, [view]);

  const open = () => { setView({ kind: 'form' }); setCopied(false); dlg.current?.showModal(); document.documentElement.classList.add('sts-open'); setTimeout(() => input.current?.focus(), 0); };
  const close = () => { if (!dlg.current?.open) return; dlg.current.close(); };
  const onClosed = () => { document.documentElement.classList.remove('sts-open'); trigger.current?.focus(); };

  function fail(kind: StsError, x: { sec?: number; min?: number } = {}) {
    if (kind === 'required' || kind === 'invalid' || kind === 'blocked') {
      const msg = t(kind === 'required' ? 'errRequired' : kind === 'invalid' ? 'errInvalid' : 'errBlocked');
      setView({ kind: 'form', field: msg }); announce(msg); return;
    }
    const A: Record<string, Alert> = {
      wait: { text: t('errWait', { sec: x.sec ?? 60 }), kind: 'wait' }, poll_max: { text: t('errPollMax'), copy: true },
      ip: { text: t('errIp', { min: x.min ?? 1 }), copy: true, kind: 'ip' }, hour: { text: t('errIp', { min: x.min ?? 1 }), copy: true, kind: 'hour' },
      quota: { text: t('errQuota'), copy: true }, server: { text: t('errServer') }, offline: { text: t('errOffline') }, token: { text: t('errToken') },
    };
    const a = A[kind];
    if (a.kind) { const n = Date.now(); a.until = n + (x.sec ?? 60) * 1000; setNow(n); announce(a.text); }
    setCopied(false); setView({ kind: 'form', alert: a });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = val.trim();
    if (!v) return fail('required');
    if (!RE.test(v)) return fail('invalid');
    setView({ kind: 'form', busy: true }); announce(t('sending'));
    let r: Response;
    try {
      r = await fetch(`/api/polls/${encodeURIComponent(slug)}/send-to-self`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: v, locale }) });
    } catch { return fail('offline'); }
    const b = await r.json().catch(() => null) as { ok?: boolean; remaining?: number; reason?: string } | null;
    if (r.ok && b?.ok) {
      const m = (b as { sent_to?: string }).sent_to || maskSelf(v.toLowerCase());
      setView({ kind: 'sent', email: m, remaining: b.remaining ?? 0 }); announce(`${t('sentP', { email: m })} ${t('spam')}`);
      return;
    }
    const [k, x] = mapResponse(r.status, b, r.headers.get('Retry-After'));
    fail(k, x);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Tab') return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href]')].filter((x) => x.offsetParent);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
  const copyAdmin = () => { navigator.clipboard?.writeText(adminUrl).catch(() => undefined); setCopied(true); announce(t('copied')); };

  return (
    <>
      <button type="button" ref={trigger} className="btn btn--secondary" id="mailme" aria-haspopup="dialog" onClick={open}><span aria-hidden="true">{'✉'}</span> {tc('sendToSelf')}</button>
      <dialog ref={dlg} className="sts" aria-modal="true" aria-labelledby="sts-h" aria-describedby="sts-lead" onClose={onClosed} onKeyDown={onKeyDown}
        onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="sts__grab" aria-hidden="true" />
        <button type="button" className="sts__x" id="sts-x" aria-label={t('close')} onClick={close}>{'✕'}</button>
        {view.kind === 'sent' ? (
          <div className="sts__done">
            <div className="sts__check" aria-hidden="true">{'✓'}</div>
            <h2 id="sts-h" className="sts__h" tabIndex={-1}>{t('sentH')}</h2>
            {/* Receipt: exactly two lines – where it went, and the spam hint. The "N more" line below is separate (remaining ≤ 2). */}
            <p className="sts__lead sts__receipt" id="sts-lead">
              <span className="sts__line">{t('sentP', { email: '\u0001' }).split('\u0001').map((part, i) => (i ? <span key={i}><strong>{view.email}</strong>{part}</span> : part))}</span>
              <span className="sts__line sts__spam"><span aria-hidden="true">{'📬 '}</span>{t('spam')}</span>
            </p>
            {view.remaining <= 2 && <p className="meta sts__left">{t('left', { n: view.remaining })}</p>}
            <div className="sts__actions">
              <button type="button" className="btn btn--ghost" id="sts-again" hidden={!view.remaining} onClick={() => { setVal(''); setView({ kind: 'form' }); }}>{t('another')}</button>
              <button type="button" className="btn btn--primary" id="sts-done" onClick={close}>{t('done')}</button>
            </div>
          </div>
        ) : (
          <>
            <h2 id="sts-h" className="sts__h"><span aria-hidden="true">{'✉'}</span> {t('title')}</h2>
            <p id="sts-lead" className="sts__lead">{t('lead')}</p>
            {view.alert && (
              <div className="sts__alert" role={view.alert.until ? undefined : 'alert'} id="sts-alert">
                <p>{view.alert.until ? timedText(view.alert) : view.alert.text}</p>
                {view.alert.copy && <button type="button" className="btn btn--secondary btn--sm" id="sts-copy" onClick={copyAdmin}>{copied ? t('copied') : t('copyInstead')}</button>}
              </div>
            )}
            <form id="sts-form" noValidate onSubmit={submit}>
              <div className="field">
                <label className="field__label" htmlFor="sts-email">{t('emailLabel')}</label>
                <input ref={input} className="input" id="sts-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} enterKeyHint="send"
                  placeholder={t('emailPh')} value={val} onChange={(e) => setVal(e.target.value)} readOnly={view.busy} maxLength={254}
                  aria-invalid={view.field ? true : undefined} aria-describedby={view.field ? 'sts-err sts-note' : 'sts-note'} />
                {view.field && <p className="field__error" id="sts-err">{view.field}</p>}
                <p className="field__hint" id="sts-note"><span aria-hidden="true">{'🔒 '}</span>{t('noStore')}</p>
              </div>
              <div className="sts__actions">
                <button type="button" className="btn btn--ghost" id="sts-cancel" onClick={close}>{t('cancel')}</button>
                <button type="submit" className="btn btn--primary" id="sts-send" disabled={view.busy || left > 0} aria-busy={view.busy || undefined}>
                  {view.busy ? <><span className="spinner" aria-hidden="true" /> {t('sending')}</> : t('send')}
                </button>
              </div>
            </form>
          </>
        )}
        <p className="sr-only" id="sts-live" aria-live="polite">{live}</p>
      </dialog>
    </>
  );
}
