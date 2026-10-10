import { SLUG_RE } from '@/lib/validate';

// Legacy URL: /e/<id> → 301 /p/<id>. Malformed ids → 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SLUG_RE.test(id)) return new Response('Ikke fundet', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(null, { status: 301, headers: { Location: `/p/${id}` } });
}
