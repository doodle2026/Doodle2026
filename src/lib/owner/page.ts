import { cookies } from 'next/headers';
import { sessionFromCookie } from './auth';

/** Server-side session check for /owner pages (cookie name depends on https). */
export async function pageSession() {
  const c = await cookies();
  return sessionFromCookie(c.get('__Host-ga_owner')?.value ?? c.get('ga_owner')?.value);
}
