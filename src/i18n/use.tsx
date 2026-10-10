'use client';
import { useLocale, useTranslations } from 'next-intl';
import { formatDateLong, formatDateLongCap, formatDateShort, columnHead, monthLabel, weekdayHeads } from '@/lib/dates';
import type { Locale } from './config';
import { formatHtml, htmlToReact, type Vars } from './rich';
import type { Tr } from './translator';

/** Client i18n bundle: t (type-safe keys), rich (catalog HTML → React, vars escaped), date formatters in the active locale. */
export function useI18n() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const rich = (key: Parameters<typeof t.raw>[0], vars?: Vars) => htmlToReact(formatHtml(t.raw(key) as string, locale, vars));
  /** Untyped key variant for pure helpers in src/lib (keys are checked by i18n-check + tests). */
  const tr: Tr = (k, v) => (t as unknown as Tr)(k, v);
  return {
    t, tr, rich, locale,
    fd: (d: string) => formatDateShort(d, locale),
    fl: (d: string) => formatDateLong(d, locale),
    flc: (d: string) => formatDateLongCap(d, locale),
    head: (d: string) => columnHead(d, locale),
    month: (d: string) => monthLabel(d, locale),
    weekdays: () => weekdayHeads(locale),
  };
}
export type I18n = ReturnType<typeof useI18n>;
