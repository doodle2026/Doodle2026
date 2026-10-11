import { cookies } from 'next/headers';
import { sessionFromCookie } from './auth';

/** Server-side session check for /owner pages (cookie name depends on https). */
export async function pageSession() {
  const c = await cookies();
  return sessionFromCookie(c.get('__Host-ga_owner')?.value ?? c.get('ga_owner')?.value);
}

/** Page guard: no session → login with ?next= (and ?expired=1 when a stale cookie was sent). */
export async function requireOwner(locale: string, path: string): Promise<NonNullable<Awaited<ReturnType<typeof pageSession>>>> {
  const s = await pageSession();
  if (s) return s;
  const c = await cookies();
  const stale = Boolean(c.get('__Host-ga_owner') ?? c.get('ga_owner'));
  const { redirect } = await import('next/navigation');
  return redirect(`/${locale}/owner/login?next=${encodeURIComponent(path)}${stale ? '&expired=1' : ''}`);
}
/** Only same-app owner paths are accepted as ?next= (no open redirect). */
export const safeNext = (locale: string, next: unknown) =>
  typeof next === 'string' && new RegExp(`^/${locale}/owner(/[A-Za-z0-9/_-]*)?(\\?[A-Za-z0-9=&%._-]*)?$`).test(next) && !next.includes('//') ? next : `/${locale}/owner`;
