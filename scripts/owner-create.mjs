#!/usr/bin/env node
// Create (or with --reset, re-password) an owner dashboard account. No public sign-up exists.
//
//   npm run owner:create -- [--username jan] [--reset]
//
// Uses DATABASE_URL from the environment (for prod: run with the production DATABASE_URL, see docs/OWNER.md).
// The password is read without echo from the terminal (asked twice). Without a TTY (CI/pipelines) it is read
// from the first line of stdin – never pass it as an argument or env var. The password is never printed or logged.
import { createInterface } from 'node:readline';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

const ARGON2_OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }; // keep in sync with src/lib/owner/auth.ts
const MIN = 12;
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { process.stderr.write(`owner:create: ${m}\n`); process.exit(1); };

function ask(q) {
  return new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stderr }); rl.question(q, (a) => { rl.close(); res(a); }); });
}
/** Hidden prompt: raw mode, nothing echoed (not even asterisks). */
function askHidden(q) {
  return new Promise((res, rej) => {
    const stdin = process.stdin; process.stderr.write(q);
    let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stderr.write('\n'); return res(buf); }
        if (c === '\u0003') { stdin.setRawMode(false); process.stderr.write('\n'); return rej(new Error('aborted')); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', on);
  });
}
async function stdinLine() {
  let data = ''; for await (const c of process.stdin) data += c;
  return data.split(/\r?\n/)[0];
}

const tty = process.stdin.isTTY;
let username = (opt('username') ?? (tty ? await ask('Brugernavn: ') : '')).normalize('NFKC').trim().toLowerCase();
if (!/^[a-z0-9._-]{3,64}$/.test(username)) die('brugernavn skal være 3–64 tegn: a–z, 0–9, . _ -  (angiv --username uden TTY)');
let pw;
if (tty) {
  pw = await askHidden('Password (min. 12 tegn): ');
  if ([...pw].length >= MIN && (await askHidden('Gentag password: ')) !== pw) die('de to passwords er ikke ens');
} else pw = await stdinLine();
if ([...(pw ?? '')].length < MIN) die(`password skal have mindst ${MIN} tegn`);

const prisma = new PrismaClient();
try {
  const passwordHash = await hash(pw, ARGON2_OPTS);
  pw = undefined;
  const existing = await prisma.ownerUser.findUnique({ where: { username } });
  if (existing && !flag('reset')) die(`brugeren "${username}" findes allerede (brug --reset for nyt password)`);
  if (existing) {
    await prisma.ownerUser.update({ where: { id: existing.id }, data: { passwordHash } });
    await prisma.ownerSession.deleteMany({ where: { userId: existing.id } }); // log out everywhere
    process.stderr.write(`Nyt password sat for "${username}"; alle sessioner er logget ud.\n`);
  } else {
    await prisma.ownerUser.create({ data: { username, passwordHash } });
    process.stderr.write(`Ejer-bruger "${username}" oprettet.\n`);
  }
} catch (e) {
  die(`fejl: ${e?.code ?? e?.name ?? 'ukendt'}`); // never print the error object (could contain input)
} finally { await prisma.$disconnect(); }
