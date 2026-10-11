import { cookies } from 'next/headers';
import { sessionCheck, sessionFromCookie } from './auth';

/** Server-side session check for /owner pages (cookie name depends on https). */
export async function pageSession() {
  const c = await cookies();
  return sessionFromCookie(c.get('__Host-ga_owner')?.value ?? c.get('ga_owner')?.value);
}

/** Page guard: no session → login with ?next= (and ?expired=1 when a stale cookie was sent). */
export async function requireOwner(locale: string, path: string): Promise<NonNullable<Awaited<ReturnType<typeof pageSession>>>> {
  const c = await cookies();
  const raw = c.get('__Host-ga_owner')?.value ?? c.get('ga_owner')?.value;
  const { s, end } = await sessionCheck(raw);
  if (s) return s;
  const { redirect } = await import('next/navigation');
  return redirect(`/${locale}/owner/login?next=${encodeURIComponent(path)}${end ? `&expired=${end}` : ''}`);
}
/** Only same-app owner paths are accepted as ?next= (no open redirect). */
export const safeNext = (locale: string, next: unknown) =>
  typeof next === 'string' && new RegExp(`^/${locale}/owner(/[A-Za-z0-9/_-]*)?(\\?[A-Za-z0-9=&%._-]*)?$`).test(next) && !next.includes('//') ? next : `/${locale}/owner`;
