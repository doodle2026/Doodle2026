'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n/use';

/** Minimal placeholder login (Doodle UI design pending). Same message for unknown user and wrong password. */
export default function LoginForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const f = new FormData(e.currentTarget);
    try {
      const { csrf } = await (await fetch('/api/owner/csrf', { cache: 'no-store' })).json();
      const res = await fetch('/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) });
      if (res.ok) { location.replace(next); return; }
      const d = await res.json().catch(() => ({}));
      setErr(res.status === 401 ? t('owner.badLogin') : res.status === 429 ? t('owner.locked', { min: Math.ceil(Number(d.retry_after || 900) / 60) }) : res.status === 503 ? t('app.ownerNotConfigured') : t('app.ownerRetry'));
      (document.getElementById('owner-pw') as HTMLInputElement | null)?.select();
    } catch { setErr(t('app.ownerRetry')); }
    setBusy(false);
  }
  return (
    <form className="card" onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
      <h1>{t('owner.loginTitle')}</h1>
      <div className="field"><label className="field__label" htmlFor="owner-user">{t('owner.username')}</label>
        <input className="input" id="owner-user" name="username" autoComplete="username" required autoCapitalize="none" spellCheck={false} /></div>
      <div className="field"><label className="field__label" htmlFor="owner-pw">{t('owner.password')}</label>
        <input className="input" id="owner-pw" name="password" type="password" autoComplete="current-password" required /></div>
      <p className="field__error" id="owner-err" role="alert">{err}</p>
      <button type="submit" className="btn btn--primary" id="owner-submit" disabled={busy} aria-busy={busy}>{t('owner.signIn')}</button>
    </form>
  );
}
