#!/usr/bin/env node
// Lift login locks for an owner account: `npm run owner:unlock -- <username>`
//
// Uses DATABASE_URL from the environment (prod: run with the production DATABASE_URL, see docs/OWNER.md).
// Writes an 'unlock' row to the owner audit log (owner_login_log); lock checks ignore that username's failures before it
// (per username+IP backoff and the per-username ceiling). Failed attempts stay in the log as evidence – nothing is deleted.
// The per-IP spraying limit is not touched (it never blocks the owner from another network).
import { PrismaClient } from '@prisma/client';

const raw = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!raw) { process.stderr.write('usage: npm run owner:unlock -- <username>\n'); process.exit(2); }
const username = raw.normalize('NFKC').trim().toLowerCase().slice(0, 64); // same normalisation as normUsername()
const prisma = new PrismaClient();
try {
  const user = await prisma.ownerUser.findUnique({ where: { username }, select: { id: true } });
  if (!user) { process.stderr.write(`owner:unlock: no owner user "${username}"\n`); process.exitCode = 1; }
  else {
    const since = new Date(Date.now() - 24 * 3600_000);
    const fails = await prisma.ownerLoginLog.count({ where: { username, success: false, outcome: 'bad_credentials', at: { gt: since } } });
    await prisma.ownerLoginLog.create({ data: { username, userId: user.id, success: true, outcome: 'unlock', ip: '', userAgent: `cli owner:unlock (${process.env.USER || 'unknown'})`.slice(0, 255) } });
    process.stdout.write(`Unlocked "${username}" (${fails} failed attempts in the last 24 h no longer count). Logged in the audit log.\n`);
  }
} catch (e) {
  // exit 3 = database error (unreachable DB, bad DATABASE_URL, missing migration); 1 = unknown user; 2 = usage
  process.stderr.write(`owner:unlock: database error: ${e?.code ?? ''} ${String(e?.message ?? e).split('\n').pop()}\n`);
  process.exitCode = 3;
} finally { await prisma.$disconnect().catch(() => undefined); }
