import { NextResponse } from 'next/server';
import { applyWebhook } from '@/lib/invitations';
import { jsonError, logError } from '@/lib/http';
import { verifySvix } from '@/lib/webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Resend delivery events → per-recipient status. Signature-verified (RESEND_WEBHOOK_SECRET); 401 otherwise. */
export async function POST(req: Request) {
  const body = (await req.text()).slice(0, 256 * 1024);
  if (!verifySvix(process.env.RESEND_WEBHOOK_SECRET, req.headers, body)) return jsonError(401, ['Ugyldig signatur.']);
  try {
    const evt = JSON.parse(body);
    return NextResponse.json(await applyWebhook(evt));
  } catch (e) {
    if (e instanceof SyntaxError) return jsonError(400, ['Ugyldig JSON.']);
    logError('resend webhook', e);
    return jsonError(500, ['Serverfejl.']);
  }
}
