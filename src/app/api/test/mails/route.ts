import { NextResponse } from 'next/server';
import { captureActive, capturedMails, clearCaptured } from '@/lib/email/capture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEST ONLY. 404 unless EMAIL_MODE=capture and the capture gate passes (NODE_ENV=test, not Vercel/preview/production).
 * GET ?to=<address> filters by recipient; DELETE clears the in-memory list (the JSONL file is kept).
 */
const notFound = () => NextResponse.json({ errors: ['Ikke fundet.'] }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
const h = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(req: Request) {
  if (!captureActive()) return notFound();
  const to = new URL(req.url).searchParams.get('to')?.trim().toLowerCase();
  const mails = capturedMails().filter((m) => !to || m.to.some((x) => x.toLowerCase() === to));
  return NextResponse.json({ count: mails.length, mails }, { headers: h });
}
export async function DELETE() {
  if (!captureActive()) return notFound();
  clearCaptured();
  return NextResponse.json({ cleared: true }, { headers: h });
}
