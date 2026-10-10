import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';

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
    const env = { ...process.env, APP_URL: base, NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next-test' };
    const dev = process.env.TEST_SERVER === 'dev';
    if (!dev) execSync('npx next build', { stdio: 'inherit', env: { ...env, NODE_ENV: 'production' } });
    child = spawn('npx', ['next', dev ? 'dev' : 'start', '-p', port], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
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
    await fetch(`${base}/e/AAAAAAAAAAAAAAAAAAAAAA`, { redirect: 'manual' });
    await fetch(`${base}/api/nope`);
  }
  project.provide('baseUrl', base);
  project.provide('serverLog', child ? '.next-test/server.log' : '');
  return async () => {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } }
  };
}

declare module 'vitest' {
  export interface ProvidedContext { baseUrl: string; serverLog: string }
}
