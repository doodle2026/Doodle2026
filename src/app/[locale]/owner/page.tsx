import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/i18n/config';
import { requireOwner } from '@/lib/owner/page';
import { ownerStats } from '@/lib/owner/stats';
import { ownerFmt } from '@/lib/owner/fmt';
import { logError } from '@/lib/http';
import LocalTime, { ResetAt, TzNote } from './LocalTime';
import { split } from './split';
import OwnerChrome from './OwnerChrome';
import { ErrorBox, StatusBadge } from './parts';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }> };
type Stats = Awaited<ReturnType<typeof ownerStats>>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.dashTitle'), robots: { index: false, follow: false } };
}

function Chart({ days, k, label, cls, f, summary }: { days: Stats['daily']; k: 'polls' | 'votes'; label: string; cls: string; f: ReturnType<typeof ownerFmt>; summary: (total: string, max: string, date: string) => string }) {
  const W = 600, H = 170, pl = 34, pb = 24, pt = 8;
  const max = Math.max(1, ...days.map((d) => d[k])), step = max > 20 ? 10 : max > 5 ? 5 : 1, nice = Math.ceil(max / step) * step;
  const bw = (W - pl) / days.length, y = (v: number) => pt + (H - pt - pb) * (1 - v / nice);
  const total = days.reduce((a, d) => a + d[k], 0), top = days.reduce((a, d) => (d[k] > a[k] ? d : a), days[0]);
  const id = `c-${k}`, sum = summary(f.n(total), f.n(top[k]), f.short(top.date));
  return (
    <figure className={`ochart ochart--${cls}`}>
      <figcaption id={`${id}-t`} className="ochart__cap">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="none">
        <desc id={`${id}-d`}>{sum}</desc>
        {[0, 0.5, 1].map((fr) => (
          <g key={fr}><line x1={pl} x2={W} y1={y(nice * fr)} y2={y(nice * fr)} className="ochart__grid" />
            <text x={pl - 6} y={y(nice * fr) + 4} textAnchor="end" className="ochart__ax">{f.n(nice * fr)}</text></g>
        ))}
        {days.map((d, i) => (
          <rect key={d.date} x={pl + i * bw + 1.5} y={y(d[k])} width={bw - 3} height={Math.max(0, H - pb - y(d[k]))} rx={2} className="ochart__bar"><title>{`${f.short(d.date)}: ${f.n(d[k])}`}</title></rect>
        ))}
        {days.map((d, i) => (i % 7 === 1 || i === days.length - 1 ? <text key={`l${d.date}`} x={pl + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="ochart__ax">{f.short(d.date)}</text> : null))}
      </svg>
      <p className="sr-only">{sum}</p>
    </figure>
  );
}

export default async function OwnerDashboard({ params }: Props) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const s = await requireOwner(locale, `/${locale}/owner`);
  const t = await getTranslations({ locale });
  const f = ownerFmt(locale);
  let st: Stats | null = null;
  try { st = await ownerStats(); } catch (e) { logError('owner stats', e); }
  const ev = (q: string) => `/${locale}/owner/events${q}`;
  const title = <h1>{t('owner.dashTitle')}</h1>;
  if (!st) return <OwnerChrome locale={locale} active="dash" user={s.username}><main className="owner-container" id="main">{title}<ErrorBox locale={locale} href={`/${locale}/owner`} /></main></OwnerChrome>;
  const tz = st.dayTz;
  const { polls: P, participation: Pa, dates: D, languages: Lg, email: E, limits: Li } = st;
  const pct = E.sentToday / E.dailyLimit, lvl = pct >= 1 ? 'full' : pct >= 0.95 ? 'crit' : pct >= 0.8 ? 'warn' : 'ok';
  const buckets = [D.timeToClose.lt1, D.timeToClose.d1_3, D.timeToClose.d4_7, D.timeToClose.d8_14, D.timeToClose.gt14], bmax = Math.max(1, ...buckets);
  const lmax = Math.max(1, ...LOCALES.map((x) => Lg[x].polls)), pmax = Math.max(1, ...LOCALES.map((x) => Lg[x].participants));
  const [wp, wa] = t('owner.kWithPart', { pct: '\u0001' }).split('\u0001');
  const stRow = (k: 'open' | 'closed', n: number) => (
    <li key={k}><a href={ev(`?status=${k}`)} aria-label={t('owner.kStatusAria', { status: t(`owner.st.${k}` as 'owner.st.open'), n: f.n(n) })}><StatusBadge t={t} s={k} /><span className="okpi__num-sm">{f.n(n)}</span></a></li>
  );
  return (
    <OwnerChrome locale={locale} active="dash" user={s.username}>
      <main className="owner-container" id="main" aria-busy="false">
        <div className="owner-title">
          <div>{title}<p className="lead">{t('owner.dashLead')}</p></div>
          <div className="owner-title__meta">
            <p className="meta" id="o-updated">{split(t('owner.updated', { time: '\u0001' }), <LocalTime iso={st.generatedAt} kind="time" />)}</p>
            <p className="meta" id="o-dayrule">{'🕛 '}<ResetAt tz={tz} /></p>
            <TzNote />
          </div>
        </div>
        {lvl !== 'ok' && (
          <div className={`obanner obanner--${lvl === 'warn' ? 'warn' : 'crit'}`} role={lvl === 'warn' ? 'status' : 'alert'} id="o-quota-banner">
            <span className="obanner__icon" aria-hidden="true">{lvl === 'warn' ? '!' : '⛔'}</span>
            <div>
              <strong>{lvl === 'full' ? t('owner.qFullH') : lvl === 'crit' ? t('owner.qCritH', { pct: f.pct(pct) }) : t('owner.qWarnH', { pct: f.pct(pct) })}</strong>
              <p>{lvl === 'full' ? t('owner.qFullP') : t('owner.qWarnP', { n: E.sentToday, max: E.dailyLimit })}</p>
              {lvl !== 'warn' && <p className="meta">{t('owner.qAction')}</p>}
            </div>
          </div>
        )}
        {!P.total && <div className="owner-empty card"><p>{`📊 ${t('owner.emptyDash')}`}</p></div>}
        <div className="okpis">
          <section className="card okpi" aria-labelledby="k1"><h2 id="k1">{t('owner.kPolls')}</h2><p className="okpi__num" id="o-total">{f.n(P.total)}</p>
            <ul className="okpi__list">
              <li><a href={ev('?period=today')} id="o-today">{`${f.n(P.today)} ${t('owner.todayTz', { tz })}`}</a></li>
              <li><a href={ev('?period=7')}>{t('owner.k7', { n: f.n(P.d7) })}</a></li>
              <li><a href={ev('?period=30')}>{t('owner.k30', { n: f.n(P.d30) })}</a></li>
            </ul></section>
          <section className="card okpi" aria-labelledby="k2"><h2 id="k2">{t('owner.kStatus')}</h2>
            <ul className="okpi__status">
              {stRow('open', P.open)}{stRow('closed', P.closed)}
              <li id="o-deleted"><div className="okpi__static"><StatusBadge t={t} s="deleted" /><span className="okpi__num-sm">{f.n(P.deleted)}</span></div><p className="meta okpi__note">{t('owner.deletedCounter')}</p></li>
            </ul></section>
          <section className="card okpi" aria-labelledby="k3"><h2 id="k3">{t('owner.kParticipation')}</h2><p className="okpi__num">{t('owner.kParticipants', { n: f.n(Pa.participants) })}</p>
            <ul className="okpi__list"><li>{t('owner.kVotes', { n: f.n(Pa.votes) })}</li><li>{t('owner.kAvgPart', { n: f.d1(Pa.avgPerPoll) })}</li><li>{wp}<strong>{f.pct(Pa.shareWithParticipant)}</strong>{wa}</li></ul></section>
          <section className="card okpi" aria-labelledby="k4"><h2 id="k4">{t('owner.kDates')}</h2><p className="okpi__num">{t('owner.kAvgDates', { n: f.d1(D.avgPerPoll) })}</p>
            <h3 className="okpi__sub" id="k4b">{t('owner.kTtc')} <span className="meta">{`· ${t('owner.ttcMedian', { n: f.d1(D.timeToClose.medianDays) })}`}</span></h3>
            <ul className="ohist" aria-labelledby="k4b">{buckets.map((b, i) => (
              <li key={i}><span className="ohist__l">{t(`owner.ttc.${i}` as 'owner.ttc.0')}</span><span className="ohist__bar" style={{ ['--w' as string]: `${(b / bmax) * 100}%` }} /><span className="ohist__n">{f.n(b)}</span></li>
            ))}</ul></section>
          <section className="card okpi" aria-labelledby="k5"><h2 id="k5">{t('owner.kLang')}</h2>
            <table className="olang"><thead><tr><th scope="col"><span className="sr-only">{t('owner.fLang')}</span></th><th scope="col">{t('owner.langPolls')}</th><th scope="col">{t('owner.langParts')}</th></tr></thead>
              <tbody>{LOCALES.map((x) => (
                <tr key={x}><th scope="row"><a href={ev(`?pl=${x}`)} lang={x}>{LOCALE_NAMES[x]}</a></th>
                  <td><span className="obar" style={{ ['--w' as string]: `${(Lg[x].polls / lmax) * 100}%` }} />{f.n(Lg[x].polls)}</td>
                  <td><span className="obar obar--2" style={{ ['--w' as string]: `${(Lg[x].participants / pmax) * 100}%` }} />{f.n(Lg[x].participants)}</td></tr>
              ))}</tbody></table></section>
          <section className="card okpi okpi--mail" aria-labelledby="k6"><h2 id="k6">{t('owner.kMail')}</h2>
            <p className="okpi__sub">{t('owner.mailToday')} <span className="meta" id="o-mail-tz">{`(${tz})`}</span></p>
            <p className="okpi__num" id="o-mail">{t('owner.mailOf', { n: f.n(E.sentToday), max: f.n(E.dailyLimit) })}</p>
            <div className={`oquota oquota--${lvl}`} role="meter" aria-valuemin={0} aria-valuemax={E.dailyLimit} aria-valuenow={E.sentToday} aria-label={t('owner.mailBarAria', { n: E.sentToday, max: E.dailyLimit, pct: f.pct(pct) })}>
              <span style={{ ['--w' as string]: `${Math.min(1, pct) * 100}%` }} /><i style={{ left: '80%' }} aria-hidden="true" /></div>
            <dl className="omail">
              <div><dt>{t('owner.mailSent')}</dt><dd>{f.n(E.sent)}</dd></div><div><dt>{t('owner.mailFailed')}</dt><dd>{f.n(E.failed)}</dd></div>
              <div><dt>{t('owner.mailRejected')}</dt><dd>{f.n(E.rejected)}</dd></div><div><dt>{t('owner.mailUnsub')}</dt><dd>{f.n(E.unsubscribes)}</dd></div>
            </dl></section>
          <section className="card okpi okpi--lim" aria-labelledby="k7"><h2 id="k7">{t('owner.limH')}</h2>
            <table className="olim" id="o-limits"><thead><tr><th scope="col">{t('owner.limType')}</th><th scope="col" className="num">{t('owner.limTodayCol')} <span className="meta">{`(${tz})`}</span></th><th scope="col" className="num">{t('owner.lim7')}</th><th scope="col" className="num">{t('owner.lim30')}</th></tr></thead>
              <tbody>{(['poll', 'hour', 'ip', 'day'] as const).map((k) => (
                <tr key={k}><th scope="row">{t(`owner.lim.${k}` as 'owner.lim.poll')}</th>{[Li[k].today, Li[k].d7, Li[k].d30].map((v, i) => <td key={i} className="num">{v ? <strong>{f.n(v)}</strong> : <span className="meta">{'0'}</span>}</td>)}</tr>
              ))}</tbody></table>
            <p className="meta okpi__note">{`🔒 ${t('owner.limNote')}`}</p></section>
        </div>
        <section className="card ocharts" aria-labelledby="ch-h"><h2 id="ch-h">{`${t('owner.chartH')} (${tz})`}</h2>
          <div className="ocharts__grid">
            <Chart days={st.daily} k="polls" label={t('owner.chartPolls')} cls="a" f={f} summary={(total, max, date) => t('owner.chartSummary', { label: t('owner.chartPolls'), total, max, date })} />
            <Chart days={st.daily} k="votes" label={t('owner.chartVotes')} cls="b" f={f} summary={(total, max, date) => t('owner.chartSummary', { label: t('owner.chartVotes'), total, max, date })} />
          </div>
          <details className="otable-toggle"><summary>{t('owner.chartTable')}</summary><div className="oscroll"><table className="otable otable--compact"><caption className="sr-only">{t('owner.chartH')}</caption>
            <thead><tr><th scope="col">{t('owner.colDay')}</th><th scope="col">{t('owner.chartPolls')}</th><th scope="col">{t('owner.chartVotes')}</th></tr></thead>
            <tbody>{st.daily.map((d) => <tr key={d.date}><th scope="row">{f.short(d.date)}</th><td>{f.n(d.polls)}</td><td>{f.n(d.votes)}</td></tr>)}</tbody></table></div></details>
        </section>
        <section className="card" aria-labelledby="nw-h"><div className="owner-sechead"><h2 id="nw-h">{t('owner.newestH')}</h2><a href={ev('')}>{`${t('owner.allEvents')} →`}</a></div>
          {st.newest.length ? (
            <table className="otable otable--cards" id="o-newest"><thead><tr><th scope="col">{t('owner.cTitle')}</th><th scope="col">{t('owner.cCreated')}</th><th scope="col">{t('owner.cLang')}</th><th scope="col">{t('owner.cStatus')}</th><th scope="col" className="num">{t('owner.cParts')}</th></tr></thead>
              <tbody>{st.newest.map((e) => (
                <tr key={e.id}><th scope="row" data-label={t('owner.cTitle')}><a href={`/${locale}/owner/events/${e.id}`}>{e.title}</a></th>
                  <td data-label={t('owner.cCreated')}>{<LocalTime iso={e.createdAt} />}</td><td data-label={t('owner.cLang')}>{e.locale.toUpperCase()}</td>
                  <td data-label={t('owner.cStatus')}><StatusBadge t={t} s={e.status} /></td><td className="num" data-label={t('owner.cParts')}>{f.n(e.participants)}</td></tr>
              ))}</tbody></table>
          ) : <p className="meta">{t('owner.emptyEvents')}</p>}
        </section>
      </main>
    </OwnerChrome>
  );
}
