'use client';
import { useCallback } from 'react';
import { useLocale } from 'next-intl';
import { localePath, type Locale } from './config';
/** Client hook: prefix an app path with the active locale (stable per locale). */
export function useLp() {
  const l = useLocale() as Locale;
  return useCallback((p: string) => localePath(l, p), [l]);
}
