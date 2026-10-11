// Tester-only server with EMAIL_MODE=capture: `npm run start:capture` → http://localhost:3001
// Runs Next in dev mode via a custom server so NODE_ENV stays "test" at runtime (next start/build force "production").
// Uses the test DB (.env.test) unless DATABASE_URL is set. Separate build dir (.next-capture) so it never clashes with :3000.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.test')) for (const line of readFileSync('.env.test', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
process.env.EMAIL_MODE = 'capture';
process.env.NEXT_DIST_DIR ||= '.next-capture';
process.env.EMAIL_LINK_SECRET ||= 'capture-only-local-link-secret-0123456789abcdef';
process.env.EMAIL_FROM ||= 'grabAday <test@grabaday.invalid>';
process.env.EMAIL_DAILY_QUOTA ||= '100000';
process.env.EMAIL_MONTHLY_QUOTA ||= '1000000';
const port = Number(process.env.PORT || 3001);
process.env.APP_URL ||= `http://localhost:${port}`;
if (process.env.NODE_ENV !== 'test') { console.error('[capture-server] refuse: NODE_ENV must be "test" (use npm run start:capture)'); process.exit(1); }
if (process.env.VERCEL || /^(preview|production)$/i.test(process.env.VERCEL_ENV || '')) { console.error('[capture-server] refuse: Vercel environment'); process.exit(1); }

const { default: next } = await import('next');
const app = next({ dev: true, hostname: 'localhost', port });
await app.prepare();
const handle = app.getRequestHandler();
createServer((req, res) => handle(req, res)).listen(port, () => console.log(`[capture-server] ready on http://localhost:${port} (EMAIL_MODE=capture, DB ${process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, '//***@')})`));
