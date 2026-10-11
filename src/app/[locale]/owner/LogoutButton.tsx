'use client';
import { useI18n } from '@/i18n/use';

export default function LogoutButton({ loginUrl }: { loginUrl: string }) {
  const { t } = useI18n();
  async function out() {
    const me = await fetch('/api/owner/me', { cache: 'no-store' });
    if (me.ok) { const { csrf } = await me.json(); await fetch('/api/owner/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); }
    location.replace(loginUrl);
  }
  return <button type="button" className="btn btn--secondary" id="owner-logout" onClick={out}>{t('owner.logout')}</button>;
}
