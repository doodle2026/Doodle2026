import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import LogoutButton from './LogoutButton';

/** Owner header (§47): logo + "Owner" badge, nav (aria-current), signed-in user, logout. */
export default async function OwnerChrome({ locale, active, user, children }: { locale: Locale; active: 'dash' | 'events' | 'log' | null; user?: string; children: React.ReactNode }) {
  const t = await getTranslations({ locale });
  const base = `/${locale}/owner`;
  const nav: [typeof active, string, string][] = [['dash', base, t('owner.navDash')], ['events', `${base}/events`, t('owner.navEvents')], ['log', `${base}/log`, t('owner.navLog')]];
  const [pre, post] = t('owner.signedInAs', { user: '\u0001' }).split('\u0001');
  return (
    <div className="owner">
      <a className="sr-only skip" href="#main">{t('app.ownerSkip')}</a>
      <header className="app-header owner-header">
        <Link className="app-header__logo" href={active ? base : `${base}/login`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/favicon.svg" alt="" width={24} height={24} />{'GrabAday '}<span className="owner-badge">{t('owner.brand')}</span>
        </Link>
        {active && (
          <nav className="owner-nav" aria-label={t('owner.navAria')}>
            {nav.map(([k, href, label]) => <Link key={k} href={href} aria-current={k === active ? 'page' : undefined}>{label}</Link>)}
          </nav>
        )}
        <div className="app-header__actions">
          {user && <span className="owner-user meta" id="owner-who">{pre}<strong>{user}</strong>{post}</span>}
          {user && <LogoutButton loginUrl={`${base}/login?out=1`} />}
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
