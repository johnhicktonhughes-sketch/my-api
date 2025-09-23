// app/api/whatsapp/route.ts
export const dynamic = 'force-dynamic'; // don't cache verification
// (Do NOT set runtime: 'edge' — use Node runtime for simplicity)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  // WhatsApp sends JSON bodies for events
  const body = await req.json().catch(() => ({}));
  // TODO: process body.entry[0].changes[0].value.{messages|statuses}
  // Always 200 quickly; do heavy work async via a queue if needed
  return Response.json({ ok: true });
}
