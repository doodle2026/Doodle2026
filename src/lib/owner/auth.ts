/**
 * Owner dashboard auth (spec "Ejer-dashboard" › Adgang). Owner/ops accounts only – poll users never have accounts.
 *
 * - Passwords: argon2id, m=19456 KiB, t=2, p=1 (OWASP Password Storage Cheat Sheet minimum), min 12 chars.
 * - Sessions: random 256-bit id; cookie = `<id>.<HMAC(OWNER_SESSION_SECRET, id)>`; DB stores only SHA-256(id).
 *   HttpOnly, SameSite=Strict, Secure (+ `__Host-` prefix) on https. Absolute expiry 12 h, idle expiry 2 h.
 *   A new id is issued on every login (old cookie's session deleted); logout deletes the session.
 * - CSRF: SameSite=Strict + same-origin check (Origin / Sec-Fetch-Site) + token in `X-CSRF-Token`:
 *   before login a double-submit token (HttpOnly cookie ↔ value returned by GET /api/owner/csrf),
 *   after login HMAC(secret, "csrf:" + session id) (returned by GET /api/owner/me).
 * - Throttling: ≥ 5 failed logins in 15 min per IP (truncated: IPv4 /24, IPv6 /48) or per username → locked until the window frees up (429 + Retry-After).
 *   Counted from the audit log table, so it works across serverless instances.
 * - Audit log: every success/failure/lockout/logout with truncated IP, user agent and time (owner_login_log). Never the password.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { prisma } from '@/lib/db';
import { clientIp } from '@/lib/client-ip';

export const ARGON2_OPTS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const MIN_PASSWORD = 12;
export const SESSION_ABS_MS = 12 * 3600_000;
export const SESSION_IDLE_MS = 2 * 3600_000;
export const LOCK_WINDOW_MS = 15 * 60_000;
export const LOCK_MAX_FAILS = 5;
export const GENERIC_LOGIN_ERROR = 'Forkert brugernavn eller password';

export const hashPassword = (pw: string) => argonHash(pw, ARGON2_OPTS);
export const normUsername = (u: unknown) => (typeof u === 'string' ? u.normalize('NFKC').trim().toLowerCase().slice(0, 64) : '');
export function validatePassword(pw: string): string | null {
  return [...pw].length < MIN_PASSWORD ? `Password skal have mindst ${MIN_PASSWORD} tegn.` : null;
}

/** OWNER_SESSION_SECRET (≥ 32 chars). Required in production; a fixed dev value elsewhere. */
export function ownerSecret(): string | null {
  const s = process.env.OWNER_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  const prod = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview' || (process.env.APP_URL ?? '').startsWith('https://');
  return prod ? null : 'dev-only-owner-session-secret-not-for-production!';
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('base64url');
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** https → Secure + __Host- prefix; plain http (local dev/tests only) → no Secure flag. */
export const isSecure = (req: Request) => new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
export const sessionCookieName = (secure: boolean) => (secure ? '__Host-ga_owner' : 'ga_owner');
export const preCookieName = (secure: boolean) => (secure ? '__Host-ga_owner_pre' : 'ga_owner_pre');

export function cookieHeader(name: string, value: string, secure: boolean, maxAgeSec: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${maxAgeSec}`;
}
export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Same-origin check for state-changing requests (CSRF layer 1). */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.get('origin');
  if (!origin) return site === 'same-origin';
  const allowed = new Set([new URL(req.url).origin]);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) allowed.add(`${isSecure(req) ? 'https' : 'http'}://${host}`);
  return allowed.has(origin);
}

// ---- pre-login CSRF (double submit) ----
export function newPreToken() { return randomBytes(32).toString('base64url'); }
export function checkPreCsrf(req: Request): boolean {
  const c = readCookie(req, preCookieName(isSecure(req))), h = req.headers.get('x-csrf-token');
  return !!c && !!h && c.length >= 32 && safeEq(c, h);
}

// ---- sessions ----
export type OwnerSessionInfo = { userId: number; username: string; idHash: string; csrf: string };

function parseCookie(secret: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig || id.length !== 43) return null;
  return safeEq(sig, hmac(secret, `sess:${id}`)) ? id : null;
}

