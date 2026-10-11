/**
 * EMAIL_MODE=capture – for the tester only: keeps FULL rendered mails (incl. invite/unsubscribe tokens) in memory and
 * appends them as JSONL to EMAIL_CAPTURE_FILE (default ./.email-capture/mails.jsonl, gitignored). Never sends.
 *
 * Hard gate (checked at RUNTIME, not compile time): NODE_ENV === 'test' AND no VERCEL AND VERCEL_ENV not
 * preview/production. Otherwise capture refuses: logged config error, mailer falls back to log mode (redacted, never sends).
 * NODE_ENV is read dynamically (bracket access) so Next's build-time `process.env.NODE_ENV` inlining can't fake it.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

type Env = Record<string, string | undefined>;
export interface CapturedMail {
  id: string; at: string; from: string; to: string[]; subject: string; text: string; html?: string;
  replyTo?: string; headers?: Record<string, string>; tags?: { name: string; value: string }[]; idempotencyKey?: string;
}

/**
 * Build-time NODE_ENV (Next inlines this literal): 'production' for any `next build` output. A production build is
 * never allowed to capture, even if started with NODE_ENV=test in its environment (next start doesn't override it).
 */
const BUILT_FOR = process.env.NODE_ENV;

/** Why capture is NOT allowed in this environment, or null if it is. */
export function captureRefusal(env: Env = process.env, builtFor: string | undefined = BUILT_FOR): string | null {
  if (builtFor === 'production') return 'this is a production build';
  const nodeEnv = env['NODE' + '_ENV'];
  if (nodeEnv !== 'test') return `NODE_ENV is "${nodeEnv ?? ''}", not "test"`;
  if (env.VERCEL) return 'running on Vercel (VERCEL is set)';
  const ve = (env.VERCEL_ENV ?? '').toLowerCase();
  if (ve === 'preview' || ve === 'production') return `VERCEL_ENV=${ve}`;
  return null;
}
export const captureAllowed = (env: Env = process.env) => captureRefusal(env) === null;
/** Capture endpoints/features are live only when EMAIL_MODE=capture AND the gate passes. */
export const captureActive = (env: Env = process.env) => (env.EMAIL_MODE ?? '').trim().toLowerCase() === 'capture' && captureAllowed(env);

const g = globalThis as unknown as { __gaMailCapture?: CapturedMail[] };
const store = () => (g.__gaMailCapture ??= []);
export const captureFile = (env: Env = process.env) => resolve(env.EMAIL_CAPTURE_FILE || './.email-capture/mails.jsonl');

export function recordMail(m: Omit<CapturedMail, 'id' | 'at'>, env: Env = process.env): CapturedMail {
  if (!captureAllowed(env)) throw new Error('email capture is not allowed in this environment'); // defence in depth
  const rec: CapturedMail = { id: `cap_${globalThis.crypto.randomUUID()}`, at: new Date().toISOString(), ...m };
  const s = store();
  s.push(rec);
  if (s.length > 1000) s.splice(0, s.length - 1000);
  const f = captureFile(env);
  try { mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, JSON.stringify(rec) + '\n'); }
  catch (e) { console.error(`[email:capture] could not append to file (${e instanceof Error ? e.message : 'error'})`); }
  return rec;
}
export const capturedMails = () => [...store()];
export const clearCaptured = () => { store().length = 0; };

/**
 * Tester hook (capture mode only): EMAIL_CAPTURE_FAIL=<regex> makes sends to matching recipients fail (as a provider error);
 * with EMAIL_CAPTURE_FAIL_ONCE=1 each matching address fails only the first time. Inert unless capture is active.
 */
export function captureShouldFail(to: string[], env: Env = process.env): boolean {
  const pat = env.EMAIL_CAPTURE_FAIL;
  if (!pat || !captureActive(env)) return false;
  let re: RegExp; try { re = new RegExp(pat, 'i'); } catch { return false; }
  const hit = to.find((x) => re.test(x));
  if (!hit) return false;
  if (env.EMAIL_CAPTURE_FAIL_ONCE === '1') {
    const g = globalThis as { __gaCaptureFailed?: Set<string> };
    g.__gaCaptureFailed ??= new Set();
    if (g.__gaCaptureFailed.has(hit.toLowerCase())) return false;
    g.__gaCaptureFailed.add(hit.toLowerCase());
  }
  return true;
}
