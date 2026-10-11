import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { pageSession } from '@/lib/owner/page';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.dashTitle'), robots: { index: false, follow: false } };
}

/** Placeholder until Doodle UI's dashboard design arrives (PR C). Server-side session check. */
export default async function OwnerHome({ params }: Props) {
  const { locale } = await params;
  const s = await pageSession();
  if (!s) redirect(`/${locale}/owner/login`);
  const t = await getTranslations({ locale: locale as Locale });
  return (
    <main className="container">
      <section className="card" id="owner-home">
        <h1>{t('owner.dashTitle')}</h1>
        <p className="meta" id="owner-who">{t('owner.signedInAs', { user: s.username })}</p>
        <p>{t('app.ownerPlaceholder')}</p>
        <LogoutButton loginUrl={`/${locale}/owner/login`} />
      </section>
    </main>
  );
}
