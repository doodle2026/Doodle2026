import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { pageSession, safeNext } from '@/lib/owner/page';
import LoginForm from '../LoginForm';
import OwnerChrome from '../OwnerChrome';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.loginTitle'), robots: { index: false, follow: false } };
}

export default async function OwnerLogin({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  const next = safeNext(locale, sp.next);
  if (await pageSession()) redirect(next);
  const t = await getTranslations({ locale: locale as Locale });
  return (
    <OwnerChrome locale={locale as Locale} active={null}>
      <main className="container owner-login" id="main">
        <section className="card" aria-labelledby="ol-h">
          <h1 id="ol-h">{t('owner.loginTitle')}</h1>
          <p className="lead">{t('owner.loginLead')}</p>
          <LoginForm next={next} notice={sp.out ? 'out' : sp.expired ? 'expired' : null} />
          <p className="privacy">{`🔒 ${t('owner.loginNote')}`}</p>
        </section>
      </main>
    </OwnerChrome>
  );
}
