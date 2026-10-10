import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const TEST_CRON_SECRET = 'test-cron-secret-0123456789abcdef';
export const TEST_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-webhook-secret-32-bytes!!!!').toString('base64');
const PIDFILE = '.next-test.pid'; // outside the dist dir (which is wiped before each build)

/** Kill a test server from a previous (aborted) run: by pidfile, then whatever still listens on the port. */
function killStale(port: string) {
  try {
    const pid = Number(readFileSync(PIDFILE, 'utf8'));
    if (pid > 0) process.kill(-pid, 'SIGTERM');
  } catch { /* no pidfile / already gone */ }
  try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }); } catch { /* nothing listening or no fuser */ }
}

/** N3: `npm test` works without extra env – fall back to .env.test (real env vars always win). */
function loadEnvTest() {
  if (!existsSync('.env.test')) return;
  for (const line of readFileSync('.env.test', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*(#.*)?$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
import type { TestProject } from 'vitest/node';

/**
 * Tests are black-box HTTP tests against a real Next.js server + Postgres (DATABASE_URL, any ?schema=).
 * - TEST_BASE_URL set → use that server as is.
 * - otherwise → `prisma migrate deploy`, `next build` (into .next-test) and `next start` on TEST_PORT (default 3100),
 *   so tests exercise production rendering (SSR 404 pages, prod CSP). TEST_SERVER=dev uses `next dev` instead (faster).
 */
let child: ChildProcess | undefined;

export default async function setup(project: TestProject) {
  loadEnvTest();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point at a Postgres test database');
  let base = process.env.TEST_BASE_URL;
  if (!base) {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    const port = process.env.TEST_PORT || '3100';
    base = `http://localhost:${port}`;
    const env = { ...process.env, APP_URL: base, NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next-test',
      EMAIL_MODE: 'capture' /* refused in this production build → log mode; proves capture is inert outside NODE_ENV=test */, CRON_SECRET: TEST_CRON_SECRET, RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET, EMAIL_DAILY_QUOTA: '100000', EMAIL_MONTHLY_QUOTA: '1000000', RATE_LIMIT_MAIL_PER_HOUR: '1000' };
    const dev = process.env.TEST_SERVER === 'dev';
    // V9: a test server left over from an aborted run keeps .next-test open / the port busy, and `next build`
    // then races with it (ENOENT build-manifest.json). Kill it, start from an empty dist dir, verify the build.
    killStale(port);
    rmSync('.next-test', { recursive: true, force: true, maxRetries: 3 });
    if (!dev) {
      execSync('npx next build', { stdio: 'inherit', env: { ...env, NODE_ENV: 'production' } });
      if (!existsSync('.next-test/BUILD_ID')) throw new Error('next build did not produce .next-test/BUILD_ID');
    }
    child = spawn('npx', ['next', dev ? 'dev' : 'start', '-p', port], {
      env: dev ? env : { ...env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    if (child.pid) writeFileSync(PIDFILE, String(child.pid));
    let log = '';
    mkdirSync('.next-test', { recursive: true });
    const file = createWriteStream('.next-test/server.log'); // tests assert no tokens ever reach the logs
    child.stdout!.on('data', (d) => { log += d; file.write(d); });
    child.stderr!.on('data', (d) => { log += d; file.write(d); });
    const deadline = Date.now() + 120_000;
    for (;;) {
      try { const r = await fetch(`${base}/api/events/warmup`); if (r.status === 404) break; } catch { /* not up yet */ }
      if (Date.now() > deadline || child.exitCode !== null) throw new Error('Next server did not start:\n' + log);
      await new Promise((r) => setTimeout(r, 500));
    }
    // Warm up (compile) the routes used by tests so per-test timeouts are not eaten by compilation.
    await fetch(`${base}/api/events`, { method: 'POST', body: '{}' });
    await fetch(`${base}/p/AAAAAAAAAAAAAAAAAAAAAA`);
    await fetch(`${base}/en`, { redirect: 'manual' });
    await fetch(`${base}/api/nope`);
  }
  project.provide('baseUrl', base);
  project.provide('serverLog', child ? '.next-test/server.log' : '');
  return async () => {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } }
    rmSync(PIDFILE, { force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext { baseUrl: string; serverLog: string }
}
