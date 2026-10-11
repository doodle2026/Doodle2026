import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { requireOwner } from '@/lib/owner/page';
import { activityLog, LOG_TYPES } from '@/lib/owner/stats';
import { ownerFmt } from '@/lib/owner/fmt';
import { logError } from '@/lib/http';
import OwnerChrome from '../OwnerChrome';
import { ErrorBox, Pager, type T } from '../parts';
import TypeSelect from './TypeSelect';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.logTitle'), robots: { index: false, follow: false } };
}
const TY: Record<string, [string, string]> = { login_ok: ['✓', 'ok'], login_failed: ['✕', 'bad'], locked: ['⛔', 'bad'], logout: ['⇥', ''], view: ['👁', ''] };

/** Read-only activity log (§47.8): logins + detail views, IPs truncated at write time, no export. */
export default async function OwnerLog({ params, searchParams }: Props) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const sp = await searchParams;
  const type = sp.type && sp.type in LOG_TYPES ? sp.type : '';
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const base = `/${locale}/owner/log`;
  const href = (p: number) => { const u = new URLSearchParams(); if (type) u.set('type', type); if (p > 1) u.set('page', String(p)); const q = u.toString(); return q ? `${base}?${q}` : base; };
  const s = await requireOwner(locale, href(page));
  const t = await getTranslations({ locale });
  const f = ownerFmt(locale);
  let r: Awaited<ReturnType<typeof activityLog>> | null = null;
  try { r = await activityLog(type || undefined, page); } catch (e) { logError('owner log', e); }
  let body: React.ReactNode, res = '';
  if (!r) body = <ErrorBox locale={locale} href={base} />;
  else if (!r.total) body = <div className="card owner-empty"><p>{type ? `🔍 ${t('owner.logNoResults')}` : `🗒 ${t('owner.logEmpty')}`}</p></div>;
  else {
    const from = (r.page - 1) * r.pageSize;
    res = `${t('owner.logEntries', { n: r.total })} · ${t('owner.showing', { from: f.n(from + 1), to: f.n(from + r.rows.length), total: f.n(r.total) })}`;
    body = (
      <>
        <div className="card ocard-table"><table className="otable otable--cards" id="o-log"><caption className="sr-only">{t('owner.logTitle')}</caption>
          <thead><tr><th scope="col">{t('owner.cTime')}</th><th scope="col">{t('owner.cEvent')}</th><th scope="col">{t('owner.cUser')}</th><th scope="col">{t('owner.cDetails')}</th></tr></thead>
          <tbody>{r.rows.map((e, i) => (
            <tr key={i} data-type={e.type}>
              <th scope="row" data-label={t('owner.cTime')}><time dateTime={e.at}>{f.dt(e.at)}</time></th>
              <td data-label={t('owner.cEvent')}><span className={`olog-type olog-type--${TY[e.type]?.[1] ?? ''}`}><span aria-hidden="true">{TY[e.type]?.[0] ?? '·'}</span>{` ${t(`owner.lt.${e.type}` as 'owner.lt.view')}`}</span></td>
              <td data-label={t('owner.cUser')}>{e.known ? e.user : <span className="meta">{t('owner.unknownUser', { user: e.user })}</span>}</td>
              <td data-label={t('owner.cDetails')}>{e.event
                ? (e.event.title !== null ? <a href={`/${locale}/owner/events/${e.event.id}`}>{e.event.title}</a> : <span className="meta">{t('owner.deletedTitle')}</span>)
                : e.ip ? <span className="olog-ip">{t('owner.ipLabel', { ip: e.ip })}</span> : <span className="meta">{'–'}</span>}</td>
            </tr>
          ))}</tbody></table></div>
        <Pager t={t as unknown as T} page={r.page} pages={Math.max(1, Math.ceil(r.total / r.pageSize))} href={href} />
      </>
    );
  }
  return (
    <OwnerChrome locale={locale} active="log" user={s.username}>
      <main className="owner-container" id="main">
        <div className="owner-title"><div><h1>{t('owner.logTitle')}</h1><p className="lead">{t('owner.logLead')}</p></div><p className="meta">{t('owner.logRetention')}</p></div>
        <TypeSelect base={base} type={type} />
        <p className="ores meta" id="res" role="status">{res}</p>
        <div id="list">{body}</div>
      </main>
    </OwnerChrome>
  );
}
