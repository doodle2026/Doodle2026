'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { INTL_TAG, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/use';

/** Jan (a): timestamps in the viewer's local time with a zone label. The server (and the first client render) shows UTC
 *  with a "UTC" label, so there is no hydration mismatch; after mount it switches to the browser's zone. */
const fmt = (locale: string, iso: string, kind: 'dt' | 'time', tz?: string) => new Intl.DateTimeFormat(INTL_TAG[locale as Locale] ?? 'en-GB', {
  ...(kind === 'dt' ? { day: 'numeric', month: 'short', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}),
} as Intl.DateTimeFormatOptions).format(new Date(iso));
function useMounted() { const [m, setM] = useState(false); useEffect(() => setM(true), []); return m; }

export default function LocalTime({ iso, kind = 'dt' }: { iso: string; kind?: 'dt' | 'time' }) {
  const locale = useLocale(); const m = useMounted();
  return <time dateTime={iso} data-local={m ? '1' : undefined}>{fmt(locale, iso, kind, m ? undefined : 'UTC')}</time>;
}

/** "Resets at" = next UTC midnight shown in the viewer's zone. */
export function ResetAt({ tz }: { tz: string }) {
  const { t } = useI18n(); const locale = useLocale(); const m = useMounted();
  const now = new Date(); const mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  const local = fmt(locale, mid, 'time', m ? undefined : 'UTC');
  return <span id="o-reset">{t('owner.dayRule', { tz, time: local, local: `(${t('owner.localTime')})` })}</span>;
}

/** Clear statement: times are local, day counts + quota are on the UTC day. */
export function TzNote() {
  const { t } = useI18n(); const m = useMounted();
  const zone = m ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  return <p className="meta otz-note" id="o-tznote">{`🕑 ${t('app.ownerTzNote', { zone })}`}</p>;
}
