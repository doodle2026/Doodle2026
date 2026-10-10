'use client';
import { googleCalendarUrlFor } from '@/lib/format';
import { useI18n } from '@/i18n/use';
import { bestMask, totals } from '@/lib/vote-client';

interface Opt { id: number; date: string }
export interface ResultEvent {
  slug: string; title: string; description: string; is_closed: boolean; chosen_option_id: number | null;
  time_options: Opt[]; participants: { votes: ('yes' | 'maybe' | 'no' | null)[] }[];
}

/**
 * Design §29 `.result-banner`: green when a time is chosen (open or closed), blue `--closed` when closed
 * without a choice (shows ★ best). Dates are plain days (same in every time zone).
 */
export default function ResultBanner({ event, isAdmin = false, appUrl, onClear, busy = false }:
  { event: ResultEvent; isAdmin?: boolean; appUrl: string; onClear?: () => void; busy?: boolean }) {
  const { t, fd, flc, locale } = useI18n();
  const idx = event.time_options.findIndex((o) => o.id === event.chosen_option_id);
  const chosen = idx >= 0 ? event.time_options[idx] : null;
  if (!chosen && !event.is_closed) return null;
  const T = totals(event.participants.map((p) => p.votes), event.time_options.length);
  const label = (o: Opt) => `${fd(o.date)} ${t('date.allDay')}`;
  // Design §0.5: "fre. 16. okt. 2026 (hele dagen)" with the suffix muted.
  const when = (o: Opt) => <>{fd(o.date)} <span className="allday">{t('date.allDay')}</span></>;

  if (!chosen) {
    const best = bestMask(T);
    const bests = event.time_options.filter((_, i) => best[i]);
    return (
      <div className="result-banner result-banner--closed" role="status" id="result-banner">
        <span className="result-banner__icon" aria-hidden="true">🔒</span>
        <div className="result-banner__body">
          <p className="result-banner__eyebrow">{bests.length ? t('app.bannerClosedBest') : t('poll.closedH')}</p>
          {bests.length > 0
            ? <span className="result-banner__when" suppressHydrationWarning>★ {bests.map(label).join(' / ')}</span>
            : <p className="result-banner__note">{t('app.bannerClosedNote')}</p>}
        </div>
      </div>
    );
  }
  const eyebrow = event.is_closed
    ? t('app.bannerClosedFinal')
    : isAdmin ? t('app.bannerAdminOpen') : t('date.finalIs');
  const tt = T[idx];
  return (
    <div className="result-banner" role="status" id="result-banner">
      <span className="result-banner__icon" aria-hidden="true">📅</span>
      <div className="result-banner__body">
        <p className="result-banner__eyebrow"><span className="chosen-badge">{t('vote.chosen')}</span> {eyebrow}</p>
        <span className="result-banner__when" suppressHydrationWarning>{when(chosen)}</span>
        {isAdmin && <span className="meta" style={{ display: 'block' }}>{flc(chosen.date)}</span>}
        <p className="result-banner__note">{isAdmin ? t('admin.resNote', { yes: tt.yes, maybe: tt.maybe }) : t('app.yesMaybe', { yes: tt.yes, maybe: tt.maybe })}</p>
        <div className="result-banner__actions">
          <a className="btn btn--secondary btn--sm" id="ics" href={`/api/events/${event.slug}/ics`} download>{t('admin.ics')}<span className="sr-only">{t('admin.icsSr')}</span></a>
          <a className="btn btn--secondary btn--sm" id="gcal" target="_blank" rel="noopener noreferrer"
            href={googleCalendarUrlFor(chosen, { title: event.title, description: event.description, url: `${appUrl}/${locale}/p/${event.slug}` })}>
            {t('admin.google')}
          </a>
          {isAdmin && !event.is_closed && onClear && (
            <button type="button" className="btn btn--ghost btn--sm" data-clear-choice onClick={onClear} disabled={busy}>{t('admin.removeChoice')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