/** Resolve the session from a raw cookie value (pages pass cookies().get(), routes pass the request). */
export type SessionEnd = 'absolute' | 'idle' | 'ended' | null;
/** Session + why it is gone: 'absolute' (12 h), 'idle' (2 h), 'ended' (logged out / replaced / unknown). The reason is exact on the
 *  first request after expiry (the row is deleted then); later requests with the same cookie report 'ended'. */
export async function sessionCheck(raw: string | null | undefined): Promise<{ s: OwnerSessionInfo | null; end: SessionEnd }> {
  const secret = ownerSecret(); if (!secret) return { s: null, end: null };
  const id = parseCookie(secret, raw); if (!id) return { s: null, end: raw ? 'ended' : null };
  const idHash = sha256(id);
  const s = await prisma.ownerSession.findUnique({ where: { idHash }, include: { user: { select: { username: true } } } });
  const now = Date.now();
  if (!s) return { s: null, end: 'ended' };
  const end: SessionEnd = s.expiresAt.getTime() <= now ? 'absolute' : s.lastSeenAt.getTime() + SESSION_IDLE_MS <= now ? 'idle' : null;
  if (end) { await prisma.ownerSession.delete({ where: { idHash } }).catch(() => undefined); return { s: null, end }; }
  if (now - s.lastSeenAt.getTime() > 60_000) await prisma.ownerSession.update({ where: { idHash }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  return { s: { userId: s.userId, username: s.user.username, idHash, csrf: hmac(secret, `csrf:${id}`) }, end: null };
}
export async function sessionFromCookie(raw: string | null | undefined): Promise<OwnerSessionInfo | null> {
  const secret = ownerSecret(); if (!secret) return null;
  const id = parseCookie(secret, raw); if (!id) return null;
  const idHash = sha256(id);
  const s = await prisma.ownerSession.findUnique({ where: { idHash }, include: { user: { select: { username: true } } } });
  const now = Date.now();
  if (!s || s.expiresAt.getTime() <= now || s.lastSeenAt.getTime() + SESSION_IDLE_MS <= now) {
    if (s) await prisma.ownerSession.delete({ where: { idHash } }).catch(() => undefined);
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 60_000) await prisma.ownerSession.update({ where: { idHash }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  return { userId: s.userId, username: s.user.username, idHash, csrf: hmac(secret, `csrf:${id}`) };
}
export const sessionFromRequest = (req: Request) => sessionFromCookie(readCookie(req, sessionCookieName(isSecure(req))));

/** Session-bound CSRF check for state-changing owner routes (after login). */
export function checkSessionCsrf(req: Request, s: OwnerSessionInfo): boolean {
  const h = req.headers.get('x-csrf-token');
  return sameOrigin(req) && !!h && safeEq(h, s.csrf);
}

async function createSession(userId: number, secret: string) {
  const id = randomBytes(32).toString('base64url'); // 43 chars
  const now = Date.now();
  await prisma.ownerSession.create({ data: { idHash: sha256(id), userId, expiresAt: new Date(now + SESSION_ABS_MS) } });
  // housekeeping: drop this user's expired sessions
  await prisma.ownerSession.deleteMany({ where: { userId, OR: [{ expiresAt: { lte: new Date(now) } }, { lastSeenAt: { lte: new Date(now - SESSION_IDLE_MS) } }] } });
  return `${id}.${hmac(secret, `sess:${id}`)}`;
}

// ---- login ----
/** PM 11 Oct: IPs are truncated BEFORE storage – IPv4 /24 (a.b.c.xxx), IPv6 /48 (x:y:z::/48). Also the lockout key. */
export function truncateIp(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip.trim());
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.xxx`;
  if (ip.includes(':')) {
    const [head] = ip.trim().toLowerCase().split('%');
    const parts = head.split('::'); const left = parts[0] ? parts[0].split(':') : []; const right = parts[1] ? parts[1].split(':') : [];
    const full = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    return `${full.slice(0, 3).map((h) => (h || '0').replace(/^0+(?=.)/, '')).join(':')}::/48`;
  }
  return 'unknown';
}
const meta = (req: Request) => ({ ip: truncateIp(clientIp(req)), userAgent: (req.headers.get('user-agent') ?? '').slice(0, 255) });
export async function audit(req: Request, username: string, userId: number | null, success: boolean, outcome: string) {
  await prisma.ownerLoginLog.create({ data: { username: username.slice(0, 64), userId, success, outcome, ...meta(req) } });
}

/** Seconds until the caller may try again, or 0 when not locked. */
export async function lockedFor(ip: string, username: string, now = Date.now()): Promise<number> {
  const since = new Date(now - LOCK_WINDOW_MS);
  const fails = await prisma.ownerLoginLog.findMany({
    where: { success: false, outcome: 'bad_credentials', at: { gt: since }, OR: [{ ip }, ...(username ? [{ username }] : [])] },
    select: { at: true, ip: true, username: true }, orderBy: { at: 'asc' },
  });
  let wait = 0;
  for (const group of [fails.filter((f) => f.ip === ip), username ? fails.filter((f) => f.username === username) : []]) {
    if (group.length >= LOCK_MAX_FAILS) {
      const oldest = group[group.length - LOCK_MAX_FAILS].at.getTime(); // window frees when this one ages out
      wait = Math.max(wait, Math.ceil((oldest + LOCK_WINDOW_MS - now) / 1000));
    }
  }
  return Math.max(0, wait);
}

let dummy: Promise<string> | null = null;
/** Verify against a dummy hash for unknown users so timing doesn't reveal which usernames exist. */
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

export type LoginResult = { ok: true; cookie: string } | { ok: false; status: 401 | 429 | 503; error: string; retryAfter?: number };

export async function login(req: Request, usernameIn: unknown, passwordIn: unknown, oldCookie: string | null): Promise<LoginResult> {
  const secret = ownerSecret();
  if (!secret) return { ok: false, status: 503, error: 'Ejer-login er ikke sat op på serveren.' };
  const username = normUsername(usernameIn);
  const password = typeof passwordIn === 'string' ? passwordIn.slice(0, 1024) : '';
  const { ip } = meta(req);
  const wait = await lockedFor(ip, username);
  if (wait > 0) { await audit(req, username, null, false, 'locked'); return { ok: false, status: 429, error: 'For mange forsøg. Prøv igen senere.', retryAfter: wait }; }
  const user = username ? await prisma.ownerUser.findUnique({ where: { username } }) : null;
  const good = await argonVerify(user?.passwordHash ?? (await dummyHash()), password || ' ').catch(() => false);
  if (!user || !good || !password) {
    await audit(req, username, user?.id ?? null, false, 'bad_credentials');
    return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR };
  }
  // rotation: whatever session the browser had is destroyed; a fresh id is issued
  const old = parseCookie(secret, oldCookie);
  if (old) await prisma.ownerSession.deleteMany({ where: { idHash: sha256(old) } });
  const cookie = await createSession(user.id, secret);
  await prisma.ownerUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(req, username, user.id, true, 'ok');
  return { ok: true, cookie };
}

export async function logout(req: Request, s: OwnerSessionInfo) {
  await prisma.ownerSession.deleteMany({ where: { idHash: s.idHash } });
  await audit(req, s.username, s.userId, true, 'logout');
}

/** Headers for every /owner page and /api/owner response. */
export const OWNER_HEADERS = { 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } as const;
