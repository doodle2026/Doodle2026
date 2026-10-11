import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LOCALE_NAMES, type Locale } from '@/i18n/config';
import { requireOwner } from '@/lib/owner/page';
import { eventDetail, logView } from '@/lib/owner/stats';
import { ownerFmt } from '@/lib/owner/fmt';
import { logError } from '@/lib/http';
import OwnerChrome from '../../OwnerChrome';
import { ErrorBox, StatusBadge } from '../../parts';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.evTitle'), robots: { index: false, follow: false } };
}

const DS = { sent: '✉', failed: '!', rejected: '⊘', answered: '✓' } as const;

/** Detail (§47.5). The view is logged (user + poll + time, no IP) BEFORE rendering. Never tokens or admin/edit/invite links. */
export default async function OwnerEvent({ params }: Props) {
  const { locale: l, id } = await params;
  const locale = l as Locale;
  const s = await requireOwner(locale, `/${locale}/owner/events/${encodeURIComponent(id)}`);
  const t = await getTranslations({ locale });
  const f = ownerFmt(locale);
  const back = <p><a href={`/${locale}/owner/events`}>{t('owner.back')}</a></p>;
  const wrap = (c: React.ReactNode) => <OwnerChrome locale={locale} active="events" user={s.username}><main className="owner-container" id="main">{back}{c}</main></OwnerChrome>;
  let e: Awaited<ReturnType<typeof eventDetail>>;
  try {
    e = /^[A-Za-z0-9_-]{1,22}$/.test(id) ? await eventDetail(id) : null;
    if (e) await logView(s.userId, s.username, id);
  } catch (err) { logError('owner detail', err); return wrap(<ErrorBox locale={locale} href={`/${locale}/owner/events/${id}`} />); }
  if (!e) return wrap(<div className="card owner-empty" id="o-notfound"><p>{`🔍 ${t('owner.notFound')}`}</p></div>);
  const now = new Date().toISOString();
  const dl = (k: string, v: React.ReactNode) => <div><dt>{t(k as 'owner.createdAt')}</dt><dd>{v}</dd></div>;
  const tl = e.timeline.map((x) => [x.at, x.type === 'created' ? t('owner.tl.created') : x.type === 'invites' ? t('owner.tl.invites', { n: x.n ?? 0 })
    : x.type === 'votes' ? t('owner.tl.votes', { n: x.n ?? 0 }) : x.type === 'reminder' ? t('owner.tl.reminder') : t('owner.tl.closed', { date: x.date ? f.date(x.date) : '–' })] as const);
  return wrap(
    <>
      <div className="owner-title">
        <div><h1>{e.title} <StatusBadge t={t as never} s={e.status as 'open'} /></h1><p className="meta">{`ID ${e.id}`}</p></div>
        <a className="btn btn--secondary btn--sm" id="o-public" href={e.publicUrl} target="_blank" rel="noopener noreferrer">{`↗ ${t('owner.publicLink')}`}</a>
      </div>
      <div className="owner-notes">
        <p className="onote">{`🔒 ${t('owner.noTokens')}`}</p>
        <p className="onote" id="o-viewlogged">{`👁 ${t('owner.viewLogged', { user: s.username, time: f.time(now) })}`}</p>
      </div>
      <div className="odetail">
        <section className="card">
          <dl className="ometa">
            {dl('owner.createdAt', f.dt(e.createdAt))}
            {e.closedAt && dl('owner.closedAt', f.dt(e.closedAt))}
            {dl('owner.language', LOCALE_NAMES[e.locale as Locale] ?? e.locale)}
            {dl('owner.tracking', t(e.tracking ? 'owner.on' : 'owner.off'))}
            {e.finalDate && dl('owner.cFinal', <strong>{f.date(e.finalDate)}</strong>)}
          </dl>
          <h2>{t('owner.descH')}</h2>
          <p className="odesc">{e.description || <span className="meta">{t('owner.noDesc')}</span>}</p>
        </section>
        <section className="card"><h2>{t('owner.timelineH')}</h2>
          <ol className="otl">{tl.map(([at, label], i) => <li key={i}><time dateTime={at}>{f.dt(at)}</time><span>{label}</span></li>)}</ol>
          {e.purgeAt && <p className="privacy">{t('owner.purgeNote', { date: f.date(e.purgeAt) })}</p>}
        </section>
      </div>
      <section className="card"><h2>{t('owner.optsH')} <span className="meta">{`(${e.options.length})`}</span></h2>
        <div className="oscroll"><table className="otable otable--opts" id="o-opts"><thead><tr><th scope="col">{t('owner.cDate')}</th><th scope="col" className="num">{t('owner.cYes')}</th><th scope="col" className="num">{t('owner.cMaybe')}</th><th scope="col" className="num">{t('owner.cNo')}</th></tr></thead>
          <tbody>{e.options.map((o) => (
            <tr key={o.date} className={o.final ? 'is-final' : undefined}><th scope="row">{f.date(o.date)} {o.final && <span className="ost ost--final">{`★ ${t('owner.finalBadge')}`}</span>}</th>
              <td className="num">{o.yes}</td><td className="num">{o.maybe}</td><td className="num">{o.no}</td></tr>
          ))}</tbody></table></div></section>
      <section className="card"><h2>{t('owner.partsH', { n: e.participants.length })}</h2>
        {e.participants.length ? (
          <table className="otable otable--cards" id="o-parts"><thead><tr><th scope="col">{t('owner.cName')}</th><th scope="col">{t('owner.cAnswered')}</th><th scope="col">{t('owner.cAnswers')}</th></tr></thead>
            <tbody>{e.participants.map((p, i) => (
              <tr key={i}><th scope="row" data-label={t('owner.cName')}>{p.name}</th><td data-label={t('owner.cAnswered')}>{f.dt(p.answeredAt)}</td>
                <td data-label={t('owner.cAnswers')}><span className="vote vote--yes">{`✓ ${p.yes}`}</span>{' '}<span className="vote vote--maybe">{`( ) ${p.maybe}`}</span>{' '}<span className="vote vote--no">{`✕ ${p.no}`}</span></td></tr>
            ))}</tbody></table>
        ) : <p className="meta">{t('owner.noParts')}</p>}
      </section>
      <section className="card"><h2>{t('owner.invH', { n: e.invitations.length })}</h2>
        {e.invitations.length ? (
          <table className="otable otable--cards" id="o-inv"><thead><tr><th scope="col">{t('owner.cEmail')}</th><th scope="col">{t('owner.cDelivery')}</th><th scope="col">{t('owner.cWhen')}</th></tr></thead>
            <tbody>{e.invitations.map((i) => (
              <tr key={i.email}><th scope="row" data-label={t('owner.cEmail')} className="addr">{i.email}</th>
                <td data-label={t('owner.cDelivery')}><span className={`ost ost--d-${i.status}`}>{`${DS[i.status as keyof typeof DS]} ${t(`owner.d.${i.status}` as 'owner.d.sent')}`}</span>
                  {i.unsubscribed && <>{' '}<span className="ost ost--unsub" title={t('owner.unsubMarkHint')}>{`– ${t('owner.unsubMark')}`}</span><div className="meta">{t('owner.unsubMarkHint')}</div></>}</td>
                <td data-label={t('owner.cWhen')}>{f.dt(i.updatedAt)}</td></tr>
            ))}</tbody></table>
        ) : <p className="meta">{t('owner.noInv')}</p>}
      </section>
    </>,
  );
}
