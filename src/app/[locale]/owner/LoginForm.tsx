'use client';
import { useRef, useState } from 'react';
import { useI18n } from '@/i18n/use';

type Msg = { kind: 'error' | 'info'; text: string } | null;
/** Owner login (§47.2). Same message for unknown user and wrong password; lock shows minutes (rounded up, <1 → "under 1 min"). */
export default function LoginForm({ next, notice }: { next: string; notice: 'out' | 'expired' | null }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState<Msg>(notice === 'out' ? { kind: 'info', text: `✓ ${t('owner.loggedOut')}` } : notice === 'expired' ? { kind: 'info', text: t('owner.expired') } : null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [show, setShow] = useState(false);
  const [errs, setErrs] = useState<{ user?: string; pw?: string }>({});
  const user = useRef<HTMLInputElement>(null), pw = useRef<HTMLInputElement>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const u = user.current!.value.trim(), p = pw.current!.value;
    const er = { user: u ? undefined : t('owner.reqUser'), pw: p ? undefined : t('owner.reqPw') };
    setErrs(er);
    if (er.user) return user.current!.focus();
    if (er.pw) return pw.current!.focus();
    setBusy(true); setMsg(null);
    try {
      const { csrf } = await (await fetch('/api/owner/csrf', { cache: 'no-store' })).json();
      const res = await fetch('/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ username: u, password: p }) });
      if (res.ok) { location.replace(next); return; }
      const d = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const s = Number(d.retry_after || res.headers.get('Retry-After') || 900);
        setLocked(true); setMsg({ kind: 'error', text: t('owner.locked', { min: s < 60 ? 0 : Math.ceil(s / 60) }) });
      } else {
        setMsg({ kind: 'error', text: res.status === 401 ? t('owner.badLogin') : res.status === 503 ? t('app.ownerNotConfigured') : t('owner.loadError') });
        pw.current!.value = ''; pw.current!.focus();
      }
    } catch { setMsg({ kind: 'error', text: t('owner.loadError') }); }
    setBusy(false);
  }
  return (
    <>
      <div id="ol-msg">{msg && <div className={`owner-msg owner-msg--${msg.kind}`} id="owner-err" role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}</div>
      <form id="ol-form" noValidate onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="owner-user">{t('owner.username')}</label>
          <input ref={user} className="input" id="owner-user" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={locked}
            aria-invalid={errs.user ? true : undefined} aria-describedby="ol-user-err" onInput={() => errs.user && setErrs({ ...errs, user: undefined })} />
          <p className="field__error" id="ol-user-err">{errs.user}</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="owner-pw">{t('owner.password')}</label>
          <div className="pw-wrap">
            <input ref={pw} className="input" id="owner-pw" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required disabled={locked}
              aria-invalid={errs.pw ? true : undefined} aria-describedby="ol-pw-err" onInput={() => errs.pw && setErrs({ ...errs, pw: undefined })} />
            <button type="button" className="btn btn--ghost btn--sm pw-toggle" aria-controls="owner-pw" aria-pressed={show} disabled={locked}
              aria-label={t(show ? 'owner.hidePwAria' : 'owner.showPwAria')} onClick={() => { setShow(!show); pw.current?.focus(); }}>{t(show ? 'owner.hidePw' : 'owner.showPw')}</button>
          </div>
          <p className="field__error" id="ol-pw-err">{errs.pw}</p>
        </div>
        <button type="submit" className="btn btn--primary owner-login__submit" id="owner-submit" disabled={busy || locked} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />{` ${t('owner.signingIn')}`}</> : t('owner.signIn')}
        </button>
      </form>
    </>
  );
}
