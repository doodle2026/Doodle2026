import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LOCALE_NAMES, isLocale, type Locale } from '@/i18n/config';
import { requireOwner } from '@/lib/owner/page';
import { listEvents, SORTS } from '@/lib/owner/stats';
import { ownerFmt } from '@/lib/owner/fmt';
import { DAY_TZ } from '@/lib/owner/counters';
import { logError } from '@/lib/http';
import OwnerChrome from '../OwnerChrome';
import { ErrorBox, Pager, StatusBadge, type T } from '../parts';
import Filters from './Filters';
import { qs, type F } from './qs';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.evTitle'), robots: { index: false, follow: false } };
}

const COLS: [keyof typeof SORTS, string, 't' | 'n'][] = [['title', 'owner.cTitle', 't'], ['createdAt', 'owner.cCreated', 't'], ['locale', 'owner.cLang', 't'], ['status', 'owner.cStatus', 't'],
  ['dateCount', 'owner.cDates', 'n'], ['participants', 'owner.cParts', 'n'], ['invitesSent', 'owner.cSent', 'n'], ['invitesRejected', 'owner.cRejected', 'n'], ['finalDate', 'owner.cFinal', 't']];

export default async function OwnerEvents({ params, searchParams }: Props) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const sp = await searchParams;
  const base = `/${locale}/owner/events`;
  const f: F = {
    q: (sp.q ?? '').slice(0, 200), status: ['open', 'closed'].includes(sp.status ?? '') ? sp.status! : '', pl: isLocale(sp.pl) ? sp.pl : '',
    period: ['today', '7', '30', '90'].includes(sp.period ?? '') ? sp.period! : '', sort: sp.sort && sp.sort in SORTS ? sp.sort : 'createdAt', dir: sp.dir === 'asc' ? 'asc' : 'desc',
  };
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const s = await requireOwner(locale, base + qs({ ...f, page }));
  const t = await getTranslations({ locale });
  const tt = t as unknown as T;
  const fm = ownerFmt(locale);
  let r: Awaited<ReturnType<typeof listEvents>> | null = null;
  try { r = await listEvents({ ...f, page }); } catch (e) { logError('owner list', e); }
  const now = new Date().toISOString();
  const nfx = (v: number) => (v ? fm.n(v) : <span className="meta">{'0'}</span>);
  let body: React.ReactNode;
  let res = '';
  if (!r) body = <ErrorBox locale={locale} href={base} />;
  else {
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize)), from = (r.page - 1) * r.pageSize;
    const anyFilter = f.q || f.status || f.pl || f.period;
    res = (r.total ? `${t('owner.results', { n: r.total })} · ${t('owner.showing', { from: fm.n(from + 1), to: fm.n(from + r.rows.length), total: fm.n(r.total) })}` : '')
      + (!f.q && r.deletedNotShown ? `${r.total ? ' · ' : ''}${t('owner.deletedNotListed', { n: fm.n(r.deletedNotShown) })}` : '');
    if (!r.total && !anyFilter) body = <div className="card owner-empty"><p>{`📭 ${t('owner.emptyEvents')}`}</p></div>;
    else if (!r.rows.length) body = <div className="card owner-empty"><p>{`🔍 ${f.q ? t('owner.noResultsQ', { q: f.q }) : t('owner.noResults')}`}</p><a className="btn btn--secondary btn--sm" href={base}>{t('owner.clear')}</a></div>;
    else {
      const th = ([k, lk, ty]: (typeof COLS)[number]) => {
        const act = f.sort === k, nd = act ? (f.dir === 'asc' ? 'desc' : 'asc') : k === 'title' || k === 'locale' ? 'asc' : 'desc';
        return (
          <th key={k} scope="col" aria-sort={act ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={ty === 'n' ? 'num' : undefined}>
            <a className="osort" data-sort={k} href={base + qs({ ...f, sort: k, dir: nd })} aria-label={t('owner.sortAria', { col: tt(lk) })}>{tt(lk)}<span className="osort__i" aria-hidden="true">{act ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span></a>
          </th>
        );
      };
      const [mPre, mPost] = t('owner.emailMatch', { email: '\u0001' }).split('\u0001');
      body = (
        <>
          <div className="card ocard-table"><table className="otable otable--cards otable--events" id="o-events"><caption className="sr-only">{t('owner.evTitle')}</caption>
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>{r.rows.map((e) => (
              <tr key={e.id}>
                <th scope="row" data-label={t('owner.cTitle')}><a href={`${base}/${e.id}`}>{e.title}</a>{e.matchedEmail && <div className="meta">{mPre}<mark>{e.matchedEmail}</mark>{mPost}</div>}</th>
                <td data-label={t('owner.cCreated')}>{fm.dt(e.createdAt)}</td>
                <td data-label={t('owner.cLang')}><abbr title={LOCALE_NAMES[e.locale as Locale]} lang={e.locale}>{e.locale.toUpperCase()}</abbr></td>
                <td data-label={t('owner.cStatus')}><StatusBadge t={tt} s={e.status} /></td>
                <td className="num" data-label={t('owner.cDates')}>{nfx(e.dateCount)}</td>
                <td className="num" data-label={t('owner.cParts')}>{nfx(e.participants)}</td>
                <td className="num" data-label={t('owner.cSent')}>{nfx(e.invitesSent)}</td>
                <td className="num" data-label={t('owner.cRejected')}>{nfx(e.invitesRejected)}</td>
                <td data-label={t('owner.cFinal')}>{e.finalDate ? fm.date(e.finalDate) : <span className="meta">{'–'}</span>}</td>
              </tr>
            ))}</tbody></table></div>
          <Pager t={tt} page={r.page} pages={pages} href={(p) => base + qs({ ...f, page: p })} />
        </>
      );
    }
  }
  return (
    <OwnerChrome locale={locale} active="events" user={s.username}>
      <main className="owner-container" id="main">
        <div className="owner-title"><div><h1>{t('owner.evTitle')}</h1></div><p className="meta">{t('owner.updated', { time: fm.time(now) })}</p></div>
        <Filters base={base} f={f} dayTz={DAY_TZ} />
        <p className="ores meta" id="res" role="status" aria-live="polite">{res}</p>
        <div id="list">{body}</div>
      </main>
    </OwnerChrome>
  );
}
