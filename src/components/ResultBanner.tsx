'use client';
import { useEffect, useState } from 'react';
import { googleCalendarUrl, whenLong } from '@/lib/format';
import { bestMask, totals } from '@/lib/vote-client';

interface Opt { id: number; start_at: string; end_at: string | null }
export interface ResultEvent {
  slug: string; title: string; description: string; is_closed: boolean; chosen_option_id: number | null;
  time_options: Opt[]; participants: { votes: ('yes' | 'maybe' | 'no' | null)[] }[];
}

/**
 * Design §29 `.result-banner`: green when a time is chosen (open or closed), blue `--closed` when closed
 * without a choice (shows ★ best). Times render after mount only → always the viewer's time zone.
 */
export default function ResultBanner({ event, isAdmin = false, appUrl, onClear, busy = false }:
  { event: ResultEvent; isAdmin?: boolean; appUrl: string; onClear?: () => void; busy?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const idx = event.time_options.findIndex((o) => o.id === event.chosen_option_id);
  const chosen = idx >= 0 ? event.time_options[idx] : null;
  if (!chosen && !event.is_closed) return null;
  const T = totals(event.participants.map((p) => p.votes), event.time_options.length);
  const label = (o: Opt) => (mounted ? whenLong(o.start_at, o.end_at) : '…');

  if (!chosen) {
    const best = bestMask(T);
    const bests = event.time_options.filter((_, i) => best[i]);
    return (
      <div className="result-banner result-banner--closed" role="status" id="result-banner">
        <span className="result-banner__icon" aria-hidden="true">🔒</span>
        <div className="result-banner__body">
          <p className="result-banner__eyebrow">Afstemningen er lukket{bests.length ? ' · Bedste tidspunkt:' : ''}</p>
          {bests.length > 0
            ? <span className="result-banner__when" suppressHydrationWarning>★ {bests.map(label).join(' / ')}</span>
            : <p className="result-banner__note">Arrangøren har lukket for svar.</p>}
        </div>
      </div>
    );
  }
  const eyebrow = event.is_closed
    ? 'Afstemningen er lukket – endeligt tidspunkt'
    : isAdmin ? 'Endeligt tidspunkt (afstemningen er stadig åben)' : 'Tidspunktet er valgt';
  const t = T[idx];
  return (
    <div className="result-banner" role="status" id="result-banner">
      <span className="result-banner__icon" aria-hidden="true">📅</span>
      <div className="result-banner__body">
        <p className="result-banner__eyebrow"><span className="chosen-badge">✓ Valgt</span> {eyebrow}</p>
        <span className="result-banner__when" suppressHydrationWarning>{label(chosen)}</span>
        <p className="result-banner__note">{t.yes} ja, {t.maybe} måske.{isAdmin ? ' Deltagerne ser dette øverst på siden.' : ''}</p>
        <div className="result-banner__actions">
          <a className="btn btn--secondary btn--sm" id="ics" href={`/api/events/${event.slug}/ics`} download>📅 Tilføj til kalender (.ics)</a>
          <a className="btn btn--secondary btn--sm" id="gcal" target="_blank" rel="noopener noreferrer"
            href={googleCalendarUrl({ title: event.title, description: event.description, start: chosen.start_at, end: chosen.end_at, url: `${appUrl}/p/${event.slug}` })}>
            Google Kalender ↗
          </a>
          {isAdmin && !event.is_closed && onClear && (
            <button type="button" className="btn btn--ghost btn--sm" data-clear-choice onClick={onClear} disabled={busy}>Fjern valg</button>
          )}
        </div>
      </div>
    </div>
  );
}
