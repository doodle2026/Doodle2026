import { detectLocale, isLocale, LOCALE_COOKIE, type Locale } from './config';

/** Locale for data written by an API request: body.locale (sent by our pages) → NEXT_LOCALE cookie → Accept-Language → en. */
export function requestLocale(req: Request, body?: unknown): Locale {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>).locale : undefined;
  if (isLocale(b)) return b;
  const cookie = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1);
  return detectLocale(cookie, req.headers.get('accept-language'));
}
